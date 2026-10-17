"""Execution Agent: dry-run text for the approval prompt, then the real action plus a verification window (§13).
Only runs after a human approves; the graph enforces that."""
import json
import subprocess
import time

import httpx
from .. import config, db
from ..state import AuraState, audit

RESTART_JS = (f"import('{config.PROBLEM_DIR / 'lib' / 'server.js'}')"
              ".then(m => m.restart()).then(ok => process.exit(ok ? 0 : 1))")


def _commands(action: dict) -> list[list[str]] | str:
    t, target = action["type"], action.get("target", "")
    restart = ["node", "-e", RESTART_JS]
    if t == "rollback":
        return [["git", "-C", str(config.WEBSITE_DIR), "revert", "--no-edit", target], restart]
    if t == "restart_service":
        return [restart]
    if t == "start_db":
        return [["docker", "start", config.DB_CONTAINER]]
    if t == "terminate_db_sessions":
        return f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = '{target}'"
    return []


def dry_run(action: dict) -> str:
    cmds = _commands(action)
    if isinstance(cmds, str):
        return f"psql> {cmds};"
    if not cmds:
        return f"(no command: '{action['type']}' is advisory; nothing will be executed)"
    lines = [" ".join(c if c != RESTART_JS else "<restart website via problem/lib/server.js>" for c in cmd) for cmd in cmds]
    if action["type"] == "rollback":
        lines.insert(0, "# commit to revert:\n" + subprocess.run(
            ["git", "-C", str(config.WEBSITE_DIR), "show", "--stat", "--format=%h %s (%an, %cr)", action["target"]],
            capture_output=True, text=True).stdout.strip())
    return "\n".join(lines)


def _run(action: dict) -> list[str]:
    logs: list[str] = []
    cmds = _commands(action)
    if isinstance(cmds, str):
        if not action.get("target") or action["target"].startswith("aura"):
            raise ValueError(f"refusing to terminate sessions for application_name={action.get('target')!r}")
        with db.session() as c:  # the shared session: a fresh connect would fail if slots are exhausted
            n = len(c.execute(cmds).fetchall())
        logs.append(f"terminated {n} session(s) for application_name={action['target']}")
        return logs
    for cmd in cmds:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        logs.append(f"$ {' '.join(cmd[:4])}{' …' if len(cmd) > 4 else ''} → exit {r.returncode}\n{(r.stdout + r.stderr).strip()[-1500:]}")
        if r.returncode != 0 and cmd[0] == "git":
            raise RuntimeError(logs[-1])
    return logs


def _verify() -> tuple[bool, list[str]]:
    """Healthy + 5xx under 2% for 3 consecutive checks inside the window."""
    good, notes, prev = 0, [], None
    end = time.monotonic() + config.VERIFY_WINDOW_SECONDS
    while time.monotonic() < end:
        try:
            ok = httpx.get(f"{config.VOID_URL}/api/health", timeout=3).status_code == 200
            text = httpx.get(f"{config.VOID_URL}/metrics", timeout=3).text
            fivexx = sum(float(l.rsplit(" ", 1)[1]) for l in text.splitlines()
                         if l.startswith("http_request_duration_seconds_count") and 'status="5' in l)
            total = sum(float(l.rsplit(" ", 1)[1]) for l in text.splitlines() if l.startswith("http_request_duration_seconds_count"))
            rate = 0.0
            if prev and total > prev[1]:
                rate = (fivexx - prev[0]) / (total - prev[1])
            prev = (fivexx, total)
            good = good + 1 if ok and rate < 0.02 else 0
            notes.append(f"health={'ok' if ok else 'down'} 5xx={rate:.1%}")
        except httpx.HTTPError as e:
            good = 0
            notes.append(f"unreachable: {type(e).__name__}")
        if good >= 3:
            return True, notes[-3:]
        time.sleep(4)
    return False, notes[-5:]


def execution_node(state: AuraState) -> dict:
    action = state["rca"]["proposed_action"]
    started = time.time()
    try:
        logs = _run(action)
        if action["type"] in ("start_db", "terminate_db_sessions"):  # the app may have crashed meanwhile; bring it back too
            time.sleep(3)
            try:
                up = httpx.get(f"{config.VOID_URL}/api/health", timeout=3).status_code == 200
            except httpx.HTTPError:
                up = False
            if not up:
                logs += _run({"type": "restart_service", "target": config.SERVICE})
        resolved, notes = _verify() if _commands(action) else (False, ["advisory action, nothing executed"])
        result = {"status": "success" if resolved else "failed", "resolved": resolved, "logs": logs + notes,
                  "message": "issue resolved" if resolved else "action taken, issue not yet resolved — handing back to you",
                  "executed_at": started, "duration_s": round(time.time() - started, 1)}
    except Exception as e:
        result = {"status": "failed", "resolved": False, "logs": [str(e)], "message": f"execution error: {e}",
                  "executed_at": started}
    return {"execution_result": result,
            **audit("execution", action["type"], f"{result['message']} ({json.dumps(action)})")}
