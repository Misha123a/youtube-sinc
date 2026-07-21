"""
Главный сервер приложения.

Что тут есть:
- Регистрация / логин (POST /api/register, /api/login)
- Друзья: заявка, принятие, список (POST /api/friends/request и т.д.)
- Поиск треков (GET /api/search?q=...)
- Комнаты: создание, приглашение (POST /api/rooms/create, /api/rooms/invite)
- WebSocket /ws?token=... — сюда идёт всё "живое": уведомления
  о заявках в друзья, приглашения в комнату, синхронизация плеера

Frontend (HTML/JS/CSS) лежит в папке static/ и раздаётся этим же
сервером — то есть открыть приложение можно даже в обычном браузере
по адресу http://localhost:8000, без десктопного клиента вообще
(это удобно для отладки).

Запуск:
    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pathlib import Path

import database as db
import auth
import ws_manager
from ytmusic_search import search_songs

app = FastAPI()
db.init_db()

STATIC_DIR = Path(__file__).parent / "static"


# ---------- Модели запросов ----------

class RegisterBody(BaseModel):
    username: str
    password: str


class LoginBody(BaseModel):
    username: str
    password: str


class FriendRequestBody(BaseModel):
    token: str
    to_username: str


class FriendAcceptBody(BaseModel):
    token: str
    from_username: str


class RoomCreateBody(BaseModel):
    token: str


class RoomInviteBody(BaseModel):
    token: str
    room_code: str
    to_username: str


def require_user(token: str) -> str:
    username = auth.get_username(token)
    if not username:
        raise HTTPException(status_code=401, detail="Неверный или истёкший токен, залогинься заново")
    return username


# ---------- Аккаунты ----------

@app.post("/api/register")
def register(body: RegisterBody):
    if len(body.username) < 3:
        raise HTTPException(400, "Имя пользователя слишком короткое (минимум 3 символа)")
    if db.user_exists(body.username):
        raise HTTPException(400, "Такой пользователь уже существует")
    db.create_user(body.username, auth.hash_password(body.password))
    token = auth.create_session(body.username)
    return {"token": token, "username": body.username}


@app.post("/api/login")
def login(body: LoginBody):
    user = db.get_user(body.username)
    if not user or not auth.verify_password(body.password, user["password_hash"]):
        raise HTTPException(400, "Неверное имя пользователя или пароль")
    token = auth.create_session(body.username)
    return {"token": token, "username": body.username}


# ---------- Друзья ----------

@app.post("/api/friends/request")
async def friend_request(body: FriendRequestBody):
    username = require_user(body.token)
    if body.to_username == username:
        raise HTTPException(400, "Нельзя добавить самого себя")
    if not db.user_exists(body.to_username):
        raise HTTPException(404, "Такого пользователя нет")
    db.add_friend_request(username, body.to_username)
    await ws_manager.manager.send_to_user(
        body.to_username, {"type": "friend_request", "from": username}
    )
    return {"ok": True}


@app.post("/api/friends/accept")
async def friend_accept(body: FriendAcceptBody):
    username = require_user(body.token)
    db.accept_friend_request(body.from_username, username)
    await ws_manager.manager.send_to_user(
        body.from_username, {"type": "friend_accepted", "by": username}
    )
    return {"ok": True}


@app.get("/api/friends/list")
def friends_list(token: str):
    username = require_user(token)
    return {
        "friends": db.get_friends(username),
        "pending_requests": db.get_pending_requests(username),
    }


# ---------- Поиск музыки ----------

@app.get("/api/search")
def search(q: str, token: str):
    require_user(token)  # поиск доступен только залогиненным
    if not q.strip():
        return {"results": []}
    return {"results": search_songs(q)}


# ---------- Комнаты ----------

@app.post("/api/rooms/create")
def rooms_create(body: RoomCreateBody):
    require_user(body.token)
    code = ws_manager.manager.create_room()
    return {"room_code": code}


@app.post("/api/rooms/invite")
async def rooms_invite(body: RoomInviteBody):
    username = require_user(body.token)
    await ws_manager.manager.send_to_user(
        body.to_username,
        {"type": "room_invite", "from": username, "room_code": body.room_code},
    )
    return {"ok": True}


# ---------- WebSocket: живая часть (комнаты, синхронизация, уведомления) ----------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str):
    username = auth.get_username(token)
    if not username:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    ws_manager.manager.connect(username, websocket)

    try:
        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type")

            if msg_type == "join_room":
                room_code = msg.get("room_code", "")
                ok = ws_manager.manager.join_room(username, room_code)
                await websocket.send_json({
                    "type": "room_joined",
                    "ok": ok,
                    "room_code": room_code,
                    "members": sorted(ws_manager.manager.room_members(room_code)) if ok else [],
                })
                if ok:
                    # попросить остальных участников поделиться текущим состоянием плеера
                    await ws_manager.manager.broadcast_room(
                        room_code, {"type": "request_state"}, exclude=username
                    )

            elif msg_type == "sync":
                room_code = ws_manager.manager.user_room.get(username)
                if room_code:
                    await ws_manager.manager.broadcast_room(room_code, msg, exclude=username)

            elif msg_type == "request_state":
                room_code = ws_manager.manager.user_room.get(username)
                if room_code:
                    await ws_manager.manager.broadcast_room(room_code, msg, exclude=username)

    except WebSocketDisconnect:
        ws_manager.manager.disconnect(username)


# ---------- Раздача фронтенда ----------

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")
