"""Startup wrapper that enables the My Wave frontend without disturbing existing runtime upgrades."""
from __future__ import annotations

from pathlib import Path

import startup

INDEX_PATH = Path(__file__).parent / "static" / "index.html"
SCRIPT_TAG = '<script src="/static/wave.js" defer></script>'

if INDEX_PATH.exists():
    html = INDEX_PATH.read_text(encoding="utf-8")
    if SCRIPT_TAG not in html:
        anchor = '<script src="/static/player_extras.js" defer></script>'
        if anchor in html:
            html = html.replace(anchor, f'{SCRIPT_TAG}\n  {anchor}', 1)
        else:
            html = html.replace('</head>', f'  {SCRIPT_TAG}\n</head>', 1)
        INDEX_PATH.write_text(html, encoding="utf-8")

app = startup.app
