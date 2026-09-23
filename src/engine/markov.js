// Exact rotation-aware Markov chain for a volleyball set and match.
//
// Rotations are indexed 0..5 = R1..R6, named by the setter's court zone (the coaching
// convention). A team that sides out rotates R1 → R6 → R5 → R4 → R3 → R2 → R1.
//
// State of a set: (our score, their score, our rotation, their rotation, who serves).
//  - We serve in rotation i vs their receive rotation j: we win the rally w.p. pS[i][j].
//    Win → we keep serving. Lose → they side out, rotate, and serve.
//  - They serve: we win w.p. pR[i][j]. Win → we side out, rotate, and serve.
// Deuce (both teams ≥ target−1) collapses to a score *difference* in {−1,0,+1}, and that
// 216-state recurrent block is solved by fixed-point iteration, so sets are solved exactly.

import { log5 } from './stats.js';

export const US = 0, THEM = 1;
export const nextRot = (r) => (r + 5) % 6;
export const ROT_LABELS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];

export const DEFAULT_LEAGUE = { so: 0.6 }; // league side-out rate (serving team wins 40%)

// us/them: { so: [6], bp: [6] } — side-out rate when receiving, point-scoring (break-point)
// rate when serving, both vs a league-average opponent. `them` may be null (league average).
export function rallyMatrices(us, them, league = DEFAULT_LEAGUE) {
  const L = league.so;
  const pS = [], pR = [];
  for (let i = 0; i < 6; i++) {
    pS.push([]); pR.push([]);
    for (let j = 0; j < 6; j++) {
      const theirSO = them ? them.so[j] : L;
      const theirBP = them ? them.bp[j] : 1 - L;
      pS[i].push(log5(us.bp[i], 1 - theirSO, 1 - L));
      pR[i].push(log5(us.so[i], 1 - theirBP, L));
    }
  }
  return { pS, pR };
}

export function makeSetSolver({ pS, pR }, target = 25) {
  const G = new Float64Array(3 * 72);
  const gi = (d, i, j, s) => ((d + 1) * 36 + i * 6 + j) * 2 + s;
  const gv = (d, i, j, s) => (d >= 2 ? 1 : d <= -2 ? 0 : G[gi(d, i, j, s)]);
  G.fill(0.5);
  for (let it = 0; it < 5000; it++) {
    let delta = 0;
    for (let d = -1; d <= 1; d++) for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) for (let s = 0; s < 2; s++) {
      let v;
      if (s === US) { const p = pS[i][j]; v = p * gv(d + 1, i, j, US) + (1 - p) * gv(d - 1, i, nextRot(j), THEM); }
      else { const p = pR[i][j]; v = p * gv(d + 1, nextRot(i), j, US) + (1 - p) * gv(d - 1, i, j, THEM); }
      const k = gi(d, i, j, s);
      delta = Math.max(delta, Math.abs(v - G[k]));
      G[k] = v;
    }
    if (delta < 1e-13) break;
  }

  const T = target;
  const memo = new Float64Array(T * T * 72).fill(NaN);
  function f(a, b, i, j, s) {
    if (a >= T && a - b >= 2) return 1;
    if (b >= T && b - a >= 2) return 0;
    if (a >= T - 1 && b >= T - 1) return gv(a - b, i, j, s);
    const k = ((a * T + b) * 36 + i * 6 + j) * 2 + s;
    const c = memo[k];
    if (c === c) return c; // not NaN
    let v;
    if (s === US) { const p = pS[i][j]; v = p * f(a + 1, b, i, j, US) + (1 - p) * f(a, b + 1, i, nextRot(j), THEM); }
    else { const p = pR[i][j]; v = p * f(a + 1, b, nextRot(i), j, US) + (1 - p) * f(a, b + 1, i, j, THEM); }
    memo[k] = v;
    return v;
  }
  return {
    target,
    // Probability we win the set from any live state.
    prob: (a, b, i, j, s) => f(a, b, i, j, s),
    // Probability we win the set from 0–0.
    fromStart: (usRot, themRot, firstServe) => f(0, 0, usRot, themRot, firstServe),
  };
}

