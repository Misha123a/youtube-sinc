"""WebSocket connections, presence, rooms and synchronized smart queues."""

from __future__ import annotations

import random
import string
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket


@dataclass
class Room:
    host: str
    members: set[str] = field(default_factory=set)
    last_state: dict[str, Any] | None = None
    queue: list[dict[str, Any]] = field(default_factory=list)
    current_id: str | None = None
    queue_revision: int = 0


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

    async def leave_room(self, username: str) -> bool:
        room_code = self.user_room.pop(username, None)
        if not room_code or room_code not in self.rooms:
            return False

        room = self.rooms[room_code]

        # When the host explicitly leaves, close the room for everyone.
        if room.host == username:
            remaining_members = [member for member in room.members if member != username]
            self.rooms.pop(room_code, None)
            for member in remaining_members:
                self.user_room.pop(member, None)
                await self.send_to_user(
                    member,
                    {
                        "type": "room_closed",
                        "room_code": room_code,
                        "reason": "Хост покинул комнату. Комната закрыта",
                    },
                )
            return True

        room.members.discard(username)
        if not room.members:
            self.rooms.pop(room_code, None)
            return False

        await self.broadcast_presence(room_code)
        return False

    def room_snapshot(self, room_code: str) -> dict[str, Any]:
        room = self.rooms.get(room_code)
        if not room:
            return {}
        return {
            "room_code": room_code,
            "host": room.host,
            "members": sorted(room.members),
            "online_members": sorted(member for member in room.members if member in self.online_users),
            **self.queue_snapshot(room_code),
        }

    def set_last_state(self, room_code: str, state: dict[str, Any]) -> None:
        room = self.rooms.get(room_code)
        if room:
            room.last_state = state

    def get_last_state(self, room_code: str) -> dict[str, Any] | None:
        room = self.rooms.get(room_code)
        return room.last_state if room else None

    @staticmethod
    def _clean_song(song: dict[str, Any], added_by: str) -> dict[str, Any]:
        return {
            "id": uuid.uuid4().hex[:12],
            "videoId": str(song.get("videoId") or "")[:32],
            "title": str(song.get("title") or "Без названия")[:300],
            "artist": str(song.get("artist") or "Неизвестный исполнитель")[:300],
            "album": str(song.get("album") or "")[:300],
            "duration": str(song.get("duration") or "")[:32],
            "durationSeconds": song.get("durationSeconds"),
            "thumbnail": str(song.get("thumbnail") or "")[:1200],
            "source": str(song.get("source") or "search")[:40],
            "addedBy": added_by,
            "addedAt": int(time.time() * 1000),
            "votes": 0,
        }

    def _rebalance_upcoming(self, room: Room) -> None:
        if len(room.queue) < 3:
            return
        current_index = next(
            (index for index, item in enumerate(room.queue) if item["id"] == room.current_id),
            -1,
        )
        prefix = room.queue[: current_index + 1] if current_index >= 0 else []
        candidates = room.queue[current_index + 1 :] if current_index >= 0 else list(room.queue)
        ordered: list[dict[str, Any]] = []
        last_user = prefix[-1].get("addedBy") if prefix else ""
        last_artist = prefix[-1].get("artist", "").lower() if prefix else ""

        while candidates:
            def penalty(item: dict[str, Any]) -> tuple[float, int]:
                score = 0.0
                if item.get("addedBy") == last_user:
                    score += 5.0
                if str(item.get("artist") or "").lower() == last_artist:
                    score += 3.0
                score -= min(int(item.get("votes") or 0), 5) * 1.4
                age = int(item.get("addedAt") or 0)
                return score, age

            selected = min(candidates, key=penalty)
            candidates.remove(selected)
            ordered.append(selected)
            last_user = selected.get("addedBy")
            last_artist = str(selected.get("artist") or "").lower()

        room.queue = prefix + ordered

    def add_queue_item(
        self,
        room_code: str,
        song: dict[str, Any],
        added_by: str,
    ) -> tuple[dict[str, Any], bool]:
        room = self.rooms[room_code]
        video_id = str(song.get("videoId") or "")
        duplicate = next((item for item in room.queue if item.get("videoId") == video_id), None)
        if duplicate:
            return duplicate, True
        item = self._clean_song(song, added_by)
        room.queue.append(item)
        if not room.current_id:
            room.current_id = item["id"]
        self._rebalance_upcoming(room)
        room.queue_revision += 1
        return item, False

    def remove_queue_item(self, room_code: str, item_id: str) -> dict[str, Any] | None:
        room = self.rooms.get(room_code)
        if not room:
            return None
        index = next((i for i, item in enumerate(room.queue) if item["id"] == item_id), -1)
        if index < 0:
            return None
        removed = room.queue.pop(index)
        if room.current_id == item_id:
            if room.queue:
                room.current_id = room.queue[min(index, len(room.queue) - 1)]["id"]
            else:
                room.current_id = None
        room.queue_revision += 1
        return removed

    def clear_upcoming(self, room_code: str) -> None:
        room = self.rooms.get(room_code)
        if not room:
            return
        current = next((item for item in room.queue if item["id"] == room.current_id), None)
        room.queue = [current] if current else []
        room.queue_revision += 1

    def set_current(self, room_code: str, item_id: str) -> dict[str, Any] | None:
        room = self.rooms.get(room_code)
        if not room:
            return None
        item = next((entry for entry in room.queue if entry["id"] == item_id), None)
        if not item:
            return None
        room.current_id = item_id
        room.queue_revision += 1
        return item

    def advance_queue(self, room_code: str, direction: int = 1) -> dict[str, Any] | None:
        room = self.rooms.get(room_code)
        if not room or not room.queue:
            return None
        current_index = next(
            (index for index, item in enumerate(room.queue) if item["id"] == room.current_id),
            0,
        )
        target_index = current_index + direction
        # Never clamp to the current final item: that made ENDED replay the same song forever.
        if target_index < 0 or target_index >= len(room.queue):
            return None
        room.current_id = room.queue[target_index]["id"]
        room.queue_revision += 1
        return room.queue[target_index]

    def current_queue_item(self, room_code: str) -> dict[str, Any] | None:
        room = self.rooms.get(room_code)
        if not room:
            return None
        return next((item for item in room.queue if item["id"] == room.current_id), None)

    def vote_queue_item(self, room_code: str, item_id: str, delta: int) -> bool:
        room = self.rooms.get(room_code)
        if not room:
            return False
        item = next((entry for entry in room.queue if entry["id"] == item_id), None)
        if not item:
            return False
        item["votes"] = max(-5, min(20, int(item.get("votes") or 0) + delta))
        self._rebalance_upcoming(room)
        room.queue_revision += 1
        return True

    def queue_snapshot(self, room_code: str) -> dict[str, Any]:
        room = self.rooms.get(room_code)
        if not room:
            return {"queue": [], "currentQueueId": None, "queueRevision": 0}
        return {
            "queue": room.queue,
            "currentQueueId": room.current_id,
            "queueRevision": room.queue_revision,
        }

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

    async def broadcast_queue(self, room_code: str, **extra: Any) -> None:
        await self.broadcast_room(
            room_code,
            {"type": "queue_updated", **self.queue_snapshot(room_code), **extra},
        )


manager = ConnectionManager()
