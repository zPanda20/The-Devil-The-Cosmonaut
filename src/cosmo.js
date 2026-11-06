(function () {
  'use strict';
  var CE = window.CardEngine, PACK = window.COSMO_LEVELS, App = window.App;
  var PROG_KEY = 'cosmo:progress:v1', PREFS_KEY = 'cosmo:prefs:v1', PLAY_KEY = 'cosmo:play:v1', DAILY_PLAY_KEY = 'cosmo:daily-play:v1';
  var TIER_POINTS = { 'launch': 10, 'orbit': 20, 'deep-space': 35, 'binary-stars': 50, 'event-horizon': 75 };
  var TIER_BLURB = {
    'launch': '5×5 and 6×6 · one token per row, column and region',
    'orbit': '7×7 and 8×8 · one token',
    'deep-space': '9×9 and 10×10 · one token, harder deductions',
    'binary-stars': '9×9 and 10×10 · two tokens per row, column and region',
    'event-horizon': '10×10 with two tokens, 11×11 and 12×12 with one · the hardest deductions'
  };
  var DOUBLE_TAP_MS = 380;

  // Flatten the packs into numbered levels.
  var LEVELS = [];
  PACK.tiers.forEach(function (t) {
    t.levels.forEach(function (l) {
      LEVELS.push({ tier: t.id, tierName: t.name, n: l.n, k: l.k, r: l.r, s: l.s, d: l.d, num: LEVELS.length + 1 });
    });
  });

  var prefs = { deck: App.getDeck(), autoX: false };   // deck is shared app-wide; only autoX is stored here
  var prog = { score: 0, best: {}, fails: 0 };   // best[num] = most lives kept on a clear (1-3)
  var view = 'map';
  var P = null;                                  // current level state
  var lastTap = { i: -1, t: 0, prev: 0 };
  var message = '';
  var lastFit = '';

  function $(id) { return document.getElementById(id); }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  function load(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }

  /* ---------- level helpers ---------- */
  function lvl(num) { return LEVELS[num - 1]; }
  // The daily puzzle is a level from the map, turned or mirrored by date.
  var dailyCache = {};
  function dailyLevel(key) {
    if (dailyCache[key]) return dailyCache[key];
    var pick = App.dailyPick(key), base = lvl(pick.num), t = App.transformLevel(base, pick.turn);
    dailyCache[key] = { tier: base.tier, tierName: base.tierName, n: base.n, k: base.k, r: t.r, s: t.s, d: base.d, num: base.num, daily: key };
    return dailyCache[key];
  }
  function cur() { return P.daily ? dailyLevel(P.daily) : lvl(P.num); }
  function regionOf(L, i) { return parseInt(L.r.charAt(i), 36); }
  function isSolution(L, i) { if (!L._sol) L._sol = new Set(L.s); return L._sol.has(i); }
  function unlocked(num) { return num === 1 || !!prog.best[num - 1]; }
  function nextLevel() { for (var n = 1; n <= LEVELS.length; n++) if (!prog.best[n]) return n; return LEVELS.length; }
  function clearedCount() { var c = 0; for (var k in prog.best) if (prog.best[k]) c++; return c; }
  function points(L, lives) { return Math.round(TIER_POINTS[L.tier] * (1 + 0.25 * (lives - 1))); }
  function tokenRank(L) { return L.k === 1 ? 'K' : 'Q'; }
  function tokenWord(L, plural) { return L.k === 1 ? (plural ? 'Kings' : 'King') : (plural ? 'Queens' : 'Queen'); }
  function rowCol(L, i) { return [(i / L.n) | 0, i % L.n]; }
  function unitsOf(L, i) {
    var n = L.n, rc = rowCol(L, i), g = regionOf(L, i), row = [], col = [], reg = [];
    for (var j = 0; j < n * n; j++) {
      if (((j / n) | 0) === rc[0]) row.push(j);
      if (j % n === rc[1]) col.push(j);
      if (regionOf(L, j) === g) reg.push(j);
    }
    return [row, col, reg];
  }
  function neighbours(L, i) {
    var n = L.n, rc = rowCol(L, i), out = [];
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      var r = rc[0] + dr, c = rc[1] + dc;
      if (r >= 0 && r < n && c >= 0 && c < n) out.push(r * n + c);
    }
    return out;
  }

  /* ---------- theme ---------- */
  function applyTheme() {
    App.applyTheme(prefs.deck);
    var picker = $('deck');
    if (picker && picker.value !== prefs.deck) picker.value = prefs.deck;
  }

  function buildDeckPicker() {
    var picker = $('deck');
    App.fillDeckSelect(picker, prefs.deck);
    picker.addEventListener('change', function () {
      if (!App.setDeck(picker.value)) { picker.value = prefs.deck; return; }
      prefs.deck = picker.value;
      applyTheme();
      message = 'Switched to the ' + CE.getStyle(prefs.deck).name + ' deck.';
      render();
    });
  }

  function syncMoreMenu() {
    var more = $('more');
    var inline = document.documentElement.clientWidth >= 760;
    if (inline) { if (!more.classList.contains('inline')) { more.classList.add('inline'); more.open = true; } }
    else if (more.classList.contains('inline')) { more.classList.remove('inline'); more.open = false; }
  }

  /* ---------- game actions ---------- */
  function startLevel(num) {
    var L = lvl(num);
    P = { num: num, marks: new Array(L.n * L.n).fill(0), lives: 3, over: false, won: false, history: [] };
    lastTap = { i: -1, t: 0, prev: 0 };
    view = 'play';
    message = 'Level ' + num + '. Place ' + (L.k === 1 ? 'one ' + tokenWord(L) : 'two ' + tokenWord(L, true)) +
      ' in every row, column and region. Tap for X, double tap for a ' + tokenWord(L) + '.';
    render();
  }

  function startDaily() {
    var key = App.today(), L = dailyLevel(key);
    P = { num: L.num, daily: key, marks: new Array(L.n * L.n).fill(0), lives: 3, over: false, won: false, history: [] };
    lastTap = { i: -1, t: 0, prev: 0 };
    view = 'play';
    var done = App.dailyResult(key);
    message = (done ? 'You already cleared today\'s mission. This run is for fun: no points or streak change. ' : 'Daily mission for ' + App.prettyDate(key) + '. ') +
      'Place one ' + tokenWord(L) + ' in every row, column and region.';
    render();
  }
  function setHash(h) {
    try { history.replaceState(null, '', location.pathname + location.search + (h ? '#' + h : '')); } catch (e) { /* ignore */ }
  }

  function tapCell(i) {
    if (!P || P.over) return;
    var m = P.marks[i], now = Date.now();
    if (m === 2 || m === 3) { lastTap = { i: -1, t: 0, prev: 0 }; return; }
    if (lastTap.i === i && now - lastTap.t < DOUBLE_TAP_MS) {
      // Second tap: take back the X from the first tap, then try a token here.
      P.marks[i] = lastTap.prev;
      if (P.history.length) P.history.pop();
      lastTap = { i: -1, t: 0, prev: 0 };
      placeToken(i);
      return;
    }
    P.marks[i] = m === 1 ? 0 : 1;
    P.history.push([[i, m]]);
    lastTap = { i: i, t: now, prev: m };
    render();
  }

  function placeToken(i) {
    if (!P || P.over) return;
    var L = cur(), m = P.marks[i];
    if (m === 2 || m === 3) return;
    if (isSolution(L, i)) {
      P.marks[i] = 2;
      if (prefs.autoX) autoX(L, i);
      var placed = P.marks.filter(function (v) { return v === 2; }).length;
      var total = L.n * L.k;
      if (placed === total) { win(L); return; }
      message = tokenWord(L) + ' placed. ' + (total - placed) + ' to go.';
    } else {
      P.marks[i] = 3;
      P.lives--;
      if (P.lives <= 0) { fail(L); return; }
      message = '<strong>Wrong spot.</strong> That cost a life. ' + P.lives + (P.lives === 1 ? ' life' : ' lives') + ' left.';
      render();
      var el = document.querySelector('.cell[data-i="' + i + '"]');
      if (el) { el.classList.remove('wrong'); void el.offsetWidth; el.classList.add('wrong'); }
      return;
    }
    render();
  }

  function autoX(L, i) {
    neighbours(L, i).forEach(function (j) { if (P.marks[j] === 0) P.marks[j] = 1; });
    unitsOf(L, i).forEach(function (u) {
      var stars = u.filter(function (j) { return P.marks[j] === 2; }).length;
      if (stars >= L.k) u.forEach(function (j) { if (P.marks[j] === 0) P.marks[j] = 1; });
    });
  }

  function win(L) {
    P.over = true; P.won = true;
    var before = 0, gained = 0;
    if (P.daily) {
      var first = !App.dailyResult(P.daily);
      if (first) { gained = points(L, P.lives); prog.score += gained; }
      App.recordDaily(P.daily, P.lives);
      P.firstClear = first;
    } else {
      before = prog.best[P.num] || 0;
      if (P.lives > before) {
        gained = points(L, P.lives) - (before ? points(L, before) : 0);
        prog.score += gained; prog.best[P.num] = P.lives;
      }
      P.firstClear = !before;
    }
    store(PROG_KEY, prog);
    P.gained = gained;
    P.unlocked = App.checkUnlocks();
    if (P.unlocked.length) App.fillDeckSelect($('deck'), prefs.deck);
    message = '';
    render();
  }

  function fail(L) {
    P.over = true; P.won = false;
    var loss = P.daily && App.dailyResult(P.daily) ? 0 : Math.round(TIER_POINTS[L.tier] * 0.5);   // replaying a cleared daily costs nothing
    P.loss = Math.min(loss, prog.score);
    prog.score = Math.max(0, prog.score - loss);
    prog.fails++;
    store(PROG_KEY, prog);
    message = '';
    render();
  }

  function undoX() {
    if (!P || P.over || !P.history.length) return;
    var entry = P.history.pop();
    entry.forEach(function (e) { if (P.marks[e[0]] === 0 || P.marks[e[0]] === 1) P.marks[e[0]] = e[1]; });
    lastTap = { i: -1, t: 0, prev: 0 };
    message = 'Undid the last X change.';
    render();
  }

  function clearX() {
    if (!P || P.over) return;
    var entry = [];
    P.marks.forEach(function (v, i) { if (v === 1) { entry.push([i, 1]); P.marks[i] = 0; } });
    if (!entry.length) { message = 'There are no X marks to clear.'; render(); return; }
    P.history.push(entry);
    lastTap = { i: -1, t: 0, prev: 0 };
    message = 'Cleared ' + entry.length + ' X marks. Undo X brings them back.';
    render();
  }

  function toggleAutoX() {
    prefs.autoX = !prefs.autoX; store(PREFS_KEY, { autoX: prefs.autoX });
    message = prefs.autoX
      ? 'Auto-X on. Placing a token marks the cells around it and finished rows, columns and regions.'
      : 'Auto-X off.';
    render();
  }

  /* ---------- layout ---------- */
  function boardSize(L) {
    var play = $('play');
    var cw = play.clientWidth || 360;
    var wide = cw >= 760;
    var maxW = wide ? cw - 248 : cw;
    var top = play.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0);
    var vh = window.innerHeight || 800;
    var availH = vh - top - (wide ? 16 : 120);
    var size = Math.max(220, Math.min(maxW, availH, 780));
    var cell = Math.floor(size / L.n);
    return { cell: cell, wide: wide };
  }

  /* ---------- render ---------- */
  function xMark(size, colour, width) {
    return '<svg class="x" viewBox="0 0 10 10" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<path d="M2 2 L8 8 M8 2 L2 8" stroke="' + colour + '" stroke-width="' + width + '" stroke-linecap="round"></path></svg>';
  }

  function livesHtml(L, lives) {
    var h = '';
    for (var k = 0; k < 3; k++) {
      h += '<span class="life' + (k < lives ? '' : ' lost') + '">' + CE.renderToken(prefs.deck, tokenRank(L), k % 2 ? 'S' : 'H', 18) + '</span>';
    }
    return '<span class="lives" aria-label="' + lives + ' lives left">' + h + '</span>';
  }

  function renderMap() {
    var next = nextLevel(), html = '', num = 0;
    PACK.tiers.forEach(function (t) {
      var cleared = 0, buttons = '';
      t.levels.forEach(function () {
        num++;
        var best = prog.best[num] || 0, open = unlocked(num);
        if (best) cleared++;
        var cls = 'lvl' + (best ? ' cleared' : '') + (num === next && !best ? ' next' : '');
        var pips = best ? new Array(best + 1).join('●') + new Array(4 - best).join('○') : '';
        buttons += '<button type="button" class="' + cls + '" data-num="' + num + '"' + (open ? '' : ' disabled') +
          ' aria-label="Level ' + num + (best ? ', cleared with ' + best + ' of 3 lives' : open ? '' : ', locked') + '">' +
          '<span>' + num + '</span>' + (pips ? '<small>' + pips + '</small>' : '') + '</button>';
      });
      html += '<section class="tier"><div class="tier-head"><h2>' + t.name + '</h2><p>' + TIER_BLURB[t.id] + ' · ' + cleared + ' / ' + t.levels.length + ' cleared</p></div>' +
        '<div class="levels">' + buttons + '</div></section>';
    });
    $('map').innerHTML = html;
    $('hud').innerHTML =
      '<span>Score <b>' + prog.score + '</b></span>' +
      '<span>Cleared <b>' + clearedCount() + ' / ' + LEVELS.length + '</b></span>' +
      '<span>Next <b>Level ' + next + '</b></span>' +
      '<span class="x2">Missions failed <b>' + prog.fails + '</b></span>';
  }

  function renderPlay() {
    var L = cur(), n = L.n;
    var fit = boardSize(L), cell = fit.cell;
    lastFit = n + ':' + cell;
    var tint = CE.getStyle(prefs.deck).theme.regionTint || { ink: '#111', line: '#111' };
    var colours = CE.regionColours(prefs.deck, n);
    var thick = Math.max(2, Math.round(cell * 0.06)), thinColour = tint.line + '40';
    var rank = tokenRank(L), tokSize = Math.round(cell * 0.8), xSize = Math.round(cell * 0.38);
    var board = $('board');
    board.style.gridTemplateColumns = 'repeat(' + n + ', ' + cell + 'px)';
    board.style.gridAutoRows = cell + 'px';
    var html = '';
    for (var i = 0; i < n * n; i++) {
      var r = (i / n) | 0, c = i % n, g = regionOf(L, i);
      var topDiff = r === 0 || regionOf(L, i - n) !== g, leftDiff = c === 0 || regionOf(L, i - 1) !== g;
      var bt = topDiff ? thick : 1, bl = leftDiff ? thick : 1;
      var br = c === n - 1 ? thick : 0, bb = r === n - 1 ? thick : 0;
      var style = 'width:' + cell + 'px;height:' + cell + 'px;background:' + colours[g] + ';' +
        'border-width:' + bt + 'px ' + br + 'px ' + bb + 'px ' + bl + 'px;' +
        'border-color:' + (topDiff ? tint.line : thinColour) + ' ' + tint.line + ' ' + tint.line + ' ' + (leftDiff ? tint.line : thinColour) + ';';
      var m = P.marks[i], inner = '', state = 'empty';
      if (m === 1) { inner = xMark(xSize, tint.ink, 1.4); state = 'X'; }
      else if (m === 2) { inner = '<span class="tok">' + CE.renderToken(prefs.deck, rank, g % 2 ? 'S' : 'H', tokSize) + '</span>'; state = tokenWord(L); }
      else if (m === 3) { inner = xMark(Math.round(cell * 0.6), 'var(--bad)', 2.2); state = 'wrong guess'; }
      html += '<button type="button" class="cell" data-i="' + i + '" style="' + style + '" aria-label="Row ' + (r + 1) + ', column ' + (c + 1) + ', region ' + (g + 1) + ': ' + state + '"' + (P.over ? ' disabled' : '') + '>' + inner + '</button>';
    }
    board.innerHTML = html;

    var pips = new Array(L.d + 1).join('●') + new Array(5 - L.d).join('○');
    $('hud').innerHTML =
      (L.daily ? '<span>Daily · <b>' + App.prettyDate(L.daily) + '</b></span>' + '<span><b>' + n + '×' + n + '</b> · ' + L.k + ' per line</span>'
        : '<span>Level <b>' + L.num + '</b></span>' + '<span>' + L.tierName + ' · <b>' + n + '×' + n + '</b> · ' + L.k + ' per line</span>') +
      '<span class="x2">Difficulty <b>' + pips + '</b></span>' +
      '<span>Lives ' + livesHtml(L, P.lives) + '</span>' +
      '<span>Score <b>' + prog.score + '</b></span>';
    $('how-k').textContent = L.k === 1 ? 'one ' + tokenWord(L) : 'two ' + tokenWord(L, true);

    var res = $('result');
    if (P.over) {
      res.hidden = false;
      if (P.won) {
        $('result-title').textContent = P.lives === 3 ? 'Flawless landing' : 'Mission complete';
        if (L.daily) {
          var streak = App.currentStreak();
          $('result-text').textContent = 'Daily mission cleared with ' + P.lives + ' of 3 lives. ' +
            (P.gained ? '+' + P.gained + ' points. ' : '') + 'Streak: ' + streak + (streak === 1 ? ' day.' : ' days.') + ' A new mission lands tomorrow.';
          $('btn-result-main').textContent = 'Home';
          $('btn-result-main').setAttribute('data-act', 'home');
        } else {
          $('result-text').textContent = 'Level ' + L.num + ' cleared with ' + P.lives + ' of 3 lives. ' +
            (P.gained ? '+' + P.gained + ' points.' : 'No new points: your best on this level stands.');
          var hasNext = L.num < LEVELS.length;
          $('btn-result-main').textContent = hasNext ? 'Next level' : 'Back to levels';
          $('btn-result-main').setAttribute('data-act', hasNext ? 'next' : 'map');
        }
      } else {
        $('result-title').textContent = 'Mission failed';
        $('result-text').textContent = 'Three wrong ' + tokenWord(L, true) + '. ' + (P.loss ? '−' + P.loss + ' points. ' : '') + 'Restart the level to try again.';
        $('btn-result-main').textContent = L.daily ? 'Try again' : 'Restart level';
        $('btn-result-main').setAttribute('data-act', L.daily ? 'daily' : 'restart');
      }
      var un = P.won && P.unlocked && P.unlocked.length;
      $('result-unlock').innerHTML = un ? App.unlockMessage(P.unlocked) : '';
      $('result-unlock').hidden = !un;
    } else {
      res.hidden = true;
    }
    $('btn-undo').disabled = P.over || !P.history.length;
    $('btn-clear').disabled = P.over;
  }

  function render() {
    syncMoreMenu();
    $('map').hidden = view !== 'map';
    $('play').hidden = view !== 'play';
    $('btn-levels').hidden = view === 'map';
    var ab = $('btn-autox');
    ab.textContent = prefs.autoX ? 'Auto-X on' : 'Auto-X off';
    ab.setAttribute('aria-pressed', prefs.autoX ? 'true' : 'false');
    if (view === 'map') renderMap(); else if (P) renderPlay();
    $('msg').innerHTML = message;
    // The daily keeps its own save slot, so starting it never wipes a level in progress.
    var live = view === 'play' && P && !P.over ? { P: P } : null;
    if (P && P.daily) store(DAILY_PLAY_KEY, live);
    else store(PLAY_KEY, live);
  }

  /* ---------- events ---------- */
  $('map').addEventListener('click', function (e) {
    var b = e.target.closest('.lvl');
    if (b && !b.disabled) { setHash(''); startLevel(parseInt(b.getAttribute('data-num'), 10)); }
  });
  $('board').addEventListener('click', function (e) {
    var b = e.target.closest('.cell');
    if (!b) return;
    var i = b.getAttribute('data-i');
    tapCell(parseInt(i, 10));
    if (e.detail === 0) restoreFocus(i);   // keyboard activation: keep focus on the cell after redraw
  });
  $('board').addEventListener('keydown', function (e) {
    var b = e.target.closest('.cell');
    if (b && (e.key === 's' || e.key === 'S')) { e.preventDefault(); placeToken(parseInt(b.getAttribute('data-i'), 10)); restoreFocus(b.getAttribute('data-i')); }
  });
  function restoreFocus(i) { var el = document.querySelector('.cell[data-i="' + i + '"]'); if (el) el.focus(); }
  $('btn-undo').addEventListener('click', undoX);
  $('btn-clear').addEventListener('click', clearX);
  $('btn-autox').addEventListener('click', toggleAutoX);
  $('btn-levels').addEventListener('click', function () { setHash(''); view = 'map'; message = ''; render(); window.scrollTo(0, 0); });
  $('btn-result-map').addEventListener('click', function () { setHash(''); view = 'map'; message = ''; render(); window.scrollTo(0, 0); });
  $('btn-result-main').addEventListener('click', function () {
    var act = this.getAttribute('data-act');
    if (act === 'next') startLevel(P.num + 1);
    else if (act === 'restart') startLevel(P.num);
    else if (act === 'daily') startDaily();
    else if (act === 'home') location.href = 'index.html';
    else { view = 'map'; render(); }
  });
  document.addEventListener('click', function (e) {
    var more = $('more');
    if (more.open && !more.classList.contains('inline') && !more.contains(e.target)) more.open = false;
  });

  var queued = false;
  function refit() {
    if (queued) return; queued = true;
    requestAnimationFrame(function () {
      queued = false;
      syncMoreMenu();
      if (view === 'play' && P) { var L = cur(), f = boardSize(L); if (L.n + ':' + f.cell !== lastFit) render(); }
    });
  }
  window.addEventListener('resize', refit);
  window.addEventListener('orientationchange', refit);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', refit);
  if (window.ResizeObserver) new ResizeObserver(refit).observe($('play'));
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', refit);

  /* ---------- boot ---------- */
  function boot(data) {
    var sp = load(PREFS_KEY);
    if (sp) {
      prefs.autoX = !!sp.autoX;
    }
    prefs.deck = App.getDeck();
    var pg = load(PROG_KEY);
    if (pg && pg.best) prog = { score: pg.score || 0, best: pg.best, fails: pg.fails || 0 };
    buildDeckPicker();
    applyTheme();
    var wantDaily = location.hash === '#daily' || !!(data && data.P && data.P.daily);
    var saved = data && data.P ? data : load(wantDaily ? DAILY_PLAY_KEY : PLAY_KEY);
    var ok = saved && saved.P && !saved.P.over && lvl(saved.P.num) && (wantDaily ? saved.P.daily === App.today() : !saved.P.daily);
    if (ok) {
      P = saved.P; view = 'play';
      message = P.daily ? 'Welcome back. Today\'s mission is where you left it.' : 'Welcome back. Level ' + P.num + ' is where you left it.';
    } else if (wantDaily) {
      startDaily(); return;
    } else {
      view = 'map';
      message = '';
    }
    render();
  }
  window.addEventListener('hashchange', function () {
    if (location.hash !== '#daily' || (P && P.daily && view === 'play')) return;
    var d = load(DAILY_PLAY_KEY);
    if (d && d.P && !d.P.over && d.P.daily === App.today()) { P = d.P; view = 'play'; message = 'Today\'s mission is where you left it.'; render(); }
    else startDaily();
  });
  var hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(function () { return view === 'play' && P && !P.over ? { P: P } : {}; });
  if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {});
})();
