"""Command line: python -m pointiq_model <command>

  demo      simulate a season, fit, evaluate, cross-check, write reports/demo/REPORT.md
  fit       fit rotation rates from a rally CSV
  evaluate  out-of-sample evaluation of a rally CSV, writes a report
  dvw       convert DataVolley .dvw files to a rally CSV
  serve     run the model API for the PointIQ front end
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd


def main(argv=None):
    ap = argparse.ArgumentParser(prog="pointiq_model")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("demo"); d.add_argument("--matches", type=int, default=30); d.add_argument("--seasons", default="2024,2025"); d.add_argument("--out", default="reports/demo")
    f = sub.add_parser("fit"); f.add_argument("csv"); f.add_argument("--method", default="hierarchical", choices=["hierarchical", "empirical_bayes"])
    e = sub.add_parser("evaluate"); e.add_argument("csv"); e.add_argument("--method", default="hierarchical"); e.add_argument("--out", default="reports/latest")
    v = sub.add_parser("dvw"); v.add_argument("files", nargs="+"); v.add_argument("--side", default="home", choices=["home", "visiting"]); v.add_argument("--out", default="rallies.csv")
    s = sub.add_parser("serve"); s.add_argument("--port", type=int, default=5050); s.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args(argv)

    from .rallies import to_frame

    if a.cmd == "serve":
        from .server import create_app
        create_app().run(host=a.host, port=a.port)
        return

    if a.cmd == "dvw":
        from .rallies import parse_dvw
        frames = [parse_dvw(Path(p).read_text(errors="replace"), a.side, match_id=Path(p).stem) for p in a.files]
        pd.concat(frames, ignore_index=True).to_csv(a.out, index=False)
        print(f"Wrote {a.out}")
        return

    if a.cmd == "demo":
        from .simulate import simulate_season
        df = to_frame(simulate_season(a.matches, seasons=tuple(a.seasons.split(","))))
        Path(a.out).mkdir(parents=True, exist_ok=True)
        df.to_csv(Path(a.out) / "rallies.csv", index=False)
    else:
        df = to_frame(pd.read_csv(a.csv))

    from .estimate import fit_rates
    rates = fit_rates(df, a.method if a.cmd != "demo" else "hierarchical")
    if a.cmd == "fit":
        json.dump(rates, sys.stdout, indent=2)
        print()
        return

    from .evaluate import crosscheck, evaluate
    from .report import write_report
    res = evaluate(df, rates["method"])
    path = write_report(res, rates, crosscheck(rates["so"], rates["bp"]), a.out, "PointIQ model report (simulated season)" if a.cmd == "demo" else "PointIQ model report")
    print(path.read_text())


if __name__ == "__main__":
    main()
