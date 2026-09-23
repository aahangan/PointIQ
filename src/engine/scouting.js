// Recruiting model for high-school and club prospects.
//
// The core problem with recruiting stats: a .420 hitter in a small-school league and a .250
// hitter in 18 Open are not comparable, and a 60-attempt sample says very little. So every
// prospect metric goes through three steps:
//   1. Shrink toward a position prior (beta / gamma-Poisson pseudo-counts) — sample size.
//   2. Translate to an 18-Open-equivalent via a competition-level shift on the logit scale.
//   3. Score against position reference distributions → a 20–80 style T-score, with an 80%
//      range from posterior simulation, blended with measurables (height, approach touch).
// Levels and weights are editable: every staff has its own opinion, and that's the point.

import { logit, expit, rng, quantile, mean } from './stats.js';

export const LEVELS = [
  { key: 'club-open', label: 'Club — 18/17 Open (national)', shift: 0 },
  { key: 'club-usa', label: 'Club — USA / American bracket', shift: -0.15 },
  { key: 'club-regional', label: 'Club — regional', shift: -0.35 },
  { key: 'hs-top', label: 'High school — top division / power conference', shift: -0.25 },
  { key: 'hs-varsity', label: 'High school — varsity', shift: -0.45 },
  { key: 'hs-small', label: 'High school — small school', shift: -0.6 },
];
export const levelOf = (key) => LEVELS.find((l) => l.key === key) || guessLevel(key);
function guessLevel(text = '') {
  const t = String(text).toLowerCase();
  if (/open|national/.test(t)) return LEVELS[0];
  if (/usa|american/.test(t)) return LEVELS[1];
  if (/club|region/.test(t)) return LEVELS[2];
  if (/small|1a|2a/.test(t)) return LEVELS[5];
  if (/top|power|6a|5a|open div/.test(t)) return LEVELS[3];
  return LEVELS[4];
}

// 18-Open-equivalent reference distributions (mean, sd) by position. Adjustable later from
// a program's own signed-player history — that is the long-term data moat.
const REF = {
  eff: { OH: [0.21, 0.08], OPP: [0.22, 0.08], MB: [0.28, 0.09], S: [0.2, 0.12], L: [0, 1], DS: [0, 1] },
  kps: { OH: [2.8, 0.9], OPP: [2.6, 0.9], MB: [1.9, 0.6], S: [0.6, 0.4], L: [0, 1], DS: [0, 1] },
  pass: { OH: [2.05, 0.2], OPP: [1.9, 0.25], MB: [1.8, 0.3], S: [1.9, 0.3], L: [2.2, 0.18], DS: [2.1, 0.2] },
  ace: { OH: [0.08, 0.03], OPP: [0.08, 0.03], MB: [0.07, 0.03], S: [0.08, 0.03], L: [0.07, 0.03], DS: [0.08, 0.03] },
  serr: { OH: [0.1, 0.04], OPP: [0.1, 0.04], MB: [0.11, 0.04], S: [0.09, 0.04], L: [0.08, 0.03], DS: [0.08, 0.03] },
  dps: { OH: [2.4, 0.9], OPP: [1.6, 0.7], MB: [0.8, 0.5], S: [2.4, 0.9], L: [4.0, 1.0], DS: [3.2, 1.0] },
  bps: { OH: [0.35, 0.2], OPP: [0.55, 0.25], MB: [1.0, 0.35], S: [0.3, 0.2], L: [0, 1], DS: [0, 1] },
  aps: { OH: [0.2, 0.2], OPP: [0.2, 0.2], MB: [0.1, 0.1], S: [9, 1.5], L: [0.5, 0.4], DS: [0.3, 0.3] },
  height: { OH: [72.5, 2.2], OPP: [73.5, 2.2], MB: [74.5, 2.0], S: [70.5, 2.3], L: [66.5, 2.2], DS: [67.5, 2.2] },
  approach: { OH: [118, 4], OPP: [119, 4], MB: [121, 4], S: [113, 4], L: [108, 4], DS: [109, 4] },
};

