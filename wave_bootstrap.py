"""Guarantee frontend upgrade scripts are linked from the served HTML.

This module is imported from ytmusic_search, which main.py always imports, so it
works even when Railway starts `uvicorn main:app` and ignores Procfile wrappers.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent
INDEX = ROOT / "static" / "index.html"
WAVE_TAG = '<script src="/static/wave.js?v=3" defer></script>'
GOOGLE_AUTH_FIX_TAG = '<script src="/static/google_auth_fix.js?v=1" defer></script>'


def ensure_frontend_scripts() -> None:
    if not INDEX.exists():
        return

    html = INDEX.read_text(encoding="utf-8")
    changed = False

    if "/static/wave.js" not in html:
        anchor = '<script src="/static/player_extras.js" defer></script>'
        if anchor in html:
            html = html.replace(anchor, f'{WAVE_TAG}\n  {anchor}', 1)
        else:
            html = html.replace("</head>", f"  {WAVE_TAG}\n</head>", 1)
        changed = True

    if "/static/google_auth_fix.js" not in html:
        anchor = '<script src="/static/player_extras.js" defer></script>'
        if anchor in html:
            html = html.replace(anchor, f'{anchor}\n  {GOOGLE_AUTH_FIX_TAG}', 1)
        else:
            html = html.replace("</head>", f"  {GOOGLE_AUTH_FIX_TAG}\n</head>", 1)
        changed = True

    if changed:
        INDEX.write_text(html, encoding="utf-8")


try:
    ensure_frontend_scripts()
except Exception as exc:
    print(f"Frontend bootstrap warning: {exc}")
