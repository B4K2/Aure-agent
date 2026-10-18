"""Conversation Agent: ReAct tool loop (§4 exception). Works with or without an incident in focus.
It can only *propose* an action; executing still needs /approve from the human."""
import json
import re
from typing import Callable

from .. import config, db, llm
from ..memory import vector_db
from ..state import ActionType
from .enrichment import full_diff, recent_commits
from .execution import dry_run

SYSTEM = """You are Aura, an SRE co-pilot in the user's terminal, watching the VOID sneaker store
(Node/Express `void-app` on {url}, Postgres `void-db`, code in a local git repo).
Use tools to look at real data before answering; be concise and concrete (commands, hashes, numbers).
You cannot execute fixes yourself: call propose_execution, and the human approves with /approve.
Output renders in a plain terminal: use short paragraphs and `-` bullets only, **bold** for a few labels,
`backticks` for commands/hashes. No tables, no nested bullets, no headings. Keep it under ~15 lines:
cause first, then the key evidence, then the proposed fix.
{focus}"""

TOOLS = [
    {"type": "function", "function": {"name": "fetch_logs", "description": "Recent website server logs.",
        "parameters": {"type": "object", "properties": {
            "unfiltered": {"type": "boolean", "description": "true = raw access+error log, false = regex-filtered errors"},
            "lines": {"type": "integer", "default": 60}}}}},
    {"type": "function", "function": {"name": "current_signals", "description": "Latest health, metrics and Postgres activity snapshot.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "recent_deploys", "description": "Recent commits with diff summaries.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_full_diff", "description": "Full patch of one commit.",
        "parameters": {"type": "object", "properties": {"commit": {"type": "string"}}, "required": ["commit"]}}},
    {"type": "function", "function": {"name": "query_db_readonly", "description": "Run a read-only SQL query (SELECT/EXPLAIN/SHOW) on the app's Postgres, e.g. pg_stat_activity, pg_locks.",
        "parameters": {"type": "object", "properties": {"sql": {"type": "string"}}, "required": ["sql"]}}},
    {"type": "function", "function": {"name": "retrieve_runbook", "description": "Search the runbooks.",
        "parameters": {"type": "object", "properties": {"question": {"type": "string"}}, "required": ["question"]}}},
    {"type": "function", "function": {"name": "list_incidents", "description": "Open and recent incidents.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "propose_execution",
        "description": "Replace the focused incident's proposed action. The human must still approve it.",
        "parameters": {"type": "object", "properties": {
            "type": {"type": "string", "enum": list(ActionType.__args__)},
            "target": {"type": "string"}, "reason": {"type": "string"}}, "required": ["type", "target", "reason"]}}},
]

READONLY = re.compile(r"^\s*(select|explain|show|with)\b", re.I)


def _query(sql: str) -> str:
    if not READONLY.match(sql) or re.search(r"\b(insert|update|delete|drop|alter|truncate|create|grant|pg_terminate|pg_cancel)\b", sql, re.I):
        return "refused: read-only queries only"
    with db.readonly() as c:
        cur = c.execute(sql)
        cols = [d.name for d in cur.description or []]
        return json.dumps([dict(zip(cols, r)) for r in cur.fetchmany(50)], default=str)


class Conversation:
    """`ctx` is provided by the server: observer, incidents, and callbacks for the focused incident."""

    def __init__(self, ctx, emit: Callable[[dict], None]):
        self.ctx, self.emit = ctx, emit
        self.history: list[dict] = []

    def _tool(self, name: str, args: dict, incident_id: str | None) -> str:
        obs = self.ctx.observer
        if name == "fetch_logs":
            src = obs.recent_logs if args.get("unfiltered") else obs.filtered_logs
            return "\n".join(list(src)[-int(args.get("lines", 60)):]) or "(no log lines yet)"
        if name == "current_signals":
            return json.dumps(obs.last_signals, default=str)[:6000]
        if name == "recent_deploys":
            return json.dumps(recent_commits(8))
        if name == "get_full_diff":
            return full_diff(args["commit"]) or "unknown commit"
        if name == "query_db_readonly":
            return _query(args["sql"])[:6000]
        if name == "retrieve_runbook":
            return json.dumps(vector_db.search_runbooks(args["question"]))
        if name == "list_incidents":
            return json.dumps(self.ctx.list_incidents(), default=str)
        if name == "propose_execution":
            if not incident_id:
                return "no incident in focus; open one with /focus <id> first"
            action = {"type": args["type"], "target": args["target"], "params": {"reason": args.get("reason", "")}}
            self.ctx.set_action(incident_id, action)
            return f"proposed. dry run:\n{dry_run(action)}\nTell the user to /approve if they agree."
        return f"unknown tool {name}"

    def send(self, text: str, incident_id: str | None) -> str:
        focus = ""
        if incident_id and (inc := self.ctx.get_incident(incident_id)):
            focus = "Incident in focus:\n" + json.dumps({k: inc.get(k) for k in
                    ("incident_id", "anomalies_detected", "correlation", "rca", "dry_run", "execution_result")}, default=str)[:8000]
        self.history.append({"role": "user", "content": text})
        msgs = [{"role": "system", "content": SYSTEM.format(url=config.VOID_URL, focus=focus)}] + self.history[-30:]
        for _ in range(8):
            msg = llm.chat(msgs, TOOLS)
            if not msg.tool_calls:
                answer = msg.content or ""
                self.history.append({"role": "assistant", "content": answer})
                return answer
            msgs.append({"role": "assistant", "content": msg.content or "",
                         "tool_calls": [tc.model_dump() for tc in msg.tool_calls]})
            for tc in msg.tool_calls:
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                self.emit({"type": "tool", "name": tc.function.name, "args": args})
                try:
                    out = self._tool(tc.function.name, args, incident_id)
                except Exception as e:
                    out = f"error: {e}"
                msgs.append({"role": "tool", "tool_call_id": tc.id, "content": out[:8000]})
        answer = "(stopped after 8 tool steps — ask me to continue)"
        self.history.append({"role": "assistant", "content": answer})
        return answer
