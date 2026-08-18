"""Guarantee that the My Wave frontend is linked from the served HTML.

This module is imported from ytmusic_search, which main.py always imports, so it
works even when Railway starts `uvicorn main:app` and ignores Procfile wrappers.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent
INDEX = ROOT / "static" / "index.html"
SCRIPT_TAG = '<script src="/static/wave.js?v=3" defer></script>'


def ensure_wave_script() -> None:
    if not INDEX.exists():
        return
    html = INDEX.read_text(encoding="utf-8")
    if "/static/wave.js" in html:
        return
    anchor = '<script src="/static/player_extras.js" defer></script>'
    if anchor in html:
        html = html.replace(anchor, f'{SCRIPT_TAG}\n  {anchor}', 1)
    else:
        html = html.replace("</head>", f"  {SCRIPT_TAG}\n</head>", 1)
    INDEX.write_text(html, encoding="utf-8")


try:
    ensure_wave_script()
except Exception as exc:
    print(f"My Wave bootstrap warning: {exc}")
