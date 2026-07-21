#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  . .venv/bin/activate
  python -m pip install --upgrade pip
  pip install -r requirements.txt
else
  . .venv/bin/activate
fi
python -m uvicorn main:app --host 0.0.0.0 --port 8000
