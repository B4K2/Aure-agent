# Aura — Technical Reference Document

Agentic SRE Platform — working reference for the build, not a pitch doc.
Model: **Muse 1.3** (`muse-spark-1.3-contributor`, high-reasoning) for reasoning-heavy calls.
Embeddings: **Qwen3-Embedding-8B** via OpenRouter, 4096-dim.

---

## 1. Problem & Solution (short version)

On-call engineers lose critical time doing manual triage — pulling logs, correlating a spike with a recent deploy, guessing root cause, deciding whether to roll back, often at 3 AM with data-loss-level stakes. Aura is an agentic SRE co-pilot that watches a deployed app, detects anomalies, correlates them with recent changes, retrieves similar past incidents from memory, forms a root-cause hypothesis, and proposes a fix — but never executes anything destructive without explicit human approval. Every resolved incident is written back into memory so RCA accuracy and speed compound over time.

## 2. MVP Scope

**In scope:**
- LangGraph agent pipeline: Observability → Context Enrichment → Reasoning (Muse 1.3) → Notification → HITL decision → Execution → Post-Incident Learning, sharing one state object.
- Sub-agents per stage, deterministic where possible, LLM only where reasoning is genuinely needed (see §5).
- Dual memory: Neo4j (causal/dependency graph) + Qdrant (semantic similarity), with cold-start seed data.
- Self-learning loop, including learning from **rejected** hypotheses.
- Docker Compose demo app integration (no Kubernetes required for MVP).
- Minimal chat (Conversation Agent, ReAct loop) — functional, not polished.
- A CLI as the primary interface (see §9) — built before any dashboard.
- Thin dashboard: live incident feed, RCA trail, approve/reject. No mobile app for MVP.

**Out of scope for MVP:**
- Flutter mobile app / push notifications.
- Kubernetes operator + `aura connect` CLI auto-detection (stretch goal, Phase 3+).
- Multi-tenant auth, billing, production hardening.
- Slack/Teams/email integrations (one channel — CLI/dashboard — is enough).
- Dashboard visual polish (dark mode, animations, dependency graph viz).

## 3. Success Metrics

- Detection-to-hypothesis time < 2 minutes.
- Memory effect provable: 3rd occurrence of a repeated injected failure is faster/higher-confidence than the 1st, citing the retrieved past incident.
- Zero unapproved destructive actions — 100% of rollback/restart actions pass through human approval.
- Correlation accuracy ≥ 80% on injected failure scenarios (bad deploy, memory leak, DB exhaustion, load spike).

## 4. Orchestration Pattern

**Linear LangGraph with conditional edges** for the main pipeline — not a supervisor/router. Reasoning: the workflow is a fixed causal pipeline (Observe → Enrich → Reason → Notify → wait for human → Execute → Learn), not an open-ended task. A supervisor meta-agent adds a failure surface and hurts explainability ("why did it call Execution before Enrichment?") without buying real flexibility here.

**Exception:** the **Conversation Agent** (Agent 5) uses a ReAct-style tool-calling loop (ChatGPT-not-supervisor pattern) — once a human is chatting, the next action is genuinely open-ended, so a single LLM call with bound tools (`fetch_logs`, `run_kubectl_readonly`, `get_full_diff`, `retrieve_runbook`, `propose_execution`) looping until a final answer or hand-off action makes sense there specifically.

```
Observability Agent
   ├─[no anomaly]→ idle / loop
   └─[anomaly]→ incident grouping check (see §6.3)
                   └→ Context Enrichment Agent
                        └→ Reasoning Agent
                             ├─[confidence ≥ 0.75]→ Notification Agent (action pre-selected)
                             └─[confidence < 0.75]→ Notification Agent (flagged "low confidence, needs review")
                                                        └→ human_decision
                                                             ├─[approve]→ Execution Agent
                                                             ├─[chat]→ Conversation Agent (ReAct loop) → human_decision (loop)
                                                             └─[reject]→ Post-Incident Learning Agent (confirmed: false)
Execution Agent → Post-Incident Learning Agent (always, regardless of outcome)
```

## 5. Shared State Object

