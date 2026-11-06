/*
 * Cosmonaut Sudoku level generator (Node).
 * Star Battle rules: N x N grid, N regions, K stars in every row, column and region,
 * no two stars touching (including diagonally). Every level has exactly one solution
 * and is solvable by deduction; difficulty = the hardest deduction it needs.
 */
'use strict';

/* ---------- seeded randomness ---------- */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(a, r) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

/* ---------- geometry ---------- */
function n4(i, N) {
  const r = (i / N) | 0, c = i % N, o = [];
  if (r > 0) o.push(i - N); if (r < N - 1) o.push(i + N);
  if (c > 0) o.push(i - 1); if (c < N - 1) o.push(i + 1);
  return o;
}
function n8(i, N) {
  const r = (i / N) | 0, c = i % N, o = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < N && cc >= 0 && cc < N) o.push(rr * N + cc);
  }
  return o;
}
function rowCombos(N, K) {
  const out = [];
  if (K === 1) for (let c = 0; c < N; c++) out.push([c]);
  else for (let a = 0; a < N; a++) for (let b = a + 2; b < N; b++) out.push([a, b]);
  return out;
}

/* ---------- random valid star layout ---------- */
function randomSolution(N, K, r) {
  const combos = rowCombos(N, K), colCnt = new Array(N).fill(0), rows = [];
  let nodes = 0;
  function dfs(i) {
    if (++nodes > 200000) return false;
    if (i === N) return true;
    const prev = i ? rows[i - 1] : null;
    for (const cb of shuffle(combos.slice(), r)) {
      let ok = true;
      for (const c of cb) {
        if (colCnt[c] >= K) { ok = false; break; }
        if (prev) for (const p of prev) if (Math.abs(p - c) <= 1) { ok = false; break; }
        if (!ok) break;
      }
      if (!ok) continue;
      cb.forEach(c => colCnt[c]++); rows.push(cb);
      const rem = N - 1 - i;
      let feas = true;
      for (let c = 0; c < N && feas; c++) if (K - colCnt[c] > Math.ceil(rem / 2)) feas = false;
      if (feas && dfs(i + 1)) return true;
      rows.pop(); cb.forEach(c => colCnt[c]--);
    }
    return false;
  }
  if (!dfs(0)) return null;
  const stars = [];
  rows.forEach((cb, i) => cb.forEach(c => stars.push(i * N + c)));
  return stars;
}

/* ---------- regions ---------- */
function growBlobs(N, seeds, r) {
  const reg = new Array(N * N).fill(-1);
  seeds.forEach((s, k) => { reg[s] = k; });
  let left = N * N - seeds.length;
  while (left > 0) {
    const cand = [];
    for (let i = 0; i < N * N; i++) if (reg[i] < 0) {
      const nb = n4(i, N).filter(j => reg[j] >= 0);
      if (nb.length) cand.push([i, nb]);
    }
    const pick = cand[Math.floor(r() * cand.length)];
    reg[pick[0]] = reg[pick[1][Math.floor(r() * pick[1].length)]];
    left--;
  }
  return reg;
}

function pairBlobs(N, reg, count, r) {
  const adj = Array.from({ length: count }, () => new Set());
  for (let i = 0; i < N * N; i++) for (const j of n4(i, N)) if (reg[i] !== reg[j]) adj[reg[i]].add(reg[j]);
  const match = new Array(count).fill(-1);
  let steps = 0;
  function dfs() {
    if (++steps > 20000) return false;
    let b = -1, best = 1e9;
    for (let x = 0; x < count; x++) if (match[x] < 0) {
      let o = 0; adj[x].forEach(y => { if (match[y] < 0) o++; });
      if (o < best) { best = o; b = x; }
    }
    if (b < 0) return true;
    if (best === 0) return false;
    for (const y of shuffle([...adj[b]].filter(y => match[y] < 0), r)) {
      match[b] = y; match[y] = b;
      if (dfs()) return true;
      match[b] = -1; match[y] = -1;
    }
    return false;
  }
  if (!dfs()) return null;
  const id = new Array(count).fill(-1); let n = 0;
  for (let x = 0; x < count; x++) if (id[x] < 0) { id[x] = n; id[match[x]] = n; n++; }
  return reg.map(b => id[b]);
}

