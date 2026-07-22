"""Railway entrypoint that applies final UI/runtime upgrades before FastAPI starts."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

STYLE_PATH = Path(__file__).parent / "static" / "style.css"
APP_JS_PATH = Path(__file__).parent / "static" / "app.js"
STYLE_MARKER = "/* responsive-home-shelves-v2 */"
JS_MARKER = "/* smart-personal-radio-v1 */"

OVERRIDES = r'''

/* responsive-home-shelves-v2 */
.workspace,
.content,
.view,
.home-view,
.home-shelves,
#homeRecommendations,
.music-row-section,
.recent-section {
  min-width: 0 !important;
  max-width: 100% !important;
}
.content,
.home-view,
.home-shelves,
#homeRecommendations { overflow-x: hidden !important; }
.music-row-section { width: 100% !important; overflow: hidden !important; }
.music-row {
  display: flex !important;
  flex-wrap: nowrap !important;
  gap: 18px !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  overflow-x: scroll !important;
  overflow-y: hidden !important;
  padding: 2px 2px 16px !important;
  scroll-behavior: smooth;
  scroll-snap-type: x mandatory;
  overscroll-behavior-inline: contain;
  scrollbar-gutter: stable;
  scrollbar-width: auto;
  scrollbar-color: rgba(255,255,255,.42) rgba(255,255,255,.075);
}
.music-row > .track-card {
  flex: 0 0 clamp(150px, calc((100% - 90px) / 6), 196px) !important;
  width: auto !important;
  min-width: 0 !important;
  max-width: none !important;
  scroll-snap-align: start;
}
.music-row::-webkit-scrollbar { height: 10px !important; display: block !important; }
.music-row::-webkit-scrollbar-track { background: rgba(255,255,255,.075) !important; border-radius: 999px; }
.music-row::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,.42) !important;
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 999px;
  min-width: 48px;
}
.music-row::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,.62) !important;
  border: 2px solid transparent;
  background-clip: padding-box;
}
@media (max-width: 1250px) { .music-row > .track-card { flex-basis: clamp(150px, calc((100% - 54px) / 4), 190px) !important; } }
@media (max-width: 900px) { .music-row > .track-card { flex-basis: clamp(145px, calc((100% - 36px) / 3), 180px) !important; } }
@media (max-width: 620px) {
  .music-row { gap: 14px !important; padding-bottom: 14px !important; }
  .music-row > .track-card { flex-basis: min(72vw, 170px) !important; }
}
'''

OLD_NEXT_TRACK = """async function nextTrack(direction=1){
  if(state.roomCode){sendWS({type:direction>0?'queue_next':'queue_prev',expectedCurrentId:state.currentQueueId||null});return;}
  let queue=state.localQueue;if(!queue.length)return;
  let index=queue.findIndex((item)=>item.id===state.currentQueueId);if(index<0)index=0;
  let target=index+direction;
  if(direction>0&&target>=queue.length){
    const seed=[state.currentSong?.artist,state.currentSong?.title].filter(Boolean).join(' ');
    if(seed){try{const data=await api(`/api/search?q=${encodeURIComponent(seed)}&token=${encodeURIComponent(state.token)}`);for(const song of data.results||[]){if(!state.localQueue.some(item=>item.videoId===song.videoId)){state.localQueue.push({...song,id:crypto.randomUUID().slice(0,12),addedBy:'Умная очередь',votes:0,source:'smart_radio'});}if(state.localQueue.length>=index+7)break;}smartLocalQueue();saveLocalQueue();queue=state.localQueue;target=index+1;}catch(error){toast('Не удалось продолжить умную очередь','error');}}
  }
  if(target<0||target>=queue.length){toast('Больше треков нет');return;}
  state.currentQueueId=queue[target].id;playSongInternal(queue[target],true,0);renderQueue();
}"""

NEW_NEXT_TRACK = """/* smart-personal-radio-v1 */
async function nextTrack(direction=1){
  if(state.roomCode){sendWS({type:direction>0?'queue_next':'queue_prev',expectedCurrentId:state.currentQueueId||null});return;}
  let queue=state.localQueue;if(!queue.length)return;
  let index=queue.findIndex((item)=>item.id===state.currentQueueId);if(index<0)index=0;
  let target=index+direction;
  if(direction>0&&target>=queue.length&&state.currentSong?.videoId){
    try{
      const payload={
        token:state.token,
        current:state.currentSong,
        recent:state.recent.slice(0,18),
        exclude_video_ids:state.localQueue.map((item)=>item.videoId).filter(Boolean),
        limit:20
      };
      const data=await api('/api/radio/smart',{method:'POST',body:JSON.stringify(payload)});
      for(const song of data.results||[]){
        if(!state.localQueue.some((item)=>item.videoId===song.videoId)){
          state.localQueue.push({...song,id:crypto.randomUUID().slice(0,12),addedBy:'Умная очередь',votes:0,source:'smart_radio'});
        }
      }
      smartLocalQueue();saveLocalQueue();queue=state.localQueue;target=index+1;
    }catch(error){toast('Не удалось продолжить умную очередь','error');}
  }
  if(target<0||target>=queue.length){toast('Больше треков нет');return;}
  state.currentQueueId=queue[target].id;playSongInternal(queue[target],true,0);renderQueue();
}"""

if STYLE_PATH.exists():
    current_style = STYLE_PATH.read_text(encoding="utf-8")
    if STYLE_MARKER not in current_style:
        STYLE_PATH.write_text(current_style + OVERRIDES, encoding="utf-8")

if APP_JS_PATH.exists():
    current_js = APP_JS_PATH.read_text(encoding="utf-8")
    if JS_MARKER not in current_js and OLD_NEXT_TRACK in current_js:
        APP_JS_PATH.write_text(current_js.replace(OLD_NEXT_TRACK, NEW_NEXT_TRACK), encoding="utf-8")

import main  # noqa: E402
from recommender import build_smart_radio  # noqa: E402

app = main.app


class SmartRadioBody(BaseModel):
    token: str
    current: dict[str, Any]
    recent: list[dict[str, Any]] = Field(default_factory=list, max_length=50)
    exclude_video_ids: list[str] = Field(default_factory=list, max_length=500)
    limit: int = Field(default=20, ge=5, le=30)


@app.post("/api/radio/smart")
def smart_radio(body: SmartRadioBody) -> dict[str, Any]:
    main.require_user(body.token)
    if not body.current.get("videoId"):
        return {"results": []}
    try:
        results = build_smart_radio(
            current=body.current,
            recent=body.recent,
            exclude_video_ids=body.exclude_video_ids,
            limit=body.limit,
        )
    except Exception:
        results = []
    return {"results": results}


_original_search_songs = main.search_songs


def _room_radio_search(query: str, limit: int = 24) -> list[dict[str, Any]]:
    """Upgrade existing room auto-fill without changing ordinary user search."""
    if limit not in {14, 18}:
        return _original_search_songs(query, limit=limit)
    seeds = _original_search_songs(query, limit=5)
    if not seeds:
        return []
    try:
        return build_smart_radio(seeds[0], recent=[], limit=limit)
    except Exception:
        return seeds


main.search_songs = _room_radio_search
