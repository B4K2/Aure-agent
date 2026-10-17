"""Observability Agent — plain code. Polls the site, its /metrics, Postgres and the server log;
keeps rolling baselines; emits Anomaly dicts. No LLM here (rule of thumb, §6)."""
import re
import statistics
import subprocess
import time
import uuid
from collections import defaultdict, deque

import httpx
from .. import config, db
from ..state import Anomaly, now

SIGMA = 4.0       # 5 s polling is noisy; 2σ fires on ordinary traffic jitter
WARMUP = 12       # samples (~1 min) before σ-based checks start
WINDOW = 120      # ~10 min rolling baseline
MIN_SD_FRAC = 0.15  # a very steady baseline would make tiny moves look like 20σ; floor sd at 15% of the mean

# A candidate only becomes an anomaly after this many consecutive polls (5 s each). Short blips — a burst of
# new users doing full page loads, one slow request — never page anyone.
SUSTAIN = {"health": 2, "db_container": 1, "db_reachable": 2, "error_logs": 2}
SUSTAIN_DEFAULT = 3
MIN_ERROR_LINES = 3  # per poll, for the log signal

# Regex pre-filter for the server log (§6 Log Analyzer): keep errors + 5xx access lines only.
LOG_KEEP = re.compile(r"(Error|error:|ECONNREFUSED|ECONNRESET|timeout|terminat|FATAL|Unhandled|"
                      r"Failed to|Cannot|ReferenceError|TypeError|is not defined|column .* does not exist|"
                      r"\s5\d\d$)")
LOG_ACCESS = re.compile(r"^\S+Z (GET|POST|PUT|DELETE|PATCH) (\S+) (\d{3})$")


def _parse_prom(text: str) -> dict[str, list[tuple[dict, float]]]:
    out = defaultdict(list)
    for line in text.splitlines():
        if not line or line[0] == "#":
            continue
        m = re.match(r"^([a-zA-Z_:][\w:]*)(\{[^}]*\})?\s+(\S+)", line)
        if not m:
            continue
        labels = dict(re.findall(r'(\w+)="([^"]*)"', m.group(2) or ""))
        try:
            out[m.group(1)].append((labels, float(m.group(3))))
        except ValueError:
            pass
    return out


