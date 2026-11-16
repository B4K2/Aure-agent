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

## Connecting from another device (iOS app, a phone, another laptop)

By default the server listens on `127.0.0.1` only. To accept connections from other devices, put the bind
address in `agent/.env` rather than on the command line. `aura-cli` restarts the server whenever it loses it,
and that respawned server only sees `.env`. A one-off `AURA_API_HOST=0.0.0.0 uv run …` silently goes back to
localhost after the next respawn.

```bash
# agent/.env
AURA_API_HOST=0.0.0.0        # all interfaces
AURA_API_PORT=8700
AURA_API_TOKEN=<long random string>   # optional: fixed token for the app; else .aura_state/api_token is used
```

Restart the server, then check it from the machine itself and from the device:

```bash
ss -ltn | grep 8700                         # must show 0.0.0.0:8700, not 127.0.0.1:8700
hostname -I                                 # the machine's LAN IP, e.g. 192.168.29.15
curl -H "x-aura-token: $TOKEN" http://<LAN-IP>:8700/incidents   # from another device: 200 = reachable
sudo ufw allow 8700/tcp                     # only if a firewall is on and the curl above times out
```

The phone must be on the same Wi-Fi/LAN (or the same Tailscale network, see below).

**API the app talks to.** Every request carries the token:
- REST: header `x-aura-token: <token>`. `GET /incidents`, `GET /incidents/{id}`,
  `POST /incidents/{id}/approve`, `POST /incidents/{id}/reject?note=<reason>` (a reason is required),
  `GET /memory/incidents`, `GET /memory/search?q=…`, `GET /memory/topology`.
- Live feed: `ws://<host>:8700/ws?token=<token>`. The server sends `hello` (recent incidents + heartbeat
  history), then `heartbeat`, `incident_opened`, `anomaly`, `stage`, `awaiting_approval`, `action_changed`,
  `closed`, `error`. The client sends `{"type":"decide","incident_id":…,"decision":"approved"|"rejected","note":…}`,
  `{"type":"chat","text":…,"incident_id":…|null}` and `{"type":"get","incident_id":…}`.
  A bad token closes the socket with code `4401`. The app should reconnect when it sees `1012` (server restart).

**iOS app settings (Info.plist).** The server speaks plain `http`/`ws`, not TLS:
- `NSAppTransportSecurity` → `NSAllowsLocalNetworking = YES` allows cleartext to LAN hosts without
  turning ATS off globally.
- `NSLocalNetworkUsageDescription` (iOS 14+), e.g. "Connect to your Aura server on this network". iOS asks
  the user once. If they decline, every LAN request fails with no clear error (*Settings → Privacy →
  Local Network* to re-enable).

**Outside the LAN.** Don't port-forward 8700 to the internet: the token and the approve endpoint travel
in cleartext. Put the server and the phone on [Tailscale](https://tailscale.com) and use the machine's
`100.x` address, or put a TLS reverse proxy/tunnel in front and use `https://`/`wss://` (ATS then works
with no exceptions).

Actions: `rollback` (git revert + restart), `restart_service`, `terminate_db_sessions` (by application_name),
`start_db`, `scale` / `investigate_further` (advisory). Nothing runs without `/approve`.

Prompts are versioned in `aura/prompts/*_v1.md`.
