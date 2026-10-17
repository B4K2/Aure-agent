"""One long-lived Postgres session for Aura itself.

Opening a fresh connection per poll fails exactly when it matters: when something holds every slot
(including superuser_reserved_connections), Aura would be blind and unable to run pg_terminate_backend.
So we connect once at startup, keep the session, and share it (observer, chat, execution) behind a lock.
"""
import threading
from contextlib import contextmanager

import psycopg

from . import config

_lock = threading.Lock()
_conn: psycopg.Connection | None = None


def _connect() -> psycopg.Connection:
    c = psycopg.connect(config.DATABASE_URL, connect_timeout=3, autocommit=True, application_name="aura")
    c.execute("SET statement_timeout = 5000")
    return c


@contextmanager
def session():
    """Yields the shared connection; reconnects if it died (e.g. Postgres restarted)."""
    global _conn
    with _lock:
        if _conn is None or _conn.closed or _conn.broken:
            _conn = _connect()
        try:
            yield _conn
        except (psycopg.OperationalError, psycopg.InterfaceError):
            try:
                _conn.close()
            finally:
                _conn = None
            raise


@contextmanager
def readonly():
    """Read-only transaction on the shared session (chat's ad-hoc SQL)."""
    with session() as c:
        with c.transaction():
            c.execute("SET TRANSACTION READ ONLY")
            yield c
