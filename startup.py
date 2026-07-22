"""Railway entrypoint that applies final static UI overrides before FastAPI starts."""
from pathlib import Path

STYLE_PATH = Path(__file__).parent / "static" / "style.css"
MARKER = "/* responsive-home-shelves-v2 */"
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
#homeRecommendations {
  overflow-x: hidden !important;
}

.music-row-section {
  width: 100% !important;
  overflow: hidden !important;
}

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

.music-row::-webkit-scrollbar {
  height: 10px !important;
  display: block !important;
}

.music-row::-webkit-scrollbar-track {
  background: rgba(255,255,255,.075) !important;
  border-radius: 999px;
}

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

@media (max-width: 1250px) {
  .music-row > .track-card {
    flex-basis: clamp(150px, calc((100% - 54px) / 4), 190px) !important;
  }
}

@media (max-width: 900px) {
  .music-row > .track-card {
    flex-basis: clamp(145px, calc((100% - 36px) / 3), 180px) !important;
  }
}

@media (max-width: 620px) {
  .music-row {
    gap: 14px !important;
    padding-bottom: 14px !important;
  }

  .music-row > .track-card {
    flex-basis: min(72vw, 170px) !important;
  }
}
'''

if STYLE_PATH.exists():
    current = STYLE_PATH.read_text(encoding="utf-8")
    if MARKER not in current:
        STYLE_PATH.write_text(current + OVERRIDES, encoding="utf-8")

from main import app  # noqa: E402
