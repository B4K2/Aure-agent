"""Cold-start memory: runbooks + a few hand-written past incidents (§16: hand-written, human-reviewed).

    uv run python -m aura.memory.seed
"""
import json
import re
from datetime import datetime, timedelta, timezone

from .. import config
from . import graph_db, vector_db

SEED = config.AGENT_DIR / "seed"


def main() -> None:
    chunks = []
    for f in sorted((SEED / "runbooks").glob("*.md")):
        for i, sec in enumerate(re.split(r"^# ", f.read_text(), flags=re.M)[1:]):
            title, _, body = sec.partition("\n")
            chunks.append({"id": f"{f.stem}-{i}", "title": title.strip(), "text": body.strip()})
    vector_db.upsert_runbooks(chunks)  # one batch (§9.2)
    print(f"runbooks: {len(chunks)} chunks")

    items = []
    for s in json.loads((SEED / "incidents.json").read_text()):
        ts = (datetime.now(timezone.utc) - timedelta(days=s["days_ago"])).isoformat()
        items.append({"incident_id": s["incident_id"], "service": config.SERVICE, "root_cause_type": s["root_cause_type"],
                      "resolved_by": s["resolved_by"], "confirmed": s["confirmed"], "timestamp": ts,
                      "text": vector_db.incident_text(config.SERVICE, s["root_cause_type"], s["hypothesis"], s["resolved_by"], s["symptoms"])})
    vector_db.upsert_incidents(items)
    graph_db.ensure_topology()
    for it in items:
        graph_db.record_incident(it["incident_id"], config.SERVICE, it["root_cause_type"], it["confirmed"], it["timestamp"],
                                 it["resolved_by"].split(" ")[0], None)
    print(f"incidents: {len(items)} seeded; neo4j topology ready")


if __name__ == "__main__":
    main()