function contiguous(N, reg, g) {
  let start = -1, total = 0;
  for (let i = 0; i < N * N; i++) if (reg[i] === g) { total++; if (start < 0) start = i; }
  if (start < 0) return false;
  const seen = new Set([start]), q = [start];
  while (q.length) { const i = q.pop(); for (const j of n4(i, N)) if (reg[j] === g && !seen.has(j)) { seen.add(j); q.push(j); } }
  return seen.size === total;
}

/* ---------- exact solver: counts solutions up to `limit` ---------- */
function countSolutions(N, K, reg, limit) {
  limit = limit || 2;
  const combos = rowCombos(N, K);
  const colCnt = new Int8Array(N), regCnt = new Int8Array(N);
  const below = Array.from({ length: N }, () => new Int16Array(N + 1));
  for (let r = N - 1; r >= 0; r--) {
    for (let g = 0; g < N; g++) below[g][r] = below[g][r + 1];
    for (let c = 0; c < N; c++) below[reg[r * N + c]][r]++;
  }
  let found = 0; const sols = []; const rows = [];
  function dfs(r) {
    if (r === N) {
      found++;
      const s = []; rows.forEach((cb, i) => cb.forEach(c => s.push(i * N + c)));
      sols.push(s);
      return found >= limit;
    }
    const prev = r ? rows[r - 1] : null;
    for (const cb of combos) {
      let ok = true;
      for (const c of cb) {
        if (colCnt[c] >= K) { ok = false; break; }
        if (prev) { for (const p of prev) if (Math.abs(p - c) <= 1) { ok = false; break; } if (!ok) break; }
      }
      if (!ok) continue;
      cb.forEach(c => { colCnt[c]++; regCnt[reg[r * N + c]]++; });
      const rem = N - 1 - r;
      let feas = true;
      for (let x = 0; x < N && feas; x++) {
        if (regCnt[x] > K) feas = false;
        else if (K - colCnt[x] > Math.ceil(rem / 2)) feas = false;
        else if (K - regCnt[x] > below[x][r + 1]) feas = false;
      }
      rows.push(cb);
      const stop = feas && dfs(r + 1);
      rows.pop();
      cb.forEach(c => { colCnt[c]--; regCnt[reg[r * N + c]]--; });
      if (stop) return true;
    }
    return false;
  }
  dfs(0);
  return { count: found, sols: sols };
}

/* Reshape regions until only the planned layout solves the puzzle. */
function makeUnique(N, K, reg, stars, r) {
  const isStar = new Set(stars);
  for (let it = 0; it < 500; it++) {
    const res = countSolutions(N, K, reg, 2);
    if (res.count === 1) return reg;
    const alt = res.sols.find(s => s.some(x => !isStar.has(x)));
    if (!alt) return null;
    const diff = shuffle(alt.filter(x => !isStar.has(x)), r);
    let moved = false;
    for (const c of diff) {
      for (const g of shuffle(n4(c, N).map(j => reg[j]).filter(g => g !== reg[c]), r)) {
        const old = reg[c];
        reg[c] = g;
        if (contiguous(N, reg, old)) { moved = true; break; }
        reg[c] = old;
      }
      if (moved) break;
    }
    if (!moved) return null;
  }
  return null;
}

/* ---------- human-style solver: rates difficulty ----------
 * Level 1  basics: neighbours of a star, full units, units with exactly enough cells left
 * Level 2  single confinement (a region stuck in one row/column, or the reverse)
 *          and "a star here would leave some unit without room"
 * Level 3  group confinement: 2-4 regions squeezed into the same number of rows/columns
 * Level 4  short trial: a star (or X) here leads to a contradiction after levels 1-3
 */