class Observer:
    def __init__(self):
        self.hist: dict[str, deque] = defaultdict(lambda: deque(maxlen=WINDOW))
        self.prev: dict | None = None
        self.prev_t = 0.0
        self.log_pos = config.SERVER_LOG.stat().st_size if config.SERVER_LOG.exists() else 0
        self.recent_logs: deque[str] = deque(maxlen=400)  # unfiltered, for the Conversation Agent
        self.filtered_logs: deque[str] = deque(maxlen=200)
        self.last_signals: dict = {}
        self.streak: dict[str, int] = defaultdict(int)

    # ---------- collection ----------
    def _health(self) -> dict:
        t = time.monotonic()
        try:
            r = httpx.get(f"{config.VOID_URL}/api/health", timeout=3)
            return {"up": r.status_code == 200, "status": r.status_code, "latency_s": time.monotonic() - t}
        except httpx.TimeoutException:
            return {"up": False, "status": "timeout", "latency_s": 3.0}
        except httpx.HTTPError as e:
            return {"up": False, "status": f"unreachable ({type(e).__name__})", "latency_s": None}

    def _metrics(self) -> dict:
        try:
            prom = _parse_prom(httpx.get(f"{config.VOID_URL}/metrics", timeout=3).text)
        except httpx.HTTPError:
            return {}
        t = time.monotonic()
        counts = defaultdict(float)
        buckets = defaultdict(float)
        for labels, v in prom.get("http_request_duration_seconds_count", []):
            counts["5xx" if labels.get("status", "").startswith("5") else "all_ok"] += v
        for labels, v in prom.get("http_request_duration_seconds_bucket", []):
            if labels.get("route", "").startswith("/api"):
                buckets[labels["le"]] += v
        g = lambda n, **lbl: next((v for l, v in prom.get(n, []) if all(l.get(k) == x for k, x in lbl.items())), None)
        cur = {"counts": dict(counts), "buckets": dict(buckets), "t": t}
        m = {
            "rss_mb": (g("process_resident_memory_bytes") or 0) / 1e6,
            "event_loop_lag_p99_s": g("nodejs_eventloop_lag_p99_seconds"),
            "pg_pool_waiting": g("pg_pool_connections", state="waiting"),
            "pg_pool_total": g("pg_pool_connections", state="total"),
            "process_start_time": g("process_start_time_seconds"),
        }
        if self.prev and t > self.prev["t"]:
            dt = t - self.prev["t"]
            d5 = cur["counts"].get("5xx", 0) - self.prev["counts"].get("5xx", 0)
            dok = cur["counts"].get("all_ok", 0) - self.prev["counts"].get("all_ok", 0)
            if d5 >= 0 and dok >= 0:  # negative = process restarted, skip this delta
                m["rps"] = (d5 + dok) / dt
                m["error_rate_5xx"] = d5 / (d5 + dok) if d5 + dok else 0.0
                m["api_p95_s"] = self._p95(cur["buckets"], self.prev["buckets"])
        self.prev = cur
        return m

    @staticmethod
    def _p95(cur: dict, prev: dict) -> float | None:
        delta = sorted(((float("inf") if le == "+Inf" else float(le)), cur[le] - prev.get(le, 0)) for le in cur)
        total = delta[-1][1] if delta else 0
        if total <= 0:
            return None
        for le, c in delta:
            if c >= 0.95 * total:
                return le if le != float("inf") else 10.0
        return None

    def _db(self) -> dict:
        info = {"container_running": None}
        out = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", config.DB_CONTAINER],
                             capture_output=True, text=True)
        if out.returncode == 0:
            info["container_running"] = out.stdout.strip() == "true"
        try:
            with db.session() as c:  # long-lived: still works when every slot is taken
                info["max_connections"] = int(c.execute("SHOW max_connections").fetchone()[0])
                rows = c.execute("""
                    SELECT coalesce(nullif(application_name, ''), '(none)') app, state, count(*),
                           max(extract(epoch FROM now() - xact_start)) longest_xact_s,
                           count(*) FILTER (WHERE wait_event_type = 'Lock') lock_waits
                      FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
                     GROUP BY 1, 2 ORDER BY 3 DESC""").fetchall()
                info["sessions"] = [{"application_name": a, "state": s, "count": n,
                                     "longest_xact_s": round(float(x or 0), 1), "lock_waits": lw}
                                    for a, s, n, x, lw in rows]
                info["total_sessions"] = sum(r["count"] for r in info["sessions"])
                info["lock_waits"] = sum(r["lock_waits"] for r in info["sessions"])
                info["exclusive_locks"] = [dict(zip(("application_name", "relation", "mode", "held_s"), r)) for r in c.execute("""
                    SELECT a.application_name, l.relation::regclass::text, l.mode,
                           round(extract(epoch FROM now() - a.xact_start)::numeric, 1)
                      FROM pg_locks l JOIN pg_stat_activity a USING (pid)
                     WHERE l.granted AND l.mode = 'AccessExclusiveLock' AND l.relation IS NOT NULL
                       AND a.pid <> pg_backend_pid()""").fetchall()]
                info["reachable"] = True
        except Exception as e:
            info["reachable"] = False
            info["error"] = str(e).splitlines()[0][:200]
        return info

    def _logs(self) -> list[str]:
        if not config.SERVER_LOG.exists():
            return []
        size = config.SERVER_LOG.stat().st_size
        if size < self.log_pos:
            self.log_pos = 0
        with config.SERVER_LOG.open("r", errors="replace") as f:
            f.seek(self.log_pos)
            chunk = f.read(2_000_000)
            self.log_pos = f.tell()
        lines = chunk.splitlines()
        self.recent_logs.extend(lines)
        kept = [l for l in lines if LOG_KEEP.search(l)]
        self.filtered_logs.extend(kept)
        return kept

    # ---------- detection ----------
    def _check(self, name: str, value: float | None, floor: float) -> Anomaly | None:
        """σ check against the rolling baseline, with an absolute floor so tiny baselines don't page.
        Doesn't touch the history; poll() decides what gets absorbed into the baseline."""
        h = self.hist[name]
        if value is None or len(h) < WARMUP:
            return None
        mean = statistics.fmean(h)
        sd = max(statistics.pstdev(h), abs(mean) * MIN_SD_FRAC, 1e-9)
        sigma = (value - mean) / sd
        if sigma > SIGMA and value - mean > floor:
            return _anomaly("metric", f"{name} = {value:.3g} vs baseline {mean:.3g} ({sigma:.1f}σ)", name, value, mean, sigma)
        return None

    def poll(self) -> list[Anomaly]:
        health, metrics, db = self._health(), self._metrics(), self._db()
        err_lines = self._logs()
        self.last_signals = {"health": health, "metrics": metrics, "db": db, "at": now()}
        found: list[Anomaly] = []

        # Hard thresholds — page immediately, no baseline needed.
        if not health["up"]:
            found.append(_anomaly("infra_event", f"/api/health {health['status']}", "health", None, None, None))
        if db.get("container_running") is False:
            found.append(_anomaly("infra_event", f"container {config.DB_CONTAINER} is not running", "db_container", 0, 1, None))
        elif db.get("reachable") is False:
            found.append(_anomaly("infra_event", f"Postgres unreachable: {db.get('error')}", "db_reachable", 0, 1, None))
        if db.get("max_connections") and db.get("total_sessions", 0) >= 0.9 * db["max_connections"]:
            found.append(_anomaly("metric", f"{db['total_sessions']}/{db['max_connections']} Postgres connections in use",
                                  "pg_sessions", db["total_sessions"], None, None))
        if db.get("lock_waits", 0) >= 3:
            found.append(_anomaly("metric", f"{db['lock_waits']} sessions waiting on locks; exclusive: {db.get('exclusive_locks')}",
                                  "pg_lock_waits", db["lock_waits"], 0, None))
        if (metrics.get("error_rate_5xx") or 0) > 0.05 and (metrics.get("rps") or 0) > 0.2:
            found.append(_anomaly("metric", f"5xx rate {metrics['error_rate_5xx']:.1%} at {metrics['rps']:.1f} rps",
                                  "error_rate_5xx", metrics["error_rate_5xx"], 0, None))
        if (metrics.get("pg_pool_waiting") or 0) >= 3:
            found.append(_anomaly("metric", f"{metrics['pg_pool_waiting']:.0f} requests waiting for a pg pool connection",
                                  "pg_pool_waiting", metrics["pg_pool_waiting"], 0, None))

        # Baseline (σ) checks. These are symptoms of the service struggling, not of load: more users alone
        # (higher rps) is never an anomaly; it's only reported as context when something else degrades.
        for name, floor in (("api_p95_s", 0.5), ("event_loop_lag_p99_s", 0.2), ("rss_mb", 150)):
            if a := self._check(name, metrics.get(name), floor):
                found.append(a)
        if a := self._rss_slope():
            found.append(a)

        if len(err_lines) >= MIN_ERROR_LINES:
            sample = "\n".join(err_lines[-8:])[-1500:]
            found.append(_anomaly("log", f"{len(err_lines)} error log lines:\n{sample}", "error_logs", len(err_lines), None, None))

        confirmed = self._sustained(found)
        if confirmed and (a := self._check("rps", metrics.get("rps"), 10)):
            confirmed.append(a)  # load as context for the reasoner (traffic spike vs regression)

        # Grow the baseline with whatever isn't a confirmed anomaly, so a lasting change in normal traffic
        # (say 15 → 20 users) is learned within a few minutes instead of being held out forever.
        fired = {a["metric_name"] for a in confirmed}
        for name in ("api_p95_s", "event_loop_lag_p99_s", "rss_mb", "rps"):
            if metrics.get(name) is not None and name not in fired:
                self.hist[name].append(metrics[name])
        return confirmed

    def _sustained(self, candidates: list[Anomaly]) -> list[Anomaly]:
        names = {a["metric_name"] for a in candidates}
        for n in list(self.streak):
            if n not in names:
                self.streak[n] = 0
        out = []
        for a in candidates:
            self.streak[a["metric_name"]] += 1
            if self.streak[a["metric_name"]] >= SUSTAIN.get(a["metric_name"], SUSTAIN_DEFAULT):
                out.append(a)
        return out

    def _rss_slope(self) -> Anomaly | None:
        h = list(self.hist["rss_mb"])[-24:]  # ~2 min
        if len(h) < 24:
            return None
        slope = (h[-1] - h[0]) / (len(h) * config.POLL_SECONDS)  # MB/s
        if slope > 1.0 and h[-1] - h[0] > 80:
            return _anomaly("metric", f"RSS grew {h[0]:.0f}→{h[-1]:.0f} MB in ~2 min ({slope:.1f} MB/s), not flattening",
                            "rss_growth_mb_s", slope, 0, None)
        return None


def _anomaly(signal_type, excerpt, metric_name, value, baseline, sigma) -> Anomaly:
    return Anomaly(id=uuid.uuid4().hex[:8], signal_type=signal_type, metric_name=metric_name, value=value,
                   baseline=baseline, deviation_sigma=round(sigma, 2) if sigma else None,
                   detected_at=now(), raw_excerpt=excerpt[:2000])
