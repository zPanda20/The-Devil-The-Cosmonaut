#!/bin/bash
# Builds the playable site into docs/ (ready for GitHub Pages: Settings > Pages > main /docs).
set -e
cd "$(dirname "$0")"
mkdir -p docs
HEAD='<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
COMMON='<script src="engine.js"></script>
<script src="art-void-ink.js"></script>
<script src="art-neon-riot.js"></script>
<script src="art-hellfire-pulp.js"></script>
<script src="art-signal-orange.js"></script>
<script src="art-blood-moon.js"></script>
<script src="levels.js"></script>
<script src="app.js"></script>'
# Level pack: tools/levels.json -> src/levels.js
{ printf 'window.COSMO_LEVELS = '; cat tools/levels.json; printf ';\n'; } > src/levels.js
python3 - "$HEAD" "$COMMON" <<'PY'
import sys
head, common = sys.argv[1], sys.argv[2]
open('docs/index.html', 'w').write(head + '\n' + open('src/home.html').read().replace('<!--SCRIPTS-->', common))
PY
{ echo "$HEAD"; cat src/grip.html; echo "$COMMON"; echo '<script src="grip.js"></script>'; } > docs/grip.html
{ echo "$HEAD"; cat src/cosmo.html; echo "$COMMON"; echo '<script src="cosmo.js"></script>'; } > docs/cosmo.html
cp src/*.js docs/
for f in docs/*.js; do node --check "$f"; done
echo "Built docs/"
