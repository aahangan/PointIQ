// Multi-season hierarchical model for rotation rates (Bayesian, crossed random effects).
//
// For each phase (SO, BP) separately, with season s and rotation r:
//   y_sr  = empirical logit of won/n            y_sr ~ N(θ_sr, v_sr / w_s)
//   θ_sr  = μ + α_r + β_s + γ_sr
//   α_r ~ N(0, τα²)   persistent rotation effect (structure: who's front row, who passes)
//   β_s ~ N(0, τβ²)   season-level team strength (roster turnover, coaching)
//   γ_sr ~ N(0, τγ²)  season-specific rotation deviation (noise + this year's quirks)
//   μ ~ N(logit(league), 0.5²),  τ² ~ Inv-Gamma(2, b)
// w_s = decay^age down-weights older seasons. Fit by Gibbs sampling (all steps conjugate).
//
// What coaches get from it:
//  - current-season rotation rates, shrunk just enough given sample size;
//  - next-season projections with honest uncertainty;
//  - "persistence" τα² / (τα² + τγ²): how much of rotation-to-rotation variation is structural
//    versus season noise — i.e. whether a weak rotation is worth fixing or just bad luck;
//  - P(rotation is below the team's own average).

import { logit, expit, rng, quantile, mean } from './stats.js';

const PRIOR_B = { alpha: 0.03, beta: 0.04, gamma: 0.02 };
const A0 = 2;

function fitPhase(obs, seasons, m0, { iters, burn, seed, thin }) {
  const R = rng(seed);
  const S = seasons.length;
  const N = obs.length;
  let mu = m0, alpha = new Array(6).fill(0), beta = new Array(S).fill(0);
  let ta = PRIOR_B.alpha, tb = PRIOR_B.beta, tg = PRIOR_B.gamma;
  const theta = obs.map((o) => o.y);
  const draws = [];

  for (let it = 0; it < iters; it++) {
    // θ | rest
    for (let k = 0; k < N; k++) {
      const o = obs[k];
      const prec = 1 / o.v + 1 / tg;
      const m = (o.y / o.v + (mu + alpha[o.r] + beta[o.s]) / tg) / prec;
      theta[k] = m + R.normal() / Math.sqrt(prec);
    }
    // α_r | rest
    for (let r = 0; r < 6; r++) {
      let sr = 0, n = 0;
      for (let k = 0; k < N; k++) if (obs[k].r === r) { sr += theta[k] - mu - beta[obs[k].s]; n++; }
      const prec = n / tg + 1 / ta;
      alpha[r] = (sr / tg) / prec + R.normal() / Math.sqrt(prec);
    }
    // β_s | rest
    for (let s = 0; s < S; s++) {
      let sr = 0, n = 0;
      for (let k = 0; k < N; k++) if (obs[k].s === s) { sr += theta[k] - mu - alpha[obs[k].r]; n++; }
      const prec = n / tg + 1 / tb;
      beta[s] = (sr / tg) / prec + R.normal() / Math.sqrt(prec);
    }
    // μ | rest
    {
      let sr = 0;
      for (let k = 0; k < N; k++) sr += theta[k] - alpha[obs[k].r] - beta[obs[k].s];
      const prec = N / tg + 1 / 0.25;
      mu = (sr / tg + m0 / 0.25) / prec + R.normal() / Math.sqrt(prec);
    }
    // variance components
    let ga = 0; for (const a of alpha) ga += a * a;
    let gb = 0; for (const b of beta) gb += b * b;
    let gg = 0; for (let k = 0; k < N; k++) { const g = theta[k] - mu - alpha[obs[k].r] - beta[obs[k].s]; gg += g * g; }
    ta = R.invGamma(A0 + 3, PRIOR_B.alpha + ga / 2);
    tb = R.invGamma(A0 + S / 2, PRIOR_B.beta + gb / 2);
    tg = R.invGamma(A0 + N / 2, PRIOR_B.gamma + gg / 2);

    if (it >= burn && (it - burn) % thin === 0) {
      draws.push({ mu, alpha: alpha.slice(), beta: beta.slice(), theta: theta.slice(), ta, tb, tg, z: [R.normal(), R.normal(), ...Array.from({ length: 6 }, () => R.normal())] });
    }
  }
  return draws;
}

