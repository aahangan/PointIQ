"""Synthetic seasons with known true rotation rates.

Used for the demo, the test suite, and to check that the estimators recover the truth and
that evaluation behaves before real data exists. Opponents vary in strength match to match,
which is exactly the noise a real season has.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .markov import NEXT, US, THEM, expit, logit, rally_matrices

# A plausible college team: strong R1/R6, a weak R4 (setter front row, weakest passing seam).
TRUE_SO = np.array([0.64, 0.61, 0.62, 0.55, 0.63, 0.60])
TRUE_BP = np.array([0.42, 0.37, 0.41, 0.35, 0.43, 0.39])
SERVERS = ["Lin", "Ellis", "Chen", "Morgan", "Okafor", "Brooks"]  # serving order, setter first


def opponent_profile(rng, strength_sd=0.18, rot_sd=0.12, league_so=0.6):
    shift = rng.normal(0, strength_sd)
    so = expit(logit(league_so) + shift + rng.normal(0, rot_sd, 6))
    bp = expit(logit(1 - league_so) + shift + rng.normal(0, rot_sd, 6))
    return so, bp, shift


def simulate_match(rng, so, bp, opp_so, opp_bp, match_id, best_of=5, season="sim", opponent="Opponent"):
    pS, pR = rally_matrices(so, bp, opp_so, opp_bp)
    need = (best_of + 1) // 2
    rows, sets_us, sets_them, set_no = [], 0, 0, 1
    first = US if rng.random() < 0.5 else THEM
    while sets_us < need and sets_them < need:
        target = 15 if set_no == best_of else 25
        a = b = 0
        i, j = int(rng.integers(6)), int(rng.integers(6))  # starting rotations vary by set
        s = first
        while True:
            p = pS[i, j] if s == US else pR[i, j]
            won = rng.random() < p
            server = SERVERS[(-i) % 6] if s == US else f"opp{j}"
            rows.append({"match_id": match_id, "season": season, "opponent": opponent, "set": set_no, "score_us": a, "score_them": b,
                         "rot_us": i, "rot_them": j, "serving": "us" if s == US else "them", "server": server, "won": int(won)})
            if s == US:
                if won:
                    a += 1
                else:
                    b += 1; j = int(NEXT[j]); s = THEM
            else:
                if won:
                    a += 1; i = int(NEXT[i]); s = US
                else:
                    b += 1
            if (a >= target or b >= target) and abs(a - b) >= 2:
                break
        sets_us += a > b
        sets_them += b > a
        set_no += 1
        first = THEM if first == US else US
        if set_no == best_of:
            first = US if rng.random() < 0.5 else THEM
    return rows


def simulate_season(n_matches=30, seasons=("2025",), seed=1, so=TRUE_SO, bp=TRUE_BP, season_sd=0.08, opponent_sd=0.18):
    """Rallies for one or more seasons. Each season shifts the whole team a little."""
    rng = np.random.default_rng(seed)
    rows = []
    for season in seasons:
        shift = rng.normal(0, season_sd)
        s_so, s_bp = expit(logit(so) + shift), expit(logit(bp) + shift)
        for m in range(n_matches):
            o_so, o_bp, _ = opponent_profile(rng, strength_sd=opponent_sd)
            rows += simulate_match(rng, s_so, s_bp, o_so, o_bp, match_id=f"{season}-{m + 1:02d}", season=season, opponent=f"Opponent {m + 1}")
    return pd.DataFrame(rows)
