"""Repeated end-to-end trials: inject → wait for Aura's proposal → score vs answer key → decide → recover.

    uv run python -m eval.run_trials --trials 5                       # all 10 scenarios × 5
    uv run python -m eval.run_trials --scenarios db-lock,db-outage --trials 3 --out eval/results/run.jsonl

Needs the stack up (Qdrant/Neo4j, test-website, `npm run traffic` in problem/, `python -m aura.main`).
Each trial appends one JSON line. Decisions follow the paper's procedure, automated:
  correct + actionable → approve (Aura executes and verifies)
  advisory (investigate_further/scale) → reject "inconclusive" (stored as inconclusive, not a misdiagnosis)
  wrong → reject with the reason, then the injector's own recover fixes the site
Approvals/rejections are written to memory, so later trials see earlier ones (as in real use). Use
--order to interleave or block scenarios, and reseed memory between runs for a cold-memory condition.
"""
import argparse
import json
import os
import random
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from websockets.sync.client import connect

from aura import config
from .answer_key import ADVISORY, KEY, score

INJECT = ["node", str(config.PROBLEM_DIR / "inject.js")]


class Feed:
    """Every WebSocket event, stamped on arrival (monotonic + wall clock)."""

    def __init__(self):
        self.events: list[tuple[float, dict]] = []
        self.cv = threading.Condition()
        url = f"ws://{config.API_HOST if config.API_HOST != '0.0.0.0' else '127.0.0.1'}:{config.API_PORT}/ws?token={config.API_TOKEN}"
        self.url = url
        self.restarts = 0  # server restarts seen; incidents live in server memory, so a trial spanning one is void
        self.ws = connect(url, max_size=None)
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        while True:
            try:
                for raw in self.ws:
                    ev = json.loads(raw)
                    with self.cv:
                        self.events.append((time.monotonic(), ev))
                        self.cv.notify_all()
            except Exception as e:
                print(f"    (websocket closed: {e}; reconnecting)", flush=True)
            self.restarts += 1
            while True:  # the server restarted or went away: wait for it to come back
                time.sleep(3)
                try:
                    self.ws = connect(self.url, max_size=None)
                    break
                except Exception:
                    pass

    def wait(self, pred, since: int, timeout: float):
        """First event at index >= since matching pred, or None. Returns (index, t, event)."""
        end = time.monotonic() + timeout
        i = since
        with self.cv:
            while True:
                while i < len(self.events):
                    t, ev = self.events[i]
                    if pred(ev):
                        return i, t, ev
                    i += 1
                left = end - time.monotonic()
                if left <= 0:
                    return None
                self.cv.wait(left)

    def mark(self) -> int:
        with self.cv:
            return len(self.events)

    def send(self, msg: dict):
        self.ws.send(json.dumps(msg))


def api(path: str, method="GET", **kw):
    r = httpx.request(method, f"http://127.0.0.1:{config.API_PORT}{path}", headers={"x-aura-token": config.API_TOKEN},
                      timeout=10, **kw)
    r.raise_for_status()
    return r.json()


def site_healthy() -> bool:
    try:
        return httpx.get(f"{config.VOID_URL}/api/health", timeout=3).status_code == 200
    except httpx.HTTPError:
        return False


def head_commit() -> str | None:
    r = subprocess.run(["git", "-C", str(config.WEBSITE_DIR), "rev-parse", "HEAD"], capture_output=True, text=True)
    return r.stdout.strip() or None


def sh(args, timeout=900) -> str:
    r = subprocess.run(args, cwd=config.PROBLEM_DIR, capture_output=True, text=True, timeout=timeout)
    return (r.stdout + r.stderr)[-2000:]


