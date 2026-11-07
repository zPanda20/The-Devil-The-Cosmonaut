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
    return '<div class="seat' + (active ? ' active' : '') + '" style="' + pos + '">' +
      '<div class="seat-name">' + name + '</div>' +
      '<div style="position:relative;width:' + bwTotal + 'px;height:' + bh + 'px">' + backs + '</div>' +
      '<div class="seat-status">' + (status || '') + '</div></div>';
  }

  window.Tricks = {
    rankV: rankV, sortHand: sortHand, dealHands: dealHands, same: same, has: has, without: without, ofSuit: ofSuit,
    trickWinner: trickWinner, label: label, SYM: SYM, SUIT_NAME: SUIT_NAME, geometry: geometry, badge: badge
  };
})();
