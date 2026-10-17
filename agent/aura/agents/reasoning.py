"""Reasoning Agent — Hypothesis Generator + Action Planner (one structured Muse call), then rule calibration (§8)."""
import json

from .. import config, llm
from ..state import DESTRUCTIVE, AuraState, audit


def build_context(state: AuraState) -> str:
    sig = state.get("raw_signals", {})
    mem = state["retrieved_memories"]
    ctx = state["deployment_context"]
    parts = [
        "## Anomalies", *(f"- [{a['signal_type']}] {a['raw_excerpt'][:600]}" for a in state["anomalies_detected"][:20]),
        "## Correlation (deterministic)", state["correlation"]["reason"],
        "## Recent commits (newest first)",
        *(f"- {c['hash']} {c['timestamp']} {c['message']} [{c['diff_summary']}]" for c in ctx["recent_commits"]),
    ]
    if ctx.get("suspect_diff"):
        parts += ["## Diff of suspect commit", ctx["suspect_diff"]]
    parts += ["## Current signals", json.dumps({k: sig.get(k) for k in ("health", "metrics", "db")}, default=str)[:4000]]
    if sig.get("filtered_logs"):
        parts += ["## Filtered error logs (regex pre-filter)", "\n".join(sig["filtered_logs"][-30:])[-4000:]]
    parts.append("## Memory")
    for m in mem.get("confirmed", [])[:3]:
        tag = " (older incident: reference only, not a confirmed match)" if m["older"] else ""
        parts.append(f"- CONFIRMED similar incident (sim {m['similarity']}){tag}: {m['text']}")
    for m in mem.get("rejected", [])[:3]:
        parts.append(f"- REJECTED past hypothesis (sim {m['similarity']}): a similar pattern was previously misdiagnosed as "
                     f"{m['root_cause_type']}: {m['text']}. Consider alternative explanations.")
    for m in mem.get("inconclusive", [])[:2]:
        parts.append(f"- INCONCLUSIVE past incident (sim {m['similarity']}): Aura couldn't pin it down then: {m['text']}")
    if mem.get("causal"):
        parts.append(f"- Graph: deploys of this service have caused incidents before: {json.dumps(mem['causal'], default=str)}")
    if mem.get("frequency"):
        parts.append(f"- Graph: root-cause frequency for this service: {json.dumps(mem['frequency'])}")
    if not any(mem.get(k) for k in ("confirmed", "rejected", "causal")):
        parts.append("- no relevant past incidents")
    return "\n".join(parts)


def calibrate(llm_conf: float, state: AuraState, rca: dict) -> tuple[float, list[str]]:
    score, why = llm_conf, [f"model: {llm_conf:.2f}"]
    # Only a boost when the deploy is what we blame; otherwise proximity is coincidence.
    if state["deployment_context"].get("minutes_since_deploy", 999) <= 5 and rca["proposed_action"]["type"] == "rollback":
        score += 0.15; why.append("+0.15 deploy within 5 min of anomaly")
    mem = state["retrieved_memories"]
    top_c = max(mem.get("confirmed", []), key=lambda m: m["similarity"], default=None)
    if top_c and top_c["similarity"] > 0.85:
        score += 0.10; why.append(f"+0.10 matches confirmed incident {top_c['incident_id']} ({top_c['similarity']})")
    top_r = max(mem.get("rejected", []), key=lambda m: m["similarity"], default=None)
    if top_r and top_r["similarity"] > 0.85:
        score -= 0.20; why.append(f"-0.20 resembles rejected hypothesis {top_r['incident_id']} ({top_r['similarity']})")
    if len({a["signal_type"] for a in state["anomalies_detected"]}) < 2:
        score -= 0.20; why.append("-0.20 fewer than 2 corroborating signal types")
    if rca["proposed_action"]["type"] in DESTRUCTIVE and len(rca["evidence"]) < 2:
        score -= 0.15; why.append("-0.15 destructive action with thin evidence")
    return max(0.0, min(1.0, score)), why


def reasoning_node(state: AuraState) -> dict:
    parsed, raw = llm.generate_rca(build_context(state))
    if parsed is None:  # §7 fallback
        rca = {"hypothesis": "Aura couldn't form a confident hypothesis.", "root_cause_type": "unknown",
               "evidence": [], "llm_confidence": 0.0,
               "proposed_action": {"type": "investigate_further", "target": state["service"], "params": {}},
               "reasoning_trace": f"Structured output failed twice. Last response: {raw[:300]}"}
    else:
        rca = parsed.model_dump()
    conf, why = calibrate(rca["llm_confidence"], state, rca)
    low = conf < config.CONFIDENCE_THRESHOLD
    if low and rca["proposed_action"]["type"] in DESTRUCTIVE:
        # Keep the model's idea visible, but default to the safe action.
        rca["proposed_action"] = {"type": "investigate_further", "target": rca["proposed_action"]["target"],
                                  "params": {"suggested": rca["proposed_action"]}}
        why.append("below threshold → defaulting to investigate_further")
    rca.update(calibrated_confidence=round(conf, 2), confidence_adjustments=why, low_confidence=low)
    return {"rca": rca, **audit("reasoning", "hypothesize",
                                f"{rca['hypothesis']} → {rca['proposed_action']['type']} @ {conf:.2f}")}
