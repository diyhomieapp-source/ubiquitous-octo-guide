"""
EM-02 — Identity/Tenancy/Consent/Recovery/Membership/Authorization contract suite.

Static checks validate supabase/migrations/0002_em02_identity_tenancy.sql
(no network needed). Live checks run against the non-production Supabase
project via the management API when SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF
are set (loaded from backend/.env, git-ignored); otherwise they skip.

This suite touches no legacy engines and performs no Mongo writes.
"""
import os
import re

import pytest
import requests
from dotenv import load_dotenv

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MIGRATION = os.path.join(REPO_ROOT, "supabase", "migrations", "0002_em02_identity_tenancy.sql")
load_dotenv(os.path.join(REPO_ROOT, "backend", ".env"))

EM02_TABLES = {"identity", "tenant", "role", "role_permission", "membership",
               "consent_record", "recovery_method"}


@pytest.fixture(scope="module")
def sql() -> str:
    with open(MIGRATION, "r", encoding="utf-8") as f:
        return f.read()


# ---------------------------------------------------------------- static

def test_all_domain_tables_defined(sql):
    tables = set(re.findall(r"CREATE TABLE IF NOT EXISTS canon\.(\w+)", sql))
    assert tables == EM02_TABLES


def test_identity_contract(sql):
    m = re.search(r"CREATE TABLE IF NOT EXISTS canon\.identity\s*\((.*?)\);", sql, re.S)
    body = m.group(1)
    for col in ("id", "email", "status", "legacy_mongo_user_id", "created_at", "updated_at", "deleted_at"):
        assert re.search(rf"\b{col}\s", body), f"identity.{col} missing"
    assert "hashed_password" not in sql and "password" not in sql.lower(), \
        "credentials must NOT live in the canonical identity store (auth stays legacy)"
    assert re.search(r"identity_legacy_uq", sql), "legacy mapping uniqueness missing"


def test_membership_contract(sql):
    m = re.search(r"CREATE TABLE IF NOT EXISTS canon\.membership\s*\((.*?)\);", sql, re.S)
    body = m.group(1)
    assert re.search(r"role_key\s+text\s+NOT NULL REFERENCES canon\.role", body)
    for s in ("invited", "active", "removed"):
        assert f"'{s}'" in body
    assert "membership_active_uq" in sql, "one active membership per (tenant, identity) required"


def test_consent_append_only(sql):
    assert re.search(r"CREATE TRIGGER consent_record_append_only\s+BEFORE UPDATE OR DELETE ON canon\.consent_record", sql)


def test_recovery_never_stores_plaintext(sql):
    m = re.search(r"CREATE TABLE IF NOT EXISTS canon\.recovery_method\s*\((.*?)\);", sql, re.S)
    body = m.group(1)
    assert "value_hash" in body and not re.search(r"\bvalue\s+text", body)


def test_authorization_seeded_roles(sql):
    for role in ("owner", "admin", "editor", "viewer"):
        assert f"('{role}'," in sql or f"('{role}'" in sql, f"system role {role} not seeded"
    assert "role_permission_uq" in sql


def test_rls_enabled_on_every_table(sql):
    for t in EM02_TABLES:
        assert re.search(rf"ALTER TABLE canon\.{t}\s+ENABLE ROW LEVEL SECURITY", sql), f"RLS missing on {t}"


def test_deny_by_default_zero_policies(sql):
    assert "CREATE POLICY" not in re.sub(r"--[^\n]*", "", sql).upper()


def test_domain_audit_wired(sql):
    assert "canon.domain_audit" in sql
    assert "INSERT INTO canon.audit_event" in sql and "INSERT INTO canon.outbox" in sql


def test_no_legacy_coupling():
    backend = os.path.join(REPO_ROOT, "backend")
    for fn in os.listdir(backend):
        if fn.endswith(".py"):
            with open(os.path.join(backend, fn), encoding="utf-8", errors="ignore") as f:
                assert "0002_em02" not in f.read(), f"legacy module {fn} references EM-02 migration"


# ---------------------------------------------------------------- live

def _mgmt():
    tok, ref = os.environ.get("SUPABASE_ACCESS_TOKEN"), os.environ.get("SUPABASE_PROJECT_REF")
    if not tok or not ref:
        pytest.skip("SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set — live checks skipped")
    def q(query):
        r = requests.post(f"https://api.supabase.com/v1/projects/{ref}/database/query",
                          headers={"Authorization": f"Bearer {tok}"},
                          json={"query": query}, timeout=60)
        return r
    return q


class TestLive:
    def test_tables_and_rls_live(self):
        q = _mgmt()
        r = q("SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='canon'")
        assert r.ok, r.text
        rows = {x["tablename"]: x["rowsecurity"] for x in r.json()}
        assert EM02_TABLES | {"audit_event", "outbox"} <= set(rows)
        assert all(rows.values()), "RLS disabled on a canon table"

    def test_zero_policies_live(self):
        q = _mgmt()
        r = q("SELECT count(*) n FROM pg_policies WHERE schemaname='canon'")
        assert r.ok and r.json()[0]["n"] == 0

    def test_roles_seeded_live(self):
        q = _mgmt()
        r = q("SELECT key FROM canon.role ORDER BY key")
        assert r.ok and [x["key"] for x in r.json()] == ["admin", "editor", "owner", "viewer"]

    def test_identity_mutation_emits_audit_and_outbox(self):
        q = _mgmt()
        r = q("""INSERT INTO canon.identity (email, display_name)
                 VALUES ('em02_suite_' || substr(gen_random_uuid()::text, 1, 8) || '@diyhomie.test', 'Suite Check')
                 RETURNING id""")
        assert r.ok, r.text
        iid = r.json()[0]["id"]
        r2 = q(f"""SELECT (SELECT count(*) FROM canon.audit_event WHERE entity_id = '{iid}') AS audits,
                          (SELECT count(*) FROM canon.outbox WHERE aggregate_id = '{iid}') AS outbox""")
        assert r2.ok, r2.text
        row = r2.json()[0]
        assert row["audits"] >= 1 and row["outbox"] >= 1

    def test_consent_append_only_live(self):
        q = _mgmt()
        r = q("UPDATE canon.consent_record SET granted = NOT granted")
        assert r.status_code == 400 and "forbidden" in r.text.lower()

    def test_legacy_mapping_populated_and_unique(self):
        q = _mgmt()
        r = q("""
            SELECT count(*) AS mapped,
                   count(DISTINCT legacy_mongo_user_id) AS distinct_ids
            FROM canon.identity WHERE legacy_mongo_user_id IS NOT NULL""")
        assert r.ok, r.text
        row = r.json()[0]
        assert row["mapped"] >= 1, "legacy identity mapping not run"
        assert row["mapped"] == row["distinct_ids"], "duplicate legacy mappings"

    def test_every_mapped_identity_has_owner_membership(self):
        q = _mgmt()
        r = q("""
            SELECT count(*) AS orphans FROM canon.identity i
            WHERE i.legacy_mongo_user_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM canon.membership m
              WHERE m.identity_id = i.id AND m.role_key = 'owner' AND m.status = 'active')""")
        assert r.ok and r.json()[0]["orphans"] == 0
