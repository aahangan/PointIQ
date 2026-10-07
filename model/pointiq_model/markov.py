"""Exact set and match win probability from per-rotation rally odds.

State of a set: (our score a, their score b, our rotation i, their rotation j, who serves s).
Rotations are 0..5 = R1..R6 (named by the setter's zone); a team that sides out rotates
R1 -> R6 -> R5 -> ... -> R2.

  * We serve (s=US): we win the rally with pS[i, j]. Win -> keep serving. Lose -> they rotate, serve.
  * They serve (s=THEM): we win with pR[i, j]. Win -> we rotate and serve. Lose -> they keep serving.

Every score below deuce is solved by backward induction over (a + b), vectorised over the 72
(i, j, s) combinations. Deuce (both teams >= target - 1) only depends on the score difference
d in {-1, 0, +1}, so that recurrent block is a 216 x 216 linear system solved exactly.
"""
from __future__ import annotations

import numpy as np

US, THEM = 0, 1
NEXT = np.array([(r + 5) % 6 for r in range(6)])


def logit(p):
    p = np.clip(np.asarray(p, dtype=float), 1e-9, 1 - 1e-9)
    return np.log(p / (1 - p))


def expit(x):
    return 1.0 / (1.0 + np.exp(-np.asarray(x, dtype=float)))


def rally_matrices(us_so, us_bp, them_so=None, them_bp=None, league_so=0.6):
    """Combine our rotation rates with the opponent's via log5 against the league base rate.

    Returns pS[i, j] (we serve in Ri vs their Rj) and pR[i, j] (they serve). With an unknown
    (league-average) opponent, pS[i, :] == us_bp[i] and pR[i, :] == us_so[i].
    """
    L = league_so
    them_so = np.full(6, L) if them_so is None else np.asarray(them_so, dtype=float)
    them_bp = np.full(6, 1 - L) if them_bp is None else np.asarray(them_bp, dtype=float)
    pS = expit(logit(us_bp)[:, None] + logit(1 - them_so)[None, :] - logit(1 - L))
    pR = expit(logit(us_so)[:, None] + logit(1 - them_bp)[None, :] - logit(L))
    return pS, pR


class SetModel:
    """Exact P(we win the set) from any state, for one set length (25 or 15)."""

    def __init__(self, pS, pR, target=25):
        self.pS, self.pR, self.T = np.asarray(pS, float), np.asarray(pR, float), int(target)
        self._solve_deuce()
        self._solve_body()

    # --- deuce block: unknowns g[d, i, j, s] for d in {-1, 0, 1} ------------------------
    def _solve_deuce(self):
        idx = lambda d, i, j, s: ((d + 1) * 36 + i * 6 + j) * 2 + s
        n = 216
        A, rhs = np.eye(n), np.zeros(n)

        def add(row, d, i, j, s, w):
            if d >= 2:
                rhs[row] += w
            elif d > -2:
                A[row, idx(d, i, j, s)] -= w

        for d in (-1, 0, 1):
            for i in range(6):
                for j in range(6):
                    k = idx(d, i, j, US)
                    p = self.pS[i, j]
                    add(k, d + 1, i, j, US, p)
                    add(k, d - 1, i, NEXT[j], THEM, 1 - p)
                    k = idx(d, i, j, THEM)
                    p = self.pR[i, j]
                    add(k, d + 1, NEXT[i], j, US, p)
                    add(k, d - 1, i, j, THEM, 1 - p)
        g = np.linalg.solve(A, rhs)
        self.G = g.reshape(3, 6, 6, 2)

    def _value(self, a, b):
        T = self.T
        if a >= T and a - b >= 2:
            return np.ones((6, 6, 2))
        if b >= T and b - a >= 2:
            return np.zeros((6, 6, 2))
        if a >= T - 1 and b >= T - 1:
            return self.G[a - b + 1]
        return self.V[a, b]

    # --- everything below deuce, by backward induction on a + b -------------------------
    def _solve_body(self):
        T = self.T
        self.V = np.full((T + 1, T + 1, 6, 6, 2), np.nan)
        pS, pR = self.pS, self.pR
        for total in range(2 * T - 1, -1, -1):
            for a in range(max(0, total - T), min(T, total) + 1):
                b = total - a
                if a > T or b > T or (a >= T - 1 and b >= T - 1) or a >= T or b >= T:
                    continue
                win, lose = self._value(a + 1, b), self._value(a, b + 1)
                v = np.empty((6, 6, 2))
                v[:, :, US] = pS * win[:, :, US] + (1 - pS) * lose[:, NEXT, THEM]
                v[:, :, THEM] = pR * win[NEXT, :, US] + (1 - pR) * lose[:, :, THEM]
                self.V[a, b] = v

    def prob(self, a, b, rot_us, rot_them, serving):
        return float(self._value(int(a), int(b))[int(rot_us), int(rot_them), int(serving)])

    def from_start(self, rot_us=0, rot_them=0, first_serve=US):
        return self.prob(0, 0, rot_us, rot_them, first_serve)


