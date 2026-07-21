"""Sync Music FastAPI server."""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import auth
import database as db
import ws_manager
from youtube_api import GoogleAPIError, get_library, get_playlist_items, get_profile
from ytmusic_search import search_songs, search_suggestions

load_dotenv()

APP_NAME = "Sync Music"
ROOT_DIR = Path(__file__).parent
STATIC_DIR = ROOT_DIR / "static"
USERNAME_RE = re.compile(r"^[\w.-]+$", re.UNICODE)

app = FastAPI(title=APP_NAME, version="2.1.0")
db.init_db()


class RegisterBody(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=6, max_length=128)


class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)


class TokenBody(BaseModel):
    token: str


class FriendRequestBody(TokenBody):
    to_username: str


class FriendAcceptBody(TokenBody):
    from_username: str


class RoomInviteBody(TokenBody):
    room_code: str
    to_username: str


class GoogleProfileBody(TokenBody):
    display_name: str = Field(default="", max_length=120)
    avatar_url: str = Field(default="", max_length=1000)
    email: str = Field(default="", max_length=254)


def clean_username(value: str) -> str:
    username = value.strip()
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(
            status_code=400,
            detail="В имени можно использовать буквы, цифры, точку, дефис и подчёркивание",
        )
    return username


def require_user(token: str) -> str:
    username = auth.get_username(token)
    if not username:
        raise HTTPException(status_code=401, detail="Сессия истекла. Войди заново")
    return username


def require_google_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Подключи Google/YouTube-аккаунт")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Google-токен отсутствует")
    return token


def google_call(callback: Any, *args: Any) -> Any:
    try:
        return callback(*args)
    except GoogleAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": APP_NAME, "version": "2.1.0"}


@app.get("/api/config")
def public_config() -> dict[str, Any]:
    return {
        "googleClientId": os.getenv("GOOGLE_CLIENT_ID", "").strip(),
        "youtubeOAuthEnabled": bool(os.getenv("GOOGLE_CLIENT_ID", "").strip()),
    }


@app.post("/api/register")
def register(body: RegisterBody) -> dict[str, str]:
    username = clean_username(body.username)
    if db.user_exists(username):
        raise HTTPException(status_code=409, detail="Такой пользователь уже существует")
    db.create_user(username, auth.hash_password(body.password))
    return {"token": auth.create_session(username), "username": username}


@app.post("/api/login")
def login(body: LoginBody) -> dict[str, str]:
    username = body.username.strip()
    user = db.get_user(username)
    if not user or not auth.verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Неверное имя пользователя или пароль")
    canonical_username = str(user["username"])
    return {"token": auth.create_session(canonical_username), "username": canonical_username}


@app.get("/api/me")
def me(token: str) -> dict[str, Any]:
    username = require_user(token)
    return {
        **db.get_public_profile(username),
        "online": username in ws_manager.manager.online_users,
    }


@app.post("/api/profile/google")
def save_google_profile(body: GoogleProfileBody) -> dict[str, bool]:
    username = require_user(body.token)
    db.update_google_profile(
        username,
        display_name=body.display_name.strip(),
        avatar_url=body.avatar_url.strip(),
        email=body.email.strip(),
    )
    return {"ok": True}


@app.post("/api/profile/google/disconnect")
def disconnect_google_profile(body: TokenBody) -> dict[str, bool]:
    username = require_user(body.token)
    db.clear_google_profile(username)
    return {"ok": True}


@app.post("/api/friends/request")
async def friend_request(body: FriendRequestBody) -> dict[str, Any]:
    username = require_user(body.token)
    target = clean_username(body.to_username)
    if target.lower() == username.lower():
        raise HTTPException(status_code=400, detail="Нельзя добавить самого себя")
    if not db.user_exists(target):
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    status = db.add_friend_request(username, target)
    if status == "already_friends":
        raise HTTPException(status_code=409, detail="Вы уже друзья")
    if status == "pending":
        await ws_manager.manager.send_to_user(
            target, {"type": "friend_request", "from": username}
        )
    elif status == "accepted":
        await ws_manager.manager.send_to_user(
            target, {"type": "friend_accepted", "by": username}
        )
    return {"ok": True, "status": status}


@app.post("/api/friends/accept")
async def friend_accept(body: FriendAcceptBody) -> dict[str, bool]:
    username = require_user(body.token)
    sender = clean_username(body.from_username)
    if not db.accept_friend_request(sender, username):
        raise HTTPException(status_code=404, detail="Заявка уже обработана или не найдена")
    await ws_manager.manager.send_to_user(
        sender, {"type": "friend_accepted", "by": username}
    )
    return {"ok": True}


@app.get("/api/friends/list")
def friends_list(token: str) -> dict[str, Any]:
    username = require_user(token)
    friends = db.get_friends(username)
    pending = db.get_pending_requests(username)
    profiles = db.get_public_profiles(friends + pending)
    online = ws_manager.manager.online_users
    return {
        "friends": [
            {**profiles[friend], "online": friend in online}
            for friend in friends
        ],
        "pending_requests": [profiles[name] for name in pending],
    }


