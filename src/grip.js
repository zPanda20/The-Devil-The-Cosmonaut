(function () {
  'use strict';
  var CE = window.CardEngine;
  var App = window.App;
  var deckId = App.getDeck();   // equipped deck, shared with the home screen and Cosmonaut Sudoku
  var CHAINS = [[2, 5, 8, 11], [3, 6, 9, 12], [4, 7, 10, 13]];
  var CHAIN_TEXT = ['2 · 5 · 8 · J', '3 · 6 · 9 · Q', '4 · 7 · 10 · K'];
  var SAVE_KEY = 'devils-grip:game:v1';
  var STATS_KEY = 'devils-grip:stats:v1';
  var PREFS_KEY = 'devils-grip:prefs:v1';
  var prefs = { hints: false, autoFill: true };

  var S = null;          // game state
  var history = [];      // undo stack of past states
  var sel = null;        // { type: 'grid', i } | { type: 'waste' }
  var message = '';
  var endArmed = false, endTimer = null;
  var lastW = 0;

  function $(id) { return document.getElementById(id); }

  /* ---------- storage (best effort) ---------- */
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  function load(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function stats() { return load(STATS_KEY) || { played: 0, wins: 0, best: null }; }

  /* ---------- theme from the equipped deck ---------- */
  function applyTheme() {
    App.applyTheme(deckId);
    $('sub').textContent = CE.getStyle(deckId).name + ' deck · two packs, aces out · 96 cards';
    var picker = $('deck');
    if (picker && picker.value !== deckId) picker.value = deckId;
  }

  function buildDeckPicker() {
    var picker = $('deck');
    App.fillDeckSelect(picker, deckId);
    picker.addEventListener('change', function () {
      if (!App.setDeck(picker.value)) { picker.value = deckId; return; }
      deckId = picker.value;
      applyTheme();
      message = 'Switched to the ' + CE.getStyle(deckId).name + ' deck.';
      render();
      App.ensureArt(deckId, render);
    });
  }

  /* ---------- rules helpers ---------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function top(p) { return p[p.length - 1]; }
  function rowOf(i) { return Math.floor(i / 8); }
  function fits(card, pile) {
    if (!card || !pile.length) return false;
    var t = top(pile);
    return t.suit === card.suit && card.value === t.value + 3;
  }
  function name(c) { return CE.cardName(c); }
  function rankWord(v) { return { 11: 'Jack', 12: 'Queen', 13: 'King' }[v] || String(v); }
  function suitWord(s) { return CE.SUITS[s].name; }

  // Which row a card's chain lives in: 2-5-8-J top, 3-6-9-Q middle, 4-7-10-K bottom.
  function chainRow(card) { return (card.value - 2) % 3; }
  function rowOk(card, i) { return chainRow(card) === rowOf(i); }
  var ROW_NAME = ['top row', 'middle row', 'bottom row'];
  function homeOf(card) { return ROW_NAME[chainRow(card)] + ' (' + CHAIN_TEXT[chainRow(card)] + ')'; }
  // Can card sit directly under pile p (same suit, three lower than its bottom card)?
  function fitsUnder(card, pile) {
    if (!card || !pile.length) return false;
    return pile[0].suit === card.suit && pile[0].value === card.value + 3;
  }

  function pileState(i) {
    var p = S.grid[i];
    if (!p.length) return 'empty';
    if (!rowOk(p[0], i)) return 'away';
    if (p[0].value === CHAINS[rowOf(i)][0]) return p.length === 4 ? 'done' : 'based';
    return 'home';
  }
  function countDone(row) {
    var n = 0;
    for (var i = 0; i < 24; i++) if ((row === undefined || rowOf(i) === row) && pileState(i) === 'done') n++;
    return n;
  }
  function cardsOnGrid() { var n = 0; S.grid.forEach(function (p) { n += p.length; }); return n; }
  function cardsLeft() { return S.stock.length + S.waste.length; }

  function fillEmpties() {
    var filled = 0;
    for (var i = 0; i < 24; i++) {
      if (S.grid[i].length) continue;
      if (S.stock.length) { S.grid[i].push(S.stock.pop()); filled++; }
    }
    return filled;
  }

  function finish() {
    if (S.recorded) return;
    S.recorded = true;
    var st = stats();
    st.played++;
    if (S.won) st.wins++;
    var left = cardsLeft();
    if (st.best === null || left < st.best) st.best = left;
    store(STATS_KEY, st);
    // Points: a perfect grip pays 150; otherwise fewer cards left pays more.
    S.points = left === 0 ? 150 : Math.max(5, 50 - 2 * left);
    S.unlocked = App.award('grip', S.points);
    if (S.unlocked.length) App.fillDeckSelect($('deck'), deckId);
  }

  function checkWin() {
    for (var i = 0; i < 24; i++) if (pileState(i) !== 'done') return false;
    S.won = true; S.over = true; finish();
    return true;
  }

  function tier(left) {
    if (left === 0) return 'Perfect grip';
    if (left <= 2) return 'Brilliant';
    if (left <= 5) return 'Excellent';
    if (left <= 10) return 'Good';
    return 'Keep practising';
  }

  /* ---------- actions ---------- */
  function newGame() {
    var deck = CE.shuffle(CE.makeDeck({ decks: 2, aces: false }));
    S = { grid: [], stock: [], waste: [], redeals: 0, moves: 0, over: false, won: false, recorded: false };
    for (var i = 0; i < 24; i++) S.grid.push([deck.pop()]);
    S.stock = deck;
    history = []; sel = null; disarmEnd();
    message = 'New deal. Tap a card, then tap the pile it builds on, or any other pile to swap them.';
    render();
  }

  function remember() { history.push(clone(S)); if (history.length > 300) history.shift(); }
  // Once a card is turned up from the stock it stays seen: undo cannot go back past a deal or a fill.
  function lockUndo() { history = []; }

  function emptyCount() { var n = 0; S.grid.forEach(function (p) { if (!p.length) n++; }); return n; }
  // Spaces only ever fill from the stock. With an empty stock, the waste must be turned over first.
  function supplyLeft() { return S.stock.length > 0; }

  // Fill empty spaces if auto-fill is on; otherwise remind the player they can fill by tapping.
  function settleEmpties() {
    if (prefs.autoFill) {
      var f = fillEmpties();
      if (f) lockUndo();
      return f ? ' ' + (f === 1 ? 'The empty space was filled from the stock.' : f + ' empty spaces were filled from the stock.') : '';
    }
    if (!emptyCount()) return '';
    if (supplyLeft()) return ' Tap an empty space when you want to fill it.';
    return S.waste.length ? ' The stock is empty. Turn the waste over to fill the open spaces.' : '';
  }

  function after(text) {
    text += settleEmpties();
    message = text;
    checkWin();
    render();
  }

  function tapPile(i) {
    if (!S || S.over) return;
    disarmEnd();
    var p = S.grid[i];
    if (!sel) {
      if (!p.length) {
        if (!prefs.autoFill && supplyLeft()) {
          lockUndo();
          var card = S.stock.pop();
          p.push(card); S.moves++;
          message = 'Filled the space with the ' + name(card) + ' from the stock.';
          checkWin();
        } else if (!S.stock.length && S.waste.length) {
          message = 'The stock is empty. Turn the waste over first, then the space can be filled.';
        } else {
          message = 'That space is empty. Pick a card first.';
        }
        render(); return;
      }
      sel = { type: 'grid', i: i };
      message = '<strong>' + name(top(p)) + '</strong> selected. Tap a pile to build or swap. Tap it again to cancel.';
      render(); return;
    }
    if (sel.type === 'grid' && sel.i === i) { sel = null; message = 'Selection cleared.'; render(); return; }

    if (sel.type === 'waste') {
      var c = top(S.waste);
      if (fits(c, p) && rowOk(c, i)) {
        remember(); p.push(S.waste.pop()); S.moves++; sel = null;
        after('Played the ' + name(c) + '.');
      } else if (fitsUnder(c, p) && rowOk(c, i)) {
        remember(); p.unshift(S.waste.pop()); S.moves++; sel = null;
        after('Slid the ' + name(c) + ' under the ' + name(p[1]) + '.');
      } else {
        shake(i);
        if ((fits(c, p) || fitsUnder(c, p)) && !rowOk(c, i)) {
          message = 'The ' + name(c) + ' can only build in the ' + homeOf(c) + '. Swap this pile into that row first.';
        } else if (c.value <= 4) {
          message = 'The ' + name(c) + ' starts a pile. Slide it under its ' + rankWord(c.value + 3) + ' in the ' + ROW_NAME[chainRow(c)] + ', or wait for a space to open.';
        } else {
          message = 'The ' + name(c) + ' builds on the ' + rankWord(c.value - 3) + ' of ' + suitWord(c.suit) + ' in the ' + ROW_NAME[chainRow(c)] + '.';
        }
        render();
      }
      return;
    }

    var from = sel.i, a = S.grid[from], b = p;
    var canBuild = (b.length && fits(top(a), b) && rowOk(top(a), i)) ||
      (b.length && a.length > 1 && fits(a[0], b) && rowOk(a[0], i)) ||
      (b.length && fitsUnder(top(a), b) && rowOk(top(a), i));
    // A built stack (two or more cards) may only ever sit in its own row.
    if (!canBuild) {
      var aBad = a.length > 1 && !rowOk(a[0], i);
      var bBad = b.length > 1 && !rowOk(b[0], from);
      if (aBad || bBad) {
        var stuck = aBad ? a : b;
        shake(i);
        message = 'Stacks stay in their own row. The ' + name(stuck[0]) + ' stack belongs in the ' + homeOf(stuck[0]) + '.';
        sel = null;
        render(); return;
      }
    }
    remember();
    var text, note = '';
    if (b.length && fits(top(a), b) && rowOk(top(a), i)) {
      // Build one card on top
      b.push(a.pop());
      text = 'Built the ' + name(top(b)) + '.';
    } else if (b.length && a.length > 1 && fits(a[0], b) && rowOk(a[0], i)) {
      // Whole pile on top
      S.grid[i] = b.concat(a); S.grid[from] = [];
      text = 'Moved the whole ' + name(a[0]) + ' pile on top.';
    } else if (b.length && fitsUnder(top(a), b) && rowOk(top(a), i)) {
      // Slide the selected pile (or card) underneath, staying in this spot
      S.grid[i] = a.concat(b); S.grid[from] = [];
      text = a.length > 1
        ? 'Slid the ' + name(a[0]) + ' pile under the ' + name(b[0]) + '.'
        : 'Slid the ' + name(a[0]) + ' under the ' + name(b[0]) + '.';
    } else {
      if (b.length && (fits(top(a), b) || fitsUnder(top(a), b) || (a.length > 1 && fits(a[0], b)))) {
        note = ' Piles only build in their own row, so they swapped instead.';
      }
      S.grid[from] = b; S.grid[i] = a;
      text = (b.length ? 'Swapped the two piles.' : 'Moved the pile into the empty space.') + note;
    }
    S.moves++; sel = null;
    after(text);
  }

  // Sort every row: finished piles left, then piles that belong to the row, then strays on the right.
  function sortRows() {
    if (!S || S.over) return;
    disarmEnd(); sel = null;
    var rank = { done: 0, based: 1, home: 2, empty: 3, away: 4 };
    var next = [], changed = false;
    for (var r = 0; r < 3; r++) {
      var idx = [0, 1, 2, 3, 4, 5, 6, 7].map(function (c) { return r * 8 + c; });
      var order = idx.slice().sort(function (x, y) {
        return (rank[pileState(x)] - rank[pileState(y)]) || (x - y);
      });
      order.forEach(function (from, k) { if (from !== idx[k]) changed = true; next.push(S.grid[from]); });
    }
    if (!changed) { message = 'Every row is already sorted.'; render(); return; }
    remember();
    S.grid = next; S.moves++;
    message = 'Sorted. Finished piles are on the left of each row and cards from other rows are on the right.';
    render();
  }

  function toggleAutoFill() {
    prefs.autoFill = !prefs.autoFill;
    store(PREFS_KEY, prefs);
    if (prefs.autoFill && S && !S.over && emptyCount() && supplyLeft()) {
      lockUndo();
      var f = fillEmpties();
      message = 'Auto-fill on. ' + (f === 1 ? 'The open space was filled.' : f + ' open spaces were filled.');
      checkWin();
    } else {
      message = prefs.autoFill
        ? 'Auto-fill on. Empty spaces fill from the stock straight away.'
        : 'Auto-fill off. Empty spaces stay open until you tap one to fill it.';
    }
    render();
  }

  function toggleHints() {
    prefs.hints = !prefs.hints;
    store(PREFS_KEY, prefs);
    message = prefs.hints ? 'Hints on. Valid spots for a selected card get a dashed outline.' : 'Hints off.';
    render();
  }

  function tapWaste() {
    if (!S || S.over || !S.waste.length) return;
    disarmEnd();
    if (sel && sel.type === 'waste') { sel = null; message = 'Selection cleared.'; }
    else { sel = { type: 'waste' }; message = '<strong>' + name(top(S.waste)) + '</strong> selected. Tap the pile it builds on.'; }
    render();
  }

  function deal() {
    if (!S || S.over) return;
    disarmEnd(); sel = null;
    if (S.stock.length) {
      lockUndo();
      var n = Math.min(3, S.stock.length);
      for (var k = 0; k < n; k++) S.waste.push(S.stock.pop());
      message = 'Dealt ' + n + ' to the waste. The top card is playable.';
    } else if (S.waste.length) {
      remember();
      S.stock = S.waste.reverse(); S.waste = []; S.redeals++;
      message = 'Turned the waste over. Redeal ' + S.redeals + '.';
    } else {
      message = 'The stock and waste are both empty.';
    }
    message += settleEmpties();
    checkWin();
    render();
  }

  function undo() {
    if (!S || S.over) return;
    disarmEnd();
    if (!history.length) {
      message = 'Nothing to undo since your last deal or fill. Cards turned up from the stock stay where they are.';
      render(); return;
    }
    S = history.pop(); sel = null;
    message = 'Undid the last move.';
    render();
  }

  function disarmEnd() {
    endArmed = false;
    if (endTimer) { clearTimeout(endTimer); endTimer = null; }
  }

  function endGame() {
    if (!S || S.over) return;
    if (!endArmed) {
      endArmed = true;
      message = 'Tap <strong>Confirm end</strong> to score this game. You cannot undo after that.';
      endTimer = setTimeout(function () { disarmEnd(); render(); }, 4000);
      render(); return;
    }
    disarmEnd();
    S.over = true; sel = null; finish();
    message = '';
    render();
  }

  function shake(i) {
    var el = document.querySelector('.pile[data-i="' + i + '"]');
    if (!el) return;
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  }

  /* ---------- layout ---------- */
  // Pure sizing maths: given the play area's width and the height left on screen,
  // choose stock/waste below the grid or beside it, whichever gives bigger cards,
  // then spend any spare height on taller stack offsets.
  // Picks the largest card size that fits. Stacks either fan downwards (tall screens) or to the right
  // (short, wide screens such as laptops), whichever gives bigger cards.
  function planLayout(contentW, availH, peekFor, fanFor) {
    var gap = contentW >= 900 ? 10 : contentW >= 600 ? 8 : 4;
    var rowGap = contentW >= 600 ? (availH < 620 ? 12 : 18) : 12;
    var headH = contentW >= 600 ? 26 : 20;   // row name shown above a row
    var MARK = 12;                           // room for the finished / wrong-row line under the last row
    var LABEL_W = 92, LABEL_GAP = 18, SIDE_GAP = 20, MAX_W = 160;

    function peekX(W) { return Math.round(W * 0.26); }   // sideways fan: keeps each card's corner index visible
    function pileW(W, fan) { return fan === 'right' ? W + 3 * peekX(W) : W; }
    // Beside-the-grid column must hold the waste fan: one card plus two fan offsets.
    function sideWidth(W) { var w = Math.max(W, 44); return Math.max(150, w + 2 * fanFor(w) + 8); }
    function fixedFor(mode, labels) { return 2 * rowGap + (labels ? 0 : 3 * headH) + MARK + (mode === 'below' ? 50 : 0); }
    function heightFor(W, mode, labels, fan) {
      var H = CE.heightFor(W), pk = peekFor(W);
      var talon = mode === 'below' ? CE.heightFor(Math.max(W, 44)) : 0;
      return fixedFor(mode, labels) + 3 * (fan === 'right' ? H : H + 3 * pk) + talon;
    }
    function widthFor(W, mode, labels, fan) {
      return 8 * pileW(W, fan) + 7 * gap + (labels ? LABEL_W + LABEL_GAP : 0) + (mode === 'side' ? sideWidth(W) + SIDE_GAP : 0);
    }
    function ok(W, mode, labels, fan) {
      if (fan === 'right' && CE.isCompact(deckId, W)) return false;   // small cards fan downwards only
      return widthFor(W, mode, labels, fan) <= contentW && heightFor(W, mode, labels, fan) <= availH;
    }
    function plan(mode, labels, fan) {
      var W = MAX_W;
      while (W > 30 && !ok(W, mode, labels, fan)) W--;
      return { mode: mode, labels: labels, fan: fan, W: Math.max(30, W), fits: ok(W, mode, labels, fan) };
    }

    var options = [];
    ['down', 'right'].forEach(function (fan) {
      if (fan === 'right' && contentW < 700) return;
      options.push(plan('below', true, fan), plan('below', false, fan), plan('side', true, fan), plan('side', false, fan));
    });
    var best = null;
    options.forEach(function (o) {
      if (!best) { best = o; return; }
      if (o.fits !== best.fits) { if (o.fits) best = o; return; }
      var margin = o.fan !== best.fan ? (o.fan === 'right' ? 6 : -6) : 1;   // sideways fans must win clearly
      if (o.W > best.W + margin) best = o;
      else if (o.fan === best.fan && Math.abs(o.W - best.W) <= 1 && o.labels && !best.labels && o.mode === best.mode) best = o;
    });

    var L = {
      mode: best.mode, labels: best.labels, fan: best.fan, W: best.W, gap: gap, rowGap: rowGap,
      labelW: LABEL_W, labelGap: LABEL_GAP, sideGap: SIDE_GAP,
      sideW: best.mode === 'side' ? sideWidth(best.W) : 0, availH: availH, fits: best.fits
    };
    L.H = CE.heightFor(L.W);
    var basePeek = peekFor(L.W);
    if (L.fan === 'right') {
      // Spend spare width on a wider sideways fan.
      var spareW = contentW - widthFor(L.W, L.mode, L.labels, 'right');
      L.peek = 0;
      L.peekX = Math.min(Math.round(L.W * 0.42), peekX(L.W) + Math.max(0, Math.floor(spareW / 24)));
      L.pileW = L.W + 3 * L.peekX;
      L.pileH = L.H;
    } else {
      // Spend any spare height on taller stack offsets so buried cards are easier to read.
      var spare = availH - heightFor(L.W, L.mode, L.labels, 'down');
      var extra = spare > 0 ? Math.floor(spare / 9) : 0;
      L.peek = Math.max(basePeek, Math.min(Math.round(L.H * 0.3), basePeek + extra));
      L.peekX = 0;
      L.pileW = L.W;
      L.pileH = L.H + 3 * L.peek;
    }
    return L;
  }

  function computeLayout() {
    var play = $('play');
    var contentW = play.clientWidth || 360;
    var vh = window.innerHeight || 800;
    // Two stacked screens reported by the browser (dual-screen devices): fit the grid to the top screen.
    var segs = window.viewport && window.viewport.segments;
    if (segs && segs.length === 2 && segs[1].y > segs[0].y + 10) vh = segs[0].y + segs[0].height;
    var playTop = play.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0);
    var availH = Math.max(260, vh - playTop - 10);
    return planLayout(contentW, availH,
      function (w) { return CE.peek(deckId, w); },
      function (w) { return CE.fanOffset(deckId, w); });
  }

  function syncMoreMenu() {
    var more = $('more');
    var w = document.documentElement.clientWidth, h = window.innerHeight;
    var slim = (h <= 760 && w >= 600) || (h <= 1000 && w >= 900);   // one-line header (matches the CSS)
    var inline = w >= (slim ? 1360 : 900);
    if (inline) {
      if (!more.classList.contains('inline')) { more.classList.add('inline'); more.open = true; }
    } else if (more.classList.contains('inline')) {
      more.classList.remove('inline'); more.open = false;
    }
  }

  function targetsFor() {
    var set = {};
    if (!sel || !prefs.hints) return set;
    for (var i = 0; i < 24; i++) {
      var p = S.grid[i];
      if (sel.type === 'waste') {
        var c = top(S.waste);
        if ((fits(c, p) || fitsUnder(c, p)) && rowOk(c, i)) set[i] = 1;
      } else if (i !== sel.i) {
        var a = S.grid[sel.i];
        if ((fits(top(a), p) && rowOk(top(a), i)) ||
            (a.length > 1 && fits(a[0], p) && rowOk(a[0], i)) ||
            (fitsUnder(top(a), p) && rowOk(top(a), i))) set[i] = 1;
      }
    }
    return set;
  }

  function pileLabel(i) {
    var p = S.grid[i];
    var head = 'Row ' + (rowOf(i) + 1) + ', pile ' + (i % 8 + 1) + ': ';
    if (!p.length) return head + 'empty';
    return head + p.slice().reverse().map(name).join(' on ');
  }

  /* ---------- render ---------- */
  function render() {
    if (!S) return;
    syncMoreMenu();
    var L = computeLayout(); lastW = L.mode + L.fan + L.W + ':' + L.peek + ':' + L.peekX;
    var play = $('play');
    play.className = 'play ' + L.mode;
    $('board').style.gap = L.rowGap + 'px';
    $('talon').style.width = L.mode === 'side' ? L.sideW + 'px' : '';
    play.style.gap = L.mode === 'side' ? L.sideGap + 'px' : '';
    var targets = targetsFor();
    var radius = Math.round((CE.getStyle(deckId).card.radius || 0) * L.W / CE.BASE_W);

    var rows = '';
    for (var r = 0; r < 3; r++) {
      var piles = '';
      for (var c = 0; c < 8; c++) {
        var i = r * 8 + c, p = S.grid[i];
        var cls = 'pile ' + pileState(i) + (sel && sel.type === 'grid' && sel.i === i ? ' selected' : '') + (targets[i] ? ' target' : '');
        var inner = p.length ? '' : '<span class="slot" style="width:' + L.W + 'px;height:' + L.H + 'px;border-radius:' + radius + 'px">' +
          (!prefs.autoFill && supplyLeft() && !S.over ? 'Fill' : '') + '</span>';
        for (var k = 0; k < p.length; k++) {
          inner += '<span class="card-wrap" style="' + (L.fan === 'right' ? 'top:0;left:' + (k * L.peekX) : 'top:' + (k * L.peek)) + 'px">' + CE.renderCard(p[k], deckId, { width: L.W }) + '</span>';
        }
        piles += '<button type="button" class="' + cls + '" data-i="' + i + '" style="width:' + L.pileW + 'px;height:' + L.pileH + 'px" aria-label="' + pileLabel(i) + '"' + (S.over ? ' disabled' : '') + '>' + inner + '</button>';
      }
      var done = countDone(r);
      if (L.labels) {
        rows += '<div class="row" style="gap:' + L.labelGap + 'px">' +
          '<div class="row-label" style="width:' + L.labelW + 'px"><span class="chain">' + CHAIN_TEXT[r] + '</span><span class="count">' + done + ' / 8 finished</span></div>' +
          '<div class="piles" style="gap:' + L.gap + 'px">' + piles + '</div></div>';
      } else {
        rows += '<div class="row-block"><div class="row-head"><span class="chain">' + CHAIN_TEXT[r] + '</span><span>' + done + ' / 8 finished</span></div>' +
          '<div class="piles" style="gap:' + L.gap + 'px">' + piles + '</div></div>';
      }
    }
    $('board').innerHTML = rows;

    // Stock
    var sw = Math.max(L.W, 44), sh = CE.heightFor(sw);
    var stockInner = S.stock.length
      ? CE.renderBack(deckId, { width: sw })
      : '<span class="slot" style="width:' + sw + 'px;height:' + sh + 'px;border-radius:' + radius + 'px">' + (S.waste.length ? 'Turn over' : 'Empty') + '</span>';
    var stockLabel = S.stock.length ? 'Deal three cards from the stock, ' + S.stock.length + ' left' : (S.waste.length ? 'Turn the waste over to redeal' : 'Stock is empty');
    $('stock-slot').innerHTML = '<button type="button" class="stock" id="stock" aria-label="' + stockLabel + '"' + (S.over ? ' disabled' : '') + '>' + stockInner + '</button>';
    $('stock-cap').textContent = S.stock.length ? 'Stock · ' + S.stock.length + ' · deal 3' : (S.waste.length ? 'Stock empty · tap to redeal' : 'Stock empty');

    // Waste: show up to three, only the top is playable
    var shown = S.waste.slice(-3), off = CE.fanOffset(deckId, sw);
    var wasteW = shown.length ? sw + off * (shown.length - 1) : sw;
    var wasteHtml = '';
    if (!shown.length) {
      wasteHtml = '<span class="slot" style="display:block;box-sizing:border-box;width:' + sw + 'px;height:' + sh + 'px;border:1px dashed var(--line);border-radius:' + radius + 'px"></span>';
    } else {
      shown.forEach(function (card, k) {
        var isTop = k === shown.length - 1;
        var html = CE.renderCard(card, deckId, { width: sw });
        if (isTop) {
          wasteHtml += '<button type="button" class="waste-top' + (sel && sel.type === 'waste' ? ' selected' : '') + '" id="waste-top" style="left:' + (k * off) + 'px" aria-label="Waste: ' + name(card) + '. Select to play"' + (S.over ? ' disabled' : '') + '>' + html + '</button>';
        } else {
          wasteHtml += '<span class="card-wrap" style="left:' + (k * off) + 'px">' + html + '</span>';
        }
      });
    }
    var waste = $('waste');
    waste.style.width = wasteW + 'px'; waste.style.height = sh + 'px';
    waste.innerHTML = wasteHtml;
    $('waste-cap').textContent = 'Waste · ' + S.waste.length;

    // Status strip
    var st = stats();
    $('hud').innerHTML =
      '<span>Cards on grid <b>' + cardsOnGrid() + '/96</b></span>' +
      '<span>Finished <b>' + countDone() + '/24</b></span>' +
      '<span>Left over <b>' + cardsLeft() + '</b></span>' +
      '<span>Redeals <b>' + S.redeals + '</b></span>' +
      '<span class="x">Moves <b>' + S.moves + '</b></span>' +
      '<span class="x">Best <b>' + (st.best === null ? '—' : st.best + ' left') + '</b></span>' +
      '<span class="x">Wins <b>' + st.wins + '/' + st.played + '</b></span>';

    // Result panel
    var res = $('result');
    if (S.over) {
      var left = cardsLeft();
      $('result-title').textContent = S.won ? 'Perfect grip' : tier(left);
      $('result-text').textContent = S.won
        ? 'All 96 cards are home in ' + S.moves + ' moves.'
        : left + (left === 1 ? ' card' : ' cards') + ' left in the stock and waste · ' + countDone() + ' of 24 piles finished.';
      if (S.points) $('result-text').textContent += ' ' + App.pointsLine(S.points) + '.';
      $('result-unlock').innerHTML = S.unlocked && S.unlocked.length ? App.unlockMessage(S.unlocked) : '';
      $('result-unlock').hidden = !(S.unlocked && S.unlocked.length);
      res.hidden = false;
    } else {
      res.hidden = true;
    }

    // Controls
    $('btn-undo').disabled = S.over || !history.length;
    $('btn-sort').disabled = S.over;
    var hb = $('btn-hints');
    hb.textContent = prefs.hints ? 'Hints on' : 'Hints off';
    hb.setAttribute('aria-pressed', prefs.hints ? 'true' : 'false');
    $('legend-hint').hidden = !prefs.hints;
    var fb = $('btn-fill');
    fb.textContent = prefs.autoFill ? 'Auto-fill on' : 'Auto-fill off';
    fb.setAttribute('aria-pressed', prefs.autoFill ? 'true' : 'false');
    var endBtn = $('btn-end');
    endBtn.disabled = S.over;
    endBtn.textContent = endArmed ? 'Confirm end' : 'End game';
    endBtn.classList.toggle('armed', endArmed);
    $('msg').innerHTML = message;

    store(SAVE_KEY, { S: S, history: history.slice(-60) });
  }

  /* ---------- events ---------- */
  $('board').addEventListener('click', function (e) {
    var b = e.target.closest('.pile');
    if (b) tapPile(parseInt(b.getAttribute('data-i'), 10));
  });
  $('stock-slot').addEventListener('click', function (e) { if (e.target.closest('.stock')) deal(); });
  $('waste').addEventListener('click', function (e) { if (e.target.closest('.waste-top')) tapWaste(); });
  $('btn-new').addEventListener('click', newGame);
  $('btn-again').addEventListener('click', newGame);
  $('btn-undo').addEventListener('click', undo);
  $('btn-sort').addEventListener('click', sortRows);
  $('btn-hints').addEventListener('click', toggleHints);
  $('btn-fill').addEventListener('click', toggleAutoFill);
  $('btn-end').addEventListener('click', endGame);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sel) { sel = null; message = 'Selection cleared.'; render(); }
  });
  // Re-fit when the screen changes: folding/unfolding, rotating, moving or resizing the window.
  var refitQueued = false;
  function refit() {
    if (refitQueued) return;
    refitQueued = true;
    requestAnimationFrame(function () {
      refitQueued = false;
      if (!S) return;
      syncMoreMenu();
      var L = computeLayout();
      if (L.mode + L.fan + L.W + ':' + L.peek + ':' + L.peekX !== lastW) render();
    });
  }
  window.addEventListener('resize', refit);
  window.addEventListener('orientationchange', refit);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', refit);
  if (window.ResizeObserver) new ResizeObserver(refit).observe($('play'));
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', refit);
  $('more').addEventListener('toggle', refit);
  // On narrow screens, tapping anywhere outside the More menu closes it.
  document.addEventListener('click', function (e) {
    var more = $('more');
    if (more.open && !more.classList.contains('inline') && !more.contains(e.target)) more.open = false;
  });

  /* ---------- boot (keeps the game across page updates) ---------- */
  function boot(data) {
    var savedPrefs = load(PREFS_KEY);
    if (savedPrefs) {
      prefs.hints = !!savedPrefs.hints;
      prefs.autoFill = savedPrefs.autoFill !== false;
    }
    deckId = App.getDeck();
    buildDeckPicker();
    applyTheme();
    var saved = data && data.S ? data : load(SAVE_KEY);
    if (saved && saved.S && saved.S.grid && !saved.S.over) {
      S = saved.S; history = saved.history || [];
      message = 'Welcome back. Your game is where you left it.';
      render();
    } else {
      newGame();
    }
  }
  var hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(function () { return { S: S, history: history }; });
  if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {});
})();
