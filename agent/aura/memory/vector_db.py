"""Qdrant: semantic memory of past incidents (confirmed AND rejected, §10) and runbook chunks."""
import math
import uuid
from datetime import datetime, timezone
from functools import lru_cache

from qdrant_client import QdrantClient, models

from .. import config
from ..embeddings import embed_documents, embed_query

INCIDENTS, RUNBOOKS = "incidents", "runbooks"


@lru_cache(maxsize=1)
def client() -> QdrantClient:
    c = QdrantClient(url=config.QDRANT_URL)
    for name in (INCIDENTS, RUNBOOKS):
        if not c.collection_exists(name):
            c.create_collection(name, vectors_config=models.VectorParams(size=config.EMBED_DIM, distance=models.Distance.COSINE))
        else:  # dimension mismatch is the classic first-upsert bug (§9.2) — fail loudly
            size = c.get_collection(name).config.params.vectors.size
            if size != config.EMBED_DIM:
                raise RuntimeError(f"Qdrant collection {name!r} is {size}-dim but EMBED_DIM={config.EMBED_DIM}; drop it and reseed")
    return c


def _pid(key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, key))


def incident_text(service: str, root_cause_type: str, hypothesis: str, resolved_by: str, symptoms: str) -> str:
    """§9.5: embed root cause + fix + service + symptoms, not just the one-liner."""
    return (f"service: {service}. symptoms: {symptoms}. root cause ({root_cause_type}): {hypothesis}. "
            f"resolved by: {resolved_by}.")


def upsert_incidents(items: list[dict]) -> None:
    """items: {incident_id, service, root_cause_type, resolved_by, confirmed, timestamp, text}"""
    vecs = embed_documents([i["text"] for i in items])
    client().upsert(INCIDENTS, points=[
        models.PointStruct(id=_pid(i["incident_id"]), vector=v, payload=i) for i, v in zip(items, vecs)])


def search_incidents(description: str, service: str, limit: int = 10, threshold: float = 0.6) -> dict:
    res = client().query_points(
        INCIDENTS, query=embed_query(description), limit=limit, score_threshold=threshold,
        query_filter=models.Filter(must=[models.FieldCondition(key="service", match=models.MatchValue(value=service))]),
    ).points
    out = {"confirmed": [], "rejected": [], "inconclusive": []}
    now = datetime.now(timezone.utc)
    for p in res:
        age = (now - datetime.fromisoformat(p.payload["timestamp"])).total_seconds() / 86400
        recency = math.exp(-max(age, 0) / config.RECENCY_HALF_LIFE_DAYS)  # §11
        m = {**p.payload, "similarity": round(p.score, 3), "final_score": round(p.score * recency, 3),
             "age_days": round(age, 1), "older": age > config.RECENCY_HALF_LIFE_DAYS}
        bucket = "confirmed" if p.payload.get("confirmed") else "inconclusive" if p.payload.get("inconclusive") else "rejected"
        out[bucket].append(m)
    for k in out:
        out[k].sort(key=lambda m: m["final_score"], reverse=True)
    return out


def upsert_runbooks(chunks: list[dict]) -> None:
    """chunks: {id, title, text}"""
    vecs = embed_documents([f"title: {c['title']} | text: {c['text']}" for c in chunks])
    client().upsert(RUNBOOKS, points=[models.PointStruct(id=_pid(c["id"]), vector=v, payload=c) for c, v in zip(chunks, vecs)])


def search_runbooks(question: str, limit: int = 3) -> list[dict]:
    res = client().query_points(RUNBOOKS, query=embed_query(question), limit=limit).points
    return [{**p.payload, "similarity": round(p.score, 3)} for p in res]


def _bucket(payload: dict) -> str:
    return "confirmed" if payload.get("confirmed") else "inconclusive" if payload.get("inconclusive") else "rejected"


def all_incidents(limit: int = 500) -> list[dict]:
    """Every remembered incident, newest first (dashboard history)."""
    points, _ = client().scroll(INCIDENTS, limit=limit, with_payload=True, with_vectors=False)
    out = [{**p.payload, "outcome": _bucket(p.payload)} for p in points]
    return sorted(out, key=lambda m: m.get("timestamp", ""), reverse=True)


def search_memory(q: str, limit: int = 8) -> dict:
    """Free-text search over both collections, any service, no threshold: the human decides what's relevant."""
    v = embed_query(q)
    incidents = client().query_points(INCIDENTS, query=v, limit=limit).points
    runbooks = client().query_points(RUNBOOKS, query=v, limit=limit).points
    return {"incidents": [{**p.payload, "outcome": _bucket(p.payload), "similarity": round(p.score, 3)} for p in incidents],
            "runbooks": [{**p.payload, "similarity": round(p.score, 3)} for p in runbooks]}
