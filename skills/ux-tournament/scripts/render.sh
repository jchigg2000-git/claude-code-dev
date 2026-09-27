#!/usr/bin/env bash
# Render a static HTML mockup to PNG with headless Chrome.
# Usage: render.sh <in.html> <out.png> [width=1440] [height=1000]
# Gotchas baked in (from plain-cut STEP 7): headless Chrome stops compositing when the display sleeps, so the
# run is wrapped in `caffeinate -dimsu`; a throwaway profile avoids colliding with a running Chrome; no
# virtual-time flag (rAF-based settles hang); a watchdog kills Chrome after RENDER_TIMEOUT seconds (default 30).
set -uo pipefail
in="${1:?in.html}"; out="${2:?out.png}"; w="${3:-1440}"; h="${4:-1000}"
CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "render: chrome not found at $CHROME (set CHROME_BIN)" >&2; exit 2; }
[ -f "$in" ] || { echo "render: no such file $in" >&2; exit 2; }
abs="$(cd "$(dirname "$in")" && pwd)/$(basename "$in")"
tmp="$(mktemp -d)"; rm -f "$out"
cleanup() { [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null; pkill -P "${pid:-0}" 2>/dev/null; rm -rf "$tmp"; }
trap cleanup EXIT
wrap=(); command -v caffeinate >/dev/null && wrap=(caffeinate -dimsu)
"${wrap[@]}" "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
  --user-data-dir="$tmp" --window-size="${w},${h}" --screenshot="$out" "file://$abs" >/dev/null 2>&1 &
pid=$!
# Chrome often writes the PNG and then never exits; treat a stable non-empty file as done.
limit="${RENDER_TIMEOUT:-30}"; t=0; last=-1
while kill -0 "$pid" 2>/dev/null && [ "$t" -lt "$limit" ]; do
  sleep 1; t=$((t+1))
  if [ -s "$out" ]; then sz=$(stat -f %z "$out" 2>/dev/null || echo 0); [ "$sz" = "$last" ] && break; last=$sz; fi
done
kill "$pid" 2>/dev/null
[ -s "$out" ] && { echo "$out"; exit 0; }
echo "render: no screenshot produced for $in after ${t}s" >&2; exit 1