```python
from typing import TypedDict, Literal, Optional
from datetime import datetime

class Anomaly(TypedDict):
    id: str
    signal_type: Literal["metric", "log", "k8s_event"]
    metric_name: Optional[str]
    value: Optional[float]
    baseline: Optional[float]
    deviation_sigma: Optional[float]
    detected_at: datetime
    raw_excerpt: str  # log line or event payload, truncated

class RCAHypothesis(TypedDict):
    hypothesis: str
    evidence: list[str]
    llm_confidence: float          # 0-1, raw model output
    calibrated_confidence: float   # 0-1, after rule-based adjustment
    proposed_action: dict          # {"type": "rollback", "target": "...", "params": {...}}
    reasoning_trace: str           # shown in dashboard/CLI, not used programmatically

class AuraState(TypedDict):
    incident_id: str
    raw_signals: dict
    anomalies_detected: list[Anomaly]
    deployment_context: dict          # recent commits, diff SUMMARY (not full diff), deploy timestamp
    retrieved_memories: dict          # {"confirmed": [...], "rejected": [...]} — see §7
    rca: Optional[RCAHypothesis]
    human_decision: Optional[Literal["approved", "rejected", "chatting"]]
    conversation_history: list[dict]
    execution_result: Optional[dict]  # {"status": "success"/"failed", "logs": [...], "rolled_back_at": ...}
    audit_trail: list[dict]           # append-only: every node writes {node, timestamp, action, output_summary}
```

**Rule:** every node appends to `audit_trail` on exit, even if it did nothing. This powers the "I detected X because of Y, correlated with Z" trail directly — don't reconstruct it after the fact from logs.

## 6. Sub-Agent Implementation Split

| Sub-agent | Implementation | Notes |
|---|---|---|
| Metric Monitor | Plain code | Poll Prometheus (15-min baseline poll) + push webhook/remote_write for hard threshold breaches. Rolling mean/stdev, flag >2σ. |
| K8s Event Watcher | Plain code | Watch K8s events API for `CrashLoopBackOff`, `OOMKilled`, `BackOff`. |
| Log Analyzer | **Mixed** | Regex pre-filter always on to cut volume (plain code); LLM call only on the filtered subset for semantic anomaly detection. Conversation Agent has an `get_unfiltered_logs()` tool for when the human/agent needs to bypass the filter. |
| Deployment Fetcher | Plain code | Git/CI API, produces a **diff summary** by default (file list + added/removed line counts + commit message), not the full diff. |
| Memory Retriever | Plain code (queries) + embedding call | Embedding call is a fixed API call, not a reasoning call. |
| Correlation Engine | Plain code, deterministic | `time_delta(anomaly, deployment) < threshold`, etc. Must stay reliable/explainable — not an LLM's job. |
| Hypothesis Generator | **LLM call (Muse 1.3)** | The actual reasoning step. Structured output enforced (§7). |
| Action Planner | **LLM call**, constrained to enumerated action set (`rollback`, `restart_pod`, `scale`, `investigate_further`). Bundled into the same structured call as Hypothesis Generator to avoid an extra round-trip. |
| Summary Writer | LLM call, can use a cheaper/faster model — phrasing only, no reasoning. |
| Tool User (Conversation Agent) | LLM call, ReAct loop, Muse 1.3. Tools: `fetch_logs` (filtered + unfiltered), `get_full_diff`, `run_kubectl_readonly`, `retrieve_runbook`, `propose_execution`. |
| Runbook Retriever | Plain code (vector search) |

**Rule of thumb:** if a human could verify it by hand with a calculator or a regex, don't spend an LLM call on it.

## 7. Structured RCA Output

