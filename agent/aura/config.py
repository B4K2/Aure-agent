"""All runtime settings, from agent/.env (falls back to defaults that match the local demo stack)."""
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

AGENT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(AGENT_DIR / ".env")

PROJECT_DIR = AGENT_DIR.parent
WEBSITE_DIR = Path(os.getenv("VOID_WEBSITE_DIR", PROJECT_DIR / "test-website"))
PROBLEM_DIR = Path(os.getenv("VOID_PROBLEM_DIR", PROJECT_DIR / "problem"))
# The website's stdout when it was (re)started by the injector or by Aura.
SERVER_LOG = Path(os.getenv("VOID_SERVER_LOG", PROBLEM_DIR / ".state" / "server.log"))
STATE_DIR = AGENT_DIR / ".aura_state"
STATE_DIR.mkdir(exist_ok=True)

VOID_URL = os.getenv("VOID_URL", "http://localhost:4000").rstrip("/")
DATABASE_URL = os.getenv("DATABASE_URL", "postgres://void:void@localhost:5433/void")
DB_CONTAINER = os.getenv("VOID_DB_CONTAINER", "test-website-db-1")
# Where the watched service runs: "docker" (local demo) or "kubernetes" (kubectl; see aura/runtime.py).
RUNTIME = os.getenv("AURA_RUNTIME", "docker").lower()
K8S_NAMESPACE = os.getenv("K8S_NAMESPACE", "default")
K8S_CONTEXT = os.getenv("K8S_CONTEXT", "")  # empty = kubeconfig's current context (or in-cluster)
K8S_APP_DEPLOYMENT = os.getenv("K8S_APP_DEPLOYMENT", "void-app")
K8S_APP_SELECTOR = os.getenv("K8S_APP_SELECTOR", "app=void-app")
K8S_DB_STATEFULSET = os.getenv("K8S_DB_STATEFULSET", "void-db")
SERVICE = "void-app"  # the one service under watch; DB issues are attributed to it too

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.meta.ai/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "muse-spark-1.3-contributor")
LLM_FAST_MODEL = os.getenv("LLM_FAST_MODEL", LLM_MODEL)  # Summary Writer; phrasing only

EMBED_MODEL = os.getenv("EMBED_MODEL", "google/embeddinggemma-2")
EMBED_DIM = int(os.getenv("EMBED_DIM", "768"))  # native; 512/256/128 also valid (Matryoshka)
HF_TOKEN = os.getenv("HUGGING_FACE_TOKEN")

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "aura-dev-password")



def _api_token() -> str:
    """AURA_API_TOKEN if set; otherwise a random token generated once and kept in .aura_state/api_token
    (owner-only). A local aura-cli reads that file; the CLI's /web prints a dashboard link carrying it."""
    if os.getenv("AURA_API_TOKEN"):
        return os.environ["AURA_API_TOKEN"]
    f = STATE_DIR / "api_token"
    if not f.exists():
        fd = os.open(f, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as out:
            out.write(secrets.token_urlsafe(32))
    return f.read_text().strip()


API_TOKEN = _api_token()
API_PORT = int(os.getenv("AURA_API_PORT", "8700"))
API_HOST = os.getenv("AURA_API_HOST", "127.0.0.1")  # 0.0.0.0 in a container

POLL_SECONDS = float(os.getenv("AURA_POLL_SECONDS", "5"))
DEBOUNCE_SECONDS = 12         # §12: let a burst settle before enrichment
CONFIDENCE_THRESHOLD = 0.75   # §8
VERIFY_WINDOW_SECONDS = 120   # §13
RECENCY_HALF_LIFE_DAYS = 180  # §11