// Monte Carlo set simulation; used by tests and for score distributions.
export function simulateSet({ pS, pR }, target, usRot, themRot, serve, rand) {
  let a = 0, b = 0, i = usRot, j = themRot, s = serve;
  const log = [];
  for (;;) {
    const p = s === US ? pS[i][j] : pR[i][j];
    const won = rand() < p;
    log.push({ a, b, i, j, s, won });
    if (s === US) { if (won) a++; else { b++; j = nextRot(j); s = THEM; } }
    else { if (won) { a++; i = nextRot(i); s = US; } else b++; }
    if ((a >= target || b >= target) && Math.abs(a - b) >= 2) return { a, b, won: a > b, log };
  }
}

// Match model. `starts[k]` = { us, them } starting rotations for set k (defaults to set 0's).
// `firstServe`: US | THEM | 'toss' for set 1. Later sets alternate; the deciding set is a toss.
// Pass `solvers` ({ main, deciding }) to reuse solved sets across several start scenarios.
export function makeMatchModel(matrices, { bestOf = 5, target = 25, decidingTarget = 15, starts = [{ us: 0, them: 0 }], firstServe = 'toss', solvers = null } = {}) {
  const need = Math.ceil(bestOf / 2);
  const main = solvers?.main || makeSetSolver(matrices, target);
  const deciding = solvers?.deciding || (decidingTarget === target ? main : makeSetSolver(matrices, decidingTarget));
  const startFor = (k) => starts[Math.min(k, starts.length - 1)] || { us: 0, them: 0 };
  const solverFor = (k) => (k === bestOf - 1 ? deciding : main);

  // Probability we win set k from 0-0 given who serves first in it.
  const setP = (k, serve) => { const st = startFor(k); return solverFor(k).fromStart(st.us, st.them, serve); };
  const setPToss = (k) => 0.5 * setP(k, US) + 0.5 * setP(k, THEM);

  // From a set boundary: sets won so far, who served first in the *previous* set.
  function fromBoundary(wu, wt, prevFirst) {
    if (wu >= need) return 1;
    if (wt >= need) return 0;
    const k = wu + wt;
    if (k === bestOf - 1) return setPToss(k);
    const first = prevFirst === US ? THEM : US;
    const p = setP(k, first);
    return p * fromBoundary(wu + 1, wt, first) + (1 - p) * fromBoundary(wu, wt + 1, first);
  }

  function outcomeDist() {
    const dist = {};
    const walk = (wu, wt, prob, prevFirst) => {
      if (prob < 1e-15) return;
      if (wu >= need || wt >= need) { const key = `${wu}-${wt}`; dist[key] = (dist[key] || 0) + prob; return; }
      const k = wu + wt;
      if (k === bestOf - 1) { const p = setPToss(k); walk(wu + 1, wt, prob * p, US); walk(wu, wt + 1, prob * (1 - p), US); return; }
      const first = prevFirst === US ? THEM : US;
      const p = setP(k, first);
      walk(wu + 1, wt, prob * p, first); walk(wu, wt + 1, prob * (1 - p), first);
    };
    if (firstServe === 'toss') { walk(0, 0, 0.5, THEM); walk(0, 0, 0.5, US); }
    else walk(0, 0, 1, firstServe === US ? THEM : US); // "previous first" is the opposite of set-1 server
    return dist;
  }

  function matchProb() {
    if (firstServe === 'toss') return 0.5 * fromBoundary(0, 0, THEM) + 0.5 * fromBoundary(0, 0, US);
    return fromBoundary(0, 0, firstServe === US ? THEM : US);
  }

  // Live: mid-set state. `firstThisSet` = who served first in the current set.
  function live({ setsUs, setsThem, a, b, rotUs, rotThem, serving, firstThisSet }) {
    if (setsUs >= need) return { set: 1, match: 1 };
    if (setsThem >= need) return { set: 0, match: 0 };
    const k = setsUs + setsThem;
    const ps = solverFor(k).prob(a, b, rotUs, rotThem, serving);
    const prev = k === bestOf - 1 ? THEM : firstThisSet;
    const pm = ps * fromBoundary(setsUs + 1, setsThem, prev) + (1 - ps) * fromBoundary(setsUs, setsThem + 1, prev);
    return { set: ps, match: pm };
  }

  return {
    bestOf, need, main, deciding,
    setProb: setP,
    setProbToss: setPToss,
    matchProb,
    outcomeDist,
    live,
  };
}

// Convenience: expected rally win rates summary for a rotation profile.
export function profileSummary(team) {
  const so = team.so.reduce((s, x) => s + x, 0) / 6;
  const bp = team.bp.reduce((s, x) => s + x, 0) / 6;
  return { so, bp };
}