class MatchModel:
    """Best-of-3 or best-of-5. Serve alternates by set; the deciding set is a coin toss."""

    def __init__(self, pS, pR, best_of=5, target=25, deciding_target=15, start=(0, 0)):
        self.best_of, self.need, self.start = best_of, (best_of + 1) // 2, start
        self.main = SetModel(pS, pR, target)
        self.deciding = self.main if deciding_target == target else SetModel(pS, pR, deciding_target)

    def _solver(self, k):
        return self.deciding if k == self.best_of - 1 else self.main

    def _set_p(self, k, serve):
        return self._solver(k).from_start(self.start[0], self.start[1], serve)

    def _from_boundary(self, wu, wt, prev_first):
        if wu >= self.need:
            return 1.0
        if wt >= self.need:
            return 0.0
        k = wu + wt
        if k == self.best_of - 1:
            return 0.5 * (self._set_p(k, US) + self._set_p(k, THEM))
        first = THEM if prev_first == US else US
        p = self._set_p(k, first)
        return p * self._from_boundary(wu + 1, wt, first) + (1 - p) * self._from_boundary(wu, wt + 1, first)

    def match_prob(self, first_serve="toss"):
        if first_serve == "toss":
            return 0.5 * (self._from_boundary(0, 0, THEM) + self._from_boundary(0, 0, US))
        return self._from_boundary(0, 0, THEM if first_serve == US else US)

    def live(self, sets_us, sets_them, a, b, rot_us, rot_them, serving, first_this_set):
        if sets_us >= self.need:
            return 1.0, 1.0
        if sets_them >= self.need:
            return 0.0, 0.0
        k = sets_us + sets_them
        ps = self._solver(k).prob(a, b, rot_us, rot_them, serving)
        prev = THEM if k == self.best_of - 1 else first_this_set
        pm = ps * self._from_boundary(sets_us + 1, sets_them, prev) + (1 - ps) * self._from_boundary(sets_us, sets_them + 1, prev)
        return ps, pm


def simulate_sets(pS, pR, target=25, n=20000, rot_us=0, rot_them=0, first_serve=US, seed=0):
    """Monte Carlo cross-check: play n sets in parallel. Returns (win rate, standard error, scores)."""
    rng = np.random.default_rng(seed)
    a = np.zeros(n, int)
    b = np.zeros(n, int)
    i = np.full(n, rot_us)
    j = np.full(n, rot_them)
    s = np.full(n, first_serve)
    live = np.ones(n, bool)
    while live.any():
        idx = np.flatnonzero(live)
        p = np.where(s[idx] == US, pS[i[idx], j[idx]], pR[i[idx], j[idx]])
        won = rng.random(idx.size) < p
        serving_us = s[idx] == US
        a[idx] += won
        b[idx] += ~won
        # side-outs rotate the team that wins the serve back
        lost_serve = serving_us & ~won
        j[idx[lost_serve]] = NEXT[j[idx[lost_serve]]]
        s[idx[lost_serve]] = THEM
        sided_out = ~serving_us & won
        i[idx[sided_out]] = NEXT[i[idx[sided_out]]]
        s[idx[sided_out]] = US
        done = ((a[idx] >= target) | (b[idx] >= target)) & (np.abs(a[idx] - b[idx]) >= 2)
        live[idx[done]] = False
    wins = a > b
    return float(wins.mean()), float(wins.std(ddof=1) / np.sqrt(n)), np.stack([a, b], axis=1)
