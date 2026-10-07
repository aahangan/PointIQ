"""Per-rotation side-out (SO) and point-scoring (BP) rates from rally logs.

Two estimators, both built for small samples (a rotation can have only a handful of rallies):

* ``empirical_bayes`` — beta-binomial: the six rotations of a phase share a Beta prior whose
  mean and concentration are estimated from the rotations themselves (method of moments).
  Fast, closed-form, the default fallback.

* ``hierarchical`` — Bayesian logistic mixed model (statsmodels BinomialBayesMixedGLM, fit by
  variational Bayes) on individual rallies:

      logit P(win rally) = mu + a_rotation + b_match,   a ~ N(0, s_rot^2), b ~ N(0, s_match^2)

  The rotation effects are partially pooled toward the team average (shrinkage learned from
  the data), and the match effect soaks up opponent strength, so a rotation isn't blamed for
  having happened to face better teams. Rates are reported for a typical opponent (b = 0).
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from scipy import stats

from .markov import expit
from .rallies import counts

Z80 = 1.2815515655446004


def quiet_blas():
    """macOS Accelerate + NumPy 2.0 raise spurious divide/overflow warnings inside matmul
    (results are correct). Silence them only around scikit-learn calls."""
    return np.errstate(divide="ignore", over="ignore", invalid="ignore")


def _pack(method, so, bp, so_lo, so_hi, bp_lo, bp_hi, c, extra=None):
    so_c, bp_c = c[c.phase == "SO"].sort_values("rot_us"), c[c.phase == "BP"].sort_values("rot_us")
    raw = lambda d: [float(w / n) if n else None for w, n in zip(d["won"], d["n"])]
    out = {
        "method": method,
        "so": list(map(float, so)), "bp": list(map(float, bp)),
        "so_lo": list(map(float, so_lo)), "so_hi": list(map(float, so_hi)),
        "bp_lo": list(map(float, bp_lo)), "bp_hi": list(map(float, bp_hi)),
        "n_so": so_c["n"].astype(int).tolist(), "n_bp": bp_c["n"].astype(int).tolist(),
        "raw_so": raw(so_c), "raw_bp": raw(bp_c),
    }
    if extra:
        out.update(extra)
    return out


def empirical_bayes(df: pd.DataFrame, min_kappa=20.0, max_kappa=2000.0) -> dict:
    c = counts(df)
    res = {}
    for phase, base in (("SO", 0.6), ("BP", 0.4)):
        d = c[c.phase == phase].sort_values("rot_us")
        y, n = d["won"].to_numpy(float), d["n"].to_numpy(float)
        N = n.sum()
        m = y.sum() / N if N else base
        if (n > 0).sum() >= 3:
            r = np.where(n > 0, y / np.maximum(n, 1), m)
            s2 = np.sum(n * (r - m) ** 2) / N
            between = s2 - m * (1 - m) / np.mean(n[n > 0])
            kappa = max_kappa if between <= 0 else float(np.clip(m * (1 - m) / between - 1, min_kappa, max_kappa))
        else:
            kappa = 50.0
        a, b = m * kappa + y, (1 - m) * kappa + n - y
        res[phase] = (a / (a + b), stats.beta.ppf(0.1, a, b), stats.beta.ppf(0.9, a, b), kappa)
    return _pack("empirical_bayes", res["SO"][0], res["BP"][0], res["SO"][1], res["SO"][2], res["BP"][1], res["BP"][2], c,
                 {"kappa": {"SO": res["SO"][3], "BP": res["BP"][3]}})


def hierarchical(df: pd.DataFrame, group: str = "match_id") -> dict:
    from statsmodels.genmod.bayes_mixed_glm import BinomialBayesMixedGLM

    c = counts(df)
    res, comps = {}, {}
    for phase in ("SO", "BP"):
        d = df[df.phase == phase][["won", "rot_us", group]].copy()
        d["rot"] = d["rot_us"].astype(str)
        d["grp"] = d[group].astype(str)
        vc = {"rot": "0 + C(rot)"}
        if d["grp"].nunique() > 1:
            vc["grp"] = "0 + C(grp)"
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            model = BinomialBayesMixedGLM.from_formula("won ~ 1", vc, d)
            fit = model.fit_vb()
        fe, fe_sd = float(fit.fe_mean[0]), float(fit.fe_sd[0])
        names = list(model.vcp_names)
        re = fit.random_effects("rot") if hasattr(fit, "random_effects") else None
        mean = np.zeros(6)
        sd = np.full(6, np.nan)
        for r in range(6):
            key = f"C(rot)[{r}]"
            if re is not None and key in re.index:
                mean[r], sd[r] = re.loc[key, "Mean"], re.loc[key, "SD"]
        rot_sd = float(np.exp(fit.vcp_mean[names.index("rot")]))
        sd = np.where(np.isnan(sd), rot_sd, sd)  # unseen rotation: prior spread
        tot_sd = np.sqrt(fe_sd ** 2 + sd ** 2)
        eta = fe + mean
        res[phase] = (expit(eta), expit(eta - Z80 * tot_sd), expit(eta + Z80 * tot_sd))
        comps[phase] = {"rotation_sd": rot_sd, "match_sd": float(np.exp(fit.vcp_mean[names.index("grp")])) if "grp" in names else 0.0, "intercept": fe}
    return _pack("hierarchical", res["SO"][0], res["BP"][0], res["SO"][1], res["SO"][2], res["BP"][1], res["BP"][2], c, {"components": comps})


def fit_rates(df: pd.DataFrame, method: str = "hierarchical") -> dict:
    if method == "empirical_bayes":
        return empirical_bayes(df)
    try:
        return hierarchical(df)
    except Exception as e:  # pragma: no cover - degenerate data (e.g. one phase empty)
        out = empirical_bayes(df)
        out["note"] = f"hierarchical fit failed ({e}); used empirical Bayes"
        return out


def rally_level_cv(df: pd.DataFrame, folds: int = 5, seed: int = 0) -> dict:
    """Does knowing the rotation predict rallies better than knowing only who served?

    Grouped (by match) cross-validated log loss of two scikit-learn logistic regressions.
    """
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import log_loss
    from sklearn.model_selection import GroupKFold

    y = df["won"].to_numpy()
    X_phase = (df["phase"] == "BP").to_numpy(float)[:, None]
    X_rot = pd.get_dummies(df["phase"] + df["rot_us"].astype(str)).to_numpy(float)
    groups = df["match_id"].to_numpy()
    k = min(folds, len(np.unique(groups)))
    if k < 2:
        return {}
    out = {}
    for name, X in (("serve_only", X_phase), ("rotation", X_rot)):
        preds = np.zeros(len(y))
        for tr, te in GroupKFold(n_splits=k).split(X, y, groups):
            with quiet_blas():
                m = LogisticRegression(C=1.0, max_iter=1000).fit(X[tr], y[tr])
                preds[te] = m.predict_proba(X[te])[:, 1]
        out[name] = float(log_loss(y, preds))
    out["improvement"] = out["serve_only"] - out["rotation"]
    return out
