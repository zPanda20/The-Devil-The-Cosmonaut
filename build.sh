#!/bin/bash
# Builds the playable site.
#   docs/  standalone site (GitHub Pages / Render: publish directory "docs")
#   dist/  same files, but index.html without its own <head> (for the claude.ai artifact, which adds one)
set -e
cd "$(dirname "$0")"
mkdir -p docs dist

HEAD='<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'

# Only the equipped deck's artwork loads up front; other decks load on demand (App.ensureArt).
BASE='<script src="engine.js"></script>
<script src="app.js"></script>
<script>document.write('"'"'<script src="art-'"'"' + App.getDeck() + '"'"'.js"><\/script>'"'"');</script>'

# Level pack: tools/levels.json -> src/levels.js
{ printf 'window.COSMO_LEVELS = '; cat tools/levels.json; printf ';\n'; } > src/levels.js

python3 - "$HEAD" "$BASE" <<'PY'
import sys, os
head, base = sys.argv[1], sys.argv[2]
ui = open('src/ui.css').read()
def scripts(*names): return base + '\n' + '\n'.join('<script src="%s"></script>' % n for n in names)
pages = {
  # name: (source, extra scripts)
  'grip.html':    ('src/grip.html', ['grip.js']),
  'cosmo.html':   ('src/cosmo.html', ['levels.js', 'cosmo.js']),
  'pyramid.html': ('src/pages/pyramid.html', ['table.js', 'pyramid.js']),
}
for extra in ['klondike', '2048', 'hearts', 'spades']:
    if os.path.exists('src/pages/%s.html' % extra):
        pages[extra + '.html'] = ('src/pages/%s.html' % extra, ['table.js'] + (['klondike-deals.js'] if extra == 'klondike' else []) + (['tricks.js'] if extra in ('hearts', 'spades') else []) + [extra + '.js'])
for name, (src, extra) in pages.items():
    body = open(src).read().replace('/*UI*/', ui)
    html = head + '\n' + body + '\n' + scripts(*extra) + '\n'
    for d in ('docs', 'dist'): open(os.path.join(d, name), 'w').write(html)
home = open('src/home.html').read().replace('/*UI*/', ui).replace('<!--SCRIPTS-->', scripts('levels.js'))
open('docs/index.html', 'w').write(head + '\n' + home)
open('dist/index.html', 'w').write(home)
PY
for d in docs dist; do cp src/*.js "$d/"; done
for f in docs/*.js; do node --check "$f"; done
echo "Built docs/ and dist/"
