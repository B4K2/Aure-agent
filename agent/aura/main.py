"""Aura server: watcher loop + LangGraph runs + a WebSocket that pushes every event to the terminal UI live.

    uv run python -m aura.main
"""
import asyncio
import logging
import threading
import time
import uuid
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from langgraph.types import Command

from . import config
from .agents.conversation import Conversation
from .agents.enrichment import enrichment_node
from .agents.execution import dry_run
from .agents.notification import notification_node
from .agents.observability import Observer
from .agents.reasoning import reasoning_node
from .graph import build
from .state import audit, now

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s",
                    handlers=[logging.FileHandler(config.STATE_DIR / "aura.log"), logging.StreamHandler()])
log = logging.getLogger("aura")
logging.getLogger("httpx").setLevel(logging.WARNING)
CLOSED = {"resolved", "rejected", "unresolved"}
COOLDOWN_S = 30  # after an incident closes, let metrics settle before opening a new one


class Aura:
    def __init__(self):
        self.observer = Observer()
        self.graph = build()
        self.incidents: dict[str, dict] = {}
        self.locks: dict[str, threading.Lock] = {}
        self.pool = ThreadPoolExecutor(max_workers=4)
        self.clients: set[WebSocket] = set()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.last_closed = 0.0
        self.beats: deque[dict] = deque(maxlen=180)  # 15 min at 5 s

    # ---------- events → every connected terminal ----------
    def emit(self, event: dict) -> None:
        event.setdefault("at", now())
        if self.loop:
            asyncio.run_coroutine_threadsafe(self._broadcast(event), self.loop)

    async def _broadcast(self, event: dict) -> None:
        for ws in list(self.clients):
            try:
                await ws.send_json(event)
            except Exception:
                self.clients.discard(ws)

    # ---------- incident bookkeeping (used by Conversation too) ----------
    def summary(self, inc: dict) -> dict:
        rca = inc.get("rca") or {}
        return {"incident_id": inc["incident_id"], "status": inc["status"], "opened_at": inc["opened_at"],
                "anomalies": len(inc["anomalies_detected"]), "hypothesis": rca.get("hypothesis"),
                "confidence": rca.get("calibrated_confidence"), "action": rca.get("proposed_action")}

    def list_incidents(self) -> list[dict]:
        return [self.summary(i) for i in sorted(self.incidents.values(), key=lambda i: i["opened_at"], reverse=True)[:20]]

    def get_incident(self, iid: str) -> dict | None:
        return self.incidents.get(iid)

    def set_action(self, iid: str, action: dict) -> None:
        inc = self.incidents[iid]
        if inc["status"] != "awaiting_approval":
            raise ValueError(f"incident is {inc['status']}, not awaiting approval")
        cfg = {"configurable": {"thread_id": iid}}
        rca = {**inc["rca"], "proposed_action": action}
        self.graph.update_state(cfg, {"rca": rca, "dry_run": dry_run(action),
                                      **audit("conversation", "propose_execution", f"{action['type']} → {action['target']}")})
        inc.update(self.graph.get_state(cfg).values)
        self.emit({"type": "action_changed", "incident": self._full(inc)})

    def _full(self, inc: dict) -> dict:
        keys = ("incident_id", "status", "opened_at", "anomalies_detected", "correlation", "rca", "notification",
                "dry_run", "human_decision", "execution_result", "audit_trail")
        return {k: inc.get(k) for k in keys}

    # ---------- watcher ----------
    def watch_forever(self) -> None:
        log.info("watching %s every %ss", config.VOID_URL, config.POLL_SECONDS)
        while True:
            t = time.monotonic()
            try:
                self._tick()
            except Exception:
                log.exception("watch tick failed")
            time.sleep(max(0.5, config.POLL_SECONDS - (time.monotonic() - t)))

    def _tick(self) -> None:
        anomalies = self.observer.poll()
        s = self.observer.last_signals
        m = s.get("metrics", {})
        beat = {"type": "heartbeat", "at": now(), "health": s["health"], "rps": m.get("rps"), "p95": m.get("api_p95_s"),
                "err": m.get("error_rate_5xx"), "rss_mb": m.get("rss_mb"), "lag": m.get("event_loop_lag_p99_s"),
                "pool_waiting": m.get("pg_pool_waiting"),
                "db": {"up": s["db"].get("reachable"), "sessions": s["db"].get("total_sessions"),
                       "max": s["db"].get("max_connections"), "lock_waits": s["db"].get("lock_waits")},
                "open": sum(i["status"] not in CLOSED for i in self.incidents.values())}
        self.beats.append(beat)  # sent on connect so /state graphs aren't empty
        self.emit(beat)
        if not anomalies:
            return
        inc = self._open_incident()
        if inc is None:
            if time.time() - self.last_closed < COOLDOWN_S:
                return
            iid = f"INC-{datetime.now():%m%d-%H%M%S}-{uuid.uuid4().hex[:3]}"
            inc = {"incident_id": iid, "service": config.SERVICE, "status": "collecting", "opened_at": now(),
                   "anomalies_detected": [], "seen": set(), "audit_trail": [], "first_t": time.monotonic()}
            self.incidents[iid] = inc
            self.locks[iid] = threading.Lock()
            self.emit({"type": "incident_opened", "incident_id": iid})
            threading.Thread(target=self._debounce_then_run, args=(iid,), daemon=True).start()
        new_types = False
        for a in anomalies:
            key = a["metric_name"]
            if key in inc["seen"]:
                continue  # same signal still firing; already on the incident
            new_types |= a["signal_type"] not in {x["signal_type"] for x in inc["anomalies_detected"]}
            inc["seen"].add(key)
            inc["anomalies_detected"].append(a)
            self.emit({"type": "anomaly", "incident_id": inc["incident_id"], "anomaly": a,
                       "late": inc["status"] != "collecting"})
        if new_types and inc["status"] == "awaiting_approval" and \
                inc.get("rca", {}).get("proposed_action", {}).get("type") == "investigate_further":
            threading.Thread(target=self._reanalyze, args=(inc["incident_id"],), daemon=True).start()

    def _open_incident(self) -> dict | None:
        """§12: one open incident per service absorbs new anomalies. An open incident is always still being
        handled (collecting → analyzing → awaiting_approval → executing), so it's grouped regardless of age;
        after close, COOLDOWN_S keeps the tail of the same burst from opening a duplicate."""
        return next((i for i in self.incidents.values() if i["status"] not in CLOSED and i["service"] == config.SERVICE), None)

    def _debounce_then_run(self, iid: str) -> None:
        time.sleep(config.DEBOUNCE_SECONDS)  # §12: let the burst settle
        inc = self.incidents[iid]
        inc["status"] = "analyzing"
        self.emit({"type": "stage", "incident_id": iid, "stage": "analyzing",
                   "detail": f"{len(inc['anomalies_detected'])} anomalies grouped"})
        signals = {**self.observer.last_signals, "filtered_logs": list(self.observer.filtered_logs)[-40:]}
        initial = {"incident_id": iid, "service": inc["service"], "raw_signals": signals,
                   "anomalies_detected": list(inc["anomalies_detected"]), "conversation_history": [],
                   **audit("observability", "detect", "; ".join(a["raw_excerpt"].split("\n")[0][:80]
                                                                for a in inc["anomalies_detected"][:6]))}
        self._stream(iid, initial)

    def _reanalyze(self, iid: str) -> None:
        """A new signal type arrived while the incident sits on an advisory proposal (usually: low confidence
        for lack of corroboration). Re-run enrichment → reasoning → notification with everything seen so far,
        so it can reach a real fix without a human having to ask."""
        lock = self.locks[iid]
        if not lock.acquire(blocking=False):
            return  # a decision or another re-analysis is running
        try:
            inc = self.incidents[iid]
            if inc["status"] != "awaiting_approval":
                return
            cfg = {"configurable": {"thread_id": iid}}
            self.emit({"type": "stage", "incident_id": iid, "stage": "analyzing",
                       "detail": f"new evidence: re-analyzing {len(inc['anomalies_detected'])} anomalies"})
            st = {**self.graph.get_state(cfg).values, "anomalies_detected": list(inc["anomalies_detected"]),
                  "raw_signals": {**self.observer.last_signals, "filtered_logs": list(self.observer.filtered_logs)[-40:]}}
            trail = []
            for node in (enrichment_node, reasoning_node, notification_node):
                upd = node(st)
                trail += upd.pop("audit_trail", [])
                st.update(upd)
            keys = ("anomalies_detected", "raw_signals", "deployment_context", "correlation", "retrieved_memories",
                    "rca", "notification", "dry_run")
            self.graph.update_state(cfg, {**{k: st[k] for k in keys if k in st}, "audit_trail": trail})
            seen = inc["seen"]
            inc.update(self.graph.get_state(cfg).values)
            inc["seen"] = seen
            self.emit({"type": "action_changed", "incident": self._full(inc)})
        except Exception:
            log.exception("re-analysis failed for %s", iid)
        finally:
            lock.release()

    def _stream(self, iid: str, inp) -> None:
        cfg = {"configurable": {"thread_id": iid}}
        inc = self.incidents[iid]
        try:
            for chunk in self.graph.stream(inp, cfg, stream_mode="updates"):
                for node, upd in chunk.items():
                    if node == "__interrupt__":
                        continue
                    trail = (upd or {}).get("audit_trail") or [{}]
                    self.emit({"type": "stage", "incident_id": iid, "stage": node, "detail": trail[-1].get("output_summary", "")})
        except Exception as e:
            log.exception("graph run failed for %s", iid)
            inc["status"] = "unresolved"
            self.emit({"type": "error", "incident_id": iid, "message": f"pipeline error: {e}"})
            return
        snap = self.graph.get_state(cfg)
        seen = inc.get("seen")
        inc.update(snap.values)
        inc["seen"] = seen
        if snap.next:  # paused at human_decision
            inc["status"] = "awaiting_approval"
            self.emit({"type": "awaiting_approval", "incident": self._full(inc)})
        else:
            res = inc.get("execution_result") or {}
            inc["status"] = ("resolved" if res.get("resolved") else "unresolved") if inc.get("human_decision") == "approved" else "rejected"
            self.last_closed = time.time()
            self.emit({"type": "closed", "incident": self._full(inc)})

    def decide(self, iid: str, decision: str) -> None:
        inc = self.incidents.get(iid)
        if not inc:
            raise HTTPException(404, "no such incident")
        lock = self.locks[iid]
        if not lock.acquire(blocking=False):  # §13 idempotency: a double approve can't run twice
            raise HTTPException(409, "decision already in progress")
        if inc["status"] != "awaiting_approval":
            lock.release()
            raise HTTPException(409, f"incident is {inc['status']}")
        if decision == "approved" and inc["rca"]["proposed_action"]["type"] in ("investigate_further", "scale"):
            lock.release()
            raise HTTPException(409, "nothing to approve: the proposal is advisory. Ask Aura to investigate "
                                     "(/investigate) so it can propose a real fix, or /reject.")
        inc["status"] = "executing" if decision == "approved" else "closing"
        self.emit({"type": "stage", "incident_id": iid, "stage": inc["status"], "detail": decision})

        def run():
            try:
                self._stream(iid, Command(resume=decision))
            finally:
                lock.release()
        self.pool.submit(run)


