"""Railway entrypoint that applies final UI/runtime upgrades before FastAPI starts."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

STYLE_PATH = Path(__file__).parent / "static" / "style.css"
APP_JS_PATH = Path(__file__).parent / "static" / "app.js"
STYLE_MARKER = "/* responsive-home-shelves-v2 */"
MOBILE_STYLE_MARKER = "/* mobile-responsive-v1 */"
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

MOBILE_OVERRIDES = r'''

/* mobile-responsive-v1 */
@media (max-width: 900px) {
  html, body { width: 100%; max-width: 100%; overflow-x: hidden; }
  body { -webkit-tap-highlight-color: transparent; }
  button, input, [role="button"] { touch-action: manipulation; }

  .app-shell { min-height: 100dvh; }
  .workspace { width: 100% !important; margin-left: 0 !important; min-height: 100dvh; }

  .sidebar {
    position: fixed !important;
    inset: 0 auto 0 0 !important;
    width: min(86vw, 340px) !important;
    max-width: 340px !important;
    z-index: 1200 !important;
    transform: translateX(-105%);
    transition: transform .24s ease;
    padding-bottom: max(18px, env(safe-area-inset-bottom));
    overflow-y: auto;
  }
  .sidebar.open { transform: translateX(0); }
  .sidebar-backdrop {
    position: fixed !important;
    inset: 0 !important;
    z-index: 1190 !important;
    background: rgba(0,0,0,.62) !important;
    backdrop-filter: blur(8px);
  }
  .sidebar-backdrop:not(.open) { pointer-events: none; opacity: 0; }

  .mobile-only { display: inline-flex !important; }
  .topbar {
    position: sticky !important;
    top: 0;
    z-index: 900;
    gap: 10px !important;
    min-height: 64px;
    padding: max(10px, env(safe-area-inset-top)) 12px 10px !important;
    background: rgba(8,11,18,.88) !important;
    backdrop-filter: blur(18px);
  }
  #mobileMenuBtn { flex: 0 0 44px; width: 44px; height: 44px; }
  .search-wrap { min-width: 0 !important; flex: 1 1 auto !important; }
  .search-wrap input { width: 100% !important; min-width: 0 !important; font-size: 16px !important; }
  .room-chip { display: none !important; }
  .suggestions {
    position: fixed !important;
    left: 12px !important;
    right: 12px !important;
    top: calc(max(10px, env(safe-area-inset-top)) + 58px) !important;
    width: auto !important;
    max-height: 54dvh;
    overflow-y: auto;
  }

  .content {
    width: 100% !important;
    padding: 18px 14px calc(118px + env(safe-area-inset-bottom)) !important;
    overflow-x: hidden !important;
  }
  .view { width: 100% !important; }
  .home-header, .section-heading {
    align-items: flex-start !important;
    gap: 12px !important;
    margin-bottom: 18px !important;
  }
  .home-header h1 { font-size: clamp(28px, 9vw, 42px) !important; line-height: 1.02 !important; }
  .home-header p { max-width: 100% !important; }
  .library-pill { display: none !important; }

  .split-grid, .room-grid { grid-template-columns: 1fr !important; gap: 14px !important; }
  .track-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 12px !important; }
  .playlist-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 12px !important; }
  .friend-list.grid, .people-list.grid { grid-template-columns: 1fr !important; }
  .panel { padding: 16px !important; border-radius: 18px !important; }
  .inline-form { display: grid !important; grid-template-columns: 1fr !important; gap: 10px !important; }
  .inline-form input, .inline-form button { width: 100% !important; min-height: 48px; }
  .button-row { flex-wrap: wrap; }
  .section-heading.secondary { align-items: center !important; }
  .section-heading.secondary .button-row { width: 100%; }
  .section-heading.secondary .button-row > * { flex: 1 1 140px; }
  .empty-state { grid-template-columns: 1fr !important; text-align: center; justify-items: center; padding: 24px 18px !important; }

  .music-row {
    margin-inline: -14px !important;
    width: calc(100% + 28px) !important;
    max-width: none !important;
    padding: 2px 14px 14px !important;
    scrollbar-width: none !important;
    scroll-padding-inline: 14px;
  }
  .music-row::-webkit-scrollbar { display: none !important; }
  .music-row > .track-card { flex-basis: min(44vw, 176px) !important; }
  .track-card { border-radius: 16px !important; }
  .track-card .track-actions { opacity: 1 !important; }
  .card-play { width: 46px !important; height: 46px !important; }

  .queue-drawer {
    position: fixed !important;
    inset: auto 0 0 0 !important;
    width: 100% !important;
    max-width: none !important;
    height: min(88dvh, 760px) !important;
    border-radius: 24px 24px 0 0 !important;
    transform: translateY(105%);
    transition: transform .28s ease;
    padding: 18px 14px max(22px, env(safe-area-inset-bottom)) !important;
    z-index: 1400 !important;
  }
  .queue-drawer.open { transform: translateY(0); }
  .queue-drawer::before {
    content: "";
    display: block;
    width: 42px;
    height: 4px;
    border-radius: 99px;
    margin: -6px auto 12px;
    background: rgba(255,255,255,.28);
  }
  .queue-backdrop { position: fixed !important; inset: 0 !important; z-index: 1390 !important; }
  .drawer-note { display: none !important; }
  .queue-list { overflow-y: auto; overscroll-behavior: contain; }
  .queue-item { grid-template-columns: 28px 48px minmax(0,1fr) auto !important; gap: 10px !important; padding: 10px 4px !important; }
  .queue-thumb { width: 48px !important; height: 48px !important; }
  .queue-votes { display: none !important; }

  .modal-backdrop { padding: 0 !important; align-items: stretch !important; }
  .playlist-modal {
    width: 100% !important;
    max-width: none !important;
    height: 100dvh !important;
    max-height: none !important;
    border-radius: 0 !important;
    padding: max(16px, env(safe-area-inset-top)) 14px max(18px, env(safe-area-inset-bottom)) !important;
  }
  .modal-track-list { overflow-y: auto; }
  .modal-track { grid-template-columns: 52px minmax(0,1fr) 44px !important; }

  .player-bar {
    position: fixed !important;
    left: 8px !important;
    right: 8px !important;
    bottom: max(8px, env(safe-area-inset-bottom)) !important;
    width: auto !important;
    min-height: 72px !important;
    height: 72px !important;
    z-index: 1100 !important;
    display: grid !important;
    grid-template-columns: minmax(0,1fr) auto auto !important;
    gap: 8px !important;
    padding: 8px !important;
    border-radius: 18px !important;
    background: rgba(18,23,34,.96) !important;
    box-shadow: 0 16px 50px rgba(0,0,0,.48) !important;
    backdrop-filter: blur(20px);
  }
  .now-playing { min-width: 0 !important; gap: 10px !important; }
  .player-cover { width: 54px !important; height: 54px !important; flex: 0 0 54px !important; border-radius: 12px !important; }
  .now-meta { min-width: 0 !important; }
  .now-meta strong, .now-meta span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .player-center { display: contents !important; }
  .player-controls { gap: 2px !important; }
  .player-controls #prevBtn { display: none !important; }
  .play-button { width: 46px !important; height: 46px !important; }
  .control-button { width: 42px !important; height: 42px !important; }
  .timeline { display: none !important; }
  .player-tools { display: flex !important; gap: 2px !important; }
  .player-tools .volume-icon, #volumeBar { display: none !important; }
  .queue-button b { min-width: 16px; }

  .auth-screen { min-height: 100dvh !important; padding: max(24px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom)) !important; grid-template-columns: 1fr !important; gap: 24px !important; }
  .auth-brand-block { text-align: center; justify-content: center; }
  .auth-lead { margin-inline: auto; }
  .auth-card { width: 100% !important; max-width: 520px !important; margin-inline: auto; padding: 22px 18px !important; }
  .auth-card input { font-size: 16px !important; }

  .toast-stack { left: 12px !important; right: 12px !important; bottom: calc(92px + env(safe-area-inset-bottom)) !important; }
  .toast { width: 100% !important; max-width: none !important; }
}

@media (max-width: 520px) {
  .content { padding-inline: 12px !important; }
  .music-row { margin-inline: -12px !important; width: calc(100% + 24px) !important; padding-inline: 12px !important; }
  .music-row > .track-card { flex-basis: min(48vw, 168px) !important; }
  .track-grid, .playlist-grid { gap: 10px !important; }
  .track-grid .track-info strong, .playlist-card strong { font-size: 14px !important; }
  .section-heading { flex-direction: column !important; }
  .section-heading > button { width: 100%; }
  .room-summary { align-items: stretch !important; }
  .room-summary > button { width: 100% !important; }
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
    additions = []
    if STYLE_MARKER not in current_style:
        additions.append(OVERRIDES)
    if MOBILE_STYLE_MARKER not in current_style:
        additions.append(MOBILE_OVERRIDES)
    if additions:
        STYLE_PATH.write_text(current_style + "".join(additions), encoding="utf-8")

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
