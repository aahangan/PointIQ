# PointIQ predictive model

The statistical side of PointIQ. It learns each rotation's side-out and point-scoring odds from real rallies, turns them into exact set and match win probabilities, checks those predictions against real results, and serves them to the PointIQ front end as a small Flask API.

## Setup (once)

```bash
cd model
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Use

```bash
.venv/bin/python -m pointiq_model demo                  # simulate 2 seasons, fit, evaluate → reports/demo/REPORT.md
.venv/bin/python -m pointiq_model serve                 # API on http://127.0.0.1:5050 for PointIQ's Model lab
.venv/bin/python -m pointiq_model evaluate rallies.csv  # full report on your own rally log
.venv/bin/python -m pointiq_model fit rallies.csv       # rotation rates as JSON
.venv/bin/python -m pointiq_model dvw m1.dvw m2.dvw --side home --out rallies.csv   # DataVolley → rally log
.venv/bin/python -m pytest -q tests                     # 15 tests
```

## Pipeline

1. **Data collection.** One row per rally: match, set, score before the rally, our rotation, their rotation, who served, server, who won. Sources:
   - PointIQ's Live tracker (saved automatically when a match is saved)
   - DataVolley `.dvw` files (`rallies.parse_dvw`)
   - public play-by-play (`rallies.parse_pbp`). Play-by-play lists the server and point winner but not the rotation. With a fixed serving order, the server *is* the rotation, so it's recovered from serve order. Receiving rallies get the rotation just before our next server.
2. **Per-rotation rates with small-sample protection** (`estimate.py`)
   - `hierarchical` (default): Bayesian logistic mixed model fit by variational Bayes (statsmodels `BinomialBayesMixedGLM`). `logit P(win) = μ + a_rotation + b_match`. Rotations are partially pooled toward the team average, and the match effect absorbs opponent strength. Rates are reported for a typical opponent, with 80% intervals.
   - `empirical_bayes`: beta-binomial shrinkage, closed form. Faster, but with only six rotations to estimate its prior from it tends to over-shrink.
   - `rally_level_cv`: grouped cross-validated scikit-learn logistic regressions checking whether rotation predicts rallies better than serve/receive alone.
3. **Set model** (`markov.py`)
   - Every state (our score, their score, both rotations, server) is solved exactly. Normal scores use backward induction; deuce is a 216-state linear system.
   - `MatchModel` handles best-of-3/5 with alternating serve and a coin toss for the deciding set.
   - `simulate_sets` is the Monte Carlo cross-check (exact vs 20,000 simulated sets, agreement within ~3 standard errors).
4. **Evaluation** (`evaluate.py`)
   - 5-fold cross-validation grouped by match. At every rally state in held-out matches, each model predicts P(win this set); the label is whether we did.
   - Metrics: Brier score, log loss, expected calibration error, a 10-bin calibration table/chart, and a match-level bootstrap 95% interval for each model's Brier improvement over the **score-only baseline** (a logistic regression on the score).
5. **Live use** (`server.py`): `/api/fit`, `/api/predict` (with an in-match update from tonight's rallies), `/api/evaluate`, `/api/crosscheck`, `/api/demo-season`. It only answers browser pages served from `localhost`.

## What the simulated demo shows

From `reports/demo/REPORT.md` (60 simulated matches, 10,088 rally states):

| Model | Brier | Skill vs score-only | Improvement, 95% CI |
|---|---|---|---|
| Rotation model + in-match update | 0.158 | +5.1% | +0.009 [+0.003, +0.014] |
| Rotation model (pre-match only) | 0.165 | +0.6% | +0.001 [−0.002, +0.004] |
| Flat Markov (no rotations) | 0.165 | +0.8% | +0.001 [−0.002, +0.005] |
| Score-only baseline | 0.166 | — | — |

**Pre-match rotation rates alone barely beat the score.** Who wins a set is driven mostly by the score and by how good tonight's opponent is. The gain comes from updating the estimate of the opponent rally by rally (`evaluate.live_shift`), which is what the live tracker and `/api/predict` do. Across random seeds with ~50 matches that gain is always positive but not always statistically significant. Proving it on real data will take a full season or more of logged matches. The rotation estimates themselves are accurate with far less: the weak R4 side-out (true 55.0%) is estimated at 54.6% (80% range 52.5–56.7%).

All demo numbers are simulated. They show the pipeline works and recovers known truth, not how a real team plays.

## Real data still to do

- Log the coach's matches with the Live tracker (≈10 matches gives usable rotation estimates).
- Validate `parse_dvw` on real VolleyMetrics files.
- Public college play-by-play: NCAA statistics pages publish rally-by-rally play-by-play with servers. Check the site's terms before collecting it in bulk, then feed it through `parse_pbp`. Rotations are labeled by serve slot unless you pass `setter_server`.
- PyMC: the hierarchical model is written with statsmodels, which works on this Mac's Python 3.9. A PyMC version (full MCMC) would need Python 3.10+.
