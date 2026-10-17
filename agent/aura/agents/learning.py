"""Post-Incident Learning Agent: write the outcome to both memories — rejected hypotheses included (§10)."""
import logging

from ..memory import graph_db, vector_db
from ..state import AuraState, audit, now
from .enrichment import describe

log = logging.getLogger("aura.learning")


def learning_node(state: AuraState) -> dict:
    rca = state["rca"]
    confirmed = state.get("human_decision") == "approved" and bool((state.get("execution_result") or {}).get("resolved"))
    action = rca["proposed_action"]["type"]
    # Rejecting "investigate further" says the diagnosis wasn't useful, not that the root cause is wrong;
    # stored as inconclusive so it doesn't count as a misdiagnosis penalty next time.
    inconclusive = not confirmed and action in ("investigate_further", "scale")
    text = vector_db.incident_text(state["service"], rca["root_cause_type"], rca["hypothesis"],
                                   action if confirmed else f"nothing (hypothesis {state.get('human_decision')})",
                                   describe(state))
    errors = []
    try:
        vector_db.upsert_incidents([{"incident_id": state["incident_id"], "service": state["service"],
                                     "root_cause_type": rca["root_cause_type"], "resolved_by": action,
                                     "confirmed": confirmed, "inconclusive": inconclusive,
                                     "timestamp": now(), "text": text}])
    except Exception as e:
        errors.append(f"qdrant: {e}")
    try:
        # A rejected hypothesis says nothing true about the deploy, so no CAUSED edge for it.
        commit = (state["deployment_context"].get("suspect") or {}).get("hash") if confirmed else None
        graph_db.record_incident(state["incident_id"], state["service"], rca["root_cause_type"], confirmed, now(),
                                 action, commit)
    except Exception as e:
        errors.append(f"neo4j: {e}")
    for e in errors:
        log.warning("learning write failed: %s", e)
    label = "confirmed" if confirmed else "inconclusive" if inconclusive else "rejected"
    return audit("learning", "remember", f"stored as {label} "
                 f"{rca['root_cause_type']}" + (f" (errors: {errors})" if errors else ""))
