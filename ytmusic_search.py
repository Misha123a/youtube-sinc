"""YouTube Music search helpers with caching for ordinary searches."""
from __future__ import annotations

from functools import lru_cache
import random
from typing import Any

from ytmusicapi import YTMusic

_yt = YTMusic()
_rng = random.SystemRandom()


def _thumbnail(items: list[dict[str, Any]] | None) -> str:
    thumbnails = items or []
    return str(thumbnails[-1].get("url", "")).replace("http://", "https://") if thumbnails else ""


def _search_raw(query: str, limit: int) -> list[dict[str, Any]]:
    clean = " ".join(query.split()).strip()
    if not clean:
        return []

    songs: list[dict[str, Any]] = []
    for item in _yt.search(clean, filter="songs", limit=limit):
        video_id = item.get("videoId")
        if not video_id:
            continue
        artists = ", ".join(
            artist.get("name", "")
            for artist in item.get("artists", [])
            if artist.get("name")
        )
        album_data = item.get("album") or {}
        album = album_data.get("name", "") if isinstance(album_data, dict) else ""
        songs.append(
            {
                "videoId": video_id,
                "title": item.get("title", "Без названия"),
                "artist": artists or "Неизвестный исполнитель",
                "album": album,
                "duration": item.get("duration", ""),
                "durationSeconds": item.get("duration_seconds"),
                "thumbnail": _thumbnail(item.get("thumbnails")),
                "isExplicit": bool(item.get("isExplicit", False)),
                "source": "search",
            }
        )
    return songs


@lru_cache(maxsize=256)
def _search_songs_cached(query: str, limit: int) -> tuple[tuple[tuple[str, Any], ...], ...]:
    """Cache stable user-facing search results in an immutable representation."""
    return tuple(tuple(song.items()) for song in _search_raw(query, limit))


def search_songs(query: str, limit: int = 24) -> list[dict[str, Any]]:
    """Search songs.

    Recommendation builders request 15 items (10 visible plus 5 spare). For that
    request shape we deliberately fetch a larger pool and shuffle it so each manual
    or timed library refresh can produce a different set. Normal search remains
    cached and stable.
    """
    clean = " ".join(query.split()).strip()
    if not clean:
        return []

    if limit == 15:
        pool = _search_raw(clean, 45)
        _rng.shuffle(pool)
        return pool[:limit]

    cached = _search_songs_cached(clean, limit)
    return [dict(song) for song in cached]


@lru_cache(maxsize=512)
def search_suggestions(query: str, limit: int = 8) -> list[str]:
    clean = " ".join(query.split()).strip()
    if len(clean) < 2:
        return []

    normalized: list[str] = []
    for suggestion in _yt.get_search_suggestions(clean):
        text = (
            suggestion
            if isinstance(suggestion, str)
            else str(suggestion.get("text") or suggestion.get("query") or "")
            if isinstance(suggestion, dict)
            else str(suggestion)
        )
        text = text.strip()
        if text and text not in normalized:
            normalized.append(text)
        if len(normalized) >= limit:
            break
    return normalized
