# PointIQ

Rotation analytics, match win probability, lineup modeling and recruiting for volleyball programs.

PointIQ answers the questions a volleyball staff argues about before every match: which rotation to start in, whether the libero should serve, whether a DS for the opposite is worth two subs, which rotation to fix in practice, and how likely we are to win this match, set by set and rally by rally. The answers come from an exact Markov model of the game, not a spreadsheet average.

## Run it

No build step and no dependencies. It's plain ES modules.

```bash
python3 tools/serve.py 8080
```

Then open http://localhost:8080/index.html. Tests run at http://localhost:8080/tests/index.html (19 tests). With Node 18+ installed, `npm test` runs the same suite.

## What's in the app

| Page | What it does | Plan |
|---|---|---|
| Match day | Match win probability, outcome distribution, weakest rotation, what each lineup decision is worth | Starter+ |
| Lineup Lab | Serving order, libero rules (including libero serving in one rotation), serving subs and back-row swaps, court view per rotation, sub budget, serving-order search | Coach+ / search: Program+ |
| Match sim | Best-of-3 / best-of-5, custom set targets, first serve, start-rotation heatmap, game-theory start mixing, practice priorities | Starter+ / heatmap: Coach+ / game theory: Program+ |
| Live tracker | Two-button rally entry; rotations, serve and sets tracked automatically; live set and match win probability; in-match learning; rotation alerts; saves to history | Coach+ |
| Roster | Season stat entry with shrunk model ratings | all |
| Import | DataVolley `.dvw` (Hudl VolleyMetrics, DataVolley, VolleyStation), SoloStats/Hudl/MaxPreps CSV with column mapping, rotation sheets, multi-season history | varies |
| Multi-season model | Bayesian hierarchical model: shrunk current-season rates, next-season projections, persistence, P(rotation is really weak) | Program+ |
| Recruiting board | Level-adjusted, sample-size-aware prospect ratings with 80% ranges; staff weights; compare; notes; status pipeline | Program + Recruiting |
| Plans | Tiers, monthly / season / annual pricing, feature matrix, demo plan switcher | — |

## The math

**Rally model (`src/engine/markov.js`).** State = (our score, their score, our rotation, their rotation, who serves). Each rally is won with a probability that combines our rotation's side-out or point-score rate with the opponent's current rotation via log5 against the league base rate. A set is solved exactly. The deuce region collapses to a score difference in {−1, 0, +1} and that recurrent block is solved by fixed-point iteration. Match probability is a recursion over sets with alternating first serve and a coin toss before the deciding set. It's verified against 20,000-set Monte Carlo.

**Player → rotation model (`src/engine/lineup.js`).**
- Side-out = opponent serve errors + Σ over pass quality of P(pass q | the passers actually on court) × side-out given q, adjusted by the attack efficiency and number of attackers available.
- Point-score = server's ace rate + in-play × win probability given blocking, back-row defense and transition attack.
- Libero replacement, libero serving, serving subs and back-row swaps change who is on court per rotation and phase.
- Every player rate is shrunk toward a position prior.

**Observed + what-if.** When the rates come from real data (observed or hierarchical), lineup edits are applied as the model's change on the log-odds scale relative to the baseline lineup the data was collected with.

**Hierarchical model (`src/engine/hier.js`).** For each phase: `logit p = μ + α_rotation + β_season + γ_season×rotation`, with variance components learned by Gibbs sampling and older seasons down-weighted. It outputs:
- current-season shrunk rates
- next-season projections including turnover uncertainty
- persistence τα²/(τα²+τγ²)
- P(rotation below team average)

**Recruiting (`src/engine/scouting.js`).** Beta and gamma-Poisson shrinkage for sample size, a competition-level shift to an 18-Open equivalent, and position-weighted z-scores rescaled to a 20–80 scale. Measurables are blended in, and the 80% range comes from posterior simulation.

## Honest limits

- **Effect sizes in the player model are informed priors, not yet fit to data.** The coefficients in `LEAGUE.beta` (for example, how much +0.100 hitting efficiency moves side-out) should be re-estimated from a program's own `.dvw` rallies. With a season of VolleyMetrics files that's a logistic regression per phase, and it's the first thing to do with real data.
- **The `.dvw` parser is tested against files written to the published DataVolley layout** (the same one the openvolley R/Python packages read), not yet against real VolleyMetrics exports. Validate on a handful of real files before a demo.
- Recruiting level shifts and reference distributions are starting guesses. A staff should tune them, and a program's own signed-player history can calibrate them.
- Data lives in the browser (localStorage) with JSON backup/restore. Multi-seat staff sharing needs the hosted backend described in `BUSINESS.md`.

## Layout

```
index.html, styles.css         app shell and design system
src/engine/                    pure math and parsing (no DOM), unit-tested
  stats.js markov.js lineup.js optimize.js hier.js importers.js scouting.js plans.js dvwsim.js
src/app/                       UI: store.js (state), ui.js (charts), main.js (router), views/*
tests/                         engine.test.js + browser runner + node runner
tools/serve.py                 no-cache dev server
```
