"""Small startup hook loaded automatically by Python's site module.

It makes sure the My Wave frontend script is present even when Railway uses a
custom start command such as ``uvicorn main:app`` and therefore bypasses
``wave_startup.py`` / Procfile.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INDEX = ROOT / "static" / "index.html"
SCRIPT_TAG = '<script src="/static/wave.js" defer></script>'

try:
    if INDEX.exists():
        html = INDEX.read_text(encoding="utf-8")
        if SCRIPT_TAG not in html:
            anchor = '<script src="/static/player_extras.js" defer></script>'
            if anchor in html:
                html = html.replace(anchor, f'{SCRIPT_TAG}\n  {anchor}', 1)
            else:
                html = html.replace('</head>', f'  {SCRIPT_TAG}\n</head>', 1)
            INDEX.write_text(html, encoding="utf-8")
except Exception as exc:
    print(f"My Wave loader warning: {exc}")
