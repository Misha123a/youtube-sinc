"""
Управление живыми WebSocket-соединениями.

У каждого залогиненного пользователя — одно WebSocket-соединение,
через которое идёт всё: уведомления о заявках в друзья, приглашения
в комнату, и синхронизация плеера внутри комнаты.

Комнаты существуют только в памяти (пока жив процесс сервера).
"""

import random
import string
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.user_sockets: dict[str, WebSocket] = {}
        self.rooms: dict[str, set[str]] = {}
        self.user_room: dict[str, str] = {}  # username -> текущая комната

    def connect(self, username: str, ws: WebSocket) -> None:
        self.user_sockets[username] = ws

    def disconnect(self, username: str) -> None:
        self.user_sockets.pop(username, None)
        room_code = self.user_room.pop(username, None)
        if room_code and room_code in self.rooms:
            self.rooms[room_code].discard(username)
            if not self.rooms[room_code]:
                self.rooms.pop(room_code, None)

    def create_room(self) -> str:
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        self.rooms[code] = set()
        return code

    def join_room(self, username: str, room_code: str) -> bool:
        if room_code not in self.rooms:
            return False
        # покинуть предыдущую комнату, если была
        old_room = self.user_room.get(username)
        if old_room and old_room in self.rooms:
            self.rooms[old_room].discard(username)
        self.rooms[room_code].add(username)
        self.user_room[username] = room_code
        return True

    def room_members(self, room_code: str) -> set[str]:
        return self.rooms.get(room_code, set())

    async def send_to_user(self, username: str, message: dict) -> None:
        ws = self.user_sockets.get(username)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                pass

    async def broadcast_room(self, room_code: str, message: dict, exclude: str | None = None) -> None:
        for member in list(self.room_members(room_code)):
            if member == exclude:
                continue
            await self.send_to_user(member, message)


manager = ConnectionManager()
