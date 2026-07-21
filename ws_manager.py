"""WebSocket connections, online presence and temporary listening rooms."""

from __future__ import annotations

import random
import string
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket


@dataclass
class Room:
    host: str
    members: set[str] = field(default_factory=set)
    last_state: dict[str, Any] | None = None


class ConnectionManager:
    def __init__(self) -> None:
        self.user_sockets: dict[str, WebSocket] = {}
        self.rooms: dict[str, Room] = {}
        self.user_room: dict[str, str] = {}

    @property
    def online_users(self) -> set[str]:
        return set(self.user_sockets)

    def connect(self, username: str, websocket: WebSocket) -> None:
        self.user_sockets[username] = websocket

    async def disconnect(self, username: str) -> None:
        self.user_sockets.pop(username, None)
        room_code = self.user_room.pop(username, None)
        if not room_code or room_code not in self.rooms:
            return

        room = self.rooms[room_code]
        room.members.discard(username)
        if not room.members:
            self.rooms.pop(room_code, None)
            return

        if room.host == username:
            room.host = sorted(room.members)[0]
        await self.broadcast_presence(room_code)

    def create_room(self, owner: str) -> str:
        while True:
            code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
            if code not in self.rooms:
                break
        self.rooms[code] = Room(host=owner)
        return code

    async def join_room(self, username: str, room_code: str) -> tuple[bool, dict[str, Any]]:
        code = room_code.strip().upper()
        room = self.rooms.get(code)
        if not room:
            return False, {}

        old_room_code = self.user_room.get(username)
        if old_room_code and old_room_code in self.rooms and old_room_code != code:
            old_room = self.rooms[old_room_code]
            old_room.members.discard(username)
            if old_room.members:
                if old_room.host == username:
                    old_room.host = sorted(old_room.members)[0]
                await self.broadcast_presence(old_room_code)
            else:
                self.rooms.pop(old_room_code, None)

        room.members.add(username)
        self.user_room[username] = code
        await self.broadcast_presence(code)
        return True, self.room_snapshot(code)

    async def leave_room(self, username: str) -> None:
        room_code = self.user_room.pop(username, None)
        if not room_code or room_code not in self.rooms:
            return

        room = self.rooms[room_code]
        room.members.discard(username)
        if not room.members:
            self.rooms.pop(room_code, None)
            return
        if room.host == username:
            room.host = sorted(room.members)[0]
        await self.broadcast_presence(room_code)

    def room_snapshot(self, room_code: str) -> dict[str, Any]:
        room = self.rooms.get(room_code)
        if not room:
            return {}
        return {
            "room_code": room_code,
            "host": room.host,
            "members": sorted(room.members),
            "online_members": sorted(member for member in room.members if member in self.online_users),
        }

    def set_last_state(self, room_code: str, state: dict[str, Any]) -> None:
        room = self.rooms.get(room_code)
        if room:
            room.last_state = state

    def get_last_state(self, room_code: str) -> dict[str, Any] | None:
        room = self.rooms.get(room_code)
        return room.last_state if room else None

    async def send_to_user(self, username: str, message: dict[str, Any]) -> bool:
        websocket = self.user_sockets.get(username)
        if not websocket:
            return False
        try:
            await websocket.send_json(message)
            return True
        except Exception:
            return False

    async def broadcast_room(
        self,
        room_code: str,
        message: dict[str, Any],
        exclude: str | None = None,
    ) -> None:
        room = self.rooms.get(room_code)
        if not room:
            return
        for member in list(room.members):
            if member != exclude:
                await self.send_to_user(member, message)

    async def broadcast_presence(self, room_code: str) -> None:
        snapshot = self.room_snapshot(room_code)
        if snapshot:
            await self.broadcast_room(room_code, {"type": "room_presence", **snapshot})


manager = ConnectionManager()
