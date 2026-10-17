# Aura agent

LangGraph SRE pipeline watching the VOID site (`../test-website`), plus the terminal UI in `../aura-cli`.

```
Observer (5 s poll: /api/health, /metrics, pg_stat_activity/pg_locks, docker, server.log)
  → incident grouping (one open incident absorbs new anomalies, 12 s debounce)
  → enrichment (git log + diff summary, deterministic correlation, Qdrant + Neo4j memory)
  → reasoning (Muse 1.3 structured RCA + rule calibration, threshold 0.75)
  → notification (dry-run) → human_decision [LangGraph interrupt]
      approve → execution (+2 min verify) → learning
      reject  → learning (stored with confirmed=false)
```

Embeddings: `google/embeddinggemma-2`, local on the GPU, 768-dim cosine (`EMBED_DIM` 512/256/128 also work; reseed after changing).

## Run
```bash
docker compose up -d                           # Qdrant :6333, Neo4j :7474
(cd ../test-website && docker compose up -d db && npm start)
uv sync && uv run python -m aura.memory.seed   # once: runbooks + seed incidents
cd ../aura-cli && npm start                    # the UI starts the agent server if it isn't up
```
Server alone: `uv run python -m aura.main` (port 8700, token `AURA_API_TOKEN`). Logs: `.aura_state/aura.log`.

Actions: `rollback` (git revert + restart), `restart_service`, `terminate_db_sessions` (by application_name),
`start_db`, `scale` / `investigate_further` (advisory). Nothing runs without `/approve`.

Prompts are versioned in `aura/prompts/*_v1.md`.
