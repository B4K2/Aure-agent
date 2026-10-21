"""Neo4j: causal / dependency memory (§9.4)."""
from functools import lru_cache

from neo4j import GraphDatabase

from .. import config


@lru_cache(maxsize=1)
def driver():
    d = GraphDatabase.driver(config.NEO4J_URI, auth=(config.NEO4J_USER, config.NEO4J_PASSWORD))
    with d.session() as s:
        s.run("CREATE CONSTRAINT service_name IF NOT EXISTS FOR (s:Service) REQUIRE s.name IS UNIQUE")
        s.run("CREATE CONSTRAINT incident_id IF NOT EXISTS FOR (i:Incident) REQUIRE i.id IS UNIQUE")
    return d


def _run(cypher: str, **params) -> list[dict]:
    with driver().session() as s:
        return [r.data() for r in s.run(cypher, **params)]


def ensure_topology() -> None:
    """VOID: the app depends on Postgres; the storefront (client bundle) is served by the app."""
    _run("""
        MERGE (app:Service {name: 'void-app'}) SET app.tier = 'backend'
        MERGE (db:Service {name: 'void-db'}) SET db.tier = 'data'
        MERGE (web:Service {name: 'void-storefront'}) SET web.tier = 'frontend'
        MERGE (app)-[:DEPENDS_ON]->(db)
        MERGE (web)-[:DEPENDS_ON]->(app)""")


def record_deployment(service: str, commit: dict) -> None:
    _run("""
        MERGE (s:Service {name: $service})
        MERGE (d:Deployment {commit_hash: $hash}) SET d.timestamp = $ts, d.author = $author
        MERGE (c:Commit {hash: $hash}) SET c.message = $message, c.diff_summary = $diff
        MERGE (c)-[:PART_OF]->(d)
        MERGE (d)-[:DEPLOYED_TO]->(s)""",
         service=service, hash=commit["hash"], ts=commit["timestamp"], author=commit.get("author", ""),
         message=commit["message"], diff=commit.get("diff_summary", ""))


def causal_history(service: str, suspected_type: str | None = None) -> list[dict]:
    """'Has this type of change caused this type of failure before?' — the self-learning query."""
    return _run("""
        MATCH (s:Service {name: $service})<-[:DEPLOYED_TO]-(d:Deployment)-[:CAUSED]->(i:Incident)
        WHERE $type IS NULL OR i.root_cause_type = $type
        OPTIONAL MATCH (c:Commit)-[:PART_OF]->(d)
        RETURN d.commit_hash AS commit, c.message AS message, d.timestamp AS deployed_at,
               i.id AS incident, i.root_cause_type AS root_cause_type, i.confirmed AS confirmed
        ORDER BY d.timestamp DESC LIMIT 5""", service=service, type=suspected_type)


def root_cause_frequency(service: str) -> list[dict]:
    return _run("""
        MATCH (s:Service {name: $service})<-[:AFFECTED]-(i:Incident)
        RETURN i.root_cause_type AS root_cause_type, count(*) AS times,
               sum(CASE WHEN i.confirmed THEN 1 ELSE 0 END) AS confirmed
        ORDER BY times DESC""", service=service)


def impact(service: str) -> list[dict]:
    return _run("""
        MATCH (s:Service {name: $service})<-[:DEPENDS_ON*1..3]-(dep:Service)
        RETURN DISTINCT dep.name AS name, dep.tier AS tier""", service=service)


def record_incident(incident_id: str, service: str, root_cause_type: str, confirmed: bool, timestamp: str,
                    action_type: str, commit_hash: str | None) -> None:
    _run("""
        MERGE (s:Service {name: $service})
        MERGE (i:Incident {id: $id})
        SET i.root_cause_type = $rct, i.resolved = true, i.confirmed = $confirmed, i.timestamp = $ts
        MERGE (i)-[:AFFECTED]->(s)
        MERGE (a:Action {type: $action})
        MERGE (i)-[:RESOLVED_BY]->(a)""",
         id=incident_id, service=service, rct=root_cause_type, confirmed=confirmed, ts=timestamp, action=action_type)
    if commit_hash:
        _run("""MATCH (d:Deployment {commit_hash: $hash}), (i:Incident {id: $id}) MERGE (d)-[:CAUSED]->(i)""",
             hash=commit_hash, id=incident_id)


def topology() -> dict:
    """Every service, its DEPENDS_ON edges, and what memory knows about it (dashboard graph)."""
    nodes = _run("""
        MATCH (s:Service)
        OPTIONAL MATCH (s)<-[:AFFECTED]-(i:Incident)
        OPTIONAL MATCH (s)<-[:DEPLOYED_TO]-(d:Deployment)
        RETURN s.name AS name, s.tier AS tier, count(DISTINCT i) AS incidents,
               count(DISTINCT CASE WHEN i.confirmed THEN i END) AS confirmed, count(DISTINCT d) AS deployments""")
    edges = _run("MATCH (a:Service)-[:DEPENDS_ON]->(b:Service) RETURN a.name AS source, b.name AS target")
    return {"nodes": nodes, "edges": edges}


def service_detail(service: str) -> dict:
    incidents = _run("""
        MATCH (s:Service {name: $service})<-[:AFFECTED]-(i:Incident)
        OPTIONAL MATCH (i)-[:RESOLVED_BY]->(a:Action)
        OPTIONAL MATCH (d:Deployment)-[:CAUSED]->(i)
        RETURN i.id AS id, i.root_cause_type AS root_cause_type, i.confirmed AS confirmed, i.timestamp AS timestamp,
               a.type AS action, d.commit_hash AS commit
        ORDER BY i.timestamp DESC LIMIT 20""", service=service)
    deployments = _run("""
        MATCH (s:Service {name: $service})<-[:DEPLOYED_TO]-(d:Deployment)
        OPTIONAL MATCH (c:Commit)-[:PART_OF]->(d)
        OPTIONAL MATCH (d)-[:CAUSED]->(i:Incident)
        RETURN d.commit_hash AS commit, d.timestamp AS timestamp, d.author AS author, c.message AS message,
               collect(i.id) AS caused
        ORDER BY d.timestamp DESC LIMIT 10""", service=service)
    return {"name": service, "incidents": incidents, "deployments": deployments,
            "frequency": root_cause_frequency(service), "impact": impact(service)}
