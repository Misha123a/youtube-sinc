"""
Поиск треков на YouTube Music через неофициальную библиотеку ytmusicapi.

Авторизация НЕ нужна для обычного поиска — только для доступа к личным
плейлистам/библиотеке пользователя (это можно добавить позже отдельным
шагом, если понадобится).
"""

from ytmusicapi import YTMusic

_yt = YTMusic()


def search_songs(query: str, limit: int = 15) -> list[dict]:
    results = _yt.search(query, filter="songs", limit=limit)
    songs = []
    for r in results:
        video_id = r.get("videoId")
        if not video_id:
            continue
        artists = ", ".join(a["name"] for a in r.get("artists", []) if "name" in a)
        thumbnails = r.get("thumbnails") or []
        thumb = thumbnails[-1]["url"] if thumbnails else ""
        songs.append(
            {
                "videoId": video_id,
                "title": r.get("title", ""),
                "artist": artists,
                "thumbnail": thumb,
            }
        )
    return songs
