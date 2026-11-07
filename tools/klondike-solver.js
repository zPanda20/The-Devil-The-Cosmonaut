'use strict';
/* Offline Klondike solver. Finds deal seeds that can be won (draw 1 and draw 3, unlimited redeals),
 * so the game's "winnable deals only" option can hand them out instantly.
 * The shuffle and deal must match src/table.js and src/klondike.js exactly.
 *   node klondike-solver.js <count per mode>   -> writes ../src/klondike-deals.js */

function rng(seed) {
  let a = seed >>> 0;
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function pack() { const out = []; ['S', 'H', 'D', 'C'].forEach((s, si) => { for (let v = 1; v <= 13; v++) out.push({ v, s: si }); }); return out; }
function shuffled(a, rand) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const red = s => s === 1 || s === 2;

// Deal: columns get 1..7 cards dealt row by row; last card of each column face up. Stock top = end of array.
function deal(seed) {
  const cards = shuffled(pack(), rng(seed));
  const cols = [[], [], [], [], [], [], []];
  let k = 0;
  for (let r = 0; r < 7; r++) for (let c = r; c < 7; c++) cols[c].push(cards[k++]);
  return { cols: cols.map(c => ({ cards: c, down: c.length - 1 })), stock: cards.slice(k), waste: [], found: [0, 0, 0, 0] };
}

function code(c) { return c.s * 13 + c.v - 1; }
function key(st) {
  let s = st.found.join(',') + '|' + st.stock.map(code).join('.') + '|' + st.waste.map(code).join('.');
  // Columns sorted so equivalent positions with columns swapped match.
  const cols = st.cols.map(c => c.down + ':' + c.cards.map(code).join('.')).sort();
  return s + '|' + cols.join('/');
}
function clone(st) { return { cols: st.cols.map(c => ({ cards: c.cards.slice(), down: c.down })), stock: st.stock.slice(), waste: st.waste.slice(), found: st.found.slice() }; }
function canFound(st, c) { return st.found[c.s] === c.v - 1; }
function canStack(col, c) {
  if (!col.cards.length) return c.v === 13;
  const t = col.cards[col.cards.length - 1];
  return t.v === c.v + 1 && red(t.s) !== red(c.s);
}
function flip(col) { if (col.down >= col.cards.length && col.down > 0) col.down = col.cards.length - 1; }

// Safe automatic foundation moves: a card no other card could ever need.
function autoPlay(st) {
  let moved = true;
  while (moved) {
    moved = false;
    for (const col of st.cols) {
      if (!col.cards.length) continue;
      const c = col.cards[col.cards.length - 1];
      if (canFound(st, c) && safe(st, c)) { st.found[c.s]++; col.cards.pop(); flip(col); moved = true; }
    }
    const w = st.waste[st.waste.length - 1];
    if (w && canFound(st, w) && safe(st, w)) { st.found[w.s]++; st.waste.pop(); moved = true; }
  }
}
function safe(st, c) {
  if (c.v <= 2) return true;
  const opp = red(c.s) ? [st.found[0], st.found[3]] : [st.found[1], st.found[2]];
  return Math.min(opp[0], opp[1]) >= c.v - 1;
}

function solve(seed, drawN, budget) {
  const start = deal(seed);
  autoPlay(start);
  const seen = new Set();
  let nodes = 0;
  const stack = [start];
  while (stack.length) {
    const st = stack.pop();
    if (st.found[0] + st.found[1] + st.found[2] + st.found[3] === 52) return { won: true, nodes };
    const k = key(st);
    if (seen.has(k)) continue;
    seen.add(k);
    if (++nodes > budget) return { won: false, nodes, gaveUp: true };
    const next = [];
    const push = (s2, pri) => { autoPlay(s2); next.push([pri, s2]); };
    // Tableau moves
    for (let i = 0; i < 7; i++) {
      const from = st.cols[i];
      if (!from.cards.length) continue;
      const top = from.cards[from.cards.length - 1];
      if (canFound(st, top)) { const s2 = clone(st); s2.found[top.s]++; s2.cols[i].cards.pop(); flip(s2.cols[i]); push(s2, 5); }
      for (let start = Math.max(from.down, 0); start < from.cards.length; start++) {
        const base = from.cards[start];
        const reveals = start === from.down && from.down > 0;
        const empties = start === 0;
        const exposesFound = start > from.down && canFound(st, from.cards[start - 1]);
        if (!reveals && !exposesFound && !(empties && false)) {
          if (!(empties)) continue;
        }
        for (let j = 0; j < 7; j++) {
          if (j === i) continue;
          const to = st.cols[j];
          if (!canStack(to, base)) continue;
          if (!to.cards.length && start === 0) continue;   // king to empty from an otherwise empty column: pointless
          const s2 = clone(st);
          const run = s2.cols[i].cards.splice(start);
          s2.cols[j].cards.push(...run);
          flip(s2.cols[i]);
          push(s2, reveals ? 4 : exposesFound ? 3 : 1);
        }
      }
    }
    // Waste moves
    const w = st.waste[st.waste.length - 1];
    if (w) {
      if (canFound(st, w)) { const s2 = clone(st); s2.found[w.s]++; s2.waste.pop(); push(s2, 4); }
      for (let j = 0; j < 7; j++) if (canStack(st.cols[j], w)) { const s2 = clone(st); s2.cols[j].cards.push(s2.waste.pop()); push(s2, 3); }
    }
    // Draw / redeal
    if (st.stock.length) {
      const s2 = clone(st);
      for (let n = 0; n < drawN && s2.stock.length; n++) s2.waste.push(s2.stock.pop());
      push(s2, 0);
    } else if (st.waste.length) {
      const s2 = clone(st); s2.stock = s2.waste.reverse(); s2.waste = []; push(s2, -1);
    }
    next.sort((a, b) => a[0] - b[0]);       // highest priority explored first (pushed last)
    for (const [, s2] of next) stack.push(s2);
  }
  return { won: false, nodes };
}

if (require.main === module) {
  const want = parseInt(process.argv[2] || '1000', 10);
  const out = {};
  for (const drawN of [1, 3]) {
    const seeds = []; let tried = 0, gave = 0; const t0 = Date.now();
    for (let seed = 1; seeds.length < want; seed++) {
      tried++;
      const r = solve(seed * 2654435761 >>> 0, drawN, 60000);
      if (r.won) seeds.push(seed * 2654435761 >>> 0); else if (r.gaveUp) gave++;
    }
    console.log('draw ' + drawN + ': ' + seeds.length + ' winnable of ' + tried + ' tried (' + gave + ' undecided) in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    out['draw' + drawN] = seeds;
  }
  require('fs').writeFileSync(__dirname + '/../src/klondike-deals.js',
    '/* Klondike deal seeds proven winnable by tools/klondike-solver.js (unlimited redeals). */\nwindow.KLONDIKE_DEALS = ' + JSON.stringify(out) + ';\n');
}
module.exports = { solve, deal };
