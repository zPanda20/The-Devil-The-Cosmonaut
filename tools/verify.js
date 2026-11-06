'use strict';
const G = require('./cosmo-gen.js');
const pack = JSON.parse(require('fs').readFileSync('levels.json', 'utf8'));
let n = 0, problems = [];
const perTier = [];
for (const t of pack.tiers) {
  const sizes = {};
  t.levels.forEach((l, idx) => {
    n++;
    const N = l.n, K = l.k, reg = l.r.split('').map(ch => parseInt(ch, 36));
    const tag = t.name + ' #' + (idx + 1);
    if (reg.length !== N * N) problems.push(tag + ' wrong size');
    if (new Set(reg).size !== N) problems.push(tag + ' region count');
    if (l.s.length !== N * K) problems.push(tag + ' star count');
    const set = new Set(l.s);
    for (const s of l.s) {
      const r = (s / N) | 0, c = s % N;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N && set.has(rr * N + cc)) problems.push(tag + ' touching');
      }
    }
    for (let x = 0; x < N; x++) {
      const row = l.s.filter(s => ((s / N) | 0) === x).length, col = l.s.filter(s => s % N === x).length;
      const rg = l.s.filter(s => reg[s] === x).length;
      if (row !== K || col !== K || rg !== K) problems.push(tag + ' unit count');
    }
    const cnt = G.countSolutions(N, K, reg, 2);
    if (cnt.count !== 1) problems.push(tag + ' solutions=' + cnt.count);
    const rated = G.makeRater(N, K, reg).rate();
    if (!rated || rated.stars.join() !== l.s.slice().sort((a, b) => a - b).join()) problems.push(tag + ' not logic-solvable');
    const key = N + 'x' + N + ' ' + K + '★';
    sizes[key] = (sizes[key] || 0) + 1;
  });
  perTier.push(t.name + ': ' + t.levels.length + ' levels (' + Object.entries(sizes).map(e => e[1] + ' × ' + e[0]).join(', ') + ')');
}
console.log(perTier.join('\n'));
console.log('checked', n, 'levels;', problems.length ? 'PROBLEMS: ' + problems.slice(0, 10).join('; ') : 'all unique, valid and solvable by deduction');
