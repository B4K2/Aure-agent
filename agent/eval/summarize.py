"""Per-scenario table from eval.run_trials JSONL (one or more files).

    uv run python -m eval.summarize eval/results/trials-*.jsonl [--latex ../paper/tables/trials.tex]
"""
import argparse
import json
import statistics
from collections import defaultdict

from .answer_key import KEY


def pct(xs):
    xs = [x for x in xs if x is not None]
    return f"{sum(xs)}/{len(xs)}" if xs else "--"


def med(xs, q=0.5):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    return xs[min(len(xs) - 1, int(q * len(xs)))] if q != 0.5 else statistics.median(xs)


def detect(r):
    """Seconds from the start of injection. Rows written before this fix measured from the end of the
    inject command (negative when the fault bit mid-command); add the command time back."""
    if r.get("detect_s") is None:
        return None
    return r["detect_s"] + (r.get("inject_cmd_s") or 0) if r.get("detect_from") != "start" else r["detect_s"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("files", nargs="+")
    p.add_argument("--latex")
    a = p.parse_args()
    rows = [json.loads(l) for f in a.files for l in open(f) if l.strip()]
    by = defaultdict(list)
    for r in rows:
        by[r["scenario"]].append(r)
    hdr = ["scenario", "n", "detected", "cause", "action", "target", "correct", "first-correct",
           "detect_s med", "ttp med", "ttp p90", "conf med", "resolved"]
    table = []
    for s in [k for k in KEY if k in by]:
        rs = by[s]
        fin = [r.get("final") or {} for r in rs if r.get("final")]
        first = [r.get("first") or {} for r in rs if r.get("first")]
        ttp = [r.get("time_to_final_proposal_s") or r.get("time_to_proposal_s") for r in rs]
        table.append([s, len(rs), pct([bool(r.get("detected")) for r in rs]),
                      pct([f["cause_ok"] for f in fin]), pct([f["action_ok"] for f in fin]),
                      pct([f["target_ok"] for f in fin]), pct([f["correct"] for f in fin]),
                      pct([f["correct"] for f in first]),
                      med([detect(r) for r in rs]), med(ttp), med(ttp, 0.9),
                      med([f.get("calibrated_confidence") for f in fin]),
                      pct([r.get("resolved_by_aura") for r in rs if r.get("decision") == "approve"])])
    fin_all = [r["final"] for r in rows if r.get("final")]
    table.append(["ALL", len(rows), pct([bool(r.get("detected")) for r in rows]),
                  pct([f["cause_ok"] for f in fin_all]), pct([f["action_ok"] for f in fin_all]),
                  pct([f["target_ok"] for f in fin_all]), pct([f["correct"] for f in fin_all]),
                  pct([r["first"]["correct"] for r in rows if r.get("first")]),
                  med([detect(r) for r in rows]),
                  med([r.get("time_to_final_proposal_s") or r.get("time_to_proposal_s") for r in rows]),
                  med([r.get("time_to_final_proposal_s") or r.get("time_to_proposal_s") for r in rows], 0.9),
                  med([f.get("calibrated_confidence") for f in fin_all]),
                  pct([r.get("resolved_by_aura") for r in rows if r.get("decision") == "approve"])])
    fmt = lambda v: "--" if v is None else (f"{v:.2f}" if isinstance(v, float) and v < 1.5 else
                                            f"{v:.0f}" if isinstance(v, float) else str(v))
    w = [max(len(h), *(len(fmt(r[i])) for r in table)) for i, h in enumerate(hdr)]
    print("  ".join(h.ljust(w[i]) for i, h in enumerate(hdr)))
    for r in table:
        print("  ".join(fmt(v).ljust(w[i]) for i, v in enumerate(r)))
    errs = [r for r in rows if r.get("error")]
    if errs:
        print(f"\n{len(errs)} trial(s) with errors:")
        for r in errs:
            print(f"  {r['scenario']} #{r.get('trial')}: {r['error']}")
    if a.latex:
        cols = [0, 1, 6, 3, 4, 9, 10, 11]
        with open(a.latex, "w") as f:
            f.write("\\begin{tabular}{@{}lccccccc@{}}\n\\toprule\n"
                    "Scenario & $n$ & Correct & Cause & Action & TTP med (s) & TTP p90 (s) & $\\hat p$ med \\\\\n\\midrule\n")
            for r in table:
                if r[0] == "ALL":
                    f.write("\\midrule\n")
                f.write(" & ".join(fmt(r[i]).replace("_", "\\_") for i in cols) + " \\\\\n")
            f.write("\\bottomrule\n\\end{tabular}\n")
        print(f"wrote {a.latex}")


if __name__ == "__main__":
    main()