Muse 1.3 has native structured-output support (per Meta's docs: `https://dev.meta.ai/docs/structured-output`), so failure-to-parse should be rare — but still validate and handle it:

```json
{
  "hypothesis": "string, one sentence, plain language",
  "evidence": [
    {"source": "deploy_event | log | metric | memory", "detail": "string, short"}
  ],
  "llm_confidence": 0.0,
  "proposed_action": {
    "type": "rollback | restart_pod | scale | investigate_further",
    "target": "string, e.g. service name or pod id",
    "params": {}
  },
  "reasoning_trace": "string, 2-3 sentences on how evidence led to hypothesis"
}
```

Validate server-side with a Pydantic model. **If parsing fails twice** (even though rare with native structured output): fall back to `proposed_action.type = "investigate_further"` and notify "Aura couldn't form a confident hypothesis" rather than failing silently or stalling the pipeline.

**Prompt versioning:** store Hypothesis Generator prompts as versioned templates (not hardcoded strings), so they can be iterated/A-B tested against the seed incident set without redeploying code.

## 8. Confidence Calibration (hybrid: LLM proposes, rules adjust)

```python
def calibrate_confidence(llm_confidence: float, state: AuraState) -> float:
    score = llm_confidence

    # Boost: deploy happened within 5 min of anomaly
    if state["deployment_context"].get("minutes_since_deploy", 999) <= 5:
        score += 0.15

    # Boost: this pattern matched a CONFIRMED past incident above similarity threshold
    top_confirmed = max(state["retrieved_memories"]["confirmed"], key=lambda m: m["similarity"], default=None)
    if top_confirmed and top_confirmed["similarity"] > 0.85:
        score += 0.10

    # Penalty: top match is a REJECTED past hypothesis — same pattern was wrong before
    top_rejected = max(state["retrieved_memories"]["rejected"], key=lambda m: m["similarity"], default=None)
    if top_rejected and top_rejected["similarity"] > 0.85:
        score -= 0.20

    # Penalty: fewer than 2 corroborating signal types (metric+log+k8s_event)
    signal_types = {a["signal_type"] for a in state["anomalies_detected"]}
    if len(signal_types) < 2:
        score -= 0.20

    # Penalty: destructive action proposed but evidence list is short
    if state["rca"]["proposed_action"]["type"] in ("rollback", "restart_pod") and len(state["rca"]["evidence"]) < 2:
        score -= 0.15

    return max(0.0, min(1.0, score))
```

Kept simple and inspectable on purpose — you want to say exactly *why* a confidence number moved, not "the model decided." Tune constants against the seed incident set.

**Threshold usage:** `calibrated_confidence >= 0.75` → auto-notify with action pre-selected. `< 0.75` → notify flagged "needs review, low confidence," Action Planner defaults to `investigate_further` instead of a destructive action.

## 9. Memory System

### 9.1 Local infra (dev/testing)

Run both locally via Docker — no hosted Qdrant Cloud / Neo4j Aura needed while iterating on schema and queries.

```bash
# Qdrant
docker run -d --name qdrant -p 6333:6333 -p 6334:6334 \
  -v $(pwd)/qdrant_storage:/qdrant/storage \
  qdrant/qdrant

# Neo4j
docker run -d --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/your_password \
  -v $(pwd)/neo4j_data:/data \
  neo4j:5
```

Add both to `docker-compose.yml` alongside the demo app, so `docker compose up` boots everything at once. Qdrant dashboard at `localhost:6333/dashboard`, Neo4j Browser at `localhost:7474` — use both to visually sanity-check data during development.

### 9.2 Embedding model

`qwen/qwen3-embedding-8b` via OpenRouter, **4096-dim**. Set Qdrant collection config to match exactly (`vectors_config={"size": 4096, "distance": "Cosine"}`) — dimension mismatch is a common first-upsert bug. This is a larger embedding model than typical small embedders, so batch embedding calls where possible (embed all runbook chunks in one batch job at seed time, not one-by-one) and cache anything static.

### 9.3 Vector DB (Qdrant) — example queries

**Storing an incident:**
```python
client.upsert(
    collection_name="incidents",
    points=[{
        "id": incident_id,
        "vector": embed(incident_summary_text),  # see §9.5 for what text to embed
        "payload": {
            "service": "user-service",
            "root_cause_type": "memory_leak",
            "resolved_by": "rollback",
            "confirmed": True,  # False if the human rejected this hypothesis — see §10
            "timestamp": "2026-09-18T23:47:00Z",
            "text": incident_summary_text
        }
    }]
)
```

**Retrieving similar past incidents at RCA time:**
```python
results = client.search(
    collection_name="incidents",
    query_vector=embed(current_anomaly_description),
    query_filter={"must": [{"key": "service", "match": {"value": "user-service"}}]},
    limit=10,
    score_threshold=0.6
)
# split into confirmed / rejected in application code, then apply recency re-rank (§11)
```

**Runbook retrieval (Conversation Agent tool call):**
```python
results = client.search(collection_name="runbooks", query_vector=embed(user_question), limit=3)
```

### 9.4 Graph DB (Neo4j) — example Cypher

**Schema:**
```cypher
CREATE CONSTRAINT service_name IF NOT EXISTS FOR (s:Service) REQUIRE s.name IS UNIQUE;

(:Service {name, tier})
(:Deployment {commit_hash, timestamp, author})
(:Incident {id, timestamp, root_cause_type, resolved, confirmed})
(:Pod {name, service})
(:Commit {hash, message, diff_summary})

(:Service)-[:DEPENDS_ON]->(:Service)
(:Deployment)-[:CAUSED]->(:Incident)
(:Incident)-[:RESOLVED_BY]->(:Action {type, params})
(:Commit)-[:PART_OF]->(:Deployment)
(:Deployment)-[:DEPLOYED_TO]->(:Service)
```

**"Has this type of change caused this type of failure before?" (the self-learning query):**
```cypher
MATCH (s:Service {name: $service_name})<-[:DEPLOYED_TO]-(d:Deployment)-[:CAUSED]->(i:Incident)
WHERE i.root_cause_type = $suspected_type
RETURN d.commit_hash, d.timestamp, i.id, i.timestamp, i.resolved
ORDER BY d.timestamp DESC
LIMIT 5
```

**Impact analysis — "what else could this affect?":**
```cypher
MATCH (s:Service {name: $service_name})<-[:DEPENDS_ON*1..3]-(dependent:Service)
RETURN DISTINCT dependent.name, dependent.tier
```

**Writing back after incident close:**
```cypher
MERGE (i:Incident {id: $incident_id})
SET i.root_cause_type = $root_cause_type, i.resolved = true, i.confirmed = $confirmed, i.timestamp = $timestamp
WITH i
MATCH (d:Deployment {commit_hash: $commit_hash})
MERGE (d)-[:CAUSED]->(i)
MERGE (i)-[:RESOLVED_BY]->(a:Action {type: $action_type})
```

**Retrieval sequence (Context Enrichment Agent, combining both DBs):**
1. Vector search on `incidents` with live anomaly text → top matches, split confirmed vs rejected.
2. For each returned incident's service, run the Cypher causal-frequency query.
3. Merge into `retrieved_memories` — vector gives *semantic similarity*, graph gives *causal frequency*. Present both distinctly to the Reasoning Agent prompt: "3 semantically similar incidents found; this deploy pattern has caused this failure type 2 times before; a similar pattern was previously misdiagnosed as X (rejected)."

### 9.5 Embedding text composition

Embed a **concatenated summary** — root cause + fix + affected service — not just the one-line hypothesis. Just the hypothesis sentence loses too much retrieval signal.

## 10. Learning from Rejected Hypotheses

Store rejected RCAs in the vector DB with `confirmed: false`, and **still embed them** — don't exclude them from retrieval, that throws away exactly the information that prevents repeating the mistake. At retrieval time, if the top match is a `confirmed: false` incident with high similarity, surface it explicitly to the Reasoning Agent as a negative signal: "A similar-looking pattern was previously misdiagnosed as X (rejected by human) — consider alternative explanations." This also feeds the confidence penalty in §8.

## 11. Recency Weighting

Qdrant doesn't natively decay by time, so apply it as a post-filter re-rank: retrieve top-10 by similarity, then `final_score = similarity * recency_weight`, where `recency_weight = exp(-age_days / half_life_days)` (half-life ~180 days is fine at this project's scale). Label older incidents in the prompt ("older incident — use as reference only, not a confirmed match") rather than excluding them — old solutions can still inform current reasoning without being treated as current fact.

