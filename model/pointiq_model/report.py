"""Write an evaluation report: calibration chart (PNG), metrics (JSON) and a Markdown summary."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

LABEL = {
    "live_markov": "Rotation model + in-match update",
    "rotation_markov": "Rotation model (pre-match)",
    "flat_markov": "Flat Markov (no rotations)",
    "score_only": "Score-only baseline",
}


def calibration_png(result: dict, path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(6, 6), dpi=130)
    ax.plot([0, 1], [0, 1], ls="--", color="#888", lw=1, label="Perfect calibration")
    colors = {"live_markov": "#0b7a6e", "rotation_markov": "#33b5a3", "flat_markov": "#d9951a", "score_only": "#7a7a7a"}
    for name, m in result["models"].items():
        cal = m["calibration"]
        x = [c["predicted"] for c in cal]
        y = [c["observed"] for c in cal]
        n = np.array([c["n"] for c in cal], float)
        ax.plot(x, y, marker="o", color=colors.get(name), lw=1.8, label=f"{LABEL.get(name, name)} (Brier {m['brier']:.3f})")
        ax.scatter(x, y, s=20 + 180 * n / n.max(), color=colors.get(name), alpha=0.25)
    ax.set_xlabel("Predicted probability of winning the set")
    ax.set_ylabel("Observed frequency")
    ax.set_title(f"Calibration — {result['matches']} matches, {result['rallies']:,} rally states")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.legend(loc="upper left", fontsize=8, frameon=False)
    ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def write_report(result: dict, rates: dict, crosscheck: list, out_dir: str | Path, title: str = "PointIQ model report") -> Path:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    slim = {k: v for k, v in result.items() if k != "predictions"}
    (out / "metrics.json").write_text(json.dumps({"evaluation": slim, "rates": rates, "crosscheck": crosscheck}, indent=2))
    calibration_png(result, out / "calibration.png")

    lines = [f"# {title}", "", f"{result['matches']} matches · {result['sets']} sets · {result['rallies']:,} rally states · {result['folds']}-fold cross-validation by match", "",
             "## Set win prediction (out of sample)", "", "| Model | Brier ↓ | Log loss ↓ | Calibration error ↓ | Brier skill vs score-only | Improvement, 95% CI |", "|---|---|---|---|---|---|"]
    for name, m in result["models"].items():
        imp = m.get("brier_improvement_vs_score_only")
        ci = f"{imp['mean']:+.4f} [{imp['ci95'][0]:+.4f}, {imp['ci95'][1]:+.4f}]" if imp else "—"
        lines.append(f"| {LABEL.get(name, name)} | {m['brier']:.4f} | {m['log_loss']:.4f} | {m['ece']:.4f} | {m['brier_skill_vs_score_only']:+.1%} | {ci} |")
    lines += ["", "![Calibration](calibration.png)", "", f"## Rotation rates ({rates['method'].replace('_', ' ')}, 80% intervals)", "",
              "| Rotation | Side-out | Rallies | Point-score | Rallies |", "|---|---|---|---|---|"]
    for r in range(6):
        lines.append(f"| R{r + 1} | {rates['so'][r]:.1%} ({rates['so_lo'][r]:.1%}–{rates['so_hi'][r]:.1%}) | {rates['n_so'][r]} | {rates['bp'][r]:.1%} ({rates['bp_lo'][r]:.1%}–{rates['bp_hi'][r]:.1%}) | {rates['n_bp'][r]} |")
    worst = max(abs(c["z"]) for c in crosscheck)
    lines += ["", "## Exact Markov chain vs Monte Carlo", "", f"{len(crosscheck)} starting states, 20,000 simulated sets each. Largest gap: {worst:.2f} standard errors (agreement expected within ~3).", ""]
    (out / "REPORT.md").write_text("\n".join(lines))
    return out / "REPORT.md"
