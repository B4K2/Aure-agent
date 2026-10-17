"""Notification Agent: phrasing (Summary Writer) + the dry-run the human sees before approving."""
from .. import llm
from ..state import AuraState, audit
from .execution import dry_run


def notification_node(state: AuraState) -> dict:
    rca = state["rca"]
    action = rca["proposed_action"]
    plain = (f"{rca['hypothesis']}\nProposed: {action['type']} → {action['target']}\n"
             f"Confidence {rca['calibrated_confidence']:.0%}" + (" — LOW CONFIDENCE, needs review" if rca["low_confidence"] else ""))
    text = llm.summarize(plain + "\nEvidence: " + "; ".join(e["detail"] for e in rca["evidence"])) or plain
    return {"notification": text, "dry_run": dry_run(action),
            **audit("notification", "notify", "low confidence, flagged for review" if rca["low_confidence"] else "action pre-selected")}