aura = Aura()
api = FastAPI(title="Aura")


def _auth(token: str | None) -> None:
    if token != config.API_TOKEN:
        raise HTTPException(401, "bad token")


@api.on_event("startup")
async def _start():
    aura.loop = asyncio.get_running_loop()
    threading.Thread(target=aura.watch_forever, daemon=True).start()
    threading.Thread(target=_warm, daemon=True).start()


def _warm():
    """Load EmbeddingGemma before the first incident so enrichment isn't stuck on a cold model load."""
    from .embeddings import embed_query
    embed_query("warmup")
    log.info("embedding model loaded")


@api.get("/incidents")
def incidents(request: Request):
    _auth(request.headers.get("x-aura-token"))
    return aura.list_incidents()


@api.get("/incidents/{iid}")
def incident(iid: str, request: Request):
    _auth(request.headers.get("x-aura-token"))
    if iid not in aura.incidents:
        raise HTTPException(404)
    return aura._full(aura.incidents[iid])


@api.post("/incidents/{iid}/{decision}")
def decide(iid: str, decision: str, request: Request):
    _auth(request.headers.get("x-aura-token"))
    if decision not in ("approve", "reject"):
        raise HTTPException(400)
    aura.decide(iid, "approved" if decision == "approve" else "rejected")
    return {"ok": True}


