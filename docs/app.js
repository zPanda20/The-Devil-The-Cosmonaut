/* The Devil & The Cosmonaut: shared layer for the home screen and both games.
 * Owns the equipped deck, the deck unlock ladder and the daily puzzle. Everything lives in this browser's storage. */
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

  /* ---------- unlock ladder: any one route unlocks the deck ---------- */
  // kind: cosmo = Cosmonaut levels cleared · played = Devil's Grip games finished · best = finish with at most N cards left
  //       wins = perfect grips · streak = best daily streak
  var LADDER = [
    { id: 'hellfire-pulp', routes: [] },
    { id: 'blood-moon', routes: [['cosmo', 10], ['played', 3]] },
    { id: 'void-ink', routes: [['cosmo', 40], ['best', 10]] },
    { id: 'signal-orange', routes: [['cosmo', 70], ['best', 8], ['streak', 3]] },
    { id: 'neon-riot', routes: [['cosmo', 120], ['best', 6]] },
    { id: 'glitch-runner', routes: [['cosmo', 160], ['best', 5], ['streak', 7]] },
    { id: 'carcosa-yellow', routes: [['cosmo', 200], ['best', 3]] },
    { id: 'ultraviolet-rite', routes: [['cosmo', 240], ['best', 2], ['streak', 14]] },
    { id: 'toxic-halftone', routes: [['cosmo', 270], ['wins', 1]] },
    { id: 'lilac-pixel', routes: [['cosmo', 330], ['wins', 5], ['streak', 30]] }
  ];

  function snapshot() { var g = gripStats(); return { cosmo: cosmoCleared(), played: g.played, best: g.best, wins: g.wins, streak: dailyState().bestStreak || 0 }; }

  function routeInfo(route, snap) {
    var kind = route[0], need = route[1], have, met, text, status;
    if (kind === 'cosmo') { have = snap.cosmo; met = have >= need; text = need === 330 ? 'Clear all 330 Cosmonaut levels' : 'Clear ' + need + ' Cosmonaut levels'; status = Math.min(have, need) + ' / ' + need; }
    else if (kind === 'played') { have = snap.played; met = have >= need; text = 'Finish ' + need + " games of Devil's Grip"; status = Math.min(have, need) + ' / ' + need; }
    else if (kind === 'best') { have = snap.best; met = have !== null && have <= need; text = "Finish Devil's Grip with " + need + ' or fewer cards left'; status = have === null ? 'no finished game yet' : 'best ' + have + ' left'; }
    else if (kind === 'wins') { have = snap.wins; met = have >= need; text = need === 1 ? "Get a perfect grip in Devil's Grip" : 'Get ' + need + ' perfect grips'; status = Math.min(have, need) + ' / ' + need; }
    else { have = snap.streak; met = have >= need; text = 'Reach a ' + need + '-day daily streak'; status = 'best ' + have + (have === 1 ? ' day' : ' days'); }
    var pct = kind === 'best' ? (have === null ? 0 : Math.max(0, Math.min(1, (20 - have) / (20 - need)))) : Math.min(1, (have || 0) / need);
    return { kind: kind, need: need, text: text, status: status, met: met, pct: pct };
  }

  function unlockState() { var u = load(UNLOCK_KEY); return { ids: (u && u.ids) || [STARTER], fresh: (u && u.fresh) || [] }; }

  // Records every newly earned deck and returns their ids (unlocks are permanent).
  function checkUnlocks() {
    var u = unlockState(), snap = snapshot(), gained = [];
    if (u.ids.indexOf(STARTER) < 0) u.ids.push(STARTER);
    LADDER.forEach(function (d) {
      if (u.ids.indexOf(d.id) >= 0) return;
      if (d.routes.some(function (r) { return routeInfo(r, snap).met; })) { u.ids.push(d.id); u.fresh.push(d.id); gained.push(d.id); }
    });
    store(UNLOCK_KEY, u);
    return gained;
  }
  function isUnlocked(id) { return unlockState().ids.indexOf(id) >= 0; }
  function takeFresh() { var u = unlockState(), f = u.fresh; u.fresh = []; store(UNLOCK_KEY, u); return f; }

  function decks() {
    var u = unlockState(), snap = snapshot();
    return LADDER.map(function (d, i) {
      return { id: d.id, name: CE.getStyle(d.id).name, order: i, unlocked: u.ids.indexOf(d.id) >= 0, starter: d.id === STARTER,
        routes: d.routes.map(function (r) { return routeInfo(r, snap); }) };
    });
  }
  function deckNames(ids) { return ids.map(function (id) { return CE.getStyle(id).name; }); }
  function listText(names) { return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]; }
  function unlockMessage(ids) {
    if (!ids.length) return '';
    return '<strong>Deck unlocked: ' + listText(deckNames(ids)) + '.</strong> Equip ' + (ids.length > 1 ? 'them' : 'it') + ' from the deck menu or the home screen.';
  }

  function getDeck() {
    var d = load(DECK_KEY);
    if (!d) { var old = load('devils-grip:prefs:v1'); d = old && old.deck; if (d && isUnlocked(d) && hasStyle(d)) store(DECK_KEY, d); }
    return d && isUnlocked(d) && hasStyle(d) ? d : STARTER;
  }
  function setDeck(id) { if (isUnlocked(id) && hasStyle(id)) { store(DECK_KEY, id); return true; } return false; }
  function hasStyle(id) { return CE.listStyles().some(function (s) { return s.id === id; }); }

  // Fills a <select> with every deck; locked ones are listed but disabled.
  function fillDeckSelect(sel, current) {
    sel.innerHTML = decks().map(function (d) {
      return '<option value="' + d.id + '"' + (d.unlocked ? '' : ' disabled') + '>' + d.name + (d.unlocked ? '' : ' · locked') + '</option>';
    }).join('');
    sel.value = current;
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
    checkUnlocks: checkUnlocks, isUnlocked: isUnlocked, takeFresh: takeFresh, decks: decks,
    deckNames: deckNames, unlockMessage: unlockMessage, listText: listText,
    getDeck: getDeck, setDeck: setDeck, fillDeckSelect: fillDeckSelect, applyTheme: applyTheme,
    today: today, prettyDate: prettyDate, shiftDay: shiftDay,
    dailyPick: dailyPick, transformLevel: transformLevel,
    dailyState: dailyState, currentStreak: currentStreak, dailyResult: dailyResult, recordDaily: recordDaily
  };
  checkUnlocks();
  // Coming back with the browser's Back button can show a stale page; reload so deck and progress are current.
  window.addEventListener('pageshow', function (e) { if (e.persisted) location.reload(); });
})();
