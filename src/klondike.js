/* Klondike solitaire. Draw 1 or 3, unlimited redeals, optional winnable-only deals (seeds proven by tools/klondike-solver.js).
 * Tap a card to send it to its best spot; drag a card or run to place it exactly. */
(function () {
  'use strict';
  var T = window.Table, App = window.App, $ = T.$;
  var GAME_KEY = 'klondike:game:v1', PREFS_KEY = 'klondike:prefs:v1', STATS_KEY = 'klondike:stats:v1';
  var SUITS = ['S', 'H', 'D', 'C'];

  var prefs = Object.assign({ draw: 1, winnable: true, next1: 0, next3: 0 }, T.load(PREFS_KEY) || {});
  var S = null, history = [], hint = null, message = '', L = null, finishing = false;

  function red(c) { return c.suit === 'H' || c.suit === 'D'; }
  function si(c) { return SUITS.indexOf(c.suit); }

  /* ---------- dealing (must match tools/klondike-solver.js) ---------- */
  function pickSeed() {
    var list = window.KLONDIKE_DEALS && window.KLONDIKE_DEALS['draw' + prefs.draw];
    if (prefs.winnable && list && list.length) {
      var k = 'next' + prefs.draw, i = prefs[k] % list.length;
      prefs[k] = i + 1; T.store(PREFS_KEY, prefs);
      return { seed: list[i], winnable: true };
    }
    return { seed: (Math.random() * 4294967296) >>> 0, winnable: false };
  }
  function deal() {
    var pick = pickSeed();
    var cards = T.shuffled(T.pack(), T.rng(pick.seed));
    var cols = [[], [], [], [], [], [], []], k = 0;
    for (var r = 0; r < 7; r++) for (var c = r; c < 7; c++) cols[c].push(cards[k++]);
    S = { seed: pick.seed, winnable: pick.winnable, draw: prefs.draw, cols: cols.map(function (cc) { return { cards: cc, down: cc.length - 1 }; }),
      stock: cards.slice(k), waste: [], found: [[], [], [], []], moves: 0, passes: 0, over: false, won: false };
    history = []; hint = null; finishing = false;
    message = 'New deal' + (pick.winnable ? ' (winnable)' : '') + ', draw ' + prefs.draw + '. Tap a card to move it, or drag it.';
    T.result(null);
    render();
  }

  function snapshot() { history.push(JSON.stringify(S)); if (history.length > 300) history.shift(); }
  function lockUndo() { history = []; }

  /* ---------- rules ---------- */
  function topOf(arr) { return arr.length ? arr[arr.length - 1] : null; }
  function canFound(c) { return topOf(S.found[si(c)]) ? topOf(S.found[si(c)]).v === c.v - 1 : c.v === 1; }
  function canStack(col, c) {
    var t = topOf(col.cards);
    if (!t) return c.v === 13;
    return t.v === c.v + 1 && red(t) !== red(c);
  }
  function flipCol(col) {
    if (col.cards.length && col.down >= col.cards.length) { col.down = col.cards.length - 1; return true; }
    return false;
  }
  function foundCount() { return S.found.reduce(function (n, f) { return n + f.length; }, 0); }

  // A move: {from: 'w'|'c', col, idx, to: 'f'|'c', dest}
  function apply(m) {
    snapshot();
    var cards, flipped = false;
    if (m.from === 'w') cards = [S.waste.pop()];
    else if (m.from === 'f') cards = [S.found[m.col].pop()];
    else { cards = S.cols[m.col].cards.splice(m.idx); flipped = flipCol(S.cols[m.col]); }
    if (m.to === 'f') S.found[si(cards[0])].push(cards[0]);
    else S.cols[m.dest].cards.push.apply(S.cols[m.dest].cards, cards);
    S.moves++;
    if (flipped) lockUndo();
    hint = null;
    after();
  }

  // Best destination for a card / run: foundation (single card) first, then a non-empty column, then an empty one.
  function bestMove(from, col, idx) {
    var card = from === 'w' ? topOf(S.waste) : S.cols[col].cards[idx];
    var single = from === 'w' || idx === S.cols[col].cards.length - 1;
    if (single && canFound(card)) return { from: from, col: col, idx: idx, to: 'f' };
    var empty = -1;
    for (var j = 0; j < 7; j++) {
      if (from === 'c' && j === col) continue;
      if (!canStack(S.cols[j], card)) continue;
      if (S.cols[j].cards.length) return { from: from, col: col, idx: idx, to: 'c', dest: j };
      // A King run that already sits at the bottom of a column gains nothing from an empty column.
      if (empty < 0 && !(from === 'c' && idx === 0)) empty = j;
    }
    return empty >= 0 ? { from: from, col: col, idx: idx, to: 'c', dest: empty } : null;
  }
  function legalTo(move, target) {
    var card = move.from === 'w' ? topOf(S.waste) : move.from === 'f' ? topOf(S.found[move.col]) : S.cols[move.col].cards[move.idx];
    if (target.to === 'f') {
      var single = move.from !== 'c' || move.idx === S.cols[move.col].cards.length - 1;
      return single && move.from !== 'f' && canFound(card);
    }
    if (move.from === 'c' && target.dest === move.col) return false;
    return canStack(S.cols[target.dest], card);
  }

  function draw() {
    if (S.over || finishing) return;
    hint = null;
    if (S.stock.length) {
      for (var n = 0; n < S.draw && S.stock.length; n++) S.waste.push(S.stock.pop());
      message = '';
    } else if (S.waste.length) {
      S.stock = S.waste.reverse(); S.waste = []; S.passes++;
      message = 'Waste turned over.';
    } else return;
    S.moves++;
    lockUndo();
    after();
  }

  function allOpen() { return !S.stock.length && !S.waste.length && S.cols.every(function (c) { return c.down <= 0 || !c.cards.length; }); }

  function after() {
    if (foundCount() === 52) return finish(true);
    $('btn-finish').hidden = !allOpen() || S.over;
    render();
  }

  // Plays every remaining card to the foundations, one step at a time.
  function autoFinish() {
    if (S.over || !allOpen()) return;
    finishing = true; $('btn-finish').hidden = true;
    (function step() {
      for (var j = 0; j < 7; j++) {
        var t = topOf(S.cols[j].cards);
        if (t && canFound(t)) { S.found[si(t)].push(S.cols[j].cards.pop()); S.moves++; render(); return setTimeout(step, 70); }
      }
      finishing = false;
      if (foundCount() === 52) finish(true); else render();
    })();
  }

  function findHint() {
    var w = topOf(S.waste);
    for (var j = 0; j < 7; j++) {
      var col = S.cols[j];
      for (var i = Math.max(col.down, 0); i < col.cards.length; i++) {
        var m = bestMove('c', j, i);
        // Skip pointless shuffles: moving a run that does not uncover anything onto another column.
        if (m && (m.to === 'f' || i === Math.max(col.down, 0) && (col.down > 0 || S.cols[m.dest].cards.length))) return { col: j, idx: i };
      }
    }
    if (w && bestMove('w')) return { waste: true };
    return null;
  }

  function finish(won) {
    S.over = true; S.won = won; finishing = false;
    var st = T.stats(STATS_KEY);
    st.played++;
    if (won) { st.wins++; st.streak = (st.streak || 0) + 1; st['wins' + S.draw] = (st['wins' + S.draw] || 0) + 1; if (!st.fewest || S.moves < st.fewest) st.fewest = S.moves; }
    else st.streak = 0;
    T.store(STATS_KEY, st);
    S.points = won ? (S.draw === 3 ? 90 : 60) : Math.min(40, foundCount());
    S.unlocked = App.award('klondike', S.points);
    lockUndo();
    $('btn-finish').hidden = true;
    render();
  }

  /* ---------- layout ---------- */
  function layout() {
    var felt = $('felt'), rm = T.room(felt, 320);
    var g = rm.w >= 600 ? 10 : 4, rowGap = rm.w >= 600 ? 16 : 10;
    var W = Math.min(130, Math.floor((rm.w - 6 * g) / 7));
    // Height check for a typical deep column (6 face down + 7 face up); columns that grow beyond are squeezed.
    function need(W) { var H = T.height(W); return H + rowGap + H + 6 * Math.round(H * 0.08) + 7 * T.peek(W) + 14; }
    while (W > 34 && need(W) > rm.h) W--;
    var H = T.height(W);
    return { W: W, H: H, g: g, rowGap: rowGap, w: 7 * W + 6 * g, colTop: H + rowGap, maxH: Math.max(rm.h, need(W)), downStep: Math.max(4, Math.round(H * 0.08)), upStep: T.peek(W) };
  }
  function colX(j) { return j * (L.W + L.g); }
  // Offsets inside one column, squeezed if it would run past the bottom.
  function offsets(col) {
    var n = col.cards.length, down = Math.max(0, col.down), ds = L.downStep, us = L.upStep;
    var avail = L.maxH - L.colTop - L.H;
    var needH = Math.min(down, n) * ds + Math.max(0, n - down - 1) * us;
    if (needH > avail && n > 1) {
      var k = avail / needH; ds = Math.max(3, Math.floor(ds * k)); us = Math.max(Math.round(T.peek(L.W) * 0.55), Math.floor(us * k));
    }
    var out = [], y = 0;
    for (var i = 0; i < n; i++) { out.push(y); y += i < down ? ds : us; }
    return out;
  }

  function cardBtn(ref, c, x, y, z, faceUp, extraCls) {
    return '<button type="button" class="hit' + (extraCls || '') + '" data-ref="' + ref + '" style="left:' + x + 'px;top:' + y + 'px;width:' + L.W + 'px;height:' + L.H + 'px;z-index:' + z + '"' +
      (faceUp ? ' aria-label="' + c.rank + ' of ' + c.suit + '"' : ' disabled tabindex="-1" aria-label="Face-down card"') + '>' + (faceUp ? T.card(c, L.W) : T.back(L.W)) + '</button>';
  }

  function render() {
    if (!S) return;
    L = layout();
    var felt = $('felt'), html = '';
    // Stock
    var sx = colX(0);
    html += S.stock.length
      ? '<button type="button" class="hit" data-ref="stock" style="left:' + sx + 'px;top:0;width:' + L.W + 'px;height:' + L.H + 'px" aria-label="Stock, ' + S.stock.length + ' cards">' + T.back(L.W) + '</button>'
      : '<button type="button" class="hit slot" data-ref="stock" style="left:' + sx + 'px;top:0;width:' + L.W + 'px;height:' + L.H + 'px"' + (S.waste.length ? '' : ' disabled') + ' aria-label="Turn the waste over">' + (S.waste.length ? '↻' : '') + '</button>';
    // Waste: show up to three fanned (draw 3), top one playable
    var wx = colX(1), show = S.waste.slice(S.draw === 3 ? -3 : -1), fan = Math.round(Math.min(T.fan(L.W), (L.W + L.g) * 0.45));
    if (!show.length) html += '<div class="slot" style="left:' + wx + 'px;top:0;width:' + L.W + 'px;height:' + L.H + 'px"></div>';
    show.forEach(function (c, i) {
      var top = i === show.length - 1;
      html += top ? cardBtn('w', c, wx + i * fan, 0, 2 + i, true, hint && hint.waste ? ' hint' : '')
        : '<div style="position:absolute;left:' + (wx + i * fan) + 'px;top:0;z-index:' + (2 + i) + '">' + T.card(c, L.W) + '</div>';
    });
    // Foundations
    for (var f = 0; f < 4; f++) {
      var fx = colX(3 + f), ft = topOf(S.found[f]);
      html += ft ? cardBtn('f' + f, ft, fx, 0, 1, true, '')
        : '<div class="slot" data-drop="f" style="left:' + fx + 'px;top:0;width:' + L.W + 'px;height:' + L.H + 'px;font-size:' + Math.round(L.W * 0.3) + 'px">' + ['♠', '♥', '♦', '♣'][f] + '</div>';
    }
    // Columns
    var bottom = L.colTop + L.H;
    S.cols.forEach(function (col, j) {
      var x = colX(j), offs = offsets(col);
      if (!col.cards.length) html += '<div class="slot" data-drop="c' + j + '" style="left:' + x + 'px;top:' + L.colTop + 'px;width:' + L.W + 'px;height:' + L.H + 'px;font-size:' + Math.round(L.W * 0.26) + 'px">K</div>';
      col.cards.forEach(function (c, i) {
        var up = i >= col.down, isHint = hint && hint.col === j && i >= hint.idx;
        html += cardBtn('c' + j + ':' + i, c, x, L.colTop + offs[i], 1 + i, up, isHint ? ' hint' : '');
      });
      if (col.cards.length) bottom = Math.max(bottom, L.colTop + offs[offs.length - 1] + L.H);
    });
    felt.style.width = L.w + 'px';
    felt.style.height = bottom + 'px';
    felt.innerHTML = html;

    var st = T.stats(STATS_KEY);
    $('hud').innerHTML = '<span>Foundations <b>' + foundCount() + '/52</b></span><span>Stock <b>' + S.stock.length + '</b></span><span>Moves <b>' + S.moves + '</b></span>' +
      '<span>Draw <b>' + S.draw + '</b>' + (S.winnable ? ' · winnable' : '') + '</span><span>Wins <b>' + st.wins + '/' + st.played + '</b></span>' + (st.streak ? '<span>Streak <b>' + st.streak + '</b></span>' : '');
    $('msg').innerHTML = message;
    $('btn-undo').disabled = !history.length || S.over || finishing;
    $('btn-finish').hidden = S.over || finishing || !allOpen();
    if (S.over) T.result({
      title: S.won ? 'Solved' : 'Game over',
      text: S.won ? 'All 52 cards home in ' + S.moves + ' moves (draw ' + S.draw + ').' : foundCount() + ' of 52 cards reached the foundations.',
      points: S.points, unlocked: S.unlocked
    });
    else T.result(null);
    T.store(GAME_KEY, { S: S });
  }

  /* ---------- input: tap to auto-move, drag to place ---------- */
  function parseRef(ref) {
    if (ref === 'w') return { from: 'w' };
    if (ref[0] === 'f') return { from: 'f', col: +ref.slice(1) };
    if (ref[0] === 'c') { var p = ref.slice(1).split(':'); return { from: 'c', col: +p[0], idx: +p[1] }; }
    return null;
  }
  function tapCard(ref) {
    if (S.over || finishing) return;
    var r = parseRef(ref); if (!r || r.from === 'f') return;
    var m = r.from === 'w' ? bestMove('w') : bestMove('c', r.col, r.idx);
    if (m) { message = ''; apply(m); return; }
    message = 'That card has nowhere to go yet.';
    var el = document.querySelector('.hit[data-ref="' + ref + '"]');
    render();
    el = document.querySelector('.hit[data-ref="' + ref + '"]'); if (el) { el.classList.add('bump'); }
  }

  var drag = null;
  var felt = $('felt');
  felt.addEventListener('pointerdown', function (e) {
    var b = e.target.closest('.hit');
    if (!b || b.disabled || S.over || finishing) return;
    var ref = b.getAttribute('data-ref');
    if (ref === 'stock') return;
    var r = parseRef(ref); if (!r) return;
    var els = [b];
    if (r.from === 'c') for (var i = r.idx + 1; i < S.cols[r.col].cards.length; i++) els.push(document.querySelector('.hit[data-ref="c' + r.col + ':' + i + '"]'));
    drag = { ref: ref, r: r, x0: e.clientX, y0: e.clientY, els: els, moved: false, id: e.pointerId };
  });
  window.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 8) return;
    if (!drag.moved) { drag.moved = true; drag.els.forEach(function (el) { el.style.transition = 'none'; el.style.zIndex = 500 + (+el.style.zIndex || 0); el.style.pointerEvents = 'none'; }); }
    drag.els.forEach(function (el) { el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; });
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('pointerup', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    if (!d.moved) return tapCard(d.ref);
    var target = dropTarget(e.clientX, e.clientY);
    var move = d.r.from === 'w' ? { from: 'w' } : d.r.from === 'f' ? { from: 'f', col: d.r.col } : { from: 'c', col: d.r.col, idx: d.r.idx };
    if (target && legalTo(move, target)) { move.to = target.to; move.dest = target.dest; message = ''; apply(move); }
    else render();
  });
  window.addEventListener('pointercancel', function () { if (drag) { drag = null; render(); } });
  // Which pile is under the pointer: columns by x across the whole column height, foundations in the top row.
  function dropTarget(x, y) {
    var r = felt.getBoundingClientRect(), fx = x - r.left, fy = y - r.top;
    var j = Math.floor((fx + L.g / 2) / (L.W + L.g));
    if (j < 0 || j > 6) return null;
    if (fy < L.colTop - L.rowGap / 2) return j >= 3 ? { to: 'f' } : null;
    return { to: 'c', dest: j };
  }
  felt.addEventListener('click', function (e) {
    var b = e.target.closest('.hit');
    if (b && b.getAttribute('data-ref') === 'stock' && !b.disabled) draw();
  });
  felt.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var b = e.target.closest('.hit'); if (!b || b.disabled) return;
    e.preventDefault();
    var ref = b.getAttribute('data-ref');
    if (ref === 'stock') draw(); else tapCard(ref);
  });

  /* ---------- controls ---------- */
  $('btn-undo').addEventListener('click', function () {
    if (!history.length || S.over || finishing) return;
    S = JSON.parse(history.pop()); hint = null; message = 'Move undone.'; render();
  });
  var confirmNew = 0;
  $('btn-new').addEventListener('click', function () {
    if (!S.over && S.moves > 0 && Date.now() - confirmNew > 2500) { confirmNew = Date.now(); message = '<strong>Tap New deal again</strong> to give up this game (it counts as a loss).'; return render(); }
    if (!S.over && S.moves > 0) { var st = T.stats(STATS_KEY); st.played++; st.streak = 0; T.store(STATS_KEY, st); App.award('klondike', Math.min(40, foundCount())); }
    deal();
  });
  $('btn-again').addEventListener('click', deal);
  $('btn-finish').addEventListener('click', autoFinish);
  $('btn-hint').addEventListener('click', function () {
    if (S.over) return;
    hint = findHint();
    message = hint ? 'Try the highlighted card.' : (S.stock.length || S.waste.length ? 'Nothing obvious: turn the stock.' : 'No moves left. End the game from More.');
    render();
  });
  var confirmEnd = 0;
  $('btn-end').addEventListener('click', function () {
    if (S.over) return;
    if (Date.now() - confirmEnd > 2500) { confirmEnd = Date.now(); message = '<strong>Tap End game again</strong> to score this game as it stands.'; return render(); }
    finish(false);
  });
  var drawSel = $('draw');
  drawSel.value = String(prefs.draw);
  drawSel.addEventListener('change', function () {
    prefs.draw = +drawSel.value; T.store(PREFS_KEY, prefs);
    message = 'Draw ' + prefs.draw + ' starts with the next deal.'; render();
  });
  var wb = $('btn-winnable');
  function syncWinnable() { wb.setAttribute('aria-pressed', String(prefs.winnable)); wb.textContent = 'Winnable deals ' + (prefs.winnable ? 'on' : 'off'); wb.classList.toggle('on', prefs.winnable); }
  wb.addEventListener('click', function () { prefs.winnable = !prefs.winnable; T.store(PREFS_KEY, prefs); syncWinnable(); message = 'Winnable deals ' + (prefs.winnable ? 'on' : 'off') + ' from the next deal.'; render(); });
  syncWinnable();

  T.init({ render: render });
  var saved = T.load(GAME_KEY);
  if (saved && saved.S && saved.S.cols && !saved.S.over) { S = saved.S; message = 'Welcome back. Your game is where you left it.'; render(); }
  else deal();
})();
