"""Context Enrichment Agent — Deployment Fetcher, Correlation Engine, Memory Retriever. All plain code."""
import logging
import subprocess
from datetime import datetime, timezone

from .. import config
from ..runtime import runtime
from ..memory import graph_db, vector_db
from ..state import AuraState, audit

log = logging.getLogger("aura.enrichment")
CORRELATION_WINDOW_MIN = 15


def _git(*args: str) -> str:
    r = subprocess.run(["git", "-C", str(config.WEBSITE_DIR), *args], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def recent_commits(n: int = 5) -> list[dict]:
    """Diff SUMMARY per commit (files + added/removed + message), not the full diff (§6).
    Without a checkout of the site (Aura running in the cluster), the Deployment's rollout history."""
    if not (config.WEBSITE_DIR / ".git").exists() and hasattr(runtime, "deploy_history"):
        return runtime.deploy_history(n)
    out = []
    for line in _git("log", f"-{n}", "--format=%h%x1f%cI%x1f%an%x1f%s").splitlines():
        h, ts, author, msg = line.split("\x1f")
        stat = _git("show", "--numstat", "--format=", h)
        files = [{"file": f, "added": int(a or 0), "removed": int(r or 0)}
                 for a, r, f in (l.split("\t") for l in stat.splitlines() if l.count("\t") == 2) if a != "-"]
        out.append({"hash": h, "timestamp": ts, "author": author, "message": msg, "files": files,
                    "diff_summary": ", ".join(f"{f['file']} +{f['added']}/-{f['removed']}" for f in files)})
    return out


def full_diff(commit: str) -> str:
    return _git("show", "--stat", "--patch", commit)[:12000]


def correlate(anomalies: list[dict], commits: list[dict]) -> dict:
    """Deterministic: is there a deploy within the window before the first anomaly?"""
    if not anomalies:
        return {"suspect_commit": None, "reason": "no anomalies"}
    first = min(datetime.fromisoformat(a["detected_at"]) for a in anomalies)
    for c in commits:  # newest first
        ts = datetime.fromisoformat(c["timestamp"]).astimezone(timezone.utc)
        mins = (first - ts).total_seconds() / 60
        if -1 <= mins <= CORRELATION_WINDOW_MIN:
            return {"suspect_commit": c["hash"], "minutes_before_anomaly": round(mins, 1),
                    "reason": f"commit {c['hash']} '{c['message']}' landed {mins:.1f} min before the first anomaly"}
    newest = commits[0] if commits else None
    return {"suspect_commit": None, "reason": "no deploy within "
            f"{CORRELATION_WINDOW_MIN} min of the anomaly" + (f" (latest: {newest['hash']} at {newest['timestamp']})" if newest else "")}


def describe(state: AuraState) -> str:
    """Text used to search memory: the live symptoms."""
    return "; ".join(a["raw_excerpt"].split("\n")[0] for a in state["anomalies_detected"][:12])


def enrichment_node(state: AuraState) -> dict:
    commits = recent_commits()
    corr = correlate(state["anomalies_detected"], commits)
    suspect = next((c for c in commits if c["hash"] == corr["suspect_commit"]), None)
    ctx = {"recent_commits": commits, "suspect": suspect,
           "minutes_since_deploy": corr.get("minutes_before_anomaly", 999)}
    if suspect:
        ctx["suspect_diff"] = full_diff(suspect["hash"])[:4000]  # the reasoner needs to see what changed

    memories = {"confirmed": [], "rejected": [], "causal": [], "frequency": [], "impact": [], "errors": []}
    try:
        memories.update(vector_db.search_incidents(describe(state), state["service"]))
    except Exception as e:
        memories["errors"].append(f"qdrant: {e}")
    try:
        for c in commits[:3]:
            graph_db.record_deployment(state["service"], c)
        memories["causal"] = graph_db.causal_history(state["service"])
        memories["frequency"] = graph_db.root_cause_frequency(state["service"])
        memories["impact"] = graph_db.impact(state["service"])
    except Exception as e:
        memories["errors"].append(f"neo4j: {e}")
    for e in memories["errors"]:
        log.warning("memory unavailable: %s", e)

    return {"deployment_context": ctx, "correlation": corr, "retrieved_memories": memories,
            **audit("enrichment", "correlate+retrieve",
                    f"{corr['reason']}; memory: {len(memories['confirmed'])} confirmed, "
                    f"{len(memories['rejected'])} rejected, {len(memories['causal'])} causal links")}
