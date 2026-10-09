#!/bin/bash
# Screenshot a plain-walkthrough page in light and dark, at 1280px and 390px, as 2400px-tall tiles.
# usage: shoot.sh <page.html> [outdir]   (default outdir /tmp/pw-shots)
#
# Why the wrappers: headless Chrome won't lay out narrower than ~500px, and it doesn't paint
# after a scroll or an #anchor jump. So each tile loads the page in an iframe of the target width,
# shifted up by the tile's offset inside a clipping box.
set -euo pipefail
page="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
out="${2:-/tmp/pw-shots}"
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TILE=2400
MAXTILES=12
mkdir -p "$out"
rm -f "$out"/*.png "$out"/wrap.html

for theme in light dark; do
  if [ "$theme" = light ]; then flag=--blink-settings=preferredColorScheme=1; else flag=--force-dark-mode; fi
  for w in 1280 390; do
    win=$(( w < 600 ? 600 : w ))
    for ((i = 0; i < MAXTILES; i++)); do
      off=$(( i * TILE ))
      printf '<!doctype html><body style="margin:0"><div style="width:%dpx;height:%dpx;overflow:hidden"><iframe src="file://%s" width="%d" height="%d" style="border:0;display:block;margin-top:-%dpx"></iframe></div>' \
        "$w" "$TILE" "$page" "$w" "$(( off + TILE ))" "$off" > "$out/wrap.html"
      shot="$out/$theme-$w-$(printf %02d "$i").png"
      "$C" --headless --hide-scrollbars --allow-file-access-from-files "$flag" \
        --window-size="$win,$TILE" --screenshot="$shot" "file://$out/wrap.html" >/dev/null 2>&1
      # A tile past the end of the page is flat colour and compresses to almost nothing: drop it and stop.
      if [ "$(stat -f%z "$shot")" -lt 20000 ]; then rm -f "$shot"; break; fi
    done
  done
done
rm -f "$out/wrap.html"
ls -1 "$out"/*.png
