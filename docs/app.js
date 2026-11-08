/* The Devil & The Cosmonaut: shared layer for the home screen and every game.
 * Owns the equipped deck, the shared points bank and deck unlocks, deck art loading and the daily puzzle. Everything lives in this browser's storage. */
(function () {
  'use strict';
  var CE = window.CardEngine;
  var DECK_KEY = 'app:deck:v1', UNLOCK_KEY = 'app:unlocks:v1', DAILY_KEY = 'app:daily:v1';
  var STARTER = 'hellfire-pulp';

  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  function load(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }

  /* ---------- progress read from both games ---------- */
  function gripStats() { var s = load('devils-grip:stats:v1'); return { played: (s && s.played) || 0, wins: (s && s.wins) || 0, best: s && typeof s.best === 'number' ? s.best : null }; }
  function cosmoCleared() { var p = load('cosmo:progress:v1'), n = 0; if (p && p.best) for (var k in p.best) if (p.best[k]) n++; return n; }

  /* ---------- shared points: every game pays into one bank; decks unlock at thresholds ---------- */
  var POINTS_KEY = 'app:points:v1';
  var LADDER = [
    { id: 'hellfire-pulp', need: 0 },
    { id: 'blood-moon', need: 150 },
    { id: 'void-ink', need: 500 },
    { id: 'signal-orange', need: 1000 },
    { id: 'neon-riot', need: 1800 },
    { id: 'glitch-runner', need: 3000 },
    { id: 'carcosa-yellow', need: 4500 },
    { id: 'ultraviolet-rite', need: 6500 },
    { id: 'toxic-halftone', need: 9000 },
    { id: 'lilac-pixel', need: 12000 }
  ];
  var GAME_NAMES = { cosmo: 'Cosmonaut Sudoku', grip: "Devil's Grip", klondike: 'Klondike', pyramid: 'Pyramid', g2048: '2048', hearts: 'Hearts', spades: 'Spades' };

  // First run of the points system: convert progress made before it existed.
  function seedPoints() {
    var cp = load('cosmo:progress:v1'), g = gripStats();
    var by = { cosmo: Math.max(0, (cp && cp.score) || 0), grip: g.played * 15 + g.wins * 150 };
    var bank = { total: by.cosmo + by.grip, by: by };
    store(POINTS_KEY, bank);
    return bank;
  }
  function bank() { var b = load(POINTS_KEY); return b && typeof b.total === 'number' ? b : seedPoints(); }
  function points() { return bank().total; }
  function pointsBy(game) { return bank().by[game] || 0; }

  // Adds (or, with a negative amount, removes) points for a game. Returns the decks this unlocked.
  function award(game, amount) {
    var b = bank();
    amount = Math.round(amount || 0);
    b.total = Math.max(0, b.total + amount);
    b.by[game] = Math.max(0, (b.by[game] || 0) + amount);
    store(POINTS_KEY, b);
    return checkUnlocks();
  }

  function unlockState() { var u = load(UNLOCK_KEY); return { ids: (u && u.ids) || [STARTER], fresh: (u && u.fresh) || [] }; }

  // Records every newly earned deck and returns their ids (unlocks are permanent).
  function checkUnlocks() {
    var u = unlockState(), total = points(), gained = [];
    if (u.ids.indexOf(STARTER) < 0) u.ids.push(STARTER);
    LADDER.forEach(function (d) {
      if (u.ids.indexOf(d.id) < 0 && total >= d.need) { u.ids.push(d.id); u.fresh.push(d.id); gained.push(d.id); }
    });
    store(UNLOCK_KEY, u);
    return gained;
  }
  function isUnlocked(id) { return unlockState().ids.indexOf(id) >= 0; }
  function takeFresh() { var u = unlockState(), f = u.fresh; u.fresh = []; store(UNLOCK_KEY, u); return f; }

  function decks() {
    var u = unlockState(), total = points();
    return LADDER.map(function (d, i) {
      return { id: d.id, name: CE.getStyle(d.id).name, order: i, unlocked: u.ids.indexOf(d.id) >= 0, starter: d.id === STARTER,
        need: d.need, pct: d.need ? Math.min(1, total / d.need) : 1 };
    });
  }
  function nextDeck() {
    var list = decks();
    for (var i = 0; i < list.length; i++) if (!list[i].unlocked) return list[i];
    return null;
  }
  function deckNames(ids) { return ids.map(function (id) { return CE.getStyle(id).name; }); }
  function listText(names) { return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]; }
  function unlockMessage(ids) {
    if (!ids.length) return '';
    return '<strong>Deck unlocked: ' + listText(deckNames(ids)) + '.</strong> Equip ' + (ids.length > 1 ? 'them' : 'it') + ' from the deck menu or the home screen.';
  }
  // One line for a result panel: points earned and how far the next deck is.
  function pointsLine(earned) {
    var nd = nextDeck(), t = points();
    return (earned > 0 ? '+' + earned + ' points · ' : '') + t.toLocaleString() + ' total' +
      (nd ? ' · ' + (nd.need - t).toLocaleString() + ' to ' + nd.name : ' · every deck unlocked');
  }

  /* ---------- deck art: only the decks a page needs are loaded ---------- */
  var artState = {};
  function artLoaded(id) { var s = CE.getStyle(id); return !!(s.assets && s.assets.faces); }
  function ensureArt(id, cb) {
    if (artLoaded(id)) { if (cb) cb(); return; }
    var st = artState[id];
    if (!st) {
      st = artState[id] = { cbs: [] };
      var el = document.createElement('script');
      el.src = 'art-' + id + '.js';
      el.onload = el.onerror = function () { st.done = true; st.cbs.splice(0).forEach(function (f) { f(); }); };
      document.head.appendChild(el);
    }
    if (cb) { if (st.done) cb(); else st.cbs.push(cb); }
  }

  function getDeck() {
    var d = load(DECK_KEY);
    if (!d) { var old = load('devils-grip:prefs:v1'); d = old && old.deck; if (d && isUnlocked(d) && hasStyle(d)) store(DECK_KEY, d); }
    return d && isUnlocked(d) && hasStyle(d) ? d : STARTER;
  }
  // Accepts a deck id or a picker value "id|lite" (the lite flag is remembered per deck).
  function setDeck(val) {
    var p = String(val).split('|'), id = p[0];
    if (!(isUnlocked(id) && hasStyle(id))) return false;
    store(DECK_KEY, id);
    if (LITE_DECKS.indexOf(id) >= 0) setLite(id, p[1] === 'lite');
    return true;
  }

  /* ---------- lite art: simpler pictures, always used on small cards; optional everywhere ---------- */
  var LITE_KEY = 'app:lite:v1', LITE_DECKS = ['hellfire-pulp', 'neon-riot'];
  function liteMap() { return load(LITE_KEY) || {}; }
  function isLite(id) { return !!liteMap()[id]; }
  function setLite(id, on) { var m = liteMap(); m[id] = !!on; store(LITE_KEY, m); CE.setLite(id, !!on); }
  function hasLite(id) { return LITE_DECKS.indexOf(id) >= 0; }
  function deckValue(id) { id = id || getDeck(); return id + (hasLite(id) && isLite(id) ? '|lite' : ''); }
  (function () { var m = liteMap(); for (var k in m) if (m[k] && hasStyle(k)) CE.setLite(k, true); })();
  function hasStyle(id) { return CE.listStyles().some(function (s) { return s.id === id; }); }

  // Fills a <select> with every deck; locked ones are listed but disabled.
  function fillDeckSelect(sel, current) {
    sel.innerHTML = decks().map(function (d) {
      var opt = '<option value="' + d.id + '"' + (d.unlocked ? '' : ' disabled') + '>' + d.name + (d.unlocked ? '' : ' · locked') + '</option>';
      if (d.unlocked && hasLite(d.id)) opt += '<option value="' + d.id + '|lite">' + d.name + ' · Lite</option>';
      return opt;
    }).join('');
    sel.value = deckValue(String(current || getDeck()).split('|')[0]);
  }

  function applyTheme(id) {
    var s = CE.getStyle(id), t = s.theme, r = document.documentElement.style;
    CE.loadFonts(id);
    r.setProperty('--table', t.table); r.setProperty('--surface', t.surface); r.setProperty('--line', t.line);
    r.setProperty('--text', t.text); r.setProperty('--muted', t.muted); r.setProperty('--accent', t.accent);
    r.setProperty('--accent-text', t.accentText); r.setProperty('--warn', t.warn);
    r.setProperty('--display', t.display); r.setProperty('--ui', t.ui || t.display); r.setProperty('--body', t.body);
    r.setProperty('--display-size', t.displaySize || 'clamp(42px, 7vw, 68px)');
    r.setProperty('--ui-size', t.uiSize || '20px');
    r.setProperty('--body-size', t.bodySize || '14px');
    r.setProperty('color-scheme', t.scheme || 'dark');
  }

  /* ---------- daily puzzle ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return dateKey(new Date()); }
  function shiftDay(key, days) { var p = key.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2] + days); return dateKey(d); }
  function prettyDate(key) {
    var p = key.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    try { return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); } catch (e) { return key; }
  }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // The day's level is one of 41-200 (Orbit and Deep Space, 7x7 to 10x10), turned or mirrored so it never matches the level map.
  function dailyPick(key) {
    var h = hash('cosmo-daily:' + key);
    return { num: 41 + (h % 160), turn: (h >>> 8) % 8 };
  }
  function transformLevel(L, turn) {
    var n = L.n, reg = new Array(n * n), stars = [];
    function map(i) {
      var r = (i / n) | 0, c = i % n, t;
      if (turn & 4) c = n - 1 - c;                       // mirror
      for (var q = 0; q < (turn & 3); q++) { t = r; r = c; c = n - 1 - t; }   // quarter turns
      return r * n + c;
    }
    for (var i = 0; i < n * n; i++) reg[map(i)] = L.r.charAt(i);
    L.s.forEach(function (i) { stars.push(map(i)); });
    return { r: reg.join(''), s: stars.sort(function (a, b) { return a - b; }) };
  }

  function dailyState() { var d = load(DAILY_KEY); return { streak: (d && d.streak) || 0, bestStreak: (d && d.bestStreak) || 0, last: (d && d.last) || null, days: (d && d.days) || {} }; }
  function currentStreak() {
    var d = dailyState(), t = today();
    return d.last === t || d.last === shiftDay(t, -1) ? d.streak : 0;
  }
  function dailyResult(key) { return dailyState().days[key || today()] || null; }

  // Called once when a daily is solved. Returns true if this was the first clear for that date.
  function recordDaily(key, lives) {
    var d = dailyState();
    if (d.days[key]) { if (lives > d.days[key].lives) { d.days[key].lives = lives; store(DAILY_KEY, d); } return false; }
    d.days[key] = { lives: lives };
    if (key === today()) {
      d.streak = d.last === shiftDay(key, -1) ? d.streak + 1 : d.last === key ? d.streak : 1;
      d.last = key;
      if (d.streak > d.bestStreak) d.bestStreak = d.streak;
    }
    store(DAILY_KEY, d);
    return true;
  }

  window.App = {
    STARTER: STARTER,
    load: load, store: store,
    gripStats: gripStats, cosmoCleared: cosmoCleared,
    checkUnlocks: checkUnlocks, isUnlocked: isUnlocked, takeFresh: takeFresh, decks: decks, nextDeck: nextDeck,
    deckNames: deckNames, unlockMessage: unlockMessage, listText: listText,
    points: points, pointsBy: pointsBy, award: award, pointsLine: pointsLine, GAME_NAMES: GAME_NAMES,
    ensureArt: ensureArt, artLoaded: artLoaded,
    getDeck: getDeck, setDeck: setDeck, deckValue: deckValue, isLite: isLite, setLite: setLite, hasLite: hasLite, fillDeckSelect: fillDeckSelect, applyTheme: applyTheme,
    today: today, prettyDate: prettyDate, shiftDay: shiftDay,
    dailyPick: dailyPick, transformLevel: transformLevel,
    dailyState: dailyState, currentStreak: currentStreak, dailyResult: dailyResult, recordDaily: recordDaily
  };
  checkUnlocks();
  // Coming back with the browser's Back button can show a stale page; reload so deck and progress are current.
  window.addEventListener('pageshow', function (e) { if (e.persisted) location.reload(); });
})();
