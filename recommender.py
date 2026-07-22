"""Personalized queue builder based on YouTube Music radio and listening history."""
from __future__ import annotations

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
_BRACKETS = re.compile(r"[\[(].*?[\])]|")
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

    # Fallback for unavailable radio responses.
    if not pool:
        artist = _text(current.get("artist"))
        for query in (f"{artist} similar", f"{artist} essentials", artist):
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

        score = 100.0
        score -= seed_index * 4.0
        score -= min(radio_rank, 30) * 1.2
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
