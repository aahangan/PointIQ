"""Rally log: one row per rally, from PointIQ's live tracker, DataVolley files or play-by-play.

Columns (CSV / JSON keys):
  match_id      any string, one per match
  set           1..5
  score_us      our score BEFORE the rally
  score_them    their score BEFORE the rally
  rot_us        our rotation 0..5 (R1..R6, setter's zone)
  rot_them      their rotation 0..5, or -1 if unknown
  serving       "us" or "them"
  won           1 if we won the rally
  server        (optional) who served
  opponent, date, season, target (optional; target defaults to 25, 15 in set 5)
"""
from __future__ import annotations

import re
from typing import Iterable

import numpy as np
import pandas as pd

REQUIRED = ["match_id", "set", "score_us", "score_them", "rot_us", "serving", "won"]


def to_frame(rows: Iterable[dict] | pd.DataFrame) -> pd.DataFrame:
    df = rows.copy() if isinstance(rows, pd.DataFrame) else pd.DataFrame(list(rows))
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"Rally log is missing columns: {', '.join(missing)}")
    df["match_id"] = df["match_id"].astype(str)
    for c in ["set", "score_us", "score_them", "rot_us", "won"]:
        df[c] = pd.to_numeric(df[c], errors="raise").astype(int)
    df["rot_them"] = pd.to_numeric(df.get("rot_them", -1), errors="coerce").fillna(-1).astype(int)
    df["serving"] = df["serving"].map(lambda s: "us" if str(s).lower() in ("us", "0", "home", "true") else "them")
    if "season" not in df.columns:
        df["season"] = "all"
    df["season"] = df["season"].fillna("all").astype(str)
    if "target" not in df.columns:
        df["target"] = np.nan
    df["target"] = df["target"].fillna(df["set"].map(lambda s: 15 if s == 5 else 25)).astype(int)
    if not df["rot_us"].between(0, 5).all():
        raise ValueError("rot_us must be 0..5 (R1..R6)")
    df["phase"] = np.where(df["serving"] == "us", "BP", "SO")
    return add_set_outcomes(df)


def add_set_outcomes(df: pd.DataFrame) -> pd.DataFrame:
    """Label every rally with whether we went on to win that set (the target for evaluation)."""
    df = df.copy()
    final = df.assign(fa=df["score_us"] + df["won"], fb=df["score_them"] + 1 - df["won"]).groupby(["match_id", "set"])[["fa", "fb"]].last()
    final["set_won"] = (final["fa"] > final["fb"]).astype(int)
    complete = ((final[["fa", "fb"]].max(axis=1) >= df.groupby(["match_id", "set"])["target"].first()) & ((final["fa"] - final["fb"]).abs() >= 2))
    final["set_complete"] = complete
    return df.drop(columns=[c for c in ("set_won", "set_complete") if c in df.columns]).merge(final[["set_won", "set_complete"]], left_on=["match_id", "set"], right_index=True)


def counts(df: pd.DataFrame) -> pd.DataFrame:
    """won / n by phase and rotation."""
    g = df.groupby(["phase", "rot_us"])["won"].agg(["sum", "count"]).rename(columns={"sum": "won", "count": "n"})
    full = pd.MultiIndex.from_product([["SO", "BP"], range(6)], names=["phase", "rot_us"])
    return g.reindex(full, fill_value=0).reset_index()


# ---------------------------------------------------------------------------------------
# DataVolley .dvw (Hudl VolleyMetrics, DataVolley, VolleyStation, ovscout2)
# Same layout PointIQ's browser importer reads: scout fields 8 = set, 9/10 = setter zones.
# ---------------------------------------------------------------------------------------
_SKILL = re.compile(r"^([*a])(\d{2})([SREABDF])([HMQTUNO~])([#+!\-/=~])")


