"""Cold-start memory: runbooks + a few hand-written past incidents (§16: hand-written, human-reviewed).

    uv run python -m aura.memory.seed            # add the seed (keeps everything already learned)
    uv run python -m aura.memory.seed --reset    # wipe all memory first: a true cold start
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone

from .. import config
from . import graph_db, vector_db

SEED = config.AGENT_DIR / "seed"


def reset() -> None:
    """Drop all learned memory (both Qdrant collections, the whole Neo4j graph) so seeding gives a true cold start."""
    from qdrant_client import QdrantClient
    q = QdrantClient(url=config.QDRANT_URL)
    for name in (vector_db.INCIDENTS, vector_db.RUNBOOKS):
        if q.collection_exists(name):
            q.delete_collection(name)
    graph_db._run("MATCH (n) DETACH DELETE n")
    print("reset: qdrant collections dropped, neo4j graph cleared")


def main() -> None:
    if "--reset" in sys.argv[1:]:
        reset()
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
