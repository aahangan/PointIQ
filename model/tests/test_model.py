import numpy as np
import pandas as pd
import pytest

from pointiq_model.estimate import empirical_bayes, hierarchical
from pointiq_model.evaluate import brier, calibration, crosscheck, evaluate, live_shift
from pointiq_model.markov import THEM, US, MatchModel, SetModel, rally_matrices, simulate_sets
from pointiq_model.rallies import counts, parse_dvw, parse_pbp, to_frame
from pointiq_model.server import create_app
from pointiq_model.simulate import TRUE_BP, TRUE_SO, simulate_season


@pytest.fixture(scope="module")
def season():
    return to_frame(simulate_season(24, seasons=("2024", "2025"), seed=3))


def test_symmetric_teams_are_coin_flips():
    pS, pR = rally_matrices(np.full(6, 0.6), np.full(6, 0.4))
    m = SetModel(pS, pR, 25)
    assert m.from_start(0, 0, US) + m.from_start(0, 0, THEM) == pytest.approx(1.0, abs=1e-12)
    assert 0.5 * (m.prob(24, 24, 0, 0, US) + m.prob(24, 24, 0, 0, THEM)) == pytest.approx(0.5, abs=1e-12)
    assert MatchModel(pS, pR, best_of=5).match_prob() == pytest.approx(0.5, abs=1e-12)


def test_terminal_and_deuce_states():
    pS, pR = rally_matrices(TRUE_SO, TRUE_BP)
    m = SetModel(pS, pR, 25)
    assert m.prob(25, 23, 0, 0, US) == 1.0 and m.prob(23, 25, 0, 0, US) == 0.0
    assert m.prob(31, 30, 2, 3, US) > 0.5 > m.prob(30, 31, 2, 3, US)
    assert m.prob(24, 24, 0, 0, US) == pytest.approx(m.prob(30, 30, 0, 0, US), abs=1e-12)  # deuce is score-invariant


def test_exact_matches_monte_carlo():
    for row in crosscheck(TRUE_SO, TRUE_BP, n=20000):
        assert abs(row["z"]) < 4.0, row


def test_bo5_amplifies_edge():
    pS, pR = rally_matrices(TRUE_SO + 0.03, TRUE_BP + 0.03)
    assert MatchModel(pS, pR, 5).match_prob() > MatchModel(pS, pR, 3).match_prob() > 0.5


def test_live_state_at_start_equals_pregame():
    pS, pR = rally_matrices(TRUE_SO, TRUE_BP)
    mm = MatchModel(pS, pR, 5)
    _, pm = mm.live(0, 0, 0, 0, 0, 0, US, US)
    assert pm == pytest.approx(mm.match_prob(US), abs=1e-12)


def test_set_outcomes_labelled(season):
    last = season.groupby(["match_id", "set"]).tail(1)
    assert ((last["won"] == 1) == (last["set_won"] == 1)).all()  # whoever wins the last rally wins the set
    assert season["set_complete"].all()


def test_estimators_recover_truth(season):
    h = hierarchical(season)
    assert np.max(np.abs(np.array(h["so"]) - TRUE_SO)) < 0.04
    assert np.max(np.abs(np.array(h["bp"]) - TRUE_BP)) < 0.05
    covered = sum(lo <= t <= hi for lo, t, hi in zip(h["so_lo"] + h["bp_lo"], list(TRUE_SO) + list(TRUE_BP), h["so_hi"] + h["bp_hi"]))
    assert covered >= 7  # 80% intervals: expect ~9.6 of 12
    for fit in (h, empirical_bayes(season)):
        assert np.argmin(fit["so"]) == 3, fit["method"]  # R4 is the true weak side-out rotation
        assert all(lo <= m <= hi for lo, m, hi in zip(fit["so_lo"], fit["so"], fit["so_hi"]))


def test_small_samples_are_shrunk():
    df = to_frame(simulate_season(2, seed=9))
    fit = empirical_bayes(df)
    c = counts(df)
    raw = c[c.phase == "SO"].sort_values("rot_us")
    raw_rates = raw["won"] / raw["n"]
    pooled = raw["won"].sum() / raw["n"].sum()
    assert np.all(np.abs(np.array(fit["so"]) - pooled) <= np.abs(raw_rates - pooled) + 1e-12)


def test_live_shift_direction():
    assert live_shift([1, 1, 1, 1], [0.5] * 4, 0.2) > 0 > live_shift([0, 0, 0, 0], [0.5] * 4, 0.2)
    assert live_shift([], [], 0.2) == 0.0


def test_metrics():
    y = np.array([1, 0, 1, 0.0])
    assert brier(y, y) == 0.0 and brier(1 - y, y) == 1.0
    rows, ece = calibration(np.array([0.1, 0.1, 0.9, 0.9]), np.array([0, 0, 1, 1.0]))
    assert ece == pytest.approx(0.1)


