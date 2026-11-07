/* Pyramid solitaire. 28 cards in a seven-row pyramid, 24 in the stock.
 * Remove pairs adding to 13 (Kings alone) from uncovered cards and the waste top. Clear the pyramid to win. */
(function () {
  'use strict';
  var T = window.Table, App = window.App, $ = T.$;
  var GAME_KEY = 'pyramid:game:v1', PREFS_KEY = 'pyramid:prefs:v1', STATS_KEY = 'pyramid:stats:v1';

  var prefs = T.load(PREFS_KEY) || { passes: 3 };
  var S = null, history = [], sel = null, hint = null, message = '';

  function idx(r, c) { return r * (r + 1) / 2 + c; }
  function rowOf(i) { var r = 0; while (idx(r + 1, 0) <= i) r++; return r; }
  function exposed(i) {
    if (!S.pyr[i]) return false;
    var r = rowOf(i), c = i - idx(r, 0);
    return r === 6 || (!S.pyr[idx(r + 1, c)] && !S.pyr[idx(r + 1, c + 1)]);
  }
  function wasteTop() { return S.waste.length ? S.waste[S.waste.length - 1] : null; }
  function left() { return S.pyr.filter(Boolean).length; }

  function deal(seed) {
    seed = seed == null ? (Math.random() * 4294967296) >>> 0 : seed;
    var cards = T.shuffled(T.pack(), T.rng(seed));
    S = { seed: seed, pyr: cards.slice(0, 28), stock: cards.slice(28).reverse(), waste: [], pass: 1, passes: prefs.passes, over: false, won: false, moves: 0 };
    history = []; sel = null; hint = null;
    message = 'New deal. Pair cards that add up to 13; tap a King to clear it.';
    T.result(null);
    render();
  }

  function snapshot() { history.push(JSON.stringify(S)); if (history.length > 400) history.shift(); }
  function lockUndo() { history = []; }

  // A "ref" names a free card: {where: 'pyr', i} or {where: 'waste'}.
  function cardAt(ref) { return ref.where === 'pyr' ? S.pyr[ref.i] : wasteTop(); }
  function removeRef(ref) { if (ref.where === 'pyr') S.pyr[ref.i] = null; else S.waste.pop(); }
  function same(a, b) { return a && b && a.where === b.where && a.i === b.i; }

  function freeRefs() {
    var out = [];
    for (var i = 0; i < 28; i++) if (exposed(i)) out.push({ where: 'pyr', i: i });
    if (wasteTop()) out.push({ where: 'waste' });
    return out;
  }
  function findPair() {
    var free = freeRefs();
    for (var a = 0; a < free.length; a++) {
      var ca = cardAt(free[a]);
      if (ca.v === 13) return [free[a]];
      for (var b = a + 1; b < free.length; b++) if (ca.v + cardAt(free[b]).v === 13) return [free[a], free[b]];
    }
    return null;
  }

  function tap(ref) {
    if (S.over) return;
    hint = null;
    var c = cardAt(ref);
    if (!c) return;
    if (c.v === 13) {
      snapshot(); removeRef(ref); S.moves++; sel = null;
      message = 'King cleared.';
      return after();
    }
    if (sel && same(sel, ref)) { sel = null; message = ''; return render(); }
    if (sel) {
      var s = cardAt(sel);
      if (s && s.v + c.v === 13) {
        snapshot();
        // Remove the lower pyramid card first so indices stay valid (both refs are independent anyway).
        removeRef(sel); removeRef(ref); S.moves++; sel = null;
        message = 'Pair cleared: ' + s.rank + ' + ' + c.rank + '.';
        return after();
      }
      message = s.rank + ' and ' + c.rank + ' make ' + (s.v + c.v) + ', not 13.';
    } else {
      message = c.rank + ' needs a ' + nameFor(13 - c.v) + '.';
    }
    sel = ref;
    render();
  }
  function nameFor(v) { return v === 1 ? 'Ace' : v === 11 ? 'Jack' : v === 12 ? 'Queen' : String(v); }

  function draw() {
    if (S.over) return;
    hint = null; sel = null;
    if (S.stock.length) {
      S.waste.push(S.stock.pop()); S.moves++;
      lockUndo();
      message = S.stock.length ? '' : (S.pass < S.passes ? 'Stock empty. Tap it to turn the waste over.' : 'Stock empty: this is your last pass.');
    } else if (S.pass < S.passes && S.waste.length) {
      S.stock = S.waste.reverse(); S.waste = []; S.pass++;
      lockUndo();
      message = 'Pass ' + S.pass + ' of ' + S.passes + '.';
    } else return render();
    after();
  }

  function stuck() { return !S.stock.length && (S.pass >= S.passes || !S.waste.length) && !findPair(); }

  function after() {
    if (!left()) return finish(true);
    if (stuck()) { message = 'No moves left.'; return finish(false); }
    render();
  }

  function finish(won) {
    S.over = true; S.won = won;
    var st = T.stats(STATS_KEY);
    st.played++; if (won) { st.wins++; st.streak = (st.streak || 0) + 1; } else st.streak = 0;
    var cleared = 28 - left();
    if (st.best == null || cleared > st.best) st.best = cleared;
    T.store(STATS_KEY, st);
    S.points = won ? 75 + 10 * (S.passes - S.pass) : cleared * 2;
    S.unlocked = App.award('pyramid', S.points);
    lockUndo();
    render();
  }

  /* ---------- layout ---------- */
  function layout() {
    var felt = $('felt'), rm = T.room(felt, 300);
    var gx = rm.w >= 600 ? 8 : 4, gap = rm.w >= 600 ? 18 : 12, labelH = 18;
    function fit(side) {
      for (var W = 120; W >= 30; W--) {
        var H = T.height(W), vy = Math.round(H * 0.5);
        var pyrW = 7 * W + 6 * gx, pyrH = H + 6 * vy;
        var talonW = 2 * W + gx + 16;
        var w = side ? pyrW + gap + talonW : Math.max(pyrW, talonW);
        var h = side ? Math.max(pyrH, H + labelH) : pyrH + gap + H + labelH;
        if (w <= rm.w && h <= rm.h) return { W: W, H: H, vy: vy, gx: gx, gap: gap, side: side, pyrW: pyrW, pyrH: pyrH, w: w, h: h };
      }
      return null;
    }
    var a = fit(false), b = rm.w >= 700 ? fit(true) : null;
    var L = (b && (!a || b.W > a.W)) ? b : a;
    if (!L) { var H30 = T.height(30); L = { W: 30, H: H30, vy: 15, gx: 4, gap: 10, side: false, pyrW: 234, pyrH: H30 + 90, w: 234, h: H30 * 2 + 120 }; }
    return L;
  }

  function hitHtml(ref, c, x, y, L, enabled, extra) {
    var isSel = sel && same(sel, ref), isHint = hint && hint.some(function (h) { return same(h, ref); });
    var key = ref.where === 'pyr' ? 'p' + ref.i : 'w';
    return '<button type="button" class="hit' + (isSel ? ' sel' : '') + (isHint ? ' hint' : '') + '" data-ref="' + key + '"' + (enabled ? '' : ' disabled tabindex="-1"') +
      ' style="left:' + x + 'px;top:' + y + 'px;width:' + L.W + 'px;height:' + L.H + 'px;z-index:' + (extra || 1) + '" aria-label="' + c.rank + ' of ' + c.suit + '">' + T.card(c, L.W) + '</button>';
  }

  function render() {
    if (!S) return;
    var L = layout(), felt = $('felt'), html = '';
    felt.style.width = L.w + 'px'; felt.style.height = L.h + 'px';
    var ox = L.side ? 0 : Math.round((L.w - L.pyrW) / 2);
    for (var r = 0; r < 7; r++) {
      var rowX = ox + Math.round((6 - r) * (L.W + L.gx) / 2);
      for (var c = 0; c <= r; c++) {
        var i = idx(r, c), card = S.pyr[i];
        if (!card) continue;
        html += hitHtml({ where: 'pyr', i: i }, card, rowX + c * (L.W + L.gx), r * L.vy, L, exposed(i) && !S.over, r + 1);
      }
    }
    // Stock and waste
    var tx = L.side ? L.pyrW + L.gap : Math.round((L.w - (2 * L.W + L.gx)) / 2);
    var ty = L.side ? 0 : L.pyrH + L.gap;
    var canTurn = !S.stock.length && S.pass < S.passes && S.waste.length;
    html += S.stock.length
      ? '<button type="button" class="hit" data-ref="stock" style="left:' + tx + 'px;top:' + ty + 'px;width:' + L.W + 'px;height:' + L.H + 'px" aria-label="Stock, ' + S.stock.length + ' cards">' + T.back(L.W) + '</button>'
      : '<button type="button" class="hit slot" data-ref="stock" style="left:' + tx + 'px;top:' + ty + 'px;width:' + L.W + 'px;height:' + L.H + 'px"' + (canTurn ? '' : ' disabled') + ' aria-label="Turn the waste over">' + (canTurn ? '↻' : '') + '</button>';
    var wx = tx + L.W + L.gx;
    if (S.waste.length > 1) html += '<div style="position:absolute;left:' + wx + 'px;top:' + ty + 'px;opacity:0.55">' + T.card(S.waste[S.waste.length - 2], L.W) + '</div>';
    if (wasteTop()) html += hitHtml({ where: 'waste' }, wasteTop(), wx, ty, L, !S.over, 2);
    else html += '<div class="slot" style="left:' + wx + 'px;top:' + ty + 'px;width:' + L.W + 'px;height:' + L.H + 'px"></div>';
    html += '<div class="label" style="left:' + tx + 'px;top:' + (ty + L.H + 4) + 'px">Stock ' + S.stock.length + ' · pass ' + S.pass + '/' + S.passes + '</div>';
    felt.innerHTML = html;

    var st = T.stats(STATS_KEY);
    $('hud').innerHTML = '<span>Pyramid <b>' + left() + '</b> left</span><span>Stock <b>' + S.stock.length + '</b></span><span>Pass <b>' + S.pass + '/' + S.passes + '</b></span>' +
      '<span>Wins <b>' + st.wins + '/' + st.played + '</b></span>' + (st.streak ? '<span>Streak <b>' + st.streak + '</b></span>' : '');
    $('msg').innerHTML = message;
    $('btn-undo').disabled = !history.length || S.over;
    if (S.over) T.result({
      title: S.won ? 'Pyramid cleared' : 'Out of moves',
      text: S.won ? 'Cleared in ' + S.moves + ' moves on pass ' + S.pass + '.' : (28 - left()) + ' of 28 pyramid cards cleared.',
      points: S.points, unlocked: S.unlocked
    });
    else T.result(null);
    T.store(GAME_KEY, { S: S });
  }

  /* ---------- events ---------- */
  $('felt').addEventListener('click', function (e) {
    var b = e.target.closest('.hit');
    if (!b || b.disabled) return;
    var r = b.getAttribute('data-ref');
    if (r === 'stock') draw();
    else if (r === 'w') tap({ where: 'waste' });
    else tap({ where: 'pyr', i: parseInt(r.slice(1), 10) });
  });
  $('btn-undo').addEventListener('click', function () {
    if (!history.length || S.over) return;
    S = JSON.parse(history.pop()); sel = null; hint = null; message = 'Move undone.'; render();
  });
  var confirmNew = 0;
  $('btn-new').addEventListener('click', function () {
    if (!S.over && S.moves > 0 && Date.now() - confirmNew > 2500) { confirmNew = Date.now(); message = '<strong>Tap New deal again</strong> to abandon this game (it counts as played).'; return render(); }
    if (!S.over && S.moves > 0) finishQuiet();
    deal();
  });
  function finishQuiet() { var st = T.stats(STATS_KEY); st.played++; st.streak = 0; T.store(STATS_KEY, st); }
  $('btn-again').addEventListener('click', function () { deal(); });
  $('btn-hint').addEventListener('click', function () {
    if (S.over) return;
    hint = findPair();
    message = hint ? (hint.length === 1 ? 'A King is free.' : 'There is a pair you can clear.') : (S.stock.length ? 'No pairs: turn a card from the stock.' : 'No pairs on the table.');
    render();
  });
  var confirmEnd = 0;
  $('btn-end').addEventListener('click', function () {
    if (S.over) return;
    if (Date.now() - confirmEnd > 2500) { confirmEnd = Date.now(); message = '<strong>Tap End game again</strong> to score this deal as it stands.'; return render(); }
    finish(false);
  });
  var passSel = $('passes');
  passSel.value = String(prefs.passes);
  passSel.addEventListener('change', function () {
    prefs.passes = parseInt(passSel.value, 10); T.store(PREFS_KEY, prefs);
    message = 'Passes set to ' + prefs.passes + '. It applies from the next deal.';
    render();
  });

  T.init({ render: render });
  var saved = T.load(GAME_KEY);
  if (saved && saved.S && saved.S.pyr && !saved.S.over) { S = saved.S; message = 'Welcome back. Your deal is where you left it.'; render(); }
  else deal();
})();