function summarize(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  return { mean: mean(xs), lo: quantile(s, 0.1), hi: quantile(s, 0.9) };
}

// records: [{ season: '2024', rot: 0..5, phase: 'SO'|'BP', won, n }]
export function fitHierarchical(records, { leagueSO = 0.6, decay = 0.85, iters = 4000, burn = 1000, thin = 3, seed = 7, targetSeason = null } = {}) {
  const seasons = [...new Set(records.map((r) => String(r.season)))].sort();
  if (!seasons.length) return null;
  const target = targetSeason != null ? String(targetSeason) : seasons[seasons.length - 1];
  const out = { seasons, target, phases: {} };

  for (const phase of ['SO', 'BP']) {
    const agg = new Map();
    for (const rec of records) if (rec.phase === phase && rec.n > 0) {
      const key = `${rec.season}|${rec.rot}`;
      const cur = agg.get(key) || { season: String(rec.season), r: rec.rot, won: 0, n: 0 };
      cur.won += rec.won; cur.n += rec.n; agg.set(key, cur);
    }
    const obs = [...agg.values()].map((o) => {
      const s = seasons.indexOf(o.season);
      const age = seasons.length - 1 - s;
      const w = Math.pow(decay, age);
      return { s, r: o.r, won: o.won, n: o.n, y: Math.log((o.won + 0.5) / (o.n - o.won + 0.5)), v: (1 / (o.won + 0.5) + 1 / (o.n - o.won + 0.5)) / w };
    });
    if (!obs.length) continue;
    const m0 = logit(phase === 'SO' ? leagueSO : 1 - leagueSO);
    const draws = fitPhase(obs, seasons, m0, { iters, burn, seed: seed + (phase === 'BP' ? 101 : 0), thin });
    const ts = seasons.indexOf(target);

    const rots = [];
    for (let r = 0; r < 6; r++) {
      const k = obs.findIndex((o) => o.s === ts && o.r === r);
      const cur = draws.map((d) => expit(k >= 0 ? d.theta[k] : d.mu + d.alpha[r] + d.beta[ts] + Math.sqrt(d.tg) * d.z[2 + r]));
      const next = draws.map((d) => expit(d.mu + d.alpha[r] + Math.sqrt(d.tb) * d.z[0] + Math.sqrt(d.tg) * d.z[2 + r]));
      const structural = draws.map((d) => expit(d.mu + d.alpha[r]));
      const below = draws.filter((d) => d.alpha[r] < mean(d.alpha)).length / draws.length;
      const o = k >= 0 ? obs[k] : null;
      const allSeasons = seasons.map((sn, si) => { const oo = obs.find((x) => x.s === si && x.r === r); return oo ? { season: sn, won: oo.won, n: oo.n, raw: oo.won / oo.n } : { season: sn, won: 0, n: 0, raw: NaN }; });
      rots.push({ r, raw: o ? o.won / o.n : NaN, n: o ? o.n : 0, current: summarize(cur), next: summarize(next), structural: summarize(structural), pBelow: below, history: allSeasons });
    }
    const persistence = summarize(draws.map((d) => d.ta / (d.ta + d.tg)));
    const seasonEffects = seasons.map((sn, si) => ({ season: sn, ...summarize(draws.map((d) => expit(d.mu + d.beta[si]))) }));
    out.phases[phase] = {
      rots, persistence, seasonEffects,
      sd: { rotation: Math.sqrt(mean(draws.map((d) => d.ta))), season: Math.sqrt(mean(draws.map((d) => d.tb))), noise: Math.sqrt(mean(draws.map((d) => d.tg))) },
      draws: draws.length,
    };
  }
  return out;
}

// Turn a fit into a { so[6], bp[6] } profile for the match model.
export function profileFromFit(fit, which = 'current') {
  if (!fit?.phases?.SO || !fit?.phases?.BP) return null;
  return { so: fit.phases.SO.rots.map((r) => r[which].mean), bp: fit.phases.BP.rots.map((r) => r[which].mean) };
}
