"""Railway entrypoint with small runtime CSS overrides.

The repository's main stylesheet is intentionally left intact.  On every fresh
container start we append the responsive shelf rules once, then expose the
regular FastAPI application.
"""
from pathlib import Path

STYLE_PATH = Path(__file__).parent / "static" / "style.css"
MARKER = "/* responsive-home-shelves-v1 */"
OVERRIDES = r'''

/* responsive-home-shelves-v1 */
.home-view,
.home-shelves,
.music-row-section,
.recent-section {
  min-width: 0;
  max-width: 100%;
}

.music-row {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  grid-auto-columns: clamp(150px, calc((100% - 90px) / 6), 196px);
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 18px;
  scroll-behavior: smooth;
  scroll-snap-type: x proximity;
  overscroll-behavior-x: contain;
  scrollbar-width: auto;
  scrollbar-color: rgba(255,255,255,.32) rgba(255,255,255,.055);
}

.music-row .track-card {
  width: 100%;
  min-width: 0;
  scroll-snap-align: start;
}

.music-row::-webkit-scrollbar {
  height: 9px;
}

.music-row::-webkit-scrollbar-track {
  background: rgba(255,255,255,.055);
  border-radius: 999px;
}

.music-row::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,.30);
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 999px;
}

.music-row::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,.46);
  border: 2px solid transparent;
  background-clip: padding-box;
}

@media (max-width: 1250px) {
  .music-row {
    grid-auto-columns: clamp(150px, calc((100% - 54px) / 4), 190px);
  }
}

@media (max-width: 900px) {
  .music-row {
    grid-auto-columns: clamp(145px, calc((100% - 36px) / 3), 180px);
  }
}

@media (max-width: 620px) {
  .music-row {
    grid-auto-columns: minmax(145px, 72vw);
    gap: 14px;
    padding-bottom: 14px;
  }
}
'''

if STYLE_PATH.exists():
    current = STYLE_PATH.read_text(encoding="utf-8")
    if MARKER not in current:
        STYLE_PATH.write_text(current + OVERRIDES, encoding="utf-8")

from main import app  # noqa: E402  (import after preparing static assets)
