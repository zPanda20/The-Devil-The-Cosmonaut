/* Shared table helpers for the newer games (Klondike, Pyramid, 2048, Hearts, Spades).
 * Handles the equipped deck and theme, the deck picker and More menu, saved state, stats, and the result panel.
 * Each game calls Table.init({...}) once and draws its own felt. */
(function () {
  'use strict';
  var CE = window.CardEngine, App = window.App;
  var cfg = null, deckId = App.getDeck();

  function $(id) { return document.getElementById(id); }
  function load(k) { return App.load(k); }
  function store(k, v) { App.store(k, v); }

  function applyTheme() {
    App.applyTheme(deckId);
    var sel = $('deck'); if (sel && sel.value !== deckId) sel.value = deckId;
  }

  // The More menu sits inline on wide screens and folds into a button elsewhere (same rule as Devil's Grip).
  function syncMore() {
    var more = $('more'); if (!more) return;
    var w = document.documentElement.clientWidth, h = window.innerHeight;
    var slim = (h <= 760 && w >= 600) || (h <= 1000 && w >= 900);
    var inline = w >= (slim ? 1360 : 1000);
    more.classList.toggle('inline', inline);
    if (inline) more.open = true;
  }

  function init(c) {
    cfg = c;
    var sel = $('deck');
    if (sel) {
      App.fillDeckSelect(sel, deckId);
      sel.addEventListener('change', function () {
        if (!App.setDeck(sel.value)) { sel.value = deckId; return; }
        deckId = sel.value;
        applyTheme();
        cfg.render();
        App.ensureArt(deckId, cfg.render);
      });
    }
    document.addEventListener('click', function (e) {
      var more = $('more');
      if (more && more.open && !more.classList.contains('inline') && !more.contains(e.target)) more.open = false;
    });
    var t = 0;
    window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(function () { syncMore(); cfg.render(); }, 80); });
    applyTheme();
    syncMore();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { cfg.render(); });
  }

  // Space left for the felt below its top edge, inside the viewport.
  function room(el, minH) {
    var top = el.getBoundingClientRect().top + window.scrollY, par = el.parentNode, cs = getComputedStyle(par);
    var w = par.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { w: Math.floor(w), h: Math.max(minH || 280, window.innerHeight - top - 12) };
  }

  function card(c, w) { return CE.renderCard(c, deckId, { width: w }); }
  function back(w) { return CE.renderBack(deckId, { width: w }); }
  function height(w) { return CE.heightFor(w); }

  // Stats: { played, wins, best, streak, ... } per game key.
  function stats(key) { return load(key) || { played: 0, wins: 0 }; }

  // Result panel: title, text, points line, unlocks.
  function result(opts) {
    var res = $('result');
    if (!opts) { res.hidden = true; return; }
    $('result-title').textContent = opts.title;
    $('result-text').textContent = opts.text + (opts.points != null ? ' ' + App.pointsLine(opts.points) + '.' : '');
    var un = opts.unlocked && opts.unlocked.length;
    $('result-unlock').innerHTML = un ? App.unlockMessage(opts.unlocked) : '';
    $('result-unlock').hidden = !un;
    if (un) App.fillDeckSelect($('deck'), deckId);
    res.hidden = false;
  }

  // Seeded random numbers (mulberry32) and shuffles, so a deal can be replayed or chosen from a known list.
  function rng(seed) {
    var a = seed >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function shuffled(cards, rand) {
    var a = cards.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // One 52-card pack as {rank, suit, id}. Order matches the offline solver in tools/.
  function pack() {
    var out = [], ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    ['S', 'H', 'D', 'C'].forEach(function (s) { ranks.forEach(function (r, i) { out.push({ rank: r, suit: s, v: i + 1, id: r + s }); }); });
    return out;
  }
  function isRed(c) { return c.suit === 'H' || c.suit === 'D'; }

  window.Table = {
    init: init, deck: function () { return deckId; }, room: room, card: card, back: back, height: height,
    stats: stats, result: result, load: load, store: store, $: $, rng: rng, shuffled: shuffled, pack: pack, isRed: isRed,
    peek: function (w) { return CE.peek(deckId, w); }, compact: function (w) { return CE.isCompact(deckId, w); },
    fan: function (w) { return CE.fanOffset(deckId, w); }
  };
})();
