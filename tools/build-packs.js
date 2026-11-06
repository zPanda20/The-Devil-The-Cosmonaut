'use strict';
const G = require('./cosmo-gen.js');
const fs = require('fs');

// Tier plan: [grid size, stars per unit, how many to keep, how many candidates to make, pick 'easy' | 'hard']
const TIERS = [
  { id: 'launch', name: 'Launch', parts: [[5, 1, 20, 30, 'easy'], [6, 1, 20, 30, 'easy']] },
  { id: 'orbit', name: 'Orbit', parts: [[7, 1, 40, 50, 'all'], [8, 1, 40, 50, 'all']] },
  { id: 'deep-space', name: 'Deep Space', parts: [[9, 1, 40, 60, 'hard'], [10, 1, 40, 60, 'hard']] },
  { id: 'binary-stars', name: 'Binary Stars', parts: [[9, 2, 50, 60, 'easy'], [10, 2, 20, 45, 'easy']] },
  { id: 'event-horizon', name: 'Event Horizon', parts: [[10, 2, 30, 45, 'hard'], [11, 1, 15, 22, 'hard'], [12, 1, 15, 22, 'hard']] }
];

function score(p) { return p.level * 1000 + p.used[4] * 30 + p.used[3] * 8 + p.used[2] * 2; }
const CH = '0123456789abcdefghijklmnopqrstuvwxyz';

const out = { version: 1, tiers: [] };
let seedBase = 7000;
for (const tier of TIERS) {
  const levels = [];
  for (const [N, K, keep, make, pick] of tier.parts) {
    const cands = [];
    for (let s = 0; cands.length < make && s < make * 3; s++) {
      const p = G.generate(N, K, seedBase + N * 10007 + K * 1009 + s);
      if (p) cands.push(p);
    }
    cands.sort((a, b) => score(a) - score(b));
    let chosen = pick === 'easy' ? cands.slice(0, keep) : pick === 'hard' ? cands.slice(-keep) : cands.filter((_, i) => i % Math.ceil(cands.length / keep) === 0 || true).slice(0, keep);
    chosen.sort((a, b) => score(a) - score(b));
    for (const p of chosen) {
      const check = G.countSolutions(p.n, p.k, p.reg, 2);
      if (check.count !== 1) throw new Error('not unique');
      levels.push({ n: p.n, k: p.k, r: p.reg.map(g => CH[g]).join(''), s: p.stars, d: p.level });
    }
    process.stderr.write(tier.name + ' ' + N + 'x' + N + ' ' + K + '★: kept ' + chosen.length + ' of ' + cands.length + '\n');
  }
  seedBase += 100000;
  out.tiers.push({ id: tier.id, name: tier.name, levels: levels });
}
fs.writeFileSync('levels.json', JSON.stringify(out));
const total = out.tiers.reduce((a, t) => a + t.levels.length, 0);
process.stderr.write('total levels ' + total + ', bytes ' + fs.statSync('levels.json').size + '\n');