function makeRater(N, K, reg) {
  const units = [];
  for (let r = 0; r < N; r++) { const u = []; for (let c = 0; c < N; c++) u.push(r * N + c); units.push({ cells: u, t: 0, k: r }); }
  for (let c = 0; c < N; c++) { const u = []; for (let r = 0; r < N; r++) u.push(r * N + c); units.push({ cells: u, t: 1, k: c }); }
  const regs = Array.from({ length: N }, () => []);
  reg.forEach((g, i) => regs[g].push(i));
  regs.forEach((u, g) => units.push({ cells: u, t: 2, k: g }));
  const cellUnits = Array.from({ length: N * N }, () => []);
  units.forEach((u, k) => u.cells.forEach(i => cellUnits[i].push(k)));
  const NB = Array.from({ length: N * N }, (_, i) => n8(i, N));

  function counts(st, u) {
    let s = 0, q = 0;
    for (const i of u.cells) { if (st[i] === 1) s++; else if (st[i] === 0) q++; }
    return [s, q];
  }
  function bad(st) {
    for (const u of units) { const [s, q] = counts(st, u); if (s > K || s + q < K) return true; }
    return false;
  }
  // place a star; returns false on contradiction
  function star(st, i) {
    if (st[i] === 2) return false;
    if (st[i] === 1) return true;
    for (const j of NB[i]) if (st[j] === 1) return false;
    st[i] = 1;
    for (const j of NB[i]) if (st[j] === 0) st[j] = 2;
    return true;
  }
  // Level 1 to a fixpoint; returns false on contradiction
  function basics(st) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const u of units) {
        const [s, q] = counts(st, u);
        if (s > K || s + q < K) return false;
        if (q === 0) continue;
        if (s === K) { for (const i of u.cells) if (st[i] === 0) st[i] = 2; changed = true; }
        else if (s + q === K) {
          for (const i of u.cells) if (st[i] === 0) { if (!star(st, i)) return false; }
          changed = true;
        }
      }
    }
    return !bad(st);
  }
  // Level 2a: single confinement. Returns true if it changed anything.
  function confine1(st) {
    let changed = false;
    for (let a = 0; a < units.length; a++) {
      const A = units[a]; const [sa, qa] = counts(st, A); const need = K - sa;
      if (!need || !qa) continue;
      for (const t of [0, 1, 2]) {
        if (t === A.t) continue;
        let key = -1, one = true;
        for (const i of A.cells) if (st[i] === 0) {
          const k = t === 0 ? (i / N) | 0 : t === 1 ? i % N : reg[i];
          if (key < 0) key = k; else if (k !== key) { one = false; break; }
        }
        if (!one || key < 0) continue;
        const B = units[t * N + key]; const [sb] = counts(st, B);
        if (K - sb !== need) continue;
        for (const i of B.cells) if (st[i] === 0 && A.cells.indexOf(i) < 0) { st[i] = 2; changed = true; }
      }
    }
    return changed;
  }
  // Level 2b: a star at c would leave some unit with too few cells
  function squeeze(st) {
    let changed = false;
    for (let c = 0; c < N * N; c++) {
      if (st[c] !== 0) continue;
      const t = st.slice();
      if (!star(t, c)) { st[c] = 2; changed = true; continue; }
      for (const k of cellUnits[c]) { const [s] = counts(t, units[k]); if (s === K) for (const i of units[k].cells) if (t[i] === 0) t[i] = 2; }
      if (bad(t)) { st[c] = 2; changed = true; }
    }
    return changed;
  }
  // Level 3: group confinement (2-4 units of one kind inside the same number of another kind)
  function confineGroups(st) {
    let changed = false;
    for (const ta of [2, 0, 1]) for (const tb of [0, 1, 2]) {
      if (ta === tb) continue;
      const open = [];
      for (let k = 0; k < N; k++) {
        const u = units[ta * N + k]; const [s, q] = counts(st, u);
        if (q && s < K) {
          let mask = 0;
          for (const i of u.cells) if (st[i] === 0) mask |= 1 << (tb === 0 ? (i / N) | 0 : tb === 1 ? i % N : reg[i]);
          open.push({ k: k, need: K - s, mask: mask, cells: u.cells });
        }
      }
      const L = open.length;
      function tryGroup(idx) {
        let mask = 0, need = 0;
        for (const x of idx) { mask |= open[x].mask; need += open[x].need; }
        let bits = 0, bneed = 0;
        for (let b = 0; b < N; b++) if (mask & (1 << b)) { bits++; const [s] = counts(st, units[tb * N + b]); bneed += K - s; }
        if (bits > idx.length * 2 || need < bneed) return;
        const inGroup = new Set(); idx.forEach(x => open[x].cells.forEach(i => inGroup.add(i)));
        for (let b = 0; b < N; b++) if (mask & (1 << b)) for (const i of units[tb * N + b].cells) if (st[i] === 0 && !inGroup.has(i)) { st[i] = 2; changed = true; }
      }
      for (let a = 0; a < L; a++) for (let b = a + 1; b < L; b++) {
        tryGroup([a, b]);
        for (let c = b + 1; c < L; c++) {
          tryGroup([a, b, c]);
          for (let d = c + 1; d < L; d++) tryGroup([a, b, c, d]);
        }
      }
    }
    return changed;
  }
  function settle(st, maxLevel) { // apply levels up to maxLevel until stuck; false on contradiction
    for (;;) {
      if (!basics(st)) return false;
      if (maxLevel >= 2 && (confine1(st) || squeeze(st))) continue;
      if (maxLevel >= 3 && confineGroups(st)) continue;
      return !bad(st);
    }
  }
  // Level 4: trial of one cell with levels 1-3 behind it
  function trial(st) {
    for (let c = 0; c < N * N; c++) {
      if (st[c] !== 0) continue;
      const t = st.slice();
      if (!star(t, c) || !settle(t, 3)) { st[c] = 2; return true; }
      const x = st.slice(); x[c] = 2;
      if (!settle(x, 3)) { if (!star(st, c)) return false; return true; }
    }
    return false;
  }

  function rate() {
    const st = new Int8Array(N * N);
    const used = [0, 0, 0, 0, 0];
    let maxL = 1;
    for (let guard = 0; guard < 2000; guard++) {
      if (!basics(st)) return null;
      if (st.every(v => v !== 0)) break;
      if (confine1(st) || squeeze(st)) { used[2]++; maxL = Math.max(maxL, 2); continue; }
      if (confineGroups(st)) { used[3]++; maxL = Math.max(maxL, 3); continue; }
      if (trial(st)) { used[4]++; maxL = Math.max(maxL, 4); continue; }
      return null; // needs deeper guessing than we allow
    }
    if (!basics(st) || st.some(v => v === 0)) return null;
    const stars = []; st.forEach((v, i) => { if (v === 1) stars.push(i); });
    return { level: maxL, used: used, stars: stars };
  }
  return { rate: rate };
}

/* ---------- one puzzle ---------- */
function generate(N, K, seed) {
  const r = rng(seed);
  for (let attempt = 0; attempt < 60; attempt++) {
    const stars = randomSolution(N, K, r);
    if (!stars) continue;
    let reg = growBlobs(N, stars, r);
    if (K === 2) { reg = pairBlobs(N, reg, 2 * N, r); if (!reg) continue; }
    reg = makeUnique(N, K, reg, stars, r);
    if (!reg) continue;
    const rated = makeRater(N, K, reg).rate();
    if (!rated) continue;
    const want = new Set(stars);
    if (rated.stars.length !== stars.length || rated.stars.some(s => !want.has(s))) continue;
    return { n: N, k: K, reg: reg, stars: stars.slice().sort((a, b) => a - b), level: rated.level, used: rated.used, seed: seed };
  }
  return null;
}

module.exports = { generate, countSolutions, makeRater, rng };
