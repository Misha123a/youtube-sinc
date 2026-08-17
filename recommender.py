"""Personalized queue builder based on YouTube Music radio and listening history."""
from __future__ import annotations

import asyncio
from collections import Counter
import random
import re
from typing import Any

from ytmusic_search import radio_songs, search_songs

_rng = random.SystemRandom()
_BAD_VERSION = re.compile(
    r"\b(remix|radio edit|edit|live|cover|karaoke|instrumental|sped[ -]?up|slowed|"
    r"nightcore|remaster(?:ed)?|extended(?: mix)?|8d audio|bass boosted|lyrics?)\b",
    re.IGNORECASE,
)
_NON_WORD = re.compile(r"[^\w\s]+", re.UNICODE)


def _text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _key(value: Any) -> str:
    text = _BAD_VERSION.sub(" ", _text(value).lower())
    text = _NON_WORD.sub(" ", text)
    return " ".join(text.split())


def _artist_key(track: dict[str, Any]) -> str:
    return _key(track.get("artist"))


def _title_key(track: dict[str, Any]) -> str:
    return _key(track.get("title"))


def _is_bad_version(track: dict[str, Any]) -> bool:
    return bool(_BAD_VERSION.search(_text(track.get("title"))))


def _seed_tracks(current: dict[str, Any], recent: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seeds: list[dict[str, Any]] = []
    seen: set[str] = set()
    for track in [current, *recent[:12]]:
        video_id = _text(track.get("videoId"))
        if video_id and video_id not in seen:
            seen.add(video_id)
            seeds.append(track)
    return seeds[:6]


def build_smart_radio(
    current: dict[str, Any],
    recent: list[dict[str, Any]] | None = None,
    exclude_video_ids: list[str] | set[str] | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Blend several radio seeds and rank them against the user's recent taste."""
    recent = [track for track in (recent or []) if isinstance(track, dict)]
    seeds = _seed_tracks(current or {}, recent)
    excluded = {str(value) for value in (exclude_video_ids or []) if value}
    excluded.update(_text(track.get("videoId")) for track in seeds)

    recent_artists = Counter(_artist_key(track) for track in recent if _artist_key(track))
    recent_titles = {_title_key(track) for track in recent if _title_key(track)}
    current_title = _title_key(current)
    current_artist = _artist_key(current)

    pool: list[tuple[dict[str, Any], int, int]] = []
    for seed_index, seed in enumerate(seeds):
        video_id = _text(seed.get("videoId"))
        if not video_id:
            continue
        try:
            candidates = radio_songs(video_id, limit=45)
        except Exception:
            candidates = []
        for radio_rank, candidate in enumerate(candidates):
            pool.append((candidate, seed_index, radio_rank))

    if not pool:
        artist = _text(current.get("artist"))
        title = _text(current.get("title"))
        for query in (
            f"{artist} similar",
            f"{artist} essentials",
            f"{artist} radio",
            f"{artist} {title}",
            artist,
        ):
            if not query.strip():
                continue
            try:
                for rank, candidate in enumerate(search_songs(query, limit=30)):
                    pool.append((candidate, 0, rank))
            except Exception:
                continue

    scored: list[tuple[float, float, dict[str, Any]]] = []
    seen_video_ids: set[str] = set()
    seen_titles: set[str] = set()
    for candidate, seed_index, radio_rank in pool:
        video_id = _text(candidate.get("videoId"))
        title = _title_key(candidate)
        artist = _artist_key(candidate)
        if not video_id or video_id in excluded or video_id in seen_video_ids:
            continue
        if not title or title in seen_titles or title == current_title:
            continue
        if _is_bad_version(candidate):
            continue

        score = 100.0 - seed_index * 4.0 - min(radio_rank, 30) * 1.2
        if artist and artist in recent_artists:
            score += min(12.0, recent_artists[artist] * 3.0)
        if title in recent_titles:
            score -= 35.0
        if artist == current_artist:
            score -= 14.0
        if candidate.get("source") == "youtube_radio":
            score += 8.0

        seen_video_ids.add(video_id)
        seen_titles.add(title)
        scored.append((score, _rng.random(), candidate))

    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)

    result: list[dict[str, Any]] = []
    artist_window: list[str] = []
    artist_totals: Counter[str] = Counter()
    deferred: list[dict[str, Any]] = []
    for _, _, candidate in scored:
        artist = _artist_key(candidate)
        if artist and (artist in artist_window[-3:] or artist_totals[artist] >= 2):
            deferred.append(candidate)
            continue
        result.append({**candidate, "source": "smart_radio"})
        artist_window.append(artist)
        artist_totals[artist] += 1
        if len(result) >= limit:
            return result

    for candidate in deferred:
        artist = _artist_key(candidate)
        if artist and artist in artist_window[-2:]:
            continue
        result.append({**candidate, "source": "smart_radio"})
        artist_window.append(artist)
        if len(result) >= limit:
            break
    return result


def install_room_queue_upgrade() -> None:
    """Keep every active room supplied with a server-authoritative upcoming queue."""
    try:
        import ws_manager
    except Exception:
        return

    manager = ws_manager.manager
    if getattr(manager, "_infinite_queue_v3", False):
        return

    original_broadcast_queue = manager.broadcast_queue
    original_queue_snapshot = manager.queue_snapshot
    original_clear_upcoming = manager.clear_upcoming
    original_remove_queue_item = manager.remove_queue_item
    original_add_queue_item = manager.add_queue_item
    target_upcoming = 30
    refill_at = 15

    def auto_enabled(room: Any) -> bool:
        return bool(getattr(room, "auto_queue_enabled", True))

    def queue_snapshot(room_code: str) -> dict[str, Any]:
        snapshot = original_queue_snapshot(room_code)
        room = manager.rooms.get(room_code)
        snapshot["autoQueueEnabled"] = auto_enabled(room) if room else True
        return snapshot

    def clear_upcoming(room_code: str) -> None:
        room = manager.rooms.get(room_code)
        if room:
            # The clear button must visibly stay cleared. Skip exactly the broadcast
            # that follows this action; later playback can refill again if Auto Queue is on.
            room._skip_refill_once = True
        original_clear_upcoming(room_code)

    def remove_queue_item(room_code: str, item_id: str) -> dict[str, Any] | None:
        room = manager.rooms.get(room_code)
        if room and item_id in {"__AUTO_QUEUE_ON__", "__AUTO_QUEUE_OFF__"}:
            room.auto_queue_enabled = item_id == "__AUTO_QUEUE_ON__"
            room._skip_refill_once = True
            room.queue_revision += 1
            return None
        return original_remove_queue_item(room_code, item_id)

    def add_queue_item(
        room_code: str,
        song: dict[str, Any],
        added_by: str,
    ) -> tuple[dict[str, Any], bool]:
        room = manager.rooms.get(room_code)
        is_auto = str(song.get("source") or "") == "smart_radio" or added_by == "Умная очередь"
        if room and is_auto and not auto_enabled(room):
            current = manager.current_queue_item(room_code)
            return current or {"id": "", "videoId": str(song.get("videoId") or "")}, True
        return original_add_queue_item(room_code, song, added_by)

    manager.queue_snapshot = queue_snapshot
    manager.clear_upcoming = clear_upcoming
    manager.remove_queue_item = remove_queue_item
    manager.add_queue_item = add_queue_item

    def upcoming_count(room: Any) -> int:
        if not room.queue:
            return 0
        current_index = next(
            (index for index, item in enumerate(room.queue) if item.get("id") == room.current_id),
            -1,
        )
        return len(room.queue) - current_index - 1 if current_index >= 0 else len(room.queue)

    def remember_current(room: Any) -> list[dict[str, Any]]:
        history = list(getattr(room, "radio_history", []))
        current = next((item for item in room.queue if item.get("id") == room.current_id), None)
        if current and current.get("videoId"):
            history = [item for item in history if item.get("videoId") != current.get("videoId")]
            history.insert(0, dict(current))
        room.radio_history = history[:100]
        return room.radio_history

    def fill_room(room_code: str) -> bool:
        room = manager.rooms.get(room_code)
        if not room or not auto_enabled(room) or not room.queue or upcoming_count(room) >= refill_at:
            return False

        current = manager.current_queue_item(room_code) or room.queue[-1]
        history = remember_current(room)
        excluded = {
            str(item.get("videoId") or "")
            for item in [*room.queue, *history]
            if item.get("videoId")
        }
        needed = max(0, target_upcoming - upcoming_count(room))
        if not needed:
            return False

        candidates = build_smart_radio(
            current=current,
            recent=history,
            exclude_video_ids=excluded,
            limit=min(30, needed + 12),
        )

        if len(candidates) < needed:
            artist = _text(current.get("artist"))
            title = _text(current.get("title"))
            fallback_queries = (
                f"{artist} radio",
                f"{artist} similar songs",
                f"{artist} mix",
                f"{artist} {title}",
                artist,
            )
            for query in fallback_queries:
                if not query.strip() or len(candidates) >= needed + 8:
                    continue
                try:
                    candidates.extend(search_songs(query, limit=30))
                except Exception:
                    continue

        seen_titles = {_title_key(item) for item in room.queue if _title_key(item)}
        added = False
        for candidate in candidates:
            if not auto_enabled(room):
                break
            video_id = _text(candidate.get("videoId"))
            title_key = _title_key(candidate)
            if not video_id or video_id in excluded or not title_key or title_key in seen_titles:
                continue
            if _is_bad_version(candidate):
                continue
            _, duplicate = manager.add_queue_item(
                room_code,
                {**candidate, "source": "smart_radio"},
                "Умная очередь",
            )
            if not duplicate:
                added = True
                excluded.add(video_id)
                seen_titles.add(title_key)
            if upcoming_count(room) >= target_upcoming:
                break
        return added

    async def refill_in_background(room_code: str) -> None:
        room = manager.rooms.get(room_code)
        if not room or getattr(room, "_refill_running", False):
            return
        room._refill_running = True
        try:
            added = await asyncio.to_thread(fill_room, room_code)
            if added and room_code in manager.rooms:
                await original_broadcast_queue(room_code)
        except Exception as exc:
            print(f"Room queue refill failed for {room_code}: {exc}")
        finally:
            room = manager.rooms.get(room_code)
            if room:
                room._refill_running = False

    async def broadcast_queue_with_refill(room_code: str, **extra: Any) -> None:
        room = manager.rooms.get(room_code)
        skip_refill = bool(room and getattr(room, "_skip_refill_once", False))
        if room and skip_refill:
            room._skip_refill_once = False

        # Send the authoritative queue immediately. Recommendation lookups must never
        # block a click on a track or a queue update for several seconds.
        await original_broadcast_queue(room_code, **extra)

        room = manager.rooms.get(room_code)
        if (
            room
            and not skip_refill
            and auto_enabled(room)
            and room.queue
            and upcoming_count(room) < refill_at
            and not getattr(room, "_refill_running", False)
        ):
            asyncio.create_task(refill_in_background(room_code))

    manager.broadcast_queue = broadcast_queue_with_refill
    manager._infinite_queue_v2 = True
    manager._infinite_queue_v3 = True


install_room_queue_upgrade()