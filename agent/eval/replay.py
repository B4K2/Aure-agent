"""Replay a recording (eval.record) through the detector and count pages. The detector profile comes from
the environment (AURA_DETECTOR=naive, AURA_SIGMA, …), so compare profiles by running this once per profile:

    uv run python -m eval.replay eval/results/baseline-clean.jsonl
    AURA_DETECTOR=naive uv run python -m eval.replay eval/results/baseline-clean.jsonl
    uv run python -m eval.replay --compare eval/results/baseline-clean.jsonl   # both + ablations, one table

A "page" is what the server would open as an incident: the first confirmed anomaly when no incident is
open. Grouping is simulated the way aura.main does it: an incident stays open for --hold seconds (debounce +
analysis + the human closing it) and absorbs anomalies; then a 30 s cooldown.
"""
import argparse
import json
import os
import subprocess
import sys
from collections import Counter


def replay(path: str, hold: float, cooldown: float) -> dict:
    from aura.agents import observability as o
    from aura.config import POLL_SECONDS

    recs = [json.loads(l) for l in open(path)]
    obs = o.Observer()
    obs._health = lambda: cur["health"]
    obs._metrics = lambda: cur["metrics"]
    obs._db = lambda: cur["db"]
    obs._logs = lambda: [l for l in cur["logs"] if o.LOG_KEEP.search(l)]
    pages, anomaly_polls, by_metric = [], 0, Counter()
    open_until = closed_at = -1e18
    for cur in recs:
        t = cur["t"]
        found = obs.poll()
        if not found:
            continue
        anomaly_polls += 1
        by_metric.update(a["metric_name"] for a in found)
        if t < open_until:
            continue  # absorbed by the open incident
        if t - closed_at < cooldown and closed_at > 0:
            continue
        pages.append({"t": t, "metrics": sorted({a["metric_name"] for a in found}),
                      "excerpt": found[0]["raw_excerpt"][:160]})
        open_until = t + hold
        closed_at = open_until
    hours = len(recs) * POLL_SECONDS / 3600
    return {"file": path, "profile": {"detector": os.getenv("AURA_DETECTOR", "default"), "sigma": o.SIGMA,
                                      "min_sd_frac": o.MIN_SD_FRAC, "abs_floors": o.USE_FLOORS,
                                      "sustain_default": o.SUSTAIN_DEFAULT, "sustain": o.SUSTAIN},
            "polls": len(recs), "hours": round(hours, 2), "pages": len(pages),
            "pages_per_hour": round(len(pages) / hours, 2) if hours else None,
            "anomaly_polls": anomaly_polls, "by_metric": dict(by_metric), "page_list": pages}


# The paper's story: naive 2σ → +4σ → +sd floor → +absolute floors → +sustain (= default).
LADDER = [
    ("naive (2σ)", {"AURA_DETECTOR": "naive"}),
    ("+4σ", {"AURA_DETECTOR": "naive", "AURA_SIGMA": "4"}),
    ("+σ floor 15%", {"AURA_DETECTOR": "naive", "AURA_SIGMA": "4", "AURA_MIN_SD_FRAC": "0.15"}),
    ("+abs floors", {"AURA_DETECTOR": "naive", "AURA_SIGMA": "4", "AURA_MIN_SD_FRAC": "0.15", "AURA_ABS_FLOORS": "1"}),
    ("+sustain (default)", {"AURA_DETECTOR": "default"}),
]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("files", nargs="+")
    p.add_argument("--hold", type=float, default=60, help="seconds an incident stays open (absorbs anomalies)")
    p.add_argument("--cooldown", type=float, default=30)
    p.add_argument("--compare", action="store_true", help="run the detector ladder, print a table")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    if not a.compare:
        res = [replay(f, a.hold, a.cooldown) for f in a.files]
        print(json.dumps(res if a.json else [{k: v for k, v in r.items() if k != "page_list"} for r in res], indent=2))
        return
    knobs = ("AURA_DETECTOR", "AURA_SIGMA", "AURA_MIN_SD_FRAC", "AURA_ABS_FLOORS", "AURA_SUSTAIN")
    print(f"{'profile':22} {'hours':>6} {'pages':>6} {'pages/h':>8}  top metrics")
    for name, env in LADDER:
        e = {k: v for k, v in os.environ.items() if k not in knobs} | env
        out = subprocess.run([sys.executable, "-m", "eval.replay", "--json", "--hold", str(a.hold),
                              "--cooldown", str(a.cooldown), *a.files], env=e, capture_output=True, text=True)
        if out.returncode:
            sys.exit(out.stderr)
        rs = json.loads(out.stdout)
        h, n = sum(r["hours"] for r in rs), sum(r["pages"] for r in rs)
        top = Counter()
        for r in rs:
            top.update(r["by_metric"])
        print(f"{name:22} {h:6.2f} {n:6d} {n / h if h else 0:8.2f}  {', '.join(f'{k}:{v}' for k, v in top.most_common(3))}")


if __name__ == "__main__":
    main()
