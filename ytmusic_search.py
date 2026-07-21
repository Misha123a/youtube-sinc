"""YouTube Music search helpers with small in-process caches."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from ytmusicapi import YTMusic

_yt = YTMusic()


def _thumbnail(items: list[dict[str, Any]] | None) -> str:
    thumbnails = items or []
    if not thumbnails:
        return ""
    return str(thumbnails[-1].get("url", "")).replace("http://", "https://")


@lru_cache(maxsize=256)
def search_songs(query: str, limit: int = 24) -> list[dict[str, Any]]:
    """Return normalized song results suitable for the web player."""
    clean_query = " ".join(query.split()).strip()
    if not clean_query:
        return []

    results = _yt.search(clean_query, filter="songs", limit=limit)
    songs: list[dict[str, Any]] = []

    for item in results:
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
            }
        )

    return songs


@lru_cache(maxsize=512)
def search_suggestions(query: str, limit: int = 8) -> list[str]:
    """Return live YouTube Music suggestions for the search box."""
    clean_query = " ".join(query.split()).strip()
    if len(clean_query) < 2:
        return []

    suggestions = _yt.get_search_suggestions(clean_query)
    normalized: list[str] = []
    for suggestion in suggestions:
        if isinstance(suggestion, str):
            text = suggestion
        elif isinstance(suggestion, dict):
            text = str(suggestion.get("text") or suggestion.get("query") or "")
        else:
            text = str(suggestion)
        text = text.strip()
        if text and text not in normalized:
            normalized.append(text)
        if len(normalized) >= limit:
            break
    return normalized