def test_evaluation_is_calibrated(season):
    res = evaluate(season, folds=4, bootstrap=100)
    for name in ("live_markov", "rotation_markov"):
        assert res["models"][name]["ece"] < 0.05, name
    assert res["models"]["live_markov"]["brier"] < res["models"]["score_only"]["brier"] + 0.002


def test_in_match_update_beats_score_only_when_opponents_vary():
    df = to_frame(simulate_season(40, seed=11, opponent_sd=0.45))
    res = evaluate(df, folds=5, bootstrap=200)
    live = res["models"]["live_markov"]
    assert live["brier_improvement_vs_score_only"]["ci95"][0] > 0
    assert live["brier"] < res["models"]["rotation_markov"]["brier"]


DVW = """[3DATAVOLLEYSCOUT]
[3TEAMS]
H1;Home U;0;;
V1;Visit U;0;;
[3SCOUT]
*z1;;;;;;;;1;1;3;;;;
az3;;;;;;;;1;1;3;;;;
*03SQ+;;;;;;;19.00.01;1;1;3;1;1;;03;11;12;09;07;15;04;10;21;08;13;22;
a10RQ-;;;;;;;19.00.02;1;1;3;1;2;;03;11;12;09;07;15;04;10;21;08;13;22;
*p01:00;;;;;;;19.00.03;1;1;3;1;3;;03;11;12;09;07;15;04;10;21;08;13;22;
*03SQ=;;;;;;;19.00.04;1;1;3;1;4;;03;11;12;09;07;15;04;10;21;08;13;22;
ap01:01;;;;;;;19.00.05;1;1;3;1;5;;03;11;12;09;07;15;04;10;21;08;13;22;
az2;;;;;;;;1;1;2;;;;
a10SQ+;;;;;;;19.00.06;1;1;2;1;6;;03;11;12;09;07;15;10;21;08;13;22;04;
*p02:01;;;;;;;19.00.07;1;1;2;1;7;;03;11;12;09;07;15;10;21;08;13;22;04;
"""


def test_parse_dvw():
    df = parse_dvw(DVW, "home", "m1")
    assert list(df["serving"]) == ["us", "us", "them"]
    assert list(df["won"]) == [1, 0, 1]
    assert list(df["rot_us"]) == [0, 0, 0] and list(df["rot_them"]) == [2, 2, 1]
    assert list(df["score_us"]) == [0, 1, 1] and list(df["score_them"]) == [0, 0, 1]
    away = parse_dvw(DVW, "visiting", "m1")
    assert list(away["won"]) == [0, 1, 0] and list(away["serving"]) == ["them", "them", "us"]


def test_parse_pbp_recovers_rotation_from_server():
    rows = [("A", "x1"), ("them", "o1"), ("A", "x2"), ("A", "x2"), ("them", "o2"), ("A", "x3")]
    winners = ["A", "A", "them", "A", "A", "A"]
    raw = pd.DataFrame([{"match_id": "m", "set": 1, "serving_team": t, "server": s, "point_winner": w} for (t, s), w in zip(rows, winners)])
    raw.loc[raw.serving_team == "them", "serving_team"] = "B"
    raw.loc[raw.point_winner == "them", "point_winner"] = "B"
    out = parse_pbp(raw, us="A")
    assert list(out["rot_us"]) == [0, 0, 1, 1, 1, 2]


def test_api_roundtrip():
    app = create_app()
    c = app.test_client()
    assert c.get("/api/health").get_json()["ok"]
    rallies = c.post("/api/demo-season", json={"matches": 8, "seed": 2}).get_json()
    assert len(rallies) > 500
    fit = c.post("/api/fit", json={"rallies": rallies}).get_json()
    assert len(fit["so"]) == 6 and fit["method"] == "hierarchical"
    p = c.post("/api/predict", json={"state": {"a": 20, "b": 15, "rot_us": 1, "serving": "us"}}).get_json()
    assert 0.8 < p["set"] < 1 and 0 < p["match"] < 1
    hot = c.post("/api/predict", json={"state": {}, "tonight": [{"phase": "SO", "rot_us": 0, "won": 1}] * 10}).get_json()
    cold = c.post("/api/predict", json={"state": {}}).get_json()
    assert hot["match"] > cold["match"]
    assert c.post("/api/fit", json={"rallies": []}).status_code == 400
    r = c.get("/api/health", headers={"Origin": "http://localhost:8080"})
    assert r.headers["Access-Control-Allow-Origin"] == "http://localhost:8080"
    r = c.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "Access-Control-Allow-Origin" not in r.headers
