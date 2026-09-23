// Small numeric toolkit shared by every PointIQ model. Pure functions, no DOM.

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const logit = (p) => { p = clamp(p, 1e-6, 1 - 1e-6); return Math.log(p / (1 - p)); };
export const expit = (x) => 1 / (1 + Math.exp(-x));
export const sum = (a) => a.reduce((s, x) => s + x, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : NaN);
export const variance = (a) => { const m = mean(a); return a.length > 1 ? sum(a.map((x) => (x - m) ** 2)) / (a.length - 1) : 0; };
export const sd = (a) => Math.sqrt(variance(a));

// log5 / odds-ratio combination: `a` is one side's rate, `b` the other side's rate
// expressed in the same direction, `base` is the league rate both are measured against.
// When either side is exactly league-average the other side's rate comes back unchanged.
export function log5(a, b, base) {
  return expit(logit(a) + logit(b) - logit(base));
}

// Deterministic PRNG so simulations and Gibbs runs are reproducible.
export function rng(seed = 1) {
  let t = seed >>> 0;
  const next = () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  next.normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = next();
    v = next();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
  // Marsaglia–Tsang gamma sampler (shape k, scale 1).
  next.gamma = (k) => {
    if (k < 1) return next.gamma(k + 1) * Math.pow(next(), 1 / k);
    const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = next.normal(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = next();
      if (u < 1 - 0.0331 * x ** 4) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };
  next.invGamma = (shape, scale) => scale / next.gamma(shape);
  return next;
}

export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Standard normal quantile (Acklam's approximation, |error| < 1.2e-9).
export function qnorm(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Beta posterior summary with a logit-normal interval (good enough for n >= ~5).
export function betaSummary(alpha, beta, level = 0.8) {
  const m = alpha / (alpha + beta);
  const v = alpha * beta / ((alpha + beta) ** 2 * (alpha + beta + 1));
  const z = qnorm(0.5 + level / 2);
  const lv = v / (m * (1 - m)) ** 2; // delta-method variance on the logit scale
  return { mean: m, lo: expit(logit(m) - z * Math.sqrt(lv)), hi: expit(logit(m) + z * Math.sqrt(lv)) };
}

// Empirical-Bayes beta-binomial shrinkage. Given many (successes, trials) pairs from the
// same population, estimate the population Beta(m·κ, (1-m)·κ) by method of moments and
// return each unit's posterior. κ is floored so tiny pools don't over-shrink or under-shrink.
export function fitBetaPrior(units, { fallbackMean = 0.5, fallbackKappa = 50, minKappa = 5, maxKappa = 2000 } = {}) {
  const valid = units.filter((u) => u.n > 0);
  const N = sum(valid.map((u) => u.n));
  if (valid.length < 4 || N === 0) return { m: fallbackMean, kappa: fallbackKappa };
  const m = sum(valid.map((u) => u.y)) / N;
  const rates = valid.map((u) => u.y / u.n);
  const w = valid.map((u) => u.n);
  const sw = sum(w);
  const s2 = sum(rates.map((r, i) => w[i] * (r - m) ** 2)) / sw;
  const nbar = sw / valid.length;
  // Var(rate) = m(1-m)/n + m(1-m)/(κ+1)·(1 - 1/n)  →  solve for κ
  const between = s2 - m * (1 - m) / nbar;
  if (between <= 0) return { m, kappa: maxKappa };
  const kappa = clamp(m * (1 - m) / between - 1, minKappa, maxKappa);
  return { m, kappa };
}

export function shrink(y, n, prior, level = 0.8) {
  const a = prior.m * prior.kappa + y, b = (1 - prior.m) * prior.kappa + (n - y);
  return { ...betaSummary(a, b, level), raw: n ? y / n : NaN, n };
}

export const fmtPct = (p, d = 1) => (Number.isFinite(p) ? (100 * p).toFixed(d) + '%' : '—');
export const fmtNum = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