## 12. Incident Grouping / Deduplication

Multiple anomalies from different sub-agents (CPU spike, error rate spike, OOMKilled event) can describe **one** real incident. Without grouping, the pipeline spawns duplicate `incident_id`s and notifies multiple times for the same problem.

**Rule (plain code, not an LLM decision):** when an anomaly fires, check for an open (unresolved) incident on the same `service` within the last N minutes (e.g. 5). If found, attach the anomaly to that `incident_id` and re-trigger Context Enrichment (debounced ~10–15s to let a burst settle) instead of creating a new incident.

## 13. Execution Agent

- **Dry-run, shown in the approval UI/CLI** — not a separate gate. For Kubernetes: `kubectl rollout undo --dry-run=server` output is real and shown to the human before they approve. For the Docker Compose demo app: dry-run means a script that prints the exact command it would run, without running it — shown the same way.
- **Post-execution success criterion**, problem-dependent:
  - Traffic spike → error rate / latency back down to p50 or baseline average.
  - Bad push / rollback → service responding normally (health check passing, error rate back under threshold).
  - If not resolved within the 2-minute monitoring window: hand off back to the human (don't auto-retry or auto-escalate further without a decision) — flag it clearly as "action taken, issue not yet resolved."
- **Idempotency lock**: lock on `incident_id` during execution so a double-tap "Approve" (mobile lag, dashboard + CLI both open) can't trigger two rollbacks.

## 14. Cross-Cutting

- **Internal auth (FastAPI ↔ Node.js)**: use a shared secret/token on the internal call even in local dev, not an open localhost connection — decide once now rather than as an afterthought later.
- **Secrets**: OpenRouter key, Muse 1.3 key, Neo4j password, GitHub webhook secret — `.env` + `.gitignore` from day one.
- **Muse 1.3 structured output**: native support exists (`https://dev.meta.ai/docs/structured-output`), so malformed-JSON failures should be rare — still keep the Pydantic validation + retry-then-fallback path (§7) as a safety net.

## 15. CLI

Before any dashboard exists, the CLI is the way to interact with Aura — including the "SSH into a cloud server and use the agent there" case. The CLI is a client of the **Node.js backend**, same as the dashboard will be later — not a direct client of FastAPI, so auth/session logic isn't accidentally duplicated or skipped.

```
aura-cli (Python, Click or Typer)
   └── talks to → Node.js backend (same API the dashboard will use)
```

**Minimal command set:**
```bash
aura status                    # list active/open incidents
aura incident <id>             # show full state: anomalies, RCA, confidence, evidence
aura incident <id> --trail     # show audit_trail (the reasoning steps)
aura approve <id>              # approve proposed_action → triggers Execution Agent
aura reject <id>                # reject → logged, feeds negative learning (§10)
aura chat <id>                  # interactive REPL = Conversation Agent session, streamed over WebSocket
aura inject <scenario>          # dev-only: fire a failure-injection script remotely
aura connect                    # (Phase 3+) auto-detect env, register with backend
```

`aura chat <id>` is the one to build carefully — it's the only interface into the Conversation Agent until the dashboard chat exists, and worth keeping afterward since some engineers will always prefer terminal during an incident. Simple loop: send message → stream tokens over WebSocket → print → repeat, with `/approve` and `/reject` as in-chat shortcuts.

**Config, not hardcoding:** `~/.aura/config.yaml` with backend URL + auth token, so the same binary works against `localhost:3000` in dev or a real deployed backend URL from a remote box.

**Open decision:** global installable CLI (`pip install aura-cli`) vs. per-repo (`python cli/aura.py`). Recommendation: per-repo for now (less setup friction for a 4-person team on a college timeline), global install as a Phase 4 polish item.

## 16. Open Questions Still To Resolve During Build

- Cold-start seed generation: hand-written or LLM-generated + human-reviewed? Affects Phase 1 timeline.
- Muse 1.3 rate limits/cost at scale via OpenRouter — worth checking before assuming "route every anomaly to Muse" is affordable; may need the Correlation Engine to gate harder.
- Exact success-check implementation for post-execution monitoring (§13) — needs concrete health-check/metric-threshold code per failure type before Phase 2 demo.

## 17. Repository Structure (reference, from original plan)

```
aura/
  agents/                # FastAPI app + LangGraph agents
    main.py
    graph.py              # LangGraph state machine definition
    agents/
      observability.py
      enrichment.py
      reasoning.py
      conversation.py
      execution.py
      learning.py
    memory/
      graph_db.py          # Neo4j client
      vector_db.py          # Qdrant client
  dashboard-backend/      # Node.js + Express
    src/
      routes/
      websocket/
      redis/
  dashboard-frontend/     # React + TailwindCSS
    src/
      pages/
      components/
  cli/                    # aura CLI (Python)
  mobile/                 # Flutter app (post-MVP)
  demo-app/               # target application for demos
    docker-compose.yml
    k8s/
    inject-failures/
  infra/                  # Helm chart, Kubernetes manifests for Aura itself
  docker-compose.yml       # local dev: all Aura services together (incl. Qdrant, Neo4j)
```