export const DEFAULT_WEIGHTS = {
  OH: { eff: 0.3, kps: 0.15, pass: 0.25, ace: 0.08, serr: 0.07, dps: 0.15 },
  OPP: { eff: 0.4, kps: 0.25, bps: 0.2, ace: 0.08, serr: 0.07 },
  MB: { eff: 0.4, bps: 0.35, kps: 0.15, ace: 0.05, serr: 0.05 },
  S: { aps: 0.4, dps: 0.15, ace: 0.12, serr: 0.08, bps: 0.1, eff: 0.15 },
  L: { pass: 0.55, dps: 0.3, ace: 0.08, serr: 0.07 },
  DS: { pass: 0.45, dps: 0.35, ace: 0.1, serr: 0.1 },
};
export const METRIC_LABEL = { eff: 'Hitting eff.', kps: 'Kills / set', pass: 'Pass rating', ace: 'Ace %', serr: 'Serve err %', dps: 'Digs / set', bps: 'Blocks / set', aps: 'Assists / set' };
const LOWER_IS_BETTER = new Set(['serr']);

export function parseHeight(v) {
  if (v == null || v === '') return NaN;
  const s = String(v).trim();
  let m = s.match(/^(\d)\s*['’\-\s]\s*(\d{1,2})/);
  if (m) return Number(m[1]) * 12 + Number(m[2]);
  m = s.match(/^(\d{2,3}(?:\.\d+)?)$/);
  if (m) { const x = Number(m[1]); return x > 100 ? x / 2.54 : x; } // cm → in
  return NaN;
}
export const fmtHeight = (inches) => (Number.isFinite(inches) ? `${Math.floor(inches / 12)}'${Math.round(inches % 12)}"` : '—');

// Posterior (on a working scale) for each metric: { mean, sd, n } with level adjustment.
export function prospectMetrics(p) {
  const pos = REF.eff[p.pos] ? p.pos : 'OH';
  const s = p.stats || {};
  const lvl = levelOf(p.level);
  const sets = Math.max(0, s.sets || 0);
  const out = {};
  const rateMetric = (key, y, n, prior, k, invert = false) => {
    const a = prior * k + y, b = (1 - prior) * k + (n - y);
    const m = a / (a + b);
    const lsd = Math.sqrt(1 / a + 1 / b);
    const shift = invert ? -lvl.shift : lvl.shift;
    out[key] = { logitMean: logit(m) + shift, logitSd: lsd, n, raw: n ? y / n : NaN, kind: 'rate' };
    out[key].mean = expit(out[key].logitMean);
  };
  const perSet = (key, count, prior, kSets = 15) => {
    const shape = prior * kSets + count, rateP = kSets + sets;
    const m = shape / rateP;
    out[key] = { logMean: Math.log(m) + 0.8 * lvl.shift, logSd: 1 / Math.sqrt(shape), n: sets, raw: sets ? count / sets : NaN, kind: 'perset' };
    out[key].mean = Math.exp(out[key].logMean);
  };
  const A = s.attack || {}, S = s.serve || {}, P = s.pass || {};
  // Hitting: kill% and error% separately, eff = difference.
  const kp = REF.eff[pos][0] + 0.15, ep = 0.14;
  rateMetric('_kill', A.k || 0, A.att || 0, Math.min(0.6, kp), 60);
  rateMetric('_aerr', A.e || 0, A.att || 0, ep, 60, true);
  out.eff = { mean: out._kill.mean - out._aerr.mean, raw: A.att ? ((A.k || 0) - (A.e || 0)) / A.att : NaN, n: A.att || 0, kind: 'eff' };
  rateMetric('ace', S.ace || 0, S.att || 0, REF.ace[pos][0], 80);
  rateMetric('serr', S.err || 0, S.att || 0, REF.serr[pos][0], 80, true);
  // Pass rating on a 0–3 scale, treated as a rate (avg/3) with pseudo-count.
  const pAtt = P.att || (P.p0 || 0) + (P.p1 || 0) + (P.p2 || 0) + (P.p3 || 0);
  const pSum = (P.p1 || 0) + 2 * (P.p2 || 0) + 3 * (P.p3 || 0);
  rateMetric('_pass', pSum / 3, pAtt, REF.pass[pos][0] / 3, 30);
  out.pass = { ...out._pass, mean: 3 * out._pass.mean, raw: pAtt ? pSum / pAtt : NaN, kind: 'pass' };
  perSet('kps', A.k || 0, REF.kps[pos][0]);
  perSet('dps', s.dig?.digs || 0, REF.dps[pos][0]);
  perSet('bps', s.block?.stuffs || 0, REF.bps[pos][0]);
  perSet('aps', s.assists || 0, REF.aps[pos][0]);
  return { pos, level: lvl, metrics: out };
}

function tScore(key, pos, value) {
  const [m, sdv] = REF[key][pos];
  const z = (value - m) / sdv;
  return LOWER_IS_BETTER.has(key) ? -z : z;
}

// Full evaluation with an 80% range from posterior simulation.
export function evaluateProspect(p, { weights = DEFAULT_WEIGHTS, physicalWeight = 0.35, draws = 400, seed } = {}) {
  const { pos, level, metrics } = prospectMetrics(p);
  const W = weights[pos] || weights.OH;
  const wsum = Object.values(W).reduce((s, x) => s + x, 0);
  const R = rng(seed ?? hash(p.id || p.name || 'x'));
  const height = parseHeight(p.height), approach = Number(p.approach);
  const phys = [];
  if (Number.isFinite(height)) phys.push(tScore('height', pos, height));
  if (Number.isFinite(approach) && approach > 0) phys.push(tScore('approach', pos, approach));
  const physZ = phys.length ? mean(phys) : null;
  const pw = physZ == null ? 0 : physicalWeight;

  const drawValue = (key) => {
    const m = metrics[key];
    if (key === 'eff') return expit(metrics._kill.logitMean + metrics._kill.logitSd * R.normal()) - expit(metrics._aerr.logitMean + metrics._aerr.logitSd * R.normal());
    if (m.kind === 'perset') return Math.exp(m.logMean + m.logSd * R.normal());
    const v = expit(m.logitMean + m.logitSd * R.normal());
    return m.kind === 'pass' ? 3 * v : v;
  };
  // A weighted average of z-scores has sd < 1; rescale so the composite is a true z-score
  // (assuming roughly independent metrics) and 60 means one standard deviation above typical.
  const statSd = Math.sqrt(Object.values(W).reduce((s, w) => s + (w / wsum) ** 2, 0));
  const blendSd = Math.sqrt((1 - pw) ** 2 + pw ** 2);
  const scoreOf = (valueFn) => {
    let z = 0;
    for (const [k, w] of Object.entries(W)) z += (w / wsum) * tScore(k, pos, valueFn(k));
    return 50 + 10 * (((1 - pw) * (z / statSd) + pw * (physZ ?? 0)) / blendSd);
  };
  const point = scoreOf((k) => metrics[k].mean);
  const sims = Array.from({ length: draws }, () => scoreOf(drawValue)).sort((a, b) => a - b);
  const components = Object.keys(W).map((k) => ({ key: k, label: METRIC_LABEL[k], weight: W[k] / wsum, raw: metrics[k].raw, adjusted: metrics[k].mean, n: metrics[k].n, z: tScore(k, pos, metrics[k].mean) }));
  const flags = [];
  const s = p.stats || {};
  if (['OH', 'OPP', 'MB'].includes(pos) && (s.attack?.att || 0) < 120) flags.push('Small attack sample');
  if (['L', 'DS', 'OH'].includes(pos) && (s.pass?.att || 0) < 80) flags.push('Small passing sample');
  if (Number.isFinite(metrics.eff.raw) && metrics.eff.raw - metrics.eff.mean > 0.08) flags.push('Stats inflated by level');
  if (physZ != null && physZ >= 1.5) flags.push('Elite physical profile');
  if (!Number.isFinite(height)) flags.push('No verified height');
  return { pos, level, score: point, lo: quantile(sims, 0.1), hi: quantile(sims, 0.9), physical: physZ == null ? null : 50 + 10 * physZ, components, flags, height, approach };
}

function hash(str) { let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

export const STATUSES = ['Watching', 'Evaluate live', 'Contacted', 'Offered', 'Committed', 'Passed'];
