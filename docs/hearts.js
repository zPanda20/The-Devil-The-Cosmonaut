/* Hearts: you against three computer players. Pass three, avoid hearts and the Queen of Spades, first to 100 ends it.
 * The rules engine (Core) is pure and seat-based, so any seat could later be a remote player instead of a Bot. */
(function () {
  'use strict';
  var T = window.Table, K = window.Tricks, App = window.App, $ = T.$;
  var GAME_KEY = 'hearts:game:v1', STATS_KEY = 'hearts:stats:v1', PREFS_KEY = 'hearts:prefs:v1';
  var NAMES = ['You', 'Lilith', 'Baron', 'Mephisto'];
  var DIR_NAME = ['left', 'right', 'across', 'none'];
  var QS = { rank: 'Q', suit: 'S' }, TWO_C = { rank: '2', suit: 'C' };

  function isQS(c) { return K.same(c, QS); }
  function pointsOf(c) { return c.suit === 'H' ? 1 : isQS(c) ? 13 : 0; }

  /* ---------- Core: rules ---------- */
  var Core = {
    newGame: function () { return { scores: [0, 0, 0, 0], handNo: 0, log: [], phase: 'start', moons: [0, 0, 0, 0] }; },
    startHand: function (G) {
      G.handNo++;
      G.hands = K.dealHands();
      G.passDir = (G.handNo - 1) % 4;
      G.passes = [null, null, null, null];
      G.received = [];
      G.taken = [[], [], [], []];
      G.trick = []; G.trickNo = 0; G.broken = false; G.qPlayed = false; G.lastTrick = null;
      G.phase = G.passDir === 3 ? 'play' : 'pass';
      if (G.phase === 'play') Core.beginPlay(G);
    },
    passTarget: function (G, seat) { return [(seat + 1) % 4, (seat + 3) % 4, (seat + 2) % 4][G.passDir]; },
    setPass: function (G, seat, cards) {
      if (G.phase !== 'pass' || cards.length !== 3 || !cards.every(function (c) { return K.has(G.hands[seat], c); })) return false;
      G.passes[seat] = cards;
      if (G.passes.every(Boolean)) Core.doPasses(G);
      return true;
    },
    doPasses: function (G) {
      var incoming = [[], [], [], []];
      for (var s = 0; s < 4; s++) {
        var to = Core.passTarget(G, s);
        G.passes[s].forEach(function (c) { G.hands[s] = K.without(G.hands[s], c); incoming[to].push(c); });
      }
      for (var t = 0; t < 4; t++) G.hands[t] = K.sortHand(G.hands[t].concat(incoming[t]));
      G.received = incoming[0];
      G.phase = 'play';
      Core.beginPlay(G);
    },
    beginPlay: function (G) {
      for (var s = 0; s < 4; s++) if (K.has(G.hands[s], TWO_C)) { G.leader = s; G.turn = s; }
    },
    legal: function (G, seat) {
      var hand = G.hands[seat];
      if (G.phase !== 'play' || G.turn !== seat) return [];
      if (!G.trick.length) {
        if (G.trickNo === 0) return hand.filter(function (c) { return K.same(c, TWO_C); });
        if (!G.broken) { var nh = hand.filter(function (c) { return c.suit !== 'H'; }); if (nh.length) return nh; }
        return hand.slice();
      }
      var led = G.trick[0].card.suit, follow = K.ofSuit(hand, led);
      if (follow.length) return follow;
      if (G.trickNo === 0) { var clean = hand.filter(function (c) { return !pointsOf(c); }); if (clean.length) return clean; }
      return hand.slice();
    },
    play: function (G, seat, card) {
      if (!Core.legal(G, seat).some(function (c) { return K.same(c, card); })) return false;
      G.hands[seat] = K.without(G.hands[seat], card);
      G.trick.push({ seat: seat, card: card });
      if (card.suit === 'H') G.broken = true;
      if (isQS(card)) G.qPlayed = true;
      if (G.trick.length === 4) { G.winner = K.trickWinner(G.trick); G.phase = 'trick'; }
      else G.turn = (seat + 1) % 4;
      return true;
    },
    collect: function (G) {
      var w = G.winner;
      G.trick.forEach(function (p) { G.taken[w].push(p.card); });
      G.lastTrick = { plays: G.trick, winner: w };
      G.trick = []; G.trickNo++; G.leader = w; G.turn = w;
      if (G.trickNo === 13) Core.endHand(G); else G.phase = 'play';
    },
    endHand: function (G) {
      var pts = G.taken.map(function (cs) { return cs.reduce(function (n, c) { return n + pointsOf(c); }, 0); });
      var moon = pts.indexOf(26);
      if (moon >= 0) { pts = [26, 26, 26, 26]; pts[moon] = 0; G.moons[moon]++; }
      for (var s = 0; s < 4; s++) G.scores[s] += pts[s];
      G.log.push({ pts: pts, moon: moon });
      G.handPts = pts; G.moonBy = moon;
      G.phase = Math.max.apply(null, G.scores) >= 100 ? 'over' : 'handover';
    },
    standings: function (G) {
      return [0, 1, 2, 3].sort(function (a, b) { return G.scores[a] - G.scores[b]; });
    }
  };

  /* ---------- Bot ---------- */
  var Bot = {
    pass: function (G, seat) {
      var hand = G.hands[seat], spades = K.ofSuit(hand, 'S').length;
      function danger(c) {
        var v = K.rankV(c), len = K.ofSuit(hand, c.suit).length;
        if (isQS(c)) return 100;
        if (c.suit === 'S') return v > 12 ? (spades <= 3 ? 90 : 20) : v / 2;
        if (c.suit === 'H') return 30 + v * 2;
        return v * 2 + (len <= 3 ? 12 : 0);
      }
      return hand.slice().sort(function (a, b) { return danger(b) - danger(a); }).slice(0, 3);
    },
    play: function (G, seat) {
      var L = Core.legal(G, seat), hand = G.hands[seat];
      var low = function (cs) { return cs.slice().sort(function (a, b) { return K.rankV(a) - K.rankV(b); })[0]; };
      var high = function (cs) { return cs.slice().sort(function (a, b) { return K.rankV(b) - K.rankV(a); })[0]; };
      if (L.length === 1) return L[0];
      if (!G.trick.length) {
        // Smoke out the Queen with low spades if we do not hold her or the A/K.
        var sp = K.ofSuit(L, 'S'), holdQ = K.has(hand, QS);
        var lowSp = sp.filter(function (c) { return K.rankV(c) < 12; });
        if (!holdQ && !G.qPlayed && lowSp.length && !sp.some(function (c) { return K.rankV(c) > 12; })) return high(lowSp);
        var bySuit = {};
        L.forEach(function (c) { if (c.suit !== 'H' && !(c.suit === 'S' && K.rankV(c) >= 12)) (bySuit[c.suit] = bySuit[c.suit] || []).push(c); });
        var suits = Object.keys(bySuit).sort(function (a, b) { return bySuit[a].length - bySuit[b].length; });
        if (suits.length) return low(bySuit[suits[0]]);
        return low(L);
      }
      var led = G.trick[0].card.suit;
      var winning = high(G.trick.filter(function (p) { return p.card.suit === led; }).map(function (p) { return p.card; }));
      var trickPts = G.trick.reduce(function (n, p) { return n + pointsOf(p.card); }, 0);
      if (L[0].suit === led) {
        var under = L.filter(function (c) { return K.rankV(c) < K.rankV(winning); });
        if (under.length) return high(under);
        var last = G.trick.length === 3;
        var safe = L.filter(function (c) { return !isQS(c); });
        if (last && trickPts === 0) return high(safe.length ? safe : L);
        return low(safe.length ? safe : L);
      }
      // Void in the led suit: unload danger.
      var q = L.filter(isQS)[0]; if (q) return q;
      if (!G.qPlayed) { var bigSp = L.filter(function (c) { return c.suit === 'S' && K.rankV(c) > 12; }); if (bigSp.length) return high(bigSp); }
      var hearts = K.ofSuit(L, 'H'); if (hearts.length) return high(hearts);
      return high(L);
    }
  };

  /* ---------- UI ---------- */
  var prefs = Object.assign({ quick: false }, T.load(PREFS_KEY) || {});
  var G = null, sel = [], timer = null, message = '';

  function save() { T.store(GAME_KEY, { G: G }); }
  var anim = K.Animator($('felt')), firstPaint = true, fx = {};   // fx: what the next render should animate
  function newGame() {
    clearTimeout(timer);
    G = Core.newGame(); Core.startHand(G); sel = []; fx = { dealing: true };
    message = '';
    T.result(null);
    step();
  }

  // Advance bots and timed phases until it is your move (or the hand/game is over).
  function step() {
    clearTimeout(timer);
    if (G.phase === 'pass') {
      for (var s = 1; s < 4; s++) if (!G.passes[s]) G.passes[s] = Bot.pass(G, s);
      return render();
    }
    if (G.phase === 'trick') {
      render();
      timer = setTimeout(function () { Core.collect(G); after(); }, 1050);
      return;
    }
    if (G.phase === 'play' && G.turn !== 0) {
      render();
      timer = setTimeout(function () { Core.play(G, G.turn, Bot.play(G, G.turn)); step(); }, 520);
      return;
    }
    render();
  }
  function after() {
    if (G.phase === 'handover' || G.phase === 'over') return handDone();
    step();
  }
  function handDone() {
    if (G.moonBy === 0) { var un = App.award('hearts', 40); G.unlocked = (G.unlocked || []).concat(un); }
    if (G.phase === 'over') finishGame();
    render();
  }
  function finishGame() {
    var order = Core.standings(G), place = order.indexOf(0);
    var st = T.stats(STATS_KEY);
    st.played++; if (place === 0) st.wins++;
    st.moons = (st.moons || 0) + (G.moons[0] || 0) - (G.countedMoons || 0);
    if (st.best == null || G.scores[0] < st.best) st.best = G.scores[0];
    T.store(STATS_KEY, st);
    G.points = [80, 30, 15, 5][place];
    var un = App.award('hearts', G.points);
    G.unlocked = (G.unlocked || []).concat(un);
    G.place = place;
  }

  function tapCard(i) {
    var card = G.hands[0][i];
    if (G.phase === 'pass') {
      var k = sel.findIndex(function (c) { return K.same(c, card); });
      if (k >= 0) sel.splice(k, 1); else if (sel.length < 3) sel.push(card); else { sel.shift(); sel.push(card); }
      return render();
    }
    if (G.phase !== 'play' || G.turn !== 0) return;
    var legal = Core.legal(G, 0).some(function (c) { return K.same(c, card); });
    if (!legal) { message = legalHint(); return render(); }
    if (prefs.quick || (sel.length && K.same(sel[0], card))) {
      sel = []; message = '';
      Core.play(G, 0, card); G.received = [];
      return step();
    }
    sel = [card]; render();
  }
  function legalHint() {
    if (G.trickNo === 0 && !G.trick.length) return 'The 2 of Clubs leads the first trick.';
    if (G.trick.length) {
      var led = G.trick[0].card.suit;
      if (K.ofSuit(G.hands[0], led).length) return 'You must follow ' + K.SUIT_NAME[led] + '.';
      if (G.trickNo === 0) return 'No points on the first trick while you have another card.';
    }
    if (!G.broken) return 'Hearts are not broken yet.';
    return '';
  }

  function act() {
    if (G.phase === 'pass') {
      if (sel.length !== 3) return;
      var passed = {}, to = Core.passTarget(G, 0);
      sel.forEach(function (c) { passed[K.key(c)] = to; });
      Core.setPass(G, 0, sel.slice()); sel = [];
      var from = [1, 2, 3].filter(function (x) { return Core.passTarget(G, x) === 0; })[0], received = {};
      G.received.forEach(function (c) { received[K.key(c)] = from; });
      fx = { passed: passed, received: received };
      message = 'You received ' + G.received.map(K.label).join(', ') + '.';
      return step();
    }
    if (G.phase === 'handover') { Core.startHand(G); sel = []; message = ''; G.handPts = null; fx = { dealing: true }; return step(); }
  }

  function centerText() {
    if (G.phase === 'pass') return 'Pass three cards <strong>' + DIR_NAME[G.passDir] + '</strong> to ' + NAMES[Core.passTarget(G, 0)] + '.' + (sel.length ? ' ' + sel.length + ' of 3 chosen.' : '');
    if (G.phase === 'trick') return NAMES[G.winner] + (G.winner === 0 ? ' take' : ' takes') + ' the trick.';
    if (G.phase === 'play' && G.turn === 0) return G.trickNo === 0 && !G.trick.length ? 'Lead the <strong>2♣</strong>.' : 'Your turn.' + (prefs.quick ? '' : ' Tap a card, then tap it again to play.');
    if (G.phase === 'play') return NAMES[G.turn] + ' is thinking…';
    if (G.phase === 'handover') {
      var t = G.moonBy >= 0 ? '<strong>' + NAMES[G.moonBy] + (G.moonBy === 0 ? ' shot' : ' shoots') + ' the moon!</strong> ' : '';
      return t + 'Hand ' + G.handNo + ': ' + G.handPts.map(function (p, s) { return NAMES[s] + ' ' + p; }).join(' · ');
    }
    return '';
  }

  var deferred = 0, userAction = false;   // taps always redraw at once; automatic redraws wait for motion
  function render() {
    if (!G) return;
    // Let cards finish moving; the deferred render picks up every change made meanwhile.
    clearTimeout(deferred);
    var wait = anim.wait();
    if (wait > 0 && !userAction) { deferred = setTimeout(render, wait + 15); return; }
    var felt = $('felt'), rm = T.room(felt, 360);
    var w = Math.min(rm.w, 980), h = Math.max(360, Math.min(rm.h, 760));
    var n = G.hands ? G.hands[0].length : 0, Gm = K.geometry(w, h, n), html = '';
    felt.style.width = w + 'px'; felt.style.height = h + 'px';
    // Opponents
    for (var s = 1; s < 4; s++) {
      var taken = G.taken ? G.taken[s].reduce(function (a, c) { return a + pointsOf(c); }, 0) : 0;
      html += K.badge(s, NAMES[s], G.hands ? G.hands[s].length : 0, G.scores[s] + ' pts' + (taken ? ' · +' + taken + ' this hand' : ''), Gm, G.phase === 'play' && G.turn === s);
    }
    // Trick (or the cards being passed)
    (G.trick || []).forEach(function (p, i) {
      var sp = Gm.spots[p.seat];
      html += '<div class="tcard" data-key="' + K.key(p.card) + '" style="left:' + Math.round(sp.x) + 'px;top:' + Math.round(sp.y) + 'px;z-index:' + (5 + i) + '">' + T.card(p.card, Gm.tw) + '</div>';
    });
    html += '<div class="center-msg" style="top:' + Gm.msgTop + 'px">' + centerText() + '</div>';
    // Your hand
    if (G.hands) {
      var hand = G.hands[0], legal = Core.legal(G, 0), total = Gm.W + Gm.step * Math.max(0, n - 1), x0 = Math.round((w - total) / 2);
      hand.forEach(function (c, i) {
        var isSel = sel.some(function (x) { return K.same(x, c); });
        var isLegal = G.phase === 'pass' || legal.some(function (x) { return K.same(x, c); });
        var dim = G.phase === 'play' && G.turn === 0 && !isLegal;
        var got = G.received && G.received.some(function (x) { return K.same(x, c); });
        html += '<button type="button" class="hit' + (isSel ? ' sel' : '') + (dim ? ' dim' : '') + (got ? ' got' : '') + '" data-i="' + i + '" data-key="' + K.key(c) + '" style="left:' + (x0 + i * Gm.step) + 'px;top:' + (Gm.handTop - (isSel ? Gm.lift : 0)) + 'px;width:' + Gm.W + 'px;height:' + Gm.H + 'px;z-index:' + (10 + i) + '" aria-label="' + c.rank + ' of ' + K.SUIT_NAME[c.suit] + '">' + T.card(c, Gm.W) + '</button>';
      });
    }
    anim.before();
    felt.innerHTML = html;
    if (!firstPaint || fx.dealing) anim.after(K.trickFx(G, fx));   // no motion when a saved game first appears
    firstPaint = false;
    fx = {};

    var taken0 = G.taken ? G.taken[0].reduce(function (a, c) { return a + pointsOf(c); }, 0) : 0;
    $('hud').innerHTML = NAMES.map(function (nm, s) { return '<span>' + nm + ' <b>' + G.scores[s] + '</b></span>'; }).join('') +
      '<span>Hand <b>' + G.handNo + '</b> · pass ' + DIR_NAME[G.passDir] + '</span>' + (taken0 ? '<span>Taken this hand <b>' + taken0 + '</b></span>' : '') + (G.broken ? '<span>Hearts broken</span>' : '');
    var btn = $('btn-act');
    if (G.phase === 'pass') { btn.hidden = false; btn.disabled = sel.length !== 3; btn.textContent = 'Pass ' + DIR_NAME[G.passDir]; }
    else if (G.phase === 'handover') { btn.hidden = false; btn.disabled = false; btn.textContent = 'Next hand'; }
    else btn.hidden = true;
    $('msg').innerHTML = message;
    // Score sheet
    var rows = G.log.map(function (l, i) { return '<tr><td>Hand ' + (i + 1) + (l.moon >= 0 ? ' · moon' : '') + '</td>' + l.pts.map(function (p) { return '<td>' + p + '</td>'; }).join('') + '</tr>'; }).join('');
    $('score-sheet').innerHTML = '<table class="scoretable"><thead><tr><th></th>' + NAMES.map(function (n) { return '<th>' + n + '</th>'; }).join('') + '</tr></thead><tbody>' + rows +
      '<tr><td><b>Total</b></td>' + G.scores.map(function (p) { return '<td><b>' + p + '</b></td>'; }).join('') + '</tr></tbody></table>';
    if (G.phase === 'over') {
      var order = Core.standings(G);
      T.result({ title: G.place === 0 ? 'You win' : ['', 'Second place', 'Third place', 'Last place'][G.place],
        text: order.map(function (s) { return NAMES[s] + ' ' + G.scores[s]; }).join(' · ') + '.', points: G.points, unlocked: G.unlocked });
    } else T.result(null);
    save();
  }

  /* ---------- events ---------- */
  $('felt').addEventListener('click', function (e) { userAction = true; try { feltClick(e); } finally { userAction = false; } });
  function feltClick(e) {
    var b = e.target.closest('.hit'); if (!b) return;
    tapCard(+b.getAttribute('data-i'));
  }
  $('btn-act').addEventListener('click', act);
  var confirmNew = 0;
  $('btn-new').addEventListener('click', function () {
    if (G && G.phase !== 'over' && G.handNo > 0 && (G.trickNo > 0 || G.handNo > 1) && Date.now() - confirmNew > 2500) {
      confirmNew = Date.now(); message = '<strong>Tap New game again</strong> to abandon this game (it counts as last place).'; return render();
    }
    if (G && G.phase !== 'over' && (G.trickNo > 0 || G.handNo > 1)) { var st = T.stats(STATS_KEY); st.played++; T.store(STATS_KEY, st); }
    newGame();
  });
  $('btn-again').addEventListener('click', newGame);
  var qb = $('btn-quick');
  function syncQuick() { qb.textContent = 'Quick play ' + (prefs.quick ? 'on' : 'off'); qb.setAttribute('aria-pressed', String(prefs.quick)); qb.classList.toggle('on', prefs.quick); }
  qb.addEventListener('click', function () { prefs.quick = !prefs.quick; T.store(PREFS_KEY, prefs); syncQuick(); render(); });
  syncQuick();

  window.HeartsCore = Core; window.HeartsBot = Bot;   // exposed for tests and a future multiplayer client
  T.init({ render: render });
  var saved = T.load(GAME_KEY);
  if (saved && saved.G && saved.G.phase && saved.G.phase !== 'over' && saved.G.hands) { G = saved.G; message = 'Welcome back.'; step(); }
  else newGame();
})();