@app.get("/api/search")
def search(
    q: str = Query(min_length=1, max_length=120),
    token: str = Query(min_length=1),
) -> dict[str, Any]:
    require_user(token)
    try:
        return {"results": search_songs(q)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail="YouTube Music временно не отвечает") from exc


@app.get("/api/search/suggestions")
def suggestions(
    q: str = Query(min_length=2, max_length=120),
    token: str = Query(min_length=1),
) -> dict[str, Any]:
    require_user(token)
    try:
        return {"suggestions": search_suggestions(q)}
    except Exception:
        return {"suggestions": []}


@app.get("/api/youtube/profile")
def youtube_profile(
    token: str,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_user(token)
    access_token = require_google_token(authorization)
    return google_call(get_profile, access_token)


@app.get("/api/youtube/library")
def youtube_library(
    token: str,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_user(token)
    access_token = require_google_token(authorization)
    return google_call(get_library, access_token)


@app.get("/api/youtube/playlists/{playlist_id}")
def youtube_playlist(
    playlist_id: str,
    token: str,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_user(token)
    access_token = require_google_token(authorization)
    return {"items": google_call(get_playlist_items, access_token, playlist_id)}


@app.post("/api/rooms/create")
def rooms_create(body: TokenBody) -> dict[str, str]:
    username = require_user(body.token)
    return {"room_code": ws_manager.manager.create_room(username)}


@app.post("/api/rooms/invite")
async def rooms_invite(body: RoomInviteBody) -> dict[str, bool]:
    username = require_user(body.token)
    code = body.room_code.strip().upper()
    target = clean_username(body.to_username)
    room = ws_manager.manager.rooms.get(code)
    if not room or username not in room.members:
        raise HTTPException(status_code=404, detail="Комната не найдена или ты уже вышел")
    if target not in db.get_friends(username):
        raise HTTPException(status_code=403, detail="Приглашать можно только друзей")
    delivered = await ws_manager.manager.send_to_user(
        target,
        {"type": "room_invite", "from": username, "room_code": code},
    )
    if not delivered:
        raise HTTPException(status_code=409, detail="Друг сейчас не в сети")
    return {"ok": True}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str) -> None:
    username = auth.get_username(token)
    if not username:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    ws_manager.manager.connect(username, websocket)
    await websocket.send_json({"type": "connected", "username": username})

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")

            if message_type == "join_room":
                room_code = str(message.get("room_code", "")).strip().upper()
                ok, snapshot = await ws_manager.manager.join_room(username, room_code)
                await websocket.send_json(
                    {"type": "room_joined", "ok": ok, **snapshot}
                    if ok
                    else {"type": "room_joined", "ok": False, "room_code": room_code}
                )
                if ok:
                    state = ws_manager.manager.get_last_state(room_code)
                    if state:
                        await websocket.send_json({"type": "sync", **state, "initial": True})
                    else:
                        await ws_manager.manager.broadcast_room(
                            room_code,
                            {"type": "request_state", "requested_by": username},
                            exclude=username,
                        )

            elif message_type == "leave_room":
                await ws_manager.manager.leave_room(username)
                await websocket.send_json({"type": "room_left"})

            elif message_type == "sync":
                room_code = ws_manager.manager.user_room.get(username)
                if not room_code:
                    continue
                state = {
                    "videoId": message.get("videoId"),
                    "state": message.get("state", "paused"),
                    "time": float(message.get("time", 0) or 0),
                    "ts": int(message.get("ts", 0) or 0),
                    "song": message.get("song") or {},
                    "sender": username,
                }
                ws_manager.manager.set_last_state(room_code, state)
                await ws_manager.manager.broadcast_room(
                    room_code, {"type": "sync", **state}, exclude=username
                )

            elif message_type == "queue_add":
                room_code = ws_manager.manager.user_room.get(username)
                song = message.get("song") or {}
                if not room_code or not song.get("videoId"):
                    continue
                item, duplicate = ws_manager.manager.add_queue_item(room_code, song, username)
                if message.get("playNow"):
                    ws_manager.manager.set_current(room_code, item["id"])

                # Keep a real upcoming queue in rooms instead of waiting until the
                # current song has already ended. The first manually selected track
                # seeds a small radio continuation shared by every participant.
                room = ws_manager.manager.rooms.get(room_code)
                if room and len(room.queue) < 6:
                    seed_artist = str(item.get("artist") or "").strip()
                    seed_title = str(item.get("title") or "").strip()
                    queries = [
                        " ".join(part for part in (seed_artist, seed_title) if part),
                        f"{seed_artist} mix".strip(),
                        f"{seed_artist} radio".strip(),
                    ]
                    seen = {str(entry.get("videoId") or "") for entry in room.queue}
                    for query in queries:
                        if not query or len(room.queue) >= 8:
                            continue
                        try:
                            candidates = search_songs(query, limit=14)
                        except Exception:
                            continue
                        for candidate in candidates:
                            video_id = str(candidate.get("videoId") or "")
                            if not video_id or video_id in seen:
                                continue
                            seen.add(video_id)
                            ws_manager.manager.add_queue_item(
                                room_code,
                                {**candidate, "source": "smart_radio"},
                                "Умная очередь",
                            )
                            if len(room.queue) >= 8:
                                break

                await ws_manager.manager.broadcast_queue(
                    room_code,
                    duplicate=duplicate,
                    addedBy=username,
                )
                if message.get("playNow"):
                    await ws_manager.manager.broadcast_room(
                        room_code,
                        {
                            "type": "queue_play",
                            "song": item,
                            "currentQueueId": item["id"],
                            "ts": int(time.time() * 1000),
                            "sender": username,
                        },
                    )

            elif message_type == "queue_remove":
                room_code = ws_manager.manager.user_room.get(username)
                if room_code:
                    ws_manager.manager.remove_queue_item(room_code, str(message.get("itemId") or ""))
                    await ws_manager.manager.broadcast_queue(room_code)

            elif message_type == "queue_clear":
                room_code = ws_manager.manager.user_room.get(username)
                if room_code:
                    ws_manager.manager.clear_upcoming(room_code)
                    await ws_manager.manager.broadcast_queue(room_code)

            elif message_type == "queue_vote":
                room_code = ws_manager.manager.user_room.get(username)
                if room_code:
                    ws_manager.manager.vote_queue_item(
                        room_code,
                        str(message.get("itemId") or ""),
                        1 if int(message.get("delta") or 0) > 0 else -1,
                    )
                    await ws_manager.manager.broadcast_queue(room_code)

            elif message_type in {"queue_next", "queue_prev"}:
                room_code = ws_manager.manager.user_room.get(username)
                if not room_code:
                    continue
                direction = 1 if message_type == "queue_next" else -1
                expected_current = str(message.get("expectedCurrentId") or "")
                actual_current = ws_manager.manager.current_queue_item(room_code) or {}
                # Ignore duplicate ENDED/watchdog commands sent for a track that has already advanced.
                if expected_current and str(actual_current.get("id") or "") != expected_current:
                    await websocket.send_json({"type": "queue_updated", **ws_manager.manager.queue_snapshot(room_code)})
                    continue
                item = ws_manager.manager.advance_queue(room_code, direction)

                # At the end of the queue, build a radio-like continuation instead
                # of clamping to and replaying the final track forever.
                if not item and direction > 0:
                    current = ws_manager.manager.current_queue_item(room_code) or {}
                    seed = " ".join(
                        part for part in (str(current.get("artist") or ""), str(current.get("title") or ""))
                        if part
                    ).strip()
                    if seed:
                        candidates = []
                        queries = [seed, f"{current.get('artist', '')} mix".strip(), f"{current.get('artist', '')} radio".strip()]
                        for query in queries:
                            if not query:
                                continue
                            try:
                                candidates.extend(search_songs(query, limit=18))
                            except Exception:
                                continue
                        unique_candidates = []
                        seen_video_ids = set()
                        for candidate in candidates:
                            video_id = str(candidate.get("videoId") or "")
                            if video_id and video_id not in seen_video_ids:
                                seen_video_ids.add(video_id)
                                unique_candidates.append(candidate)
                        for candidate in unique_candidates:
                            _, duplicate = ws_manager.manager.add_queue_item(
                                room_code, {**candidate, "source": "smart_radio"}, "Умная очередь"
                            )
                            if not duplicate and len(ws_manager.manager.rooms[room_code].queue) >= 8:
                                break
                        item = ws_manager.manager.advance_queue(room_code, 1)

                await ws_manager.manager.broadcast_queue(room_code)
                if item:
                    await ws_manager.manager.broadcast_room(
                        room_code,
                        {
                            "type": "queue_play",
                            "song": item,
                            "currentQueueId": item["id"],
                            "ts": int(time.time() * 1000),
                            "sender": username,
                        },
                    )
                else:
                    await websocket.send_json({"type": "queue_finished"})

            elif message_type == "queue_play":
                room_code = ws_manager.manager.user_room.get(username)
                if not room_code:
                    continue
                item = ws_manager.manager.set_current(
                    room_code, str(message.get("itemId") or "")
                )
                await ws_manager.manager.broadcast_queue(room_code)
                if item:
                    await ws_manager.manager.broadcast_room(
                        room_code,
                        {
                            "type": "queue_play",
                            "song": item,
                            "currentQueueId": item["id"],
                            "ts": int(time.time() * 1000),
                            "sender": username,
                        },
                    )

            elif message_type == "request_state":
                room_code = ws_manager.manager.user_room.get(username)
                if room_code:
                    await ws_manager.manager.broadcast_room(
                        room_code,
                        {"type": "request_state", "requested_by": username},
                        exclude=username,
                    )

            elif message_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        await ws_manager.manager.disconnect(username)
    except Exception:
        await ws_manager.manager.disconnect(username)
        try:
            await websocket.close(code=1011)
        except Exception:
            pass


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/README.md")
def readme() -> FileResponse:
    return FileResponse(ROOT_DIR / "README.md", media_type="text/markdown; charset=utf-8")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
