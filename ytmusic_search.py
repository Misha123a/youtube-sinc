"""YouTube Music search and radio helpers."""
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


def _normalize_track(item: dict[str, Any], source: str = "search") -> dict[str, Any] | None:
    video_id = item.get("videoId")
    if not video_id:
        return None
    artists = ", ".join(
        artist.get("name", "")
        for artist in item.get("artists", [])
        if isinstance(artist, dict) and artist.get("name")
    )
    album_data = item.get("album") or {}
    album = album_data.get("name", "") if isinstance(album_data, dict) else ""
    return {
        "videoId": video_id,
        "title": item.get("title", "Без названия"),
        "artist": artists or item.get("author") or "Неизвестный исполнитель",
        "album": album,
        "duration": item.get("duration") or item.get("length") or "",
        "durationSeconds": item.get("duration_seconds") or item.get("lengthSeconds"),
        "thumbnail": _thumbnail(item.get("thumbnails") or item.get("thumbnail")),
        "isExplicit": bool(item.get("isExplicit", False)),
        "source": source,
    }


def _search_raw(query: str, limit: int) -> list[dict[str, Any]]:
    clean = " ".join(query.split()).strip()
    if not clean:
        return []

    songs: list[dict[str, Any]] = []
    for item in _yt.search(clean, filter="songs", limit=limit):
        normalized = _normalize_track(item)
        if normalized:
            songs.append(normalized)
    return songs


@lru_cache(maxsize=256)
def _search_songs_cached(query: str, limit: int) -> tuple[tuple[tuple[str, Any], ...], ...]:
    """Cache stable user-facing search results in an immutable representation."""
    return tuple(tuple(song.items()) for song in _search_raw(query, limit))


def search_songs(query: str, limit: int = 24) -> list[dict[str, Any]]:
    """Search songs while rotating recommendation-sized result sets."""
    clean = " ".join(query.split()).strip()
    if not clean:
        return []

    if limit == 15:
        pool = _search_raw(clean, 45)
        _rng.shuffle(pool)
        return pool[:limit]

    cached = _search_songs_cached(clean, limit)
    return [dict(song) for song in cached]


def radio_songs(video_id: str, limit: int = 40) -> list[dict[str, Any]]:
    """Return a changing YouTube Music radio playlist seeded by one track."""
    clean_id = str(video_id or "").strip()
    if not clean_id:
        return []
    payload = _yt.get_watch_playlist(videoId=clean_id, limit=max(10, limit), radio=True)
    tracks = payload.get("tracks") or []
    songs: list[dict[str, Any]] = []
    for item in tracks:
        if not isinstance(item, dict):
            continue
        normalized = _normalize_track(item, source="youtube_radio")
        if normalized:
            songs.append(normalized)
    return songs


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
