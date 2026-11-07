/* Spades: you and Baron (across) against Lilith and Mephisto. Bid, make your contract, mind the bags, first to 500.
 * Core is pure and seat-based (seat 0 you, 1 left, 2 partner, 3 right) so seats can later be remote players. */
(function () {
  'use strict';
  var T = window.Table, K = window.Tricks, App = window.App, $ = T.$;
  var GAME_KEY = 'spades:game:v1', STATS_KEY = 'spades:stats:v1', PREFS_KEY = 'spades:prefs:v1';
  var NAMES = ['You', 'Lilith', 'Baron', 'Mephisto'], TEAM_NAME = ['Us', 'Them'];
  var WIN_AT = 500, LOSE_AT = -200;
  function team(seat) { return seat % 2; }

  /* ---------- Core: rules ---------- */
  var Core = {
    newGame: function () { return { scores: [0, 0], bags: [0, 0], handNo: 0, log: [], phase: 'start', nilsMade: [0, 0, 0, 0] }; },
    startHand: function (G) {
      G.handNo++;
      G.dealer = (G.handNo - 1) % 4;
      G.hands = K.dealHands();
      G.bids = [null, null, null, null];
      G.tricks = [0, 0, 0, 0];
      G.trick = []; G.trickNo = 0; G.broken = false;
      G.turn = (G.dealer + 1) % 4;
      G.phase = 'bid';
    },
    bid: function (G, seat, n) {
      if (G.phase !== 'bid' || G.turn !== seat || n < 0 || n > 13) return false;
      G.bids[seat] = n;
      if (G.bids.every(function (b) { return b !== null; })) { G.phase = 'play'; G.turn = (G.dealer + 1) % 4; }
      else G.turn = (seat + 1) % 4;
      return true;
    },
    legal: function (G, seat) {
      var hand = G.hands[seat];
      if (G.phase !== 'play' || G.turn !== seat) return [];
      if (!G.trick.length) {
        if (!G.broken) { var ns = hand.filter(function (c) { return c.suit !== 'S'; }); if (ns.length) return ns; }
        return hand.slice();
      }
      var f = K.ofSuit(hand, G.trick[0].card.suit);
      return f.length ? f : hand.slice();
    },
    play: function (G, seat, card) {
      if (!Core.legal(G, seat).some(function (c) { return K.same(c, card); })) return false;
      G.hands[seat] = K.without(G.hands[seat], card);
      G.trick.push({ seat: seat, card: card });
      if (card.suit === 'S') G.broken = true;
      if (G.trick.length === 4) { G.winner = K.trickWinner(G.trick, 'S'); G.phase = 'trick'; }
      else G.turn = (seat + 1) % 4;
      return true;
    },
    collect: function (G) {
      G.tricks[G.winner]++;
      G.lastTrick = { plays: G.trick, winner: G.winner };
      G.trick = []; G.trickNo++; G.turn = G.winner;
      if (G.trickNo === 13) Core.endHand(G); else G.phase = 'play';
    },
    // Team score for a hand: contract from non-nil bids, nil bonuses/penalties, bags.
    endHand: function (G) {
      var res = [0, 0], bagsGot = [0, 0], notes = [[], []];
      for (var t = 0; t < 2; t++) {
        var seats = [t, t + 2], contract = 0, took = 0;
        seats.forEach(function (s) {
          if (G.bids[s] === 0) {
            if (G.tricks[s] === 0) { res[t] += 100; notes[t].push(NAMES[s] + ' nil made'); G.nilsMade[s]++; }
            else { res[t] -= 100; notes[t].push(NAMES[s] + ' nil failed'); bagsGot[t] += G.tricks[s]; }
          } else { contract += G.bids[s]; took += G.tricks[s]; }
        });
        if (contract > 0) {
          if (took >= contract) { res[t] += contract * 10 + (took - contract); bagsGot[t] += took - contract; }
          else { res[t] -= contract * 10; notes[t].push('set'); }
        }
        G.bags[t] += bagsGot[t];
        while (G.bags[t] >= 10) { G.bags[t] -= 10; res[t] -= 100; notes[t].push('10 bags −100'); }
        G.scores[t] += res[t];
      }
      G.handRes = res; G.handNotes = notes;
      G.log.push({ bids: G.bids.slice(), tricks: G.tricks.slice(), res: res.slice(), notes: notes });
      var over = G.scores.some(function (s) { return s >= WIN_AT || s <= LOSE_AT; }) && G.scores[0] !== G.scores[1];
      G.phase = over ? 'over' : 'handover';
    },
    winnerTeam: function (G) {
      if (G.scores[0] <= LOSE_AT) return 1;
      if (G.scores[1] <= LOSE_AT) return 0;
      return G.scores[0] > G.scores[1] ? 0 : 1;
    }
  };

  /* ---------- Bot ---------- */
  var Bot = {
    bid: function (G, seat) {
      var hand = G.hands[seat], est = 0;
      var bySuit = { S: [], H: [], D: [], C: [] };
      hand.forEach(function (c) { bySuit[c.suit].push(K.rankV(c)); });
      ['H', 'D', 'C'].forEach(function (s) {
        var v = bySuit[s], len = v.length;
        if (v.indexOf(14) >= 0) est += len <= 5 ? 1 : 0.6;
        if (v.indexOf(13) >= 0 && len >= 2) est += len <= 4 ? 0.8 : 0.4;
        if (v.indexOf(12) >= 0 && len >= 3 && len <= 4) est += 0.3;
      });
      var sp = bySuit.S, nS = sp.length;
      sp.forEach(function (v) { if (v === 14) est += 1; else if (v === 13 && nS >= 2) est += 0.95; else if (v === 12 && nS >= 3) est += 0.7; });
      if (nS > 3) est += (nS - 3) * 0.8;
      ['H', 'D', 'C'].forEach(function (s) { var len = bySuit[s].length; if (nS >= 2) { if (len === 0) est += 1; else if (len === 1) est += 0.5; } });
      var partner = G.bids[(seat + 2) % 4];
      var highs = hand.filter(function (c) { return K.rankV(c) >= 12; }).length, topSpade = nS ? Math.max.apply(null, sp) : 0;
      if (est < 1 && highs <= 1 && topSpade <= 9 && partner !== 0) return 0;
      var n = Math.max(1, Math.round(est * 1.1 + 0.15));   // raw counts run low against these bots' play
      if (partner === 0) n = Math.max(n, Math.round(est + 0.6));
      return Math.min(13, n);
    },
    play: function (G, seat) {
      var L = Core.legal(G, seat);
      if (L.length === 1) return L[0];
      var me = seat, pard = (seat + 2) % 4, t = team(seat);
      var low = function (cs) { return cs.slice().sort(function (a, b) { return K.rankV(a) - K.rankV(b) || (a.suit === 'S') - (b.suit === 'S'); })[0]; };
      var high = function (cs) { return cs.slice().sort(function (a, b) { return K.rankV(b) - K.rankV(a); })[0]; };
      var amNil = G.bids[me] === 0, pardNil = G.bids[pard] === 0;
      var teamBid = (amNil ? 0 : G.bids[me]) + (pardNil ? 0 : G.bids[pard]);
      var teamTook = (amNil ? 0 : G.tricks[me]) + (pardNil ? 0 : G.tricks[pard]);
      var needTricks = teamTook < teamBid;
      function beats(c, best) {
        if (c.suit === best.suit) return K.rankV(c) > K.rankV(best);
        return c.suit === 'S';
      }
      if (!G.trick.length) {
        if (amNil) return low(L);
        var aces = L.filter(function (c) { return c.suit !== 'S' && K.rankV(c) === 14; });
        if (aces.length && needTricks) return aces[0];
        var spades = K.ofSuit(L, 'S');
        if (G.broken && spades.length >= 4 && needTricks) return high(spades);
        var bySuit = {};
        L.forEach(function (c) { if (c.suit !== 'S') (bySuit[c.suit] = bySuit[c.suit] || []).push(c); });
        var suits = Object.keys(bySuit).sort(function (a, b) { return bySuit[b].length - bySuit[a].length; });
        return suits.length ? low(bySuit[suits[0]]) : low(L);
      }
      var bestPlay = G.trick[0];
      G.trick.forEach(function (p) { if (beats(p.card, bestPlay.card)) bestPlay = p; });
      var best = bestPlay.card;
      var winners = L.filter(function (c) { return beats(c, best); }), losers = L.filter(function (c) { return !beats(c, best); });
      if (amNil) return losers.length ? high(losers) : low(L);
      var pardWinning = bestPlay.seat === pard, last = G.trick.length === 3;
      // Cover a nil partner: win the trick if partner is currently winning or has yet to play.
      if (pardNil && (pardWinning || !G.trick.some(function (p) { return p.seat === pard; })) && winners.length) return pardWinning ? low(winners) : high(winners);
      if (pardWinning && (last || K.rankV(best) >= 13 || best.suit === 'S')) return low(losers.length ? losers : L);
      if (winners.length && needTricks) {
        // Win as cheaply as possible; if second/third to play and not trumping, play the top card.
        var cheap = low(winners);
        if (!last && cheap.suit !== 'S' && cheap.suit === best.suit) return high(winners);
        return cheap;
      }
      return low(losers.length ? losers : L);
    }
  };

  /* ---------- UI ---------- */
  var prefs = Object.assign({ quick: false }, T.load(PREFS_KEY) || {});
  var G = null, sel = null, timer = null, message = '';

  function save() { T.store(GAME_KEY, { G: G }); }
  function newGame() {
    clearTimeout(timer);
    G = Core.newGame(); Core.startHand(G); sel = null; message = '';
    T.result(null);
    step();
  }
  function step() {
    clearTimeout(timer);
    if (G.phase === 'bid' && G.turn !== 0) { render(); timer = setTimeout(function () { Core.bid(G, G.turn, Bot.bid(G, G.turn)); step(); }, 450); return; }
    if (G.phase === 'trick') { render(); timer = setTimeout(function () { Core.collect(G); after(); }, 1050); return; }
    if (G.phase === 'play' && G.turn !== 0) { render(); timer = setTimeout(function () { Core.play(G, G.turn, Bot.play(G, G.turn)); step(); }, 520); return; }
    render();
  }
  function after() {
    if (G.phase === 'handover' || G.phase === 'over') {
      if (G.bids[0] === 0 && G.tricks[0] === 0) { var un = App.award('spades', 30); G.unlocked = (G.unlocked || []).concat(un); }
      if (G.phase === 'over') finishGame();
      return render();
    }
    step();
  }
  function finishGame() {
    var won = Core.winnerTeam(G) === 0, st = T.stats(STATS_KEY);
    st.played++; if (won) st.wins++;
    st.nils = (st.nils || 0) + G.nilsMade[0];
    T.store(STATS_KEY, st);
    G.points = won ? 100 : 20;
    var un = App.award('spades', G.points);
    G.unlocked = (G.unlocked || []).concat(un);
    G.won = won;
  }

  function tapCard(i) {
    var card = G.hands[0][i];
    if (G.phase !== 'play' || G.turn !== 0) return;
    if (!Core.legal(G, 0).some(function (c) { return K.same(c, card); })) {
      var led = G.trick.length ? G.trick[0].card.suit : null;
      message = led && K.ofSuit(G.hands[0], led).length ? 'You must follow ' + K.SUIT_NAME[led] + '.' : 'Spades are not broken yet.';
      return render();
    }
    if (prefs.quick || (sel && K.same(sel, card))) { sel = null; message = ''; Core.play(G, 0, card); return step(); }
    sel = card; render();
  }

  function teamLine(t) {
    var s = [t, t + 2], bid = 0, nil = [];
    s.forEach(function (x) { if (G.bids[x] === 0) nil.push(NAMES[x]); else if (G.bids[x] != null) bid += G.bids[x]; });
    return bid;
  }

  function centerText() {
    if (G.phase === 'bid') return G.turn === 0 ? 'Your bid. Baron bid ' + (G.bids[2] == null ? '—' : G.bids[2] === 0 ? 'nil' : G.bids[2]) + '.' : NAMES[G.turn] + ' is bidding…';
    if (G.phase === 'trick') return NAMES[G.winner] + (G.winner === 0 ? ' take' : ' takes') + ' the trick.';
    if (G.phase === 'play' && G.turn === 0) return 'Your turn.' + (prefs.quick ? '' : ' Tap a card, then tap it again to play.');
    if (G.phase === 'play') return NAMES[G.turn] + ' is thinking…';
    if (G.phase === 'handover') return 'Hand ' + G.handNo + ': Us ' + sign(G.handRes[0]) + ' · Them ' + sign(G.handRes[1]) +
      (G.handNotes[0].length ? ' (' + G.handNotes[0].join(', ') + ')' : '');
    return '';
  }
  function sign(n) { return (n > 0 ? '+' : '') + n; }
  function bidText(s) { var b = G.bids[s]; return b == null ? '' : (b === 0 ? 'Nil' : 'Bid ' + b) + (G.phase !== 'bid' ? ' · won ' + G.tricks[s] : ''); }

  function render() {
    if (!G) return;
    var felt = $('felt'), rm = T.room(felt, 360);
    var w = Math.min(rm.w, 980), h = Math.max(380, Math.min(rm.h, 760));
    var n = G.hands[0].length, Gm = K.geometry(w, h, n), html = '';
    felt.style.width = w + 'px'; felt.style.height = h + 'px';
    for (var s = 1; s < 4; s++) html += K.badge(s, NAMES[s] + (s === 2 ? ' · partner' : ''), G.hands[s].length, bidText(s), Gm, (G.phase === 'play' || G.phase === 'bid') && G.turn === s);
    G.trick.forEach(function (p) {
      var sp = Gm.spots[p.seat];
      html += '<div class="tcard" style="left:' + sp.x + 'px;top:' + sp.y + 'px">' + T.card(p.card, Gm.tw) + '</div>';
    });
    html += '<div class="center-msg" style="top:' + Gm.msgTop + 'px">' + centerText() + (G.bids[0] != null ? '<br>' + bidText(0) : '') + '</div>';
    if (G.phase === 'bid' && G.turn === 0) {
      var est = Bot.bid(G, 0), btns = '<button type="button" class="btn nil" data-bid="0">Nil</button>';
      for (var b = 1; b <= 13; b++) btns += '<button type="button" class="btn' + (b === est ? ' on' : '') + '" data-bid="' + b + '">' + b + '</button>';
      html += '<div class="bidbox" style="top:' + Math.max(Gm.topBand, Gm.cy - Math.round(Gm.th * 0.9)) + 'px"><p>How many tricks will you take? Partner: ' + (G.bids[2] == null ? 'not bid yet' : G.bids[2] === 0 ? 'nil' : G.bids[2]) +
        '. Opponents: ' + [1, 3].map(function (x) { return G.bids[x] == null ? '—' : G.bids[x] === 0 ? 'nil' : G.bids[x]; }).join(' and ') + '. The highlighted number is a suggestion.</p><div class="bidgrid">' + btns + '</div></div>';
    }
    var hand = G.hands[0], legal = Core.legal(G, 0), total = Gm.W + Gm.step * Math.max(0, n - 1), x0 = Math.round((w - total) / 2);
    hand.forEach(function (c, i) {
      var isSel = sel && K.same(sel, c), isLegal = legal.some(function (x) { return K.same(x, c); });
      var dim = G.phase === 'play' && G.turn === 0 && !isLegal;
      html += '<button type="button" class="hit' + (isSel ? ' sel' : '') + (dim ? ' dim' : '') + '" data-i="' + i + '" style="left:' + (x0 + i * Gm.step) + 'px;top:' + (Gm.handTop - (isSel ? Gm.lift : 0)) + 'px;width:' + Gm.W + 'px;height:' + Gm.H + 'px;z-index:' + (10 + i) + '" aria-label="' + c.rank + ' of ' + K.SUIT_NAME[c.suit] + '">' + T.card(c, Gm.W) + '</button>';
    });
    felt.innerHTML = html;

    $('hud').innerHTML = [0, 1].map(function (t) { return '<span>' + TEAM_NAME[t] + ' <b>' + G.scores[t] + '</b> · bags ' + G.bags[t] + (G.phase !== 'bid' ? ' · contract ' + teamLine(t) : '') + '</span>'; }).join('') +
      '<span>Hand <b>' + G.handNo + '</b></span>' + (G.broken ? '<span>Spades broken</span>' : '');
    var btn = $('btn-act');
    if (G.phase === 'handover') { btn.hidden = false; btn.disabled = false; btn.textContent = 'Next hand'; } else btn.hidden = true;
    $('msg').innerHTML = message;
    var rows = G.log.map(function (l, i) {
      return '<tr><td>Hand ' + (i + 1) + '</td><td>' + [0, 2].map(function (s) { return l.bids[s] === 0 ? 'nil' : l.bids[s]; }).join('+') + ' / ' + (l.tricks[0] + l.tricks[2]) + '</td><td>' + sign(l.res[0]) +
        '</td><td>' + [1, 3].map(function (s) { return l.bids[s] === 0 ? 'nil' : l.bids[s]; }).join('+') + ' / ' + (l.tricks[1] + l.tricks[3]) + '</td><td>' + sign(l.res[1]) + '</td></tr>';
    }).join('');
    $('score-sheet').innerHTML = '<table class="scoretable"><thead><tr><th></th><th>Us bid / took</th><th>Us</th><th>Them bid / took</th><th>Them</th></tr></thead><tbody>' + rows +
      '<tr><td><b>Total</b></td><td></td><td><b>' + G.scores[0] + '</b></td><td></td><td><b>' + G.scores[1] + '</b></td></tr></tbody></table>';
    if (G.phase === 'over') T.result({ title: G.won ? 'You and Baron win' : 'Lilith and Mephisto win', text: 'Final score: Us ' + G.scores[0] + ', Them ' + G.scores[1] + '.', points: G.points, unlocked: G.unlocked });
    else T.result(null);
    save();
  }

  $('felt').addEventListener('click', function (e) {
    var bb = e.target.closest('[data-bid]');
    if (bb) { if (G.phase === 'bid' && G.turn === 0) { Core.bid(G, 0, +bb.getAttribute('data-bid')); message = ''; step(); } return; }
    var b = e.target.closest('.hit'); if (b) tapCard(+b.getAttribute('data-i'));
  });
  $('btn-act').addEventListener('click', function () { if (G.phase === 'handover') { Core.startHand(G); sel = null; message = ''; step(); } });
  var confirmNew = 0;
  $('btn-new').addEventListener('click', function () {
    if (G && G.phase !== 'over' && (G.handNo > 1 || G.trickNo > 0) && Date.now() - confirmNew > 2500) {
      confirmNew = Date.now(); message = '<strong>Tap New game again</strong> to abandon this game (it counts as a loss).'; return render();
    }
    if (G && G.phase !== 'over' && (G.handNo > 1 || G.trickNo > 0)) { var st = T.stats(STATS_KEY); st.played++; T.store(STATS_KEY, st); }
    newGame();
  });
  $('btn-again').addEventListener('click', newGame);
  var qb = $('btn-quick');
  function syncQuick() { qb.textContent = 'Quick play ' + (prefs.quick ? 'on' : 'off'); qb.setAttribute('aria-pressed', String(prefs.quick)); qb.classList.toggle('on', prefs.quick); }
  qb.addEventListener('click', function () { prefs.quick = !prefs.quick; T.store(PREFS_KEY, prefs); syncQuick(); render(); });
  syncQuick();

  window.SpadesCore = Core; window.SpadesBot = Bot;
  T.init({ render: render });
  var saved = T.load(GAME_KEY);
  if (saved && saved.G && saved.G.hands && saved.G.phase !== 'over') { G = saved.G; message = 'Welcome back.'; step(); }
  else newGame();
})();
