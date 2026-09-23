// Lineup decisions on top of the Markov model:
//  - starting-rotation payoff matrix vs the opponent's start, with the game-theoretic
//    (mixed-strategy) answer for when you don't know which rotation they'll open in;
//  - serving-order search over legal 5-1 orders (or every order).

import { rallyMatrices, makeSetSolver, US, THEM } from './markov.js';
import { buildRotations, candidateOrders } from './lineup.js';

// payoff[i][j] = P(win set) if we start in Ri and they start in Rj.
export function startMatrix(us, them, { league, target = 25, serve = 'toss' } = {}) {
  const solver = makeSetSolver(rallyMatrices(us, them, league), target);
  const M = [];
  for (let i = 0; i < 6; i++) {
    M.push([]);
    for (let j = 0; j < 6; j++) {
      const v = serve === 'toss' ? 0.5 * solver.fromStart(i, j, US) + 0.5 * solver.fromStart(i, j, THEM) : solver.fromStart(i, j, serve);
      M[i].push(v);
    }
  }
  return M;
}

// Zero-sum game solution by fictitious play (converges for 2-player zero-sum games).
export function solveGame(M, iters = 20000) {
  const n = M.length, m = M[0].length;
  const rowCount = new Array(n).fill(0), colCount = new Array(m).fill(0);
  const rowPay = new Array(n).fill(0), colPay = new Array(m).fill(0);
  let r = 0, c = 0;
  for (let t = 0; t < iters; t++) {
    rowCount[r]++; colCount[c]++;
    for (let i = 0; i < n; i++) rowPay[i] += M[i][c];
    for (let j = 0; j < m; j++) colPay[j] += M[r][j];
    r = rowPay.indexOf(Math.max(...rowPay));
    c = colPay.indexOf(Math.min(...colPay));
  }
  const x = rowCount.map((v) => v / iters), y = colCount.map((v) => v / iters);
  let value = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) value += x[i] * y[j] * M[i][j];
  const maximin = M.map((row) => Math.min(...row));
  const safest = maximin.indexOf(Math.max(...maximin));
  return { us: x, them: y, value, safest, safestValue: maximin[safest] };
}

// Score one lineup: average set win prob over their possible starts (or a known start).
export function scoreProfile(profile, them, { league, target = 25, themStart = null } = {}) {
  const M = startMatrix(profile, them, { league, target });
  const perStart = M.map((row) => (themStart == null ? row.reduce((s, x) => s + x, 0) / 6 : row[themStart]));
  const best = perStart.indexOf(Math.max(...perStart));
  return { M, perStart, best, bestValue: perStart[best] };
}

export function searchOrders(team, them, { league, target = 25, free = false, themStart = null } = {}) {
  const results = [];
  for (const order of candidateOrders(team, { free })) {
    const built = buildRotations({ ...team, order }, { league });
    const sc = scoreProfile(built.profile, them, { league, target, themStart });
    results.push({ order, profile: built.profile, bestStart: sc.best, value: sc.bestValue, avg: sc.perStart.reduce((s, x) => s + x, 0) / 6 });
  }
  results.sort((a, b) => b.value - a.value);
  const current = results.find((r) => r.order.join() === team.order.join());
  return { results, current };
}
