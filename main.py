"""Sync Music FastAPI server."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv

import auth
import database as db
import ws_manager
from ytmusic_search import search_songs, search_suggestions

load_dotenv()

APP_NAME = "Sync Music"
ROOT_DIR = Path(__file__).parent
STATIC_DIR = ROOT_DIR / "static"
USERNAME_RE = re.compile(r"^[\w.-]+$", re.UNICODE)

app = FastAPI(title=APP_NAME, version="2.0.0")
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


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": APP_NAME, "version": "2.0.0"}


@app.get("/api/config")
def public_config() -> dict[str, Any]:
    """Public browser configuration. Never put a client secret here."""
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
    return {"username": username, "online": username in ws_manager.manager.online_users}


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
    online = ws_manager.manager.online_users
    return {
        "friends": [
            {"username": friend, "online": friend in online}
            for friend in friends
        ],
        "pending_requests": db.get_pending_requests(username),
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
        # Suggestions are optional; the search itself should remain usable.
        return {"suggestions": []}


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
