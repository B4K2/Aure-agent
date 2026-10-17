# Bad deploy: 5xx right after a release
If error rate jumps within minutes of a commit landing, read the diff of that commit first. SQL errors such as
"column does not exist" mean code and schema disagree. Fix: revert the commit (`git revert <hash>`) and restart
the app. Don't hot-patch during an incident.

# App won't boot after a deploy
Health check unreachable, port 4000 closed, server log ends with an exception during startup (missing env var,
bad import). Fix: revert the commit that introduced it and restart. Check `problem/.state/server.log` for the trace.

# Memory growth in the Node process
RSS climbing steadily under constant traffic and never flattening means something retains per-request data
(caches, arrays, listeners). Restarting buys time; the real fix is reverting the change that introduced the
retention. Correlate the start of growth with the deploy log.

# Event loop blocked / every route slow
When all routes slow down together, including cheap ones like /api/health, and nodejs_eventloop_lag climbs,
some synchronous CPU work (crypto, JSON of huge payloads, sync fs) is on a hot path. Find the route in the
recent diff and revert it.

# Postgres pool exhausted inside the app
pg_pool_connections{state="waiting"} rising and requests hanging while Postgres itself has few active
queries means connections are checked out and never released (missing `release()`). Restarting clears it
temporarily; reverting the leaking change fixes it.

# Postgres out of connection slots
"sorry, too many clients already" or the app cannot connect while Postgres is up. Look at pg_stat_activity
grouped by application_name; a single non-app client holding most slots is the cause. Terminate its
sessions: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = '<name>'`.

# Lock contention / hanging writes
Checkout or stats hang while reads work; pg_locks shows an AccessExclusiveLock held for a long time by a
session in "idle in transaction". Terminate that session (by application_name). Migrations must not run
long transactions against hot tables during traffic.

# Slow query
/api/products p95 jumps to seconds after a deploy that touched SQL, with a large table. Check EXPLAIN for
sequential scans and correlated subqueries. Fix: revert the query change (or add the index if that was the
intent).

# Database down
Health check fails with ECONNREFUSED to 5433, the db container is stopped; this app also crashes because its
pool has no error handler. Fix: `docker start test-website-db-1`, then restart the app.

# Traffic spike
rps several times baseline, latency up, few or no 5xx, no recent deploy, no DB troublemaker. This is load,
not a bug: don't roll back. The demo cannot scale out; investigate and wait it out, or rate-limit.
