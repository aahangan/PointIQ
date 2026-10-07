"""PointIQ model service: a small Flask API behind the JavaScript front end.

  GET  /api/health                      -> {"ok": true, "version": ...}
  POST /api/fit       {rallies, method} -> per-rotation SO/BP with 80% intervals (kept in memory)
  POST /api/predict   {state, rates?}   -> P(win set), P(win match) from any live state
  POST /api/evaluate  {rallies, method} -> Brier / log loss / calibration vs baselines
  POST /api/crosscheck {rates?}         -> exact Markov vs Monte Carlo
  POST /api/demo-season {matches, seed} -> a simulated season of rallies (for trying it out)

Run:  python -m pointiq_model serve --port 5050
"""
from __future__ import annotations

import numpy as np
from flask import Flask, jsonify, request

from . import __version__
from .estimate import fit_rates, rally_level_cv
from .evaluate import crosscheck, evaluate, live_shift
from .markov import US, THEM, MatchModel, expit, logit, rally_matrices
from .rallies import to_frame
from .simulate import simulate_season

DEFAULT_ORIGINS = ("http://localhost", "http://127.0.0.1")


def create_app(allowed_origins=DEFAULT_ORIGINS) -> Flask:
    app = Flask(__name__)
    app.config["LAST_FIT"] = None

    @app.after_request
    def cors(resp):
        origin = request.headers.get("Origin", "")
        if any(origin == o or origin.startswith(o + ":") for o in allowed_origins):
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Vary"] = "Origin"
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        return resp

    @app.errorhandler(ValueError)
    def bad_request(e):
        return jsonify({"error": str(e)}), 400

    @app.route("/api/<path:_any>", methods=["OPTIONS"])
    def preflight(_any):
        return ("", 204)

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True, "version": __version__, "fitted": app.config["LAST_FIT"] is not None})

    def body():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            raise ValueError("Send a JSON object.")
        return data

    @app.post("/api/fit")
    def fit():
        data = body()
        df = to_frame(data.get("rallies") or [])
        if len(df) < 30:
            raise ValueError("Need at least 30 rallies to fit.")
        rates = fit_rates(df, data.get("method", "hierarchical"))
        rates["rallies"], rates["matches"] = int(len(df)), int(df["match_id"].nunique())
        rates["rally_cv"] = rally_level_cv(df)
        app.config["LAST_FIT"] = rates
        return jsonify(rates)

    @app.post("/api/predict")
    def predict():
        data = body()
        rates = data.get("rates") or app.config["LAST_FIT"]
        if not rates:
            raise ValueError("No fitted rates: call /api/fit first or send rates.")
        st = data.get("state") or {}
        so, bp = np.asarray(rates["so"], float), np.asarray(rates["bp"], float)
        # optional in-match update from tonight's rallies: [{phase, rot_us, won}]
        tonight = data.get("tonight") or []
        comps = rates.get("components") or {}
        for ph, arr in (("SO", so), ("BP", bp)):
            rows = [r for r in tonight if r.get("phase") == ph]
            sd = max(0.05, comps.get(ph, {}).get("match_sd", 0.2))
            d = live_shift([r["won"] for r in rows], [arr[int(r["rot_us"])] for r in rows], sd)
            arr[:] = expit(logit(arr) + d)
        pS, pR = rally_matrices(so, bp, st.get("them_so"), st.get("them_bp"))
        mm = MatchModel(pS, pR, best_of=int(st.get("best_of", 5)), target=int(st.get("target", 25)), deciding_target=int(st.get("deciding_target", 15)),
                        start=(int(st.get("start_us", 0)), int(st.get("start_them", 0))))
        serve = lambda v: US if v in ("us", 0, "0") else THEM
        p_set, p_match = mm.live(int(st.get("sets_us", 0)), int(st.get("sets_them", 0)), int(st.get("a", 0)), int(st.get("b", 0)),
                                 int(st.get("rot_us", 0)), int(st.get("rot_them", 0)), serve(st.get("serving", "us")), serve(st.get("first_this_set", "us")))
        return jsonify({"set": p_set, "match": p_match, "so": so.tolist(), "bp": bp.tolist()})

    @app.post("/api/evaluate")
    def evaluate_route():
        data = body()
        df = to_frame(data.get("rallies") or [])
        res = evaluate(df, data.get("method", "hierarchical"), folds=int(data.get("folds", 5)), bootstrap=int(data.get("bootstrap", 300)))
        res.pop("predictions", None)
        return jsonify(res)

    @app.post("/api/crosscheck")
    def crosscheck_route():
        data = body()
        rates = data.get("rates") or app.config["LAST_FIT"]
        if not rates:
            raise ValueError("No fitted rates.")
        return jsonify(crosscheck(rates["so"], rates["bp"], n=int(data.get("n", 20000))))

    @app.post("/api/demo-season")
    def demo_season():
        data = request.get_json(silent=True) or {}
        df = simulate_season(int(data.get("matches", 30)), seasons=tuple(data.get("seasons", ["2025"])), seed=int(data.get("seed", 1)))
        return app.response_class(df.to_json(orient="records"), mimetype="application/json")

    return app
