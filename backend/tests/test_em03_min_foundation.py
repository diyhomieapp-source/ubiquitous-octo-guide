"""
EM-03-MIN — Canonical Foundation Bootstrap contract suite (isolated).

Validates the bootstrap migration file statically (no database required):
  - audit_event / outbox tables exist with required convention columns
  - RLS enabled deny-by-default (zero CREATE POLICY statements)
  - append-only guard on audit_event, updated_at trigger on outbox
  - ZERO domain tables (EM-03-MIN scope guard)
  - no credential values in tracked schema files

If SUPABASE_DB_URL is set (non-production only), additionally applies the
migration and verifies live contracts; otherwise the live check is skipped.

This suite touches no legacy engines, no Mongo, and no backend endpoints.
"""
import os
import re

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MIGRATION = os.path.join(REPO_ROOT, "supabase", "migrations", "0001_foundation_bootstrap.sql")
README = os.path.join(REPO_ROOT, "supabase", "README.md")


@pytest.fixture(scope="module")
def sql() -> str:
    with open(MIGRATION, "r", encoding="utf-8") as f:
        return f.read()


def _strip_comments(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


# ---------------------------------------------------------------- structure

def test_migration_and_readme_exist():
    assert os.path.isfile(MIGRATION), "bootstrap migration missing"
    assert os.path.isfile(README), "supabase/README.md conventions record missing"


def test_canon_schema_created(sql):
    assert re.search(r"CREATE SCHEMA IF NOT EXISTS canon", sql)


def test_audit_event_contract(sql):
    m = re.search(r"CREATE TABLE IF NOT EXISTS canon\.audit_event\s*\((.*?)\);", sql, re.S)
    assert m, "canon.audit_event table missing"
    body = m.group(1)
    for col, typ in [
        ("id", "uuid"), ("occurred_at", "timestamptz"), ("actor_type", "text"),
        ("action", "text"), ("entity_type", "text"), ("payload", "jsonb"),
        ("created_at", "timestamptz"),
    ]:
        assert re.search(rf"\b{col}\s+{typ}", body), f"audit_event.{col} ({typ}) missing"
    assert "PRIMARY KEY DEFAULT gen_random_uuid()" in body, "stable uuid id convention violated"


def test_audit_event_append_only(sql):
    assert re.search(
        r"CREATE TRIGGER audit_event_append_only\s+BEFORE UPDATE OR DELETE ON canon\.audit_event",
        sql), "append-only trigger missing on audit_event"
    assert "canon.forbid_mutation" in sql


def test_outbox_contract(sql):
    m = re.search(r"CREATE TABLE IF NOT EXISTS canon\.outbox\s*\((.*?)\);", sql, re.S)
    assert m, "canon.outbox table missing"
    body = m.group(1)
    for col, typ in [
        ("id", "uuid"), ("topic", "text"), ("aggregate_type", "text"),
        ("aggregate_id", "text"), ("payload", "jsonb"), ("status", "text"),
        ("attempts", "integer"), ("available_at", "timestamptz"),
        ("dispatched_at", "timestamptz"), ("created_at", "timestamptz"),
        ("updated_at", "timestamptz"),
    ]:
        assert re.search(rf"\b{col}\s+{typ}", body), f"outbox.{col} ({typ}) missing"
    for status in ("pending", "dispatching", "dispatched", "failed"):
        assert f"'{status}'" in body, f"outbox status '{status}' missing from check constraint"
    assert re.search(r"CREATE INDEX IF NOT EXISTS outbox_dispatch_idx", sql), "dispatch index missing"
    assert re.search(
        r"CREATE TRIGGER outbox_set_updated_at\s+BEFORE UPDATE ON canon\.outbox", sql
    ), "updated_at trigger missing on outbox"


# ------------------------------------------------------- access / RLS skeleton

def test_rls_enabled_on_all_tables(sql):
    tables = re.findall(r"CREATE TABLE IF NOT EXISTS canon\.(\w+)", sql)
    assert set(tables) == {"audit_event", "outbox"}
    for t in tables:
        assert re.search(rf"ALTER TABLE canon\.{t}\s+ENABLE ROW LEVEL SECURITY", sql), \
            f"RLS not enabled on canon.{t}"


def test_deny_by_default_zero_policies(sql):
    assert "CREATE POLICY" not in _strip_comments(sql).upper().replace("CREATE  POLICY", "CREATE POLICY"), \
        "deny-by-default violated: policy found in bootstrap"


def test_client_roles_revoked(sql):
    for role in ("anon", "authenticated"):
        assert re.search(rf"REVOKE ALL ON SCHEMA canon FROM {role}", sql), \
            f"schema privileges not revoked from {role}"


# ---------------------------------------------------------------- scope guards

FORBIDDEN_DOMAIN_TERMS = [
    "user", "identity", "tenant", "consent", "recovery", "membership", "member",
    "property", "room", "asset", "project", "work_item", "workitem", "revision",
    "safety", "evidence", "measurement", "procurement", "readiness",
    "billing", "entitlement", "subscription", "provider_account", "receipt",
]


def test_zero_domain_tables(sql):
    tables = re.findall(r"CREATE TABLE IF NOT EXISTS canon\.(\w+)", sql)
    for t in tables:
        for term in FORBIDDEN_DOMAIN_TERMS:
            assert term not in t.lower(), f"domain table leaked into EM-03-MIN bootstrap: canon.{t}"


def test_no_secret_values_in_supabase_dir():
    patterns = [
        re.compile(r"sk-[A-Za-z0-9]{20,}"),
        re.compile(r"eyJ[A-Za-z0-9_-]{20,}\."),           # JWT-like (supabase keys)
        re.compile(r"postgres(ql)?://[^\s'\"]*:[^\s'\"]+@"),  # conn string with password
    ]
    sup_dir = os.path.join(REPO_ROOT, "supabase")
    for root, _dirs, files in os.walk(sup_dir):
        for fn in files:
            with open(os.path.join(root, fn), "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            for p in patterns:
                hit = p.search(content)
                assert not (hit and "$SUPABASE_DB_URL" not in hit.group(0)), \
                    f"potential secret value in tracked file {fn}: {p.pattern}"


def test_no_legacy_coupling():
    """No backend module imports from or references the supabase bootstrap."""
    backend = os.path.join(REPO_ROOT, "backend")
    for fn in os.listdir(backend):
        if fn.endswith(".py"):
            with open(os.path.join(backend, fn), "r", encoding="utf-8", errors="ignore") as f:
                assert "supabase/migrations" not in f.read(), \
                    f"legacy module {fn} references bootstrap migration"


# ------------------------------------------------------- optional live apply

@pytest.mark.skipif(not os.environ.get("SUPABASE_DB_URL"),
                    reason="SUPABASE_DB_URL not set — live non-production apply skipped")
def test_live_apply_and_contracts(sql):
    psycopg = pytest.importorskip("psycopg")
    dsn = os.environ["SUPABASE_DB_URL"]
    with psycopg.connect(dsn, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute(sql)  # idempotent apply
        cur.execute("""
            SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'canon'
        """)
        rows = dict(cur.fetchall())
        assert set(rows) == {"audit_event", "outbox"}
        assert all(rows.values()), "RLS not active on a canon table"
        cur.execute("SELECT count(*) FROM pg_policies WHERE schemaname = 'canon'")
        assert cur.fetchone()[0] == 0, "deny-by-default violated live"
        # append-only guard fires
        cur.execute("""
            INSERT INTO canon.audit_event (actor_type, action, entity_type, payload)
            VALUES ('system', 'bootstrap_verify', 'foundation', '{}'::jsonb)
            RETURNING id
        """)
        eid = cur.fetchone()[0]
        with pytest.raises(Exception):
            cur.execute("DELETE FROM canon.audit_event WHERE id = %s", (eid,))
