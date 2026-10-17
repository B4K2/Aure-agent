"""EmbeddingGemma 2 (local, sentence-transformers). 768-dim, cosine; loaded once, lazily."""
from functools import lru_cache

from . import config


@lru_cache(maxsize=1)
def _model():
    import torch
    from sentence_transformers import SentenceTransformer

    device = "cuda" if torch.cuda.is_available() else "cpu"
    # Card: use bf16/fp32, not fp16.
    kwargs = {"torch_dtype": torch.bfloat16} if device == "cuda" else {}
    return SentenceTransformer(config.EMBED_MODEL, device=device, token=config.HF_TOKEN, model_kwargs=kwargs)


def _encode(texts: list[str], prompt_name: str) -> list[list[float]]:
    truncate = config.EMBED_DIM if config.EMBED_DIM != 768 else None
    vecs = _model().encode(texts, prompt_name=prompt_name, truncate_dim=truncate,
                           normalize_embeddings=True, batch_size=16)
    return [v.astype("float32").tolist() for v in vecs]


def embed_query(text: str) -> list[float]:
    """Live anomaly description / user question → search side."""
    return _encode([text], "SearchQuery")[0]


def embed_documents(texts: list[str]) -> list[list[float]]:
    """Stored incidents and runbook chunks. Batch these (§9.2)."""
    return _encode(texts, "Document")
