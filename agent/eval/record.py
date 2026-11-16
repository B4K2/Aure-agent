"""Record the observer's raw inputs (health, derived metrics, DB probe, new log lines) every poll, to JSONL.
No LLM, no agent server needed. Replay the file through any detector profile with eval.replay.

    uv run python -m eval.record --duration 90m --out eval/results/baseline-clean.jsonl

Run it on clean traffic (problem/: npm run traffic -- --users 20) for the false-alarm rate. Stop the Aura
server first or point it elsewhere: both tail the same server log independently, which is fine, but each
holds one Postgres session.
"""
import argparse
import json
import time
from pathlib import Path

from aura import config
from aura.agents.observability import Observer


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--duration", default="60m")
    p.add_argument("--out", required=True)
    a = p.parse_args()
    from_unit = {"s": 1, "m": 60, "h": 3600}
    secs = float(a.duration[:-1]) * from_unit[a.duration[-1]] if a.duration[-1] in from_unit else float(a.duration)
    obs = Observer()
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    end = time.monotonic() + secs
    n = 0
    with out.open("a") as f:
        while time.monotonic() < end:
            t = time.monotonic()
            rec = {"t": time.time(), "health": obs._health(), "metrics": obs._metrics(), "db": obs._db(),
                   "logs": obs._logs()}
            f.write(json.dumps(rec, default=str) + "\n")
            f.flush()
            n += 1
            if n % 60 == 0:
                print(f"{n} polls ({n * config.POLL_SECONDS / 60:.0f} min)", flush=True)
            time.sleep(max(0.5, config.POLL_SECONDS - (time.monotonic() - t)))
    print(f"wrote {n} polls to {out}")


if __name__ == "__main__":
    main()
