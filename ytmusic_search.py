"""YouTube Music search helpers with small in-process caches."""
from __future__ import annotations
from functools import lru_cache
from typing import Any
from ytmusicapi import YTMusic
_yt = YTMusic()
def _thumbnail(items: list[dict[str, Any]] | None) -> str:
    thumbnails=items or []
    return str(thumbnails[-1].get('url','')).replace('http://','https://') if thumbnails else ''
@lru_cache(maxsize=256)
def search_songs(query: str, limit: int = 24) -> list[dict[str, Any]]:
    clean=' '.join(query.split()).strip()
    if not clean:return []
    songs=[]
    for item in _yt.search(clean,filter='songs',limit=limit):
        video_id=item.get('videoId')
        if not video_id:continue
        artists=', '.join(a.get('name','') for a in item.get('artists',[]) if a.get('name'))
        album_data=item.get('album') or {}; album=album_data.get('name','') if isinstance(album_data,dict) else ''
        songs.append({'videoId':video_id,'title':item.get('title','Без названия'),'artist':artists or 'Неизвестный исполнитель','album':album,'duration':item.get('duration',''),'durationSeconds':item.get('duration_seconds'),'thumbnail':_thumbnail(item.get('thumbnails')),'isExplicit':bool(item.get('isExplicit',False)),'source':'search'})
    return songs
@lru_cache(maxsize=512)
def search_suggestions(query: str, limit: int = 8) -> list[str]:
    clean=' '.join(query.split()).strip()
    if len(clean)<2:return []
    normalized=[]
    for suggestion in _yt.get_search_suggestions(clean):
        text=suggestion if isinstance(suggestion,str) else str(suggestion.get('text') or suggestion.get('query') or '') if isinstance(suggestion,dict) else str(suggestion)
        text=text.strip()
        if text and text not in normalized:normalized.append(text)
        if len(normalized)>=limit:break
    return normalized
