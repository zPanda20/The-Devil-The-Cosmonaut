/* Shared pieces for the trick-taking games (Hearts, Spades): dealing, sorting, legal follow, trick winner,
 * and the four-seat table drawing. Seats: 0 = you (bottom), 1 = left, 2 = across (top), 3 = right; play goes 0 → 1 → 2 → 3.
 * Game state is plain JSON and every action names its seat, so a seat can later be driven by a remote player instead of a bot. */
(function () {
  'use strict';
  var T = window.Table;
  var SUIT_ORDER = { C: 0, D: 1, S: 2, H: 3 }, SUIT_NAME = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
  var SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };

  function rankV(c) { return c.v === 1 ? 14 : c.v; }   // Aces high
  function sortHand(h) {
    return h.slice().sort(function (a, b) { return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || rankV(a) - rankV(b); });
  }
  function dealHands() {
    var cards = T.shuffled(T.pack(), Math.random), hands = [[], [], [], []];
    cards.forEach(function (c, i) { hands[i % 4].push(c); });
    return hands.map(sortHand);
  }
  function same(a, b) { return a && b && a.rank === b.rank && a.suit === b.suit; }
  function has(hand, c) { return hand.some(function (x) { return same(x, c); }); }
  function without(hand, c) { return hand.filter(function (x) { return !same(x, c); }); }
  function ofSuit(hand, s) { return hand.filter(function (c) { return c.suit === s; }); }
  // Winner of a finished trick: plays = [{seat, card}], highest of the led suit unless trumped.
  function trickWinner(plays, trump) {
    var led = plays[0].card.suit, best = plays[0];
    plays.forEach(function (p) {
      var c = p.card, b = best.card;
      if (trump && c.suit === trump && b.suit !== trump) best = p;
      else if (c.suit === b.suit && rankV(c) > rankV(b)) best = p;
    });
    return best.seat;
  }
  function label(c) { return c.rank + SYM[c.suit]; }

  /* ---------- table drawing ---------- */
  // Geometry for a felt of w x h: card width, your hand line, the trick spots and opponent badges.
  function geometry(w, h, n) {
    var W = Math.round(Math.max(44, Math.min(112, w / 5.4, h / 4.6)));
    var H = T.height(W), lift = Math.round(H * 0.14);
    var step = n > 1 ? Math.min(Math.round(W * 0.62), Math.floor((w - W - 8) / (n - 1))) : 0;
    var handTop = h - H - 4;
    var topBand = Math.max(46, Math.round(H * 0.42));
    var cx = w / 2, cy = Math.round((topBand + handTop - lift) / 2) - Math.round(H * 0.08);
    var tw = Math.round(W * 0.92), th = T.height(tw);
    // Trick spots as a diamond: each card's centre sits toward its player.
    var dx = tw * 0.78, dy = th * 0.40;
    var spots = [[0, dy], [-dx, 0], [0, -dy], [dx, 0]].map(function (d) { return { x: Math.round(cx + d[0] - tw / 2), y: Math.round(cy + d[1] - th / 2) }; });
    var msgTop = Math.round(cy + dy + th / 2 + 8);
    return { W: W, H: H, lift: lift, step: step, handTop: handTop, topBand: topBand, cx: cx, cy: cy, tw: tw, th: th, spots: spots, msgTop: msgTop, w: w, h: h };
  }

  // Opponent badge: name, a few small card backs, and a line of status text.
  function badge(seat, name, count, status, G, active) {
    var bw = Math.round(G.W * 0.36), backs = '';
    var shown = Math.min(count, 13), step = Math.max(3, Math.round(bw * 0.28));
    for (var i = 0; i < shown; i++) backs += '<div style="position:absolute;left:' + (i * step) + 'px;top:0">' + T.back(bw) + '</div>';
    var bwTotal = shown ? bw + (shown - 1) * step : 0, bh = T.height(bw);
    var pos;
    if (seat === 2) pos = 'left:' + Math.round(G.cx - Math.max(bwTotal, 120) / 2) + 'px;top:0;align-items:center';
    else if (seat === 1) pos = 'left:0;top:' + Math.round(G.cy - bh / 2 - 26) + 'px;align-items:flex-start';
    else pos = 'right:0;top:' + Math.round(G.cy - bh / 2 - 26) + 'px;align-items:flex-end';
    return '<div class="seat' + (active ? ' active' : '') + '" data-seat="' + seat + '" style="' + pos + '">' +
      '<div class="seat-name">' + name + '</div>' +
      '<div class="seat-cards" style="position:relative;width:' + bwTotal + 'px;height:' + bh + 'px">' + backs + '</div>' +
      '<div class="seat-status">' + (status || '') + '</div></div>';
  }

  /* ---------- card motion ----------
   * FLIP animation across re-renders. Every card element carries data-key (its rank+suit).
   *   before(): remember where each keyed card is.
   *   after(fx): cards that moved slide from their old spot; new cards fly in from fx.from(key) (a seat);
   *              cards that vanished leave as ghosts toward fx.to(key). fx.delay(key, i) staggers. */
  function Animator(felt) {
    var prev = {}, ghosts = {}, busyUntil = 0;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function rel(el) { var r = el.getBoundingClientRect(), f = felt.getBoundingClientRect(); return { x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height }; }
    function seatRect(seat) {
      if (seat === 0) { var f = felt.getBoundingClientRect(); return { x: f.width / 2 - 30, y: f.height - 20, w: 60, h: 84 }; }
      if (seat === 'deck') { var g = felt.getBoundingClientRect(); return { x: g.width / 2 - 20, y: g.height / 2 - 28, w: 40, h: 56 }; }
      var el = felt.querySelector('.seat[data-seat="' + seat + '"] .seat-cards') || felt.querySelector('.seat[data-seat="' + seat + '"]');
      return el ? rel(el) : null;
    }
    function animate(el, from, to, ms, delay, fade, done) {
      busyUntil = Math.max(busyUntil, Date.now() + ms + delay);
      var sx = from.w / to.w;
      el.style.transition = 'none';
      el.style.transform = 'translate(' + (from.x - to.x) + 'px,' + (from.y - to.y) + 'px) scale(' + sx + ')';
      el.style.transformOrigin = '0 0';
      if (fade === 'in') el.style.opacity = '0.2';
      var oz = el.style.zIndex;
      el.style.zIndex = String(400 + (parseInt(oz, 10) || 0));
      void el.offsetWidth;
      el.style.transition = 'transform ' + ms + 'ms cubic-bezier(.2,.75,.25,1) ' + delay + 'ms, opacity ' + ms + 'ms ease ' + delay + 'ms';
      el.style.transform = '';
      el.style.opacity = '';
      setTimeout(function () { el.style.transition = ''; el.style.transformOrigin = ''; el.style.zIndex = oz; if (done) done(); }, ms + delay + 30);
    }
    return {
      // Milliseconds until the current motion ends. A re-render before then would cut it short.
      wait: function () { return Math.max(0, busyUntil - Date.now()); },
      before: function () {
        prev = {}; ghosts = {};
        if (reduce) return;
        Array.prototype.forEach.call(felt.querySelectorAll('[data-key]'), function (el) {
          var k = el.getAttribute('data-key');
          prev[k] = rel(el);
          ghosts[k] = el.outerHTML;
        });
      },
      after: function (fx) {
        if (reduce) return;
        fx = fx || {};
        var seen = {}, n = 0;
        Array.prototype.forEach.call(felt.querySelectorAll('[data-key]'), function (el) {
          var k = el.getAttribute('data-key'), to = rel(el), from = prev[k];
          seen[k] = true;
          var delay = fx.delay ? fx.delay(k, n) : 0;
          if (from) {
            if (Math.abs(from.x - to.x) > 1 || Math.abs(from.y - to.y) > 1 || Math.abs(from.w - to.w) > 1) animate(el, from, to, 300, delay);
          } else {
            var src = fx.from ? fx.from(k) : null, r = src != null ? seatRect(src) : null;
            if (r) animate(el, { x: r.x + r.w / 2 - to.w * 0.25, y: r.y + r.h / 2 - to.h * 0.25, w: to.w * 0.5 }, to, 360, delay, 'in');
          }
          n++;
        });
        // Cards that left the table glide toward fx.to(key) and fade.
        Object.keys(prev).forEach(function (k) {
          if (seen[k] || !fx.to) return;
          var dest = fx.to(k), r = dest != null ? seatRect(dest) : null;
          if (!r) return;
          var box = document.createElement('div'); box.innerHTML = ghosts[k];
          var gh = box.firstChild; gh.removeAttribute('data-key'); gh.style.pointerEvents = 'none';
          var p = prev[k];
          gh.style.left = p.x + 'px'; gh.style.top = p.y + 'px'; gh.style.transform = ''; gh.classList.remove('sel');
          felt.appendChild(gh);
          void gh.offsetWidth;
          gh.style.transition = 'transform 380ms cubic-bezier(.4,0,.6,1), opacity 380ms ease';
          gh.style.transformOrigin = '0 0';
          gh.style.transform = 'translate(' + (r.x + r.w / 2 - p.x - p.w * 0.2) + 'px,' + (r.y + r.h / 2 - p.y - p.h * 0.2) + 'px) scale(0.4)';
          gh.style.opacity = '0';
          setTimeout(function () { if (gh.parentNode) gh.parentNode.removeChild(gh); }, 420);
        });
      }
    };
  }
  function key(c) { return c.rank + c.suit; }
  // Standard motion for a trick table: new trick cards come from the player who played them, received cards from
  // whoever passed them, freshly dealt cards from the middle; collected cards go to the trick winner.
  function trickFx(G, opts) {
    opts = opts || {};
    var trickSeat = {};
    (G.trick || []).forEach(function (p) { trickSeat[key(p.card)] = p.seat; });
    var won = {};
    if (G.lastTrick) G.lastTrick.plays.forEach(function (p) { won[key(p.card)] = G.lastTrick.winner; });
    return {
      from: function (k) {
        if (k in trickSeat) return trickSeat[k];
        if (opts.received && opts.received[k] != null) return opts.received[k];
        return opts.dealing ? 'deck' : null;
      },
      to: function (k) { if (opts.passed && opts.passed[k] != null) return opts.passed[k]; return k in won ? won[k] : null; },
      delay: function (k, i) { return opts.dealing && !(k in trickSeat) ? i * 40 : 0; }
    };
  }

  window.Tricks = {
    Animator: Animator, key: key, trickFx: trickFx,
    rankV: rankV, sortHand: sortHand, dealHands: dealHands, same: same, has: has, without: without, ofSuit: ofSuit,
    trickWinner: trickWinner, label: label, SYM: SYM, SUIT_NAME: SUIT_NAME, geometry: geometry, badge: badge
  };
})();