@api.websocket("/ws")
async def ws(sock: WebSocket):
    if sock.query_params.get("token") != config.API_TOKEN:
        await sock.close(code=4401)
        return
    await sock.accept()
    aura.clients.add(sock)
    convo = Conversation(aura, lambda e: aura.emit(e))
    await sock.send_json({"type": "hello", "watching": config.VOID_URL, "incidents": aura.list_incidents(),
                         "history": list(aura.beats), "at": now()})
    loop = asyncio.get_running_loop()
    try:
        while True:
            msg = await sock.receive_json()
            if msg.get("type") == "chat":
                await sock.send_json({"type": "thinking", "at": now()})
                try:
                    answer = await loop.run_in_executor(aura.pool, convo.send, msg["text"], msg.get("incident_id"))
                except Exception as e:
                    answer = f"(LLM error: {e})"
                await sock.send_json({"type": "answer", "text": answer, "at": now()})
            elif msg.get("type") == "decide":
                try:
                    aura.decide(msg["incident_id"], msg["decision"])
                except HTTPException as e:
                    await sock.send_json({"type": "error", "message": e.detail, "at": now()})
            elif msg.get("type") == "get":
                inc = aura.incidents.get(msg.get("incident_id", ""))
                await sock.send_json({"type": "incident", "incident": aura._full(inc) if inc else None, "at": now()})
    except WebSocketDisconnect:
        pass
    finally:
        aura.clients.discard(sock)


if __name__ == "__main__":
    uvicorn.run(api, host="127.0.0.1", port=config.API_PORT, log_level="warning")
