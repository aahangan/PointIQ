"""Does the model predict who wins the set? Out-of-sample evaluation against baselines.

For every rally in a held-out match, each model predicts P(we win this set) from the state
before the rally. The label is whether we actually won that set. Matches are split with
grouped K-fold (a match is never in both training and test), so nothing leaks.

Models compared
  live_markov      rotation_markov + an in-match Bayesian update of tonight's opponent strength
                   from the rallies already played (what PointIQ's live tracker uses)
  rotation_markov  per-rotation SO/BP (hierarchical or empirical Bayes) -> exact set Markov chain
  flat_markov      one SO and one BP rate for every rotation -> same Markov chain
  score_only       logistic regression on the score alone (the simple baseline)

Metrics: Brier score (mean squared error of the probability; lower is better), log loss,
Brier skill vs the score-only baseline, expected calibration error, a 10-bin calibration
table, and a match-level bootstrap 95% interval for the Brier difference.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .estimate import fit_rates, quiet_blas
from .markov import SetModel, US, THEM, expit, logit, rally_matrices, simulate_sets


def _score_features(d: pd.DataFrame) -> np.ndarray:
    a, b, t = d["score_us"].to_numpy(float), d["score_them"].to_numpy(float), d["target"].to_numpy(float)
    diff = a - b
    progress = np.maximum(a, b) / t
    return np.column_stack([diff, diff * progress, diff * progress ** 2, (t == 15).astype(float)])


def _markov_predict(d: pd.DataFrame, so, bp) -> np.ndarray:
    pS, pR = rally_matrices(np.asarray(so), np.asarray(bp))
    models = {t: SetModel(pS, pR, t) for t in d["target"].unique()}
    out = np.empty(len(d))
    for k, (a, b, r, s, t) in enumerate(zip(d["score_us"], d["score_them"], d["rot_us"], d["serving"], d["target"])):
        out[k] = models[t].prob(a, b, r, 0, US if s == "us" else THEM)
    return out


class _ModelCache:
    """SetModels keyed by (rounded) rate shifts so per-rally re-solves stay cheap."""

    def __init__(self, so, bp, step=0.02):
        self.so, self.bp, self.step, self.cache = logit(so), logit(bp), step, {}

    def get(self, d_so, d_bp, target):
        key = (round(d_so / self.step), round(d_bp / self.step), int(target))
        if key not in self.cache:
            pS, pR = rally_matrices(expit(self.so + key[0] * self.step), expit(self.bp + key[1] * self.step))
            self.cache[key] = SetModel(pS, pR, target)
        return self.cache[key]


def live_shift(won, p, prior_sd):
    """Posterior mean of a match effect on the logit scale after these rallies (one Laplace /
    Newton step from 0 with a N(0, prior_sd^2) prior)."""
    won, p = np.asarray(won, float), np.asarray(p, float)
    return float(np.sum(won - p) / (np.sum(p * (1 - p)) + 1.0 / prior_sd ** 2)) if len(won) else 0.0


def _markov_predict_live(d: pd.DataFrame, rates: dict) -> np.ndarray:
    comps = rates.get("components") or {}
    sd = {ph: max(0.05, comps.get(ph, {}).get("match_sd", 0.2)) for ph in ("SO", "BP")}
    cache = _ModelCache(np.asarray(rates["so"]), np.asarray(rates["bp"]))
    base = {"SO": np.asarray(rates["so"]), "BP": np.asarray(rates["bp"])}
    out = np.empty(len(d))
    pos = {idx: k for k, idx in enumerate(d.index)}
    for _, m in d.groupby("match_id", sort=False):
        hist = {"SO": ([], []), "BP": ([], [])}
        for idx, r in m.iterrows():
            shift = {ph: live_shift(hist[ph][0], hist[ph][1], sd[ph]) for ph in ("SO", "BP")}
            model = cache.get(shift["SO"], shift["BP"], r["target"])
            out[pos[idx]] = model.prob(r["score_us"], r["score_them"], r["rot_us"], 0, US if r["serving"] == "us" else THEM)
            ph = r["phase"]
            hist[ph][0].append(r["won"])
            hist[ph][1].append(float(base[ph][r["rot_us"]]))
    return out


def brier(p, y):
    return float(np.mean((p - y) ** 2))


def log_loss(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def calibration(p, y, bins=10):
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges) - 1, 0, bins - 1)
    rows, ece = [], 0.0
    for k in range(bins):
        m = idx == k
        if m.sum() == 0:
            continue
        pm, ym = float(p[m].mean()), float(y[m].mean())
        rows.append({"bin_lo": float(edges[k]), "bin_hi": float(edges[k + 1]), "predicted": pm, "observed": ym, "n": int(m.sum())})
        ece += m.sum() / len(p) * abs(pm - ym)
    return rows, float(ece)


def evaluate(df: pd.DataFrame, method: str = "hierarchical", folds: int = 5, bootstrap: int = 500, seed: int = 0) -> dict:
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import GroupKFold

    d = df[df["set_complete"]].reset_index(drop=True)
    matches = d["match_id"].unique()
    k = min(folds, len(matches))
    if k < 2:
        raise ValueError("Need at least 2 complete matches to evaluate out of sample.")
    y = d["set_won"].to_numpy(float)
    preds = {name: np.zeros(len(d)) for name in ("live_markov", "rotation_markov", "flat_markov", "score_only")}
    for tr, te in GroupKFold(n_splits=k).split(d, y, d["match_id"]):
        train, test = d.iloc[tr], d.iloc[te]
        rates = fit_rates(train, method)
        preds["rotation_markov"][te] = _markov_predict(test, rates["so"], rates["bp"])
        preds["live_markov"][te] = _markov_predict_live(test, rates)
        so_flat = train.loc[train.phase == "SO", "won"].mean()
        bp_flat = train.loc[train.phase == "BP", "won"].mean()
        preds["flat_markov"][te] = _markov_predict(test, [so_flat] * 6, [bp_flat] * 6)
        with quiet_blas():
            lr = LogisticRegression(max_iter=2000).fit(_score_features(train), y[tr])
            preds["score_only"][te] = lr.predict_proba(_score_features(test))[:, 1]

    results = {}
    for name, p in preds.items():
        cal, ece = calibration(p, y)
        results[name] = {"brier": brier(p, y), "log_loss": log_loss(p, y), "ece": ece, "calibration": cal}
    base = results["score_only"]["brier"]
    for name in results:
        results[name]["brier_skill_vs_score_only"] = 1 - results[name]["brier"] / base

    # match-level (cluster) bootstrap for each model's Brier improvement over score-only
    rng = np.random.default_rng(seed)
    by_match = {m: np.flatnonzero(d["match_id"].to_numpy() == m) for m in matches}
    draws = [np.concatenate([by_match[m] for m in rng.choice(matches, size=len(matches), replace=True)]) for _ in range(bootstrap)]
    sq_base = (preds["score_only"] - y) ** 2
    for name in ("live_markov", "rotation_markov", "flat_markov"):
        sq = (preds[name] - y) ** 2
        diffs = [sq_base[idx].mean() - sq[idx].mean() for idx in draws]
        lo, hi = np.percentile(diffs, [2.5, 97.5])
        results[name]["brier_improvement_vs_score_only"] = {"mean": float(np.mean(diffs)), "ci95": [float(lo), float(hi)]}

    return {
        "method": method, "folds": k, "matches": int(len(matches)), "sets": int(d.groupby(["match_id", "set"]).ngroups), "rallies": int(len(d)),
        "models": results,
        "predictions": {"set_won": y.tolist(), **{k2: v.tolist() for k2, v in preds.items()}},
    }


def crosscheck(so, bp, target=25, n=20000, seed=0) -> list:
    """Exact Markov answers vs Monte Carlo simulation for each starting rotation."""
    pS, pR = rally_matrices(np.asarray(so), np.asarray(bp))
    model = SetModel(pS, pR, target)
    rows = []
    for r in range(6):
        for s, label in ((US, "us"), (THEM, "them")):
            exact = model.from_start(r, 0, s)
            mc, se, _ = simulate_sets(pS, pR, target, n=n, rot_us=r, first_serve=s, seed=seed + 10 * r + s)
            rows.append({"start": r, "first_serve": label, "exact": exact, "monte_carlo": mc, "se": se, "z": (mc - exact) / se if se else 0.0})
    return rows
