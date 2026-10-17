"""LangGraph pipeline (§4): linear with conditional edges; the human gate is a LangGraph interrupt."""
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from .agents.enrichment import enrichment_node
from .agents.execution import execution_node
from .agents.learning import learning_node
from .agents.notification import notification_node
from .agents.reasoning import reasoning_node
from .state import AuraState, audit


def human_decision_node(state: AuraState) -> dict:
    """Pauses the graph until /approve or /reject. Chat happens outside the graph while paused."""
    decision = interrupt({"incident_id": state["incident_id"], "proposed_action": state["rca"]["proposed_action"]})
    return {"human_decision": decision, **audit("human_decision", decision, f"human {decision}")}


def after_decision(state: AuraState) -> str:
    return "execution" if state["human_decision"] == "approved" else "learning"


def build():
    g = StateGraph(AuraState)
    g.add_node("enrichment", enrichment_node)
    g.add_node("reasoning", reasoning_node)
    g.add_node("notification", notification_node)
    g.add_node("human_decision", human_decision_node)
    g.add_node("execution", execution_node)
    g.add_node("learning", learning_node)
    g.add_edge(START, "enrichment")
    g.add_edge("enrichment", "reasoning")
    g.add_edge("reasoning", "notification")
    g.add_edge("notification", "human_decision")
    g.add_conditional_edges("human_decision", after_decision, ["execution", "learning"])
    g.add_edge("execution", "learning")
    g.add_edge("learning", END)
    return g.compile(checkpointer=MemorySaver())
