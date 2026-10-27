# problem/ — failure injection + virtual users for the VOID website

Breaks `test-website/` in realistic ways while simulated shoppers use it, so Aura has to detect,
diagnose and fix real incidents and not just a synthetic API flood.

The site's clean source is `website-template/`. `test-website/` is a generated copy with its own
local git repo; `npm run setup-website -- --force` resets it to the template.

```bash
cd problem && npm install
npm run setup-website                     # once: website-template/ -> ../test-website (local git repo)
npm run traffic -- --users 20             # baseline traffic (leave running in its own terminal)
node inject.js list                       # scenarios
node inject.js <scenario> [options]       # break something
node inject.js status                     # what's active + is the site healthy
node inject.js recover <scenario|all>     # undo it (answer-key fix)
node inject.js show <scenario>            # symptoms + expected fix. Don't show this to the agent.
```

Env overrides: `VOID_URL` (default `http://localhost:4000`), `DATABASE_URL`, `VOID_WEBSITE_DIR`,
`VOID_DB_CONTAINER` (`test-website-db-1`), `VOID_APP_CONTAINER` (`test-website-app-1`).

## On Kubernetes (minikube)

```bash
bash k8s/up.sh                            # minikube profile "aura", namespace void, test-website at HEAD
set -a; source .state/k8s.env; set +a     # VOID_RUNTIME=kubernetes, VOID_URL, DATABASE_URL, AURA_RUNTIME...
npm run traffic -- --users 20             # same commands as above, from this shell
node inject.js bad-deploy-checkout-500
bash k8s/up.sh down                       # delete the cluster
```

Postgres is a StatefulSet (`void-db`), the app a one-replica Deployment (`void-app`), both NodePorts
published on localhost (`:30400` app, `:30433` db). A **deploy** builds `test-website` at HEAD into
`void-app:<commit>` inside minikube and runs `kubectl set image`, with the commit as the change-cause,
so `kubectl rollout history` matches git. **db-outage** scales `void-db` to 0. Start the Aura agent from
the same shell so it picks up `AURA_RUNTIME=kubernetes` and watches the cluster.

Kubernetes changes some scenarios: with the readiness probe, `bad-deploy-crash` stalls the rollout and
the old pod keeps serving (nothing is rolled back); crashed containers are restarted by the kubelet;
`memory-leak` ends in an OOMKill at the 1 Gi limit.

## Virtual users (`traffic/simulate.js`)

Each virtual user is one browser session that does what the React app does:

- **First visit is a full page load**: HTML, JS bundle, CSS, favicon (the site has no caching, so all of it every time). After that, moving between pages only makes the API calls the page component makes on mount (`/api/products` + `/api/stats` on home, and so on).
- **Product images** load once per session, and fewer of them on mobile user agents.
- **Shop search** sends one request per keystroke, like `Shop.jsx`. Users also filter by category and sort.
- **Personas**:
  - *browser*: looks around.
  - *shopper*: builds a cart, abandons it ~65% of the time.
  - *buyer*: signs up or logs in, checks out, views orders.
  - *returning*: logs in with an account from `.state/accounts.json` and reorders.
  - *clumsy*: dead links, wrong passwords, invalid sign-ups.
- **Real-traffic details**: log-normal think times, ~6% login typos, 12% bounces, and real UA strings.
- **When the site breaks, users react like people**: they hit refresh 1–3 times and then leave.
- **Stats every 10s**: rps, p50/p95/p99, 5xx/4xx/timeouts, sign-ups, orders, abandoned carts.

Options: `--users N` (concurrent sessions), `--duration 10m` (default: until Ctrl-C), `--ramp 30s`,
`--profile normal|flash-sale`, `--url`, `--quiet`.

## Scenarios

| scenario | type | what breaks |
|---|---|---|
| `bad-deploy-checkout-500` | deploy | renamed column, every checkout 500s |
| `bad-deploy-crash` | deploy | requires unset env var, server won't boot |
| `memory-leak` | deploy | response-capture buffer never trims, RSS +~3 MB/s at 15 users |
| `cpu-hot-path` | deploy | sync PBKDF2 on `/api/products`, event-loop lag, all routes slow |
| `db-pool-leak` | deploy | `conn.release()` missing on success, pool exhausted after ~10 orders, site hangs |
| `slow-query` | deploy + data | N+1 correlated subquery, no index, 3M-row import (`--rows`), `/api/products` ~1.7s |
| `db-connection-exhaustion` | process | `report-worker` holds every Postgres slot, app can't reconnect |
| `db-lock` | process | "migration" holds ACCESS EXCLUSIVE on `orders`, checkout/stats hang, pool fills |
| `db-outage` | infra | `docker stop` Postgres (the app also crashes: its pool has no error handler) |
| `traffic-spike` | process | flash sale with `--users 300` extra shoppers for `--duration 5m` |

**How each type works**

- **deploy**: exact find/replace edits to `test-website/server/index.js`, then the server restarts.
  Each apply/revert is logged to `.state/deploys.jsonl` (time, files, line counts, commit message).
  `test-website/` is a git repo (made by `npm run setup-website`), so it is also committed with a normal-looking message, so Aura's
  deployment fetcher can correlate it.
  Rolling back (`recover`, `git revert`, or the agent's own fix) plus a restart resolves it.
- **process**: a detached background process (pid + log in `.state/`). The DB troublemakers set
  their `application_name`, so the agent can find them in `pg_stat_activity`. They exit by
  themselves when their sessions are terminated, so `pg_terminate_backend` counts as a fix.
  `--duration` makes them stop by themselves.
- **restarts**: the injector finds the server listening on the port, saves its command, cwd and env
  (`.state/server-launch.json`), then kills it and relaunches it detached. Output goes to
  `.state/server.log`. If the docker-compose `app` container is running, it rebuilds that instead.
  `node --watch` dev servers reload by themselves. `--no-restart` only patches the code.

`.state/` (gitignored) holds active scenarios, logs, the deploy log, and the virtual users' accounts.
