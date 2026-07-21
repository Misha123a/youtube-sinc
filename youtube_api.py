"""Small authenticated YouTube Data API client used by Sync Music."""

from __future__ import annotations

from typing import Any

import httpx

from ytmusic_search import search_songs

GOOGLE_API = "https://www.googleapis.com"
YOUTUBE_API = f"{GOOGLE_API}/youtube/v3"
USERINFO_API = f"{GOOGLE_API}/oauth2/v3/userinfo"
TIMEOUT = 18.0


class GoogleAPIError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


def _get(url: str, token: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        response = httpx.get(
            url,
            params=params or {},
            headers={"Authorization": f"Bearer {token}"},
            timeout=TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise GoogleAPIError("Google API временно недоступен") from exc

    if response.status_code == 401:
        raise GoogleAPIError("Google-сессия истекла. Подключи аккаунт заново", 401)
    if response.status_code == 403:
        detail = "Недостаточно разрешений YouTube или превышена квота API"
        try:
            payload = response.json()
            detail = payload.get("error", {}).get("message") or detail
        except ValueError:
            pass
        raise GoogleAPIError(detail, 403)
    if response.is_error:
        raise GoogleAPIError(f"Google API вернул ошибку {response.status_code}", response.status_code)

    try:
        return response.json()
    except ValueError as exc:
        raise GoogleAPIError("Google API вернул некорректный ответ") from exc


def _best_thumbnail(thumbnails: dict[str, Any] | None) -> str:
    values = thumbnails or {}
    for key in ("maxres", "standard", "high", "medium", "default"):
        url = (values.get(key) or {}).get("url")
        if url:
            return str(url).replace("http://", "https://")
    return ""


def _duration_text(value: str | None) -> str:
    if not value:
        return ""
    # Lightweight ISO-8601 duration formatter for PT#H#M#S.
    text = value.removeprefix("PT")
    hours = minutes = seconds = 0
    number = ""
    for char in text:
        if char.isdigit():
            number += char
            continue
        amount = int(number or 0)
        number = ""
        if char == "H":
            hours = amount
        elif char == "M":
            minutes = amount
        elif char == "S":
            seconds = amount
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


def _video_from_item(item: dict[str, Any]) -> dict[str, Any] | None:
    snippet = item.get("snippet") or {}
    content = item.get("contentDetails") or {}
    resource = snippet.get("resourceId") or {}
    video_id = content.get("videoId") or resource.get("videoId") or item.get("id")
    if isinstance(video_id, dict):
        video_id = video_id.get("videoId")
    if not video_id:
        return None
    return {
        "videoId": str(video_id),
        "title": str(snippet.get("title") or "Без названия"),
        "artist": str(snippet.get("videoOwnerChannelTitle") or snippet.get("channelTitle") or "YouTube"),
        "album": "",
        "duration": _duration_text(content.get("duration")),
        "durationSeconds": None,
        "thumbnail": _best_thumbnail(snippet.get("thumbnails")),
        "source": "youtube",
    }


def get_profile(access_token: str) -> dict[str, Any]:
    user = _get(USERINFO_API, access_token)
    channel_payload = _get(
        f"{YOUTUBE_API}/channels",
        access_token,
        {"part": "snippet,statistics", "mine": "true", "maxResults": 1},
    )
    channel = (channel_payload.get("items") or [{}])[0]
    channel_snippet = channel.get("snippet") or {}
    channel_stats = channel.get("statistics") or {}
    return {
        "name": str(user.get("name") or channel_snippet.get("title") or "YouTube"),
        "email": str(user.get("email") or ""),
        "picture": str(user.get("picture") or _best_thumbnail(channel_snippet.get("thumbnails"))),
        "channelTitle": str(channel_snippet.get("title") or ""),
        "channelId": str(channel.get("id") or ""),
        "subscriberCount": str(channel_stats.get("subscriberCount") or ""),
    }


def get_playlists(access_token: str, limit: int = 50) -> list[dict[str, Any]]:
    payload = _get(
        f"{YOUTUBE_API}/playlists",
        access_token,
        {
            "part": "snippet,contentDetails,status",
            "mine": "true",
            "maxResults": min(max(limit, 1), 50),
        },
    )
    result: list[dict[str, Any]] = []
    for item in payload.get("items") or []:
        snippet = item.get("snippet") or {}
        details = item.get("contentDetails") or {}
        result.append(
            {
                "id": str(item.get("id") or ""),
                "title": str(snippet.get("title") or "Без названия"),
                "description": str(snippet.get("description") or ""),
                "thumbnail": _best_thumbnail(snippet.get("thumbnails")),
                "itemCount": int(details.get("itemCount") or 0),
                "privacy": str((item.get("status") or {}).get("privacyStatus") or ""),
            }
        )
    return result


def get_playlist_items(access_token: str, playlist_id: str, limit: int = 100) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    page_token = ""
    while len(items) < limit:
        params: dict[str, Any] = {
            "part": "snippet,contentDetails",
            "playlistId": playlist_id,
            "maxResults": min(50, limit - len(items)),
        }
        if page_token:
            params["pageToken"] = page_token
        payload = _get(f"{YOUTUBE_API}/playlistItems", access_token, params)
        for raw in payload.get("items") or []:
            song = _video_from_item(raw)
            if song and song["title"] not in {"Deleted video", "Private video"}:
                items.append(song)
        page_token = str(payload.get("nextPageToken") or "")
        if not page_token:
            break
    return items[:limit]


def get_liked_videos(access_token: str, limit: int = 50) -> list[dict[str, Any]]:
    """Return only liked items categorized by YouTube as Music.

    The generic liked-videos feed also contains ordinary videos, shorts and streams.
    YouTube Data API exposes categoryId=10 for Music, so we filter on that value
    and ignore live/upcoming items.
    """
    payload = _get(
        f"{YOUTUBE_API}/videos",
        access_token,
        {
            "part": "snippet,contentDetails,liveStreamingDetails",
            "myRating": "like",
            "maxResults": min(max(limit, 1), 50),
        },
    )
    result: list[dict[str, Any]] = []
    for item in payload.get("items") or []:
        snippet = item.get("snippet") or {}
        if str(snippet.get("categoryId") or "") != "10":
            continue
        if item.get("liveStreamingDetails"):
            continue
        song = _video_from_item(item)
        if song:
            song["source"] = "liked_music"
            result.append(song)
    return result


def get_subscriptions(access_token: str, limit: int = 30) -> list[dict[str, Any]]:
    payload = _get(
        f"{YOUTUBE_API}/subscriptions",
        access_token,
        {
            "part": "snippet",
            "mine": "true",
            "order": "relevance",
            "maxResults": min(max(limit, 1), 50),
        },
    )
    result: list[dict[str, Any]] = []
    for item in payload.get("items") or []:
        snippet = item.get("snippet") or {}
        resource = snippet.get("resourceId") or {}
        result.append(
            {
                "channelId": str(resource.get("channelId") or ""),
                "title": str(snippet.get("title") or "Канал"),
                "thumbnail": _best_thumbnail(snippet.get("thumbnails")),
            }
        )
    return result


def build_recommendations(
    liked: list[dict[str, Any]],
    subscriptions: list[dict[str, Any]],
    limit: int = 24,
) -> list[dict[str, Any]]:
    seeds: list[str] = []
    for item in liked[:8]:
        artist = str(item.get("artist") or "").strip()
        title = str(item.get("title") or "").strip()
        seed = artist if artist and artist != "YouTube" else title
        if seed and seed not in seeds:
            seeds.append(seed)
        if len(seeds) >= 4:
            break
    for item in subscriptions[:8]:
        title = str(item.get("title") or "").strip()
        if title and title not in seeds:
            seeds.append(title)
        if len(seeds) >= 6:
            break

    seen = {str(item.get("videoId") or "") for item in liked}
    recommendations: list[dict[str, Any]] = []
    for seed in seeds:
        try:
            candidates = search_songs(seed, limit=10)
        except Exception:
            continue
        for song in candidates:
            video_id = str(song.get("videoId") or "")
            if not video_id or video_id in seen:
                continue
            seen.add(video_id)
            song = {**song, "source": "personalized"}
            recommendations.append(song)
            if len(recommendations) >= limit:
                return recommendations
    return recommendations


def build_recommendation_sections(
    liked: list[dict[str, Any]],
    subscriptions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    seen: set[str] = {str(item.get("videoId") or "") for item in liked}

    def add_section(title: str, subtitle: str, seed: str, limit: int = 10) -> None:
        if not seed:
            return
        try:
            candidates = search_songs(seed, limit=limit + 5)
        except Exception:
            return
        tracks: list[dict[str, Any]] = []
        for song in candidates:
            video_id = str(song.get("videoId") or "")
            if not video_id or video_id in seen:
                continue
            seen.add(video_id)
            tracks.append({**song, "source": "personalized"})
            if len(tracks) >= limit:
                break
        if tracks:
            sections.append({"title": title, "subtitle": subtitle, "tracks": tracks})

    if liked:
        sections.append({
            "title": "Послушать ещё раз",
            "subtitle": "Музыка, которую ты лайкал",
            "tracks": liked[:10],
        })

    artist_seeds: list[str] = []
    for item in liked:
        artist = str(item.get("artist") or "").strip()
        if artist and artist.lower() not in {"youtube", "youtube music"} and artist not in artist_seeds:
            artist_seeds.append(artist)
        if len(artist_seeds) >= 3:
            break

    labels = ["Похоже на то, что тебе нравится", "Ещё от любимых исполнителей", "Музыка под твой вкус"]
    for index, artist in enumerate(artist_seeds):
        add_section(labels[index], f"На основе {artist}", artist)

    if subscriptions:
        channel = str(subscriptions[0].get("title") or "").strip()
        add_section("Из твоих подписок", f"Новые находки рядом с {channel}", channel)

    if not sections:
        add_section("Попробуй сегодня", "Подборка для старта", "popular music 2026")
    return sections[:5]


def get_library(access_token: str) -> dict[str, Any]:
    playlists = get_playlists(access_token)
    liked = get_liked_videos(access_token)
    subscriptions = get_subscriptions(access_token)
    recommendation_sections = build_recommendation_sections(liked, subscriptions)
    recommendations = [track for section in recommendation_sections for track in section["tracks"]]
    return {
        "playlists": playlists,
        "liked": liked,
        "subscriptions": subscriptions,
        "recommendations": recommendations,
        "recommendationSections": recommendation_sections,
    }
