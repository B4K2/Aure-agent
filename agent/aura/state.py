"""Shared state object (§5) and the structured RCA schema (§7)."""
import operator
from datetime import datetime, timezone
from typing import Annotated, Literal, Optional, TypedDict

from pydantic import BaseModel, Field

SignalType = Literal["metric", "log", "infra_event"]  # infra_event = container/process events (no K8s in the demo)
ActionType = Literal["rollback", "restart_service", "terminate_db_sessions", "start_db", "scale", "investigate_further"]
DESTRUCTIVE = {"rollback", "restart_service", "terminate_db_sessions", "start_db"}
RootCause = Literal[
    "bad_deploy", "crash_on_boot", "memory_leak", "cpu_saturation", "db_pool_leak", "slow_query",
    "db_connection_exhaustion", "db_lock", "db_outage", "traffic_spike", "unknown",
]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Anomaly(TypedDict):
    id: str
    signal_type: SignalType
    metric_name: Optional[str]
    value: Optional[float]
    baseline: Optional[float]
    deviation_sigma: Optional[float]
    detected_at: str
    raw_excerpt: str


class Evidence(BaseModel):
    source: Literal["deploy_event", "log", "metric", "memory", "db"]
    detail: str


class ProposedAction(BaseModel):
    type: ActionType
    target: str = Field(description="service name, commit hash, or postgres application_name")
    params: dict = Field(default_factory=dict)


class RCAOutput(BaseModel):
    """What the Hypothesis Generator + Action Planner must return (one structured call)."""
    hypothesis: str
    root_cause_type: RootCause
    evidence: list[Evidence]
    llm_confidence: float = Field(ge=0, le=1)
    proposed_action: ProposedAction
    reasoning_trace: str


class RCAHypothesis(TypedDict):
    hypothesis: str
    root_cause_type: str
    evidence: list[dict]
    llm_confidence: float
    calibrated_confidence: float
    confidence_adjustments: list[str]  # why the number moved (§8)
    proposed_action: dict
    reasoning_trace: str
    low_confidence: bool


class AuraState(TypedDict, total=False):
    incident_id: str
    service: str
    raw_signals: dict
    anomalies_detected: list[Anomaly]
    deployment_context: dict
    correlation: dict
    retrieved_memories: dict
    rca: Optional[RCAHypothesis]
    notification: str
    dry_run: str
    human_decision: Optional[Literal["approved", "rejected", "chatting"]]
    conversation_history: list[dict]
    execution_result: Optional[dict]
    audit_trail: Annotated[list[dict], operator.add]  # append-only


def audit(node: str, action: str, summary: str) -> dict:
    """Every node returns this in `audit_trail` on exit, even if it did nothing (§5)."""
    return {"audit_trail": [{"node": node, "timestamp": now(), "action": action, "output_summary": summary}]}
