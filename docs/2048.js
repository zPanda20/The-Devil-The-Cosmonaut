/* 2048 in the equipped deck's colours. Tiles from 2048 up show the deck's King art. */
(function () {
  'use strict';
  var T = window.Table, App = window.App, CE = window.CardEngine, $ = T.$;
  var GAME_KEY = '2048:game:v1', STATS_KEY = '2048:stats:v1', N = 4;

  var G = null, nextId = 1, message = '', busy = false;

  function empty() { var out = []; for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (!tileAt(r, c)) out.push([r, c]); return out; }
  function tileAt(r, c) { for (var i = 0; i < G.tiles.length; i++) { var t = G.tiles[i]; if (t.r === r && t.c === c && !t.gone) return t; } return null; }
  function spawn() {
    var e = empty(); if (!e.length) return;
    var p = e[Math.floor(Math.random() * e.length)];
    G.tiles.push({ id: nextId++, v: Math.random() < 0.9 ? 2 : 4, r: p[0], c: p[1], fresh: true });
  }
  function newGame() {
    G = { tiles: [], score: 0, over: false, reached: false, keep: false, moves: 0 };
    spawn(); spawn();
    message = 'Swipe or use the arrow keys.';
    T.result(null);
    render();
  }

  // Slide every tile toward dir (0 up, 1 right, 2 down, 3 left). Returns true if anything moved.
  var queued = null;   // one swipe made during the slide animation runs right after it
  function move(dir) {
    if (busy) { queued = dir; return false; }
    if (!G || G.over) return false;
    G.tiles = G.tiles.filter(function (t) { return !t.gone; });
    G.tiles.forEach(function (t) { t.fresh = false; t.merged = false; });
    var moved = false, gained = 0;
    for (var line = 0; line < N; line++) {
      var cells = [];
      for (var k = 0; k < N; k++) {
        var r, c;
        if (dir === 0) { r = k; c = line; } else if (dir === 2) { r = N - 1 - k; c = line; }
        else if (dir === 3) { r = line; c = k; } else { r = line; c = N - 1 - k; }
        cells.push([r, c]);
      }
      var target = 0, last = null;
      for (var k2 = 0; k2 < N; k2++) {
        var t = tileAt(cells[k2][0], cells[k2][1]);
        if (!t) continue;
        if (last && last.v === t.v && !last.merged) {
          // Merge t into last: t slides onto last's cell and disappears; last doubles.
          t.r = last.r; t.c = last.c; t.gone = true;
          last.v *= 2; last.merged = true; gained += last.v; moved = true;
          last = null;
          continue;
        }
        var dest = cells[target];
        if (t.r !== dest[0] || t.c !== dest[1]) moved = true;
        t.r = dest[0]; t.c = dest[1];
        last = t; target++;
      }
    }
    if (!moved) return false;
    G.score += gained; G.moves++;
    var top = topTile();
    if (top >= 2048 && !G.reached) {
      G.reached = true;
      G.unlocked = App.award('g2048', 100);
      message = '<strong>2048!</strong> Your King has arrived. +100 points. Keep going for a higher tile.';
    } else message = '';
    busy = true;
    render();
    setTimeout(function () {
      busy = false;
      G.tiles = G.tiles.filter(function (t) { return !t.gone; });
      spawn();
      if (!canMove()) return finish();
      render();
      if (queued !== null) { var q = queued; queued = null; move(q); }
    }, 115);
    return true;
  }
  function topTile() { return G.tiles.reduce(function (m, t) { return t.gone ? m : Math.max(m, t.v); }, 0); }
  function canMove() {
    if (empty().length) return true;
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var t = tileAt(r, c);
      var right = c + 1 < N && tileAt(r, c + 1), down = r + 1 < N && tileAt(r + 1, c);
      if ((right && right.v === t.v) || (down && down.v === t.v)) return true;
    }
    return false;
  }

  function finish() {
    G.over = true;
    var st = T.stats(STATS_KEY), top = topTile();
    st.played++; if (G.score > (st.best || 0)) st.best = G.score; if (top > (st.top || 0)) st.top = top;
    if (G.reached) st.wins++;
    T.store(STATS_KEY, st);
    G.points = Math.min(150, Math.floor(G.score / 100));
    var un = App.award('g2048', G.points);
    G.unlocked = (G.unlocked || []).concat(un);
    render();
  }

  /* ---------- drawing ---------- */
  // Tile colours: a ramp in the deck's own hue range, pale for small tiles and richer as they grow.
  var palette = null, palDeck = null;
  function colours() {
    var d = T.deck();
    if (palDeck !== d) {
      var t = CE.getStyle(d).theme.regionTint || { h0: 20 };
      palette = [];
      for (var i = 0; i < 11; i++) palette.push({ h: Math.round(((t.h0 || 0) + i * 31) % 360), s: 35 + i * 4, l: 84 - i * 4 });
      palDeck = d;
    }
    return palette;
  }
  // King art for big tiles: face image positioned around the head.
  function artStyle(v) {
    var s = CE.getStyle(T.deck()), f = s.assets && s.assets.faces && s.assets.faces.K;
    if (!f) return null;
    var url = (Math.log2(v) % 2 === 1) ? f.red : f.black;   // 2048 red, 4096 black, 8192 red ...
    var fp = (s.assets.focus && s.assets.focus.K) || [0.5, 0.3];
    return 'background-image:url(' + url + ');background-size:140% auto;background-position:' + Math.round(fp[0] * 100) + '% ' + Math.round(fp[1] * 100) + '%;';
  }

  var size = 0, gap = 0, cell = 0;
  function render() {
    if (!G) return;
    var board = $('board'), rm = T.room(board, 280);
    size = Math.max(240, Math.min(560, rm.w, rm.h));
    gap = Math.round(size * 0.025); cell = (size - gap * (N + 1)) / N;
    board.style.width = size + 'px'; board.style.height = size + 'px';
    var pal = colours(), html = '';
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) html += '<div class="cell2048" style="left:' + (gap + c * (cell + gap)) + 'px;top:' + (gap + r * (cell + gap)) + 'px;width:' + cell + 'px;height:' + cell + 'px"></div>';
    G.tiles.slice().sort(function (a, b) { return (a.gone ? 0 : 1) - (b.gone ? 0 : 1); }).forEach(function (t) {
      var x = gap + t.c * (cell + gap), y = gap + t.r * (cell + gap);
      var digits = String(t.v).length, fs = Math.round(cell * (digits <= 2 ? 0.5 : digits === 3 ? 0.42 : 0.33));
      var art = t.v >= 2048 ? artStyle(t.v) : null;
      var pc = pal[Math.min(10, Math.log2(t.v) - 1)], bg = 'hsl(' + pc.h + ' ' + pc.s + '% ' + pc.l + '%)', fg = pc.l > 58 ? '#141414' : '#fff';
      html += '<div class="tile' + (t.fresh ? ' new' : '') + (t.merged && !busy ? '' : '') + (t.merged ? ' pop' : '') + (art ? ' art' : '') + '" data-id="' + t.id + '" style="width:' + cell + 'px;height:' + cell + 'px;left:0;top:0;transform:translate(' + x + 'px,' + y + 'px);font-size:' + fs + 'px;' +
        (art ? art : 'background:' + bg + ';color:' + fg + ';') + 'z-index:' + (t.gone ? 1 : 2) + '">' + (art ? '<span>' + t.v + '</span>' : t.v) + '</div>';
    });
    // Keep existing tile elements so the slide animates: patch transforms when the element already exists.
    var existing = {};
    Array.prototype.forEach.call(board.querySelectorAll('.tile'), function (el) { existing[el.getAttribute('data-id')] = el; });
    var tmp = document.createElement('div'); tmp.innerHTML = html;
    var frag = document.createDocumentFragment();
    Array.prototype.slice.call(tmp.children).forEach(function (el) {   // copy first: moving nodes out shrinks the live list
      var id = el.getAttribute('data-id'), old = id && existing[id];
      if (old) { old.className = el.className.replace(' new', ''); old.style.cssText = el.style.cssText; old.innerHTML = el.innerHTML; frag.appendChild(old); }
      else frag.appendChild(el);
    });
    board.innerHTML = ''; board.appendChild(frag);

    var st = T.stats(STATS_KEY);
    $('score').textContent = G.score.toLocaleString();
    $('best').textContent = Math.max(st.best || 0, G.score).toLocaleString();
    $('msg').innerHTML = message;
    if (G.over) {
      T.result({ title: G.reached ? 'Board full · top tile ' + topTile() : 'Board full', text: 'Score ' + G.score.toLocaleString() + ' in ' + G.moves + ' moves.', points: G.points, unlocked: G.unlocked });
      $('btn-keep').hidden = true;
    } else T.result(null);
    T.store(GAME_KEY, { G: G, nextId: nextId });
  }

  /* ---------- input ---------- */
  var KEYS = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3, W: 0, D: 1, S: 2, A: 3 };
  document.addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('select, input')) return;
    if (e.key in KEYS) { e.preventDefault(); move(KEYS[e.key]); }
  });
  var sw = null, board = $('board');
  board.addEventListener('pointerdown', function (e) { sw = { x: e.clientX, y: e.clientY, id: e.pointerId }; board.setPointerCapture(e.pointerId); });
  board.addEventListener('pointerup', function (e) {
    if (!sw || e.pointerId !== sw.id) return;
    var dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
  });
  board.addEventListener('pointercancel', function () { sw = null; });

  var confirmNew = 0;
  function askNew() {
    if (G && !G.over && G.moves > 5 && Date.now() - confirmNew > 2500) { confirmNew = Date.now(); message = '<strong>Tap New game again</strong> to end this one (its points are paid out).'; return render(); }
    if (G && !G.over && G.moves > 5) { finish(); }
    newGame();
  }
  $('btn-new').addEventListener('click', askNew);
  $('btn-again').addEventListener('click', newGame);

  T.init({ render: render });
  var saved = T.load(GAME_KEY);
  if (saved && saved.G && !saved.G.over) { G = saved.G; nextId = saved.nextId || 1000; G.tiles.forEach(function (t) { t.fresh = false; t.merged = false; }); message = 'Welcome back.'; render(); }
  else newGame();
})();
