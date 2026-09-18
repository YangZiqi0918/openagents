# -*- coding: utf-8 -*-
"""
Test fixtures for the workspace backend.

Uses SQLite in-memory database for fast isolated tests.
Registers custom compilers so PostgreSQL-specific types work with SQLite.
Uses StaticPool to share a single in-memory database across all connections.
"""

import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.sqlite.base import SQLiteTypeCompiler
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Register PostgreSQL types for SQLite compilation
SQLiteTypeCompiler.visit_JSONB = lambda self, type_, **kw: "JSON"
SQLiteTypeCompiler.visit_UUID = lambda self, type_, **kw: "TEXT"

# Now import the app (which loads models)
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402


# ---------------------------------------------------------------------------
# Test database setup — StaticPool ensures all connections share one DB
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


# Translate Postgres-specific server defaults (NOW(), gen_random_uuid()) to
# SQLite-friendly equivalents at SQL-emit time. Production uses Postgres and
# is unaffected — this only fires for the test engine. Without this, CREATE
# TABLE fails because SQLite doesn't recognize NOW().
@event.listens_for(engine, "before_cursor_execute", retval=True)
def _rewrite_pg_to_sqlite(conn, cursor, statement, parameters, context, executemany):
    if "DEFAULT NOW()" in statement:
        statement = statement.replace("DEFAULT NOW()", "DEFAULT CURRENT_TIMESTAMP")
    if "DEFAULT gen_random_uuid()" in statement:
        # SQLite has no UUID generator; Python-side default=_uuid handles INSERTs.
        statement = statement.replace("DEFAULT gen_random_uuid()", "")
    return statement, parameters


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def setup_database():
    """Create all tables before each test, drop after."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    """FastAPI test client."""
    return TestClient(app)


@pytest.fixture
def db():
    """Direct database session for test setup/assertions."""
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def owner_headers(monkeypatch):
    import app.access as access
    original = access.verify_identity_claims
    claims = {"provider": "firebase", "email": "test@example.com", "firebase_uid": None, "apple_sub": None, "display_name": "Test Owner"}
    monkeypatch.setattr(access, "verify_identity_claims", lambda token: claims if token == "verified-fixture-owner" else original(token))
    return {"Authorization": "Bearer verified-fixture-owner"}


@pytest.fixture
def workspace(client, owner_headers):
    """Create a workspace and return its details (id, slug, token)."""
    resp = create_test_workspace(client, json={
        "name": "Test Workspace",
        "agent_name": "agent-alpha",
        "creator_email": "test@example.com",
    })
    assert resp.status_code == 200
    data = resp.json()["data"]
    return {
        "id": data["workspaceId"],
        "slug": data["slug"],
        "name": "Test Workspace",
        "token": data["token"],
        "channel": data["channel"],
        "owner_headers": owner_headers,
    }


def create_test_workspace(client, **kwargs):
    """Exercise authenticated creation with the usual mocked provider seam."""
    import app.access as access
    original = access.verify_identity_claims
    email = (kwargs.get("json", {}).get("creator_email") or "test@example.com").lower()
    token = "verified-fixture-owner"
    claims = {"provider": "firebase", "email": email, "firebase_uid": None, "apple_sub": None, "display_name": "Test Owner"}
    headers = {**kwargs.pop("headers", {}), "Authorization": f"Bearer {token}"}
    with patch.object(access, "verify_identity_claims", side_effect=lambda value: claims if value == token else original(value)):
        return client.post("/v1/workspaces", headers=headers, **kwargs)