def quiesce(feed: Feed, settle: float, timeout: float = 600) -> bool:
    """Healthy site, no open incident, then `settle` seconds of nothing opening (baselines re-warm)."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            listed = api("/incidents")
        except httpx.HTTPError:  # server restarting
            time.sleep(5)
            continue
        open_ = [i for i in listed if i["status"] not in ("resolved", "rejected", "unresolved")]
        for i in open_:  # leftovers from a crashed trial: close them so grouping doesn't absorb the next fault
            if i["status"] == "awaiting_approval":
                try:
                    api(f"/incidents/{i['incident_id']}/reject", "POST", params={"note": "eval cleanup: stale incident"})
                except httpx.HTTPStatusError:
                    pass
        if not open_ and site_healthy():
            m = feed.mark()
            if feed.wait(lambda e: e.get("type") == "incident_opened", m, settle) is None:
                return True
        time.sleep(5)
    return False


def trial(feed: Feed, scen: str, n: int, a) -> dict:
    row = {"scenario": scen, "trial": n, "started": datetime.now(timezone.utc).isoformat(),
           "detector": os.getenv("AURA_DETECTOR", "default"), "memory": os.getenv("AURA_MEMORY", "on"), "model": config.LLM_MODEL}
    if not quiesce(feed, a.settle):
        row["error"] = "could not reach a quiet, healthy baseline"
        return row
    before = head_commit()
    r0 = feed.restarts
    m0 = feed.mark()
    t_inj = time.monotonic()
    extra = ["--duration", a.spike_duration] if scen == "traffic-spike" else \
            ["--rows", str(a.rows)] if scen == "slow-query" else []
    row["inject_log"] = sh(INJECT + [scen] + extra)
    t_injected = time.monotonic()
    after = head_commit()
    row["fault_commit"] = after if after != before else None
    try:
        hit = feed.wait(lambda e: e.get("type") == "incident_opened", m0, a.detect_timeout)
        if not hit:
            row["detected"] = False
            return row
        mi, t_open, ev = hit
        iid = ev["incident_id"]
        row.update(detected=True, incident_id=iid, inject_cmd_s=round(t_injected - t_inj, 1),
                   detect_s=round(t_open - t_inj, 1), detect_from="start")  # from the start of injection; the fault can bite mid-command
        mine = lambda types: (lambda e: e.get("type") in types and
                              (e.get("incident_id") or (e.get("incident") or {}).get("incident_id")) == iid)
        hit = feed.wait(mine({"awaiting_approval", "closed", "error"}), mi, a.proposal_timeout)
        if not hit or hit[2]["type"] != "awaiting_approval":
            row["proposal"] = None
            row["error"] = (hit[2].get("message") if hit else "no proposal before timeout")
            return row
        mp, t_prop, ev = hit
        inc = ev["incident"]
        row["time_to_proposal_s"] = round(t_prop - t_open, 1)
        row["first"] = _prop(inc, scen, row["fault_commit"])
        # Advisory first answer: give re-analysis on new evidence a chance (it's part of the system).
        if inc["rca"]["proposed_action"]["type"] in ADVISORY and scen != "traffic-spike":
            hit2 = feed.wait(mine({"action_changed"}), mp, a.reanalysis_wait)
            if hit2:
                inc, row["time_to_final_proposal_s"] = hit2[2]["incident"], round(hit2[1] - t_open, 1)
        row["final"] = fin = _prop(inc, scen, row["fault_commit"])
        row["anomalies"] = [x["metric_name"] for x in inc.get("anomalies_detected") or []]
        row["stages"] = _stages(feed, iid, mi, t_open)
        md = feed.mark()
        if fin["correct"] and fin["action"] not in ADVISORY:
            decision, note = "approve", ""
        elif fin["action"] in ADVISORY:
            decision, note = "reject", "eval: inconclusive" + ("" if fin["correct"] else f"; expected {sorted(KEY[scen]['action'])}")
        else:
            decision, note = "reject", f"eval: wrong diagnosis; expected {sorted(KEY[scen]['cause'])} → {sorted(KEY[scen]['action'])}"
        t_dec = time.monotonic()
        api(f"/incidents/{iid}/{decision}", "POST", params={"note": note})
        row["decision"] = decision
        hit = feed.wait(mine({"closed"}), md, config.VERIFY_WINDOW_SECONDS + 120)
        if hit:
            row["closed_status"] = hit[2]["incident"]["status"]
            row["decision_to_close_s"] = round(hit[1] - t_dec, 1)  # execute + verify for approvals
            row["resolved_by_aura"] = bool((hit[2]["incident"].get("execution_result") or {}).get("resolved"))
        return row
    finally:
        if feed.restarts != r0:
            row["error"] = "void: Aura server restarted during the trial"
        row["recover_log"] = sh(INJECT + ["recover", scen])


def _prop(inc: dict, scen: str, commit: str | None) -> dict:
    rca = inc.get("rca") or {}
    act = rca.get("proposed_action") or {}
    return {"root_cause_type": rca.get("root_cause_type"), "action": act.get("type"), "target": act.get("target"),
            "raw_confidence": rca.get("llm_confidence"), "calibrated_confidence": rca.get("calibrated_confidence"),
            "hypothesis": rca.get("hypothesis"),
            "adjustments": rca.get("confidence_adjustments"), **score(scen, rca, commit)}


def _stages(feed: Feed, iid: str, since: int, t0: float) -> list:
    return [{"stage": e["stage"], "t": round(t - t0, 1)} for t, e in feed.events[since:]
            if e.get("type") == "stage" and e.get("incident_id") == iid]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--scenarios", default=",".join(KEY))
    p.add_argument("--trials", type=int, default=5)
    p.add_argument("--order", choices=["round-robin", "blocked", "shuffled"], default="round-robin")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--out", default=f"eval/results/trials-{datetime.now():%Y%m%d-%H%M}.jsonl")
    p.add_argument("--settle", type=float, default=90, help="quiet seconds required before each injection")
    p.add_argument("--detect-timeout", type=float, default=420, help="memory-leak needs minutes to show")
    p.add_argument("--proposal-timeout", type=float, default=240)
    p.add_argument("--reanalysis-wait", type=float, default=90)
    p.add_argument("--rows", type=int, default=3_000_000, help="slow-query bulk import size")
    p.add_argument("--spike-duration", default="5m")
    a = p.parse_args()
    scen = [s.strip() for s in a.scenarios.split(",") if s.strip()]
    bad = set(scen) - set(KEY)
    if bad:
        p.error(f"unknown scenarios: {bad}")
    plan = [(s, n) for n in range(1, a.trials + 1) for s in scen] if a.order == "round-robin" else \
           [(s, n) for s in scen for n in range(1, a.trials + 1)]
    if a.order == "shuffled":
        random.Random(a.seed).shuffle(plan)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    feed = Feed()
    for k, (s, n) in enumerate(plan, 1):
        print(f"[{k}/{len(plan)}] {s} #{n} …", flush=True)
        try:
            row = trial(feed, s, n, a)
        except Exception as e:  # keep the campaign going; the row records why
            row = {"scenario": s, "trial": n, "error": f"{type(e).__name__}: {e}"}
            sh(INJECT + ["recover", s])
        with out.open("a") as f:
            f.write(json.dumps(row) + "\n")
        f_ = row.get("final") or {}
        print(f"    detected={row.get('detected')} ttp={row.get('time_to_proposal_s')} "
              f"{f_.get('root_cause_type')}/{f_.get('action')} correct={f_.get('correct')} "
              f"→ {row.get('decision')} {row.get('closed_status') or row.get('error') or ''}", flush=True)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
