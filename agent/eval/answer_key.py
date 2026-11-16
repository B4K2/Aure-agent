"""Answer key for scoring Aura's proposals. Mirrors problem/scenarios/*.js `fix`; never shown to the agent.

cause:   accepted root_cause_type values
action:  accepted proposed_action.type values (traffic-spike: advisory only, rollback is the trap)
target:  "commit"   -> rollback target must match the commit the injector made
         "<name>"   -> terminate target must name this application_name
         None       -> target not scored
"""
KEY = {
    "bad-deploy-checkout-500": dict(cause={"bad_deploy"}, action={"rollback"}, target="commit"),
    "bad-deploy-crash": dict(cause={"crash_on_boot", "bad_deploy"}, action={"rollback"}, target="commit"),
    "cpu-hot-path": dict(cause={"cpu_saturation", "bad_deploy"}, action={"rollback"}, target="commit"),
    "memory-leak": dict(cause={"memory_leak"}, action={"rollback"}, target="commit"),
    # trap: restart_service only buys time
    "db-pool-leak": dict(cause={"db_pool_leak"}, action={"rollback"}, target="commit"),
    "slow-query": dict(cause={"slow_query"}, action={"rollback"}, target="commit"),
    "db-connection-exhaustion": dict(cause={"db_connection_exhaustion"}, action={"terminate_db_sessions"},
                                     target="report-worker"),
    "db-lock": dict(cause={"db_lock"}, action={"terminate_db_sessions"}, target="migrate_orders_add_status"),
    "db-outage": dict(cause={"db_outage"}, action={"start_db"}, target=None),
    # trap: no deploy correlates; the right answer is NOT a rollback
    "traffic-spike": dict(cause={"traffic_spike"}, action={"scale", "investigate_further"}, target=None),
}
ADVISORY = {"scale", "investigate_further"}


def score(scenario: str, rca: dict, commit: str | None) -> dict:
    k = KEY[scenario]
    act = (rca or {}).get("proposed_action") or {}
    target = str(act.get("target") or "")
    cause_ok = (rca or {}).get("root_cause_type") in k["cause"]
    action_ok = act.get("type") in k["action"]
    if k["target"] is None or not action_ok:
        target_ok = action_ok if k["target"] else None
    elif k["target"] == "commit":
        target_ok = bool(commit) and bool(target) and (commit.startswith(target[:7]) or target.startswith(commit[:7]))
    else:
        target_ok = k["target"] in target
    return {"cause_ok": cause_ok, "action_ok": action_ok, "target_ok": target_ok,
            "correct": cause_ok and action_ok and target_ok is not False}