def parse_dvw(text: str, our_side: str = "home", match_id: str | None = None) -> pd.DataFrame:
    section, teams, rows = "", [], []
    set_no, hz, vz, rally, last = 1, 1, 1, None, (0, 0)
    for raw in text.replace("\r", "").split("\n"):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("[3"):
            section = line
            continue
        f = line.split(";")
        if section == "[3TEAMS]":
            teams.append(f[1] if len(f) > 1 else "")
            continue
        if section != "[3SCOUT]":
            continue
        code = f[0]
        m = re.match(r"^\*\*(\d)set", code, re.I)
        if m:
            set_no = int(m.group(1)) + 1
            continue
        side = "home" if code[:1] == "*" else "visiting" if code[:1] == "a" else None
        if not side:
            continue
        m = re.match(r"^[*a]z(\d)", code)
        if m:
            if side == "home":
                hz = int(m.group(1))
            else:
                vz = int(m.group(1))
            continue
        m = re.match(r"^[*a]p(\d+):(\d+)", code)
        if m:
            if rally is not None:
                home_won = side == "home"
                rally["won"] = int(home_won == (our_side == "home"))
                rows.append(rally)
                rally = None
            last = (int(m.group(1)), int(m.group(2)))
            continue
        s = _SKILL.match(code)
        if s and s.group(3) == "S":
            fset = int(f[8]) if len(f) > 8 and f[8].isdigit() else set_no
            hsz = int(f[9]) if len(f) > 9 and f[9].isdigit() else hz
            vsz = int(f[10]) if len(f) > 10 and f[10].isdigit() else vz
            ours_home = our_side == "home"
            rally = {
                "match_id": match_id or "dvw", "set": fset,
                "score_us": last[0] if ours_home else last[1], "score_them": last[1] if ours_home else last[0],
                "rot_us": (hsz if ours_home else vsz) - 1, "rot_them": (vsz if ours_home else hsz) - 1,
                "serving": "us" if (side == "home") == ours_home else "them",
                "server": s.group(2).lstrip("0"),
            }
    df = pd.DataFrame(rows)
    if len(teams) >= 2 and not df.empty:
        df["opponent"] = teams[1] if our_side == "home" else teams[0]
    # scores reset each set: the point line carries the running score, so rebuild per set
    if not df.empty:
        df = _rebuild_scores(df)
    return df


def _rebuild_scores(df: pd.DataFrame) -> pd.DataFrame:
    out = []
    for _, g in df.groupby(["match_id", "set"], sort=False):
        g = g.copy()
        won = g["won"].to_numpy()
        g["score_us"] = np.concatenate([[0], np.cumsum(won)[:-1]])
        g["score_them"] = np.concatenate([[0], np.cumsum(1 - won)[:-1]])
        out.append(g)
    return pd.concat(out, ignore_index=True)


# ---------------------------------------------------------------------------------------
# Generic play-by-play (e.g. public college box-score play-by-play): who served, who won.
# Rotation isn't printed, but it can be recovered: with a fixed serving order, the player
# serving identifies the rotation. Receiving rallies take the rotation of our *next* server
# minus one. Without the setter's serving slot, rotations are labelled by serve slot.
# ---------------------------------------------------------------------------------------
def parse_pbp(df: pd.DataFrame, us: str, setter_server: str | None = None) -> pd.DataFrame:
    """df columns: match_id, set, serving_team, server, point_winner (team names)."""
    rows = []
    for (mid, st), g in df.groupby(["match_id", "set"], sort=False):
        g = g.reset_index(drop=True)
        ours = g[g["serving_team"] == us]["server"].tolist()
        order = list(dict.fromkeys(ours))  # first-appearance order = serving order
        if len(order) == 0:
            continue
        slot = {name: k for k, name in enumerate(order)}
        # rotation index as serve slot; convert to setter-zone rotations if the setter is known
        def to_rot(k):
            if setter_server and setter_server in slot:
                return (slot[setter_server] - k) % 6
            return k % 6
        cur, a, b = None, 0, 0
        pending = []
        for _, r in g.iterrows():
            serving_us = r["serving_team"] == us
            if serving_us:
                cur = slot[r["server"]]
                for p in pending:
                    p["rot_us"] = to_rot((cur - 1) % 6)
                pending = []
            won = int(r["point_winner"] == us)
            row = {"match_id": mid, "set": int(st), "score_us": a, "score_them": b, "rot_them": -1,
                   "serving": "us" if serving_us else "them", "won": won, "server": r["server"],
                   "rot_us": to_rot(cur) if cur is not None else None}
            if not serving_us and cur is None:
                pending.append(row)
            rows.append(row)
            a, b = a + won, b + (1 - won)
    out = pd.DataFrame(rows)
    return out[out["rot_us"].notna()].astype({"rot_us": int})
