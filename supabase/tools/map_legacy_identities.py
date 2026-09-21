"""
EM-02 — Read-only legacy identity mapping importer.

Reads users from legacy MongoDB (READ-ONLY — find() only, no writes) and
idempotently maps each into the canonical Supabase foundation:

  users.id/email  → canon.identity  (legacy_mongo_user_id mapping)
  one per user    → canon.tenant    (personal household, legacy_ref = 'user:<id>')
  owner link      → canon.membership (role 'owner', status 'active')

Idempotent: safe to re-run any number of times (ON CONFLICT / NOT EXISTS).
Credentials come from backend/.env (SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF,
MONGO_URL) — never from tracked files.

Run:  python supabase/tools/map_legacy_identities.py [--dry-run]
"""
import asyncio
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", "backend", ".env"))

TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
REF = os.environ["SUPABASE_PROJECT_REF"]
QUERY_URL = f"https://api.supabase.com/v1/projects/{REF}/database/query"
DRY = "--dry-run" in sys.argv


def esc(v) -> str:
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def run_sql(sql: str):
    r = requests.post(QUERY_URL, headers={"Authorization": f"Bearer {TOKEN}"},
                      json={"query": sql}, timeout=120)
    if not r.ok:
        raise RuntimeError(f"SQL failed ({r.status_code}): {r.text[:300]}")
    return r.json()


async def main():
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "test_database")]
    users = await db.users.find(
        {}, {"_id": 0, "id": 1, "email": 1, "name": 1, "account_state": 1}
    ).to_list(100000)
    users = [u for u in users if u.get("id") and u.get("email")
             and u.get("account_state") != "deleted"]
    print(f"legacy users to map: {len(users)}{' (dry run)' if DRY else ''}")
    if DRY:
        return

    BATCH = 50
    for i in range(0, len(users), BATCH):
        chunk = users[i:i + BATCH]
        idents = ",".join(
            f"({esc(u['email'])}, {esc(u.get('name'))}, {esc(u['id'])})" for u in chunk)
        run_sql(f"""
            INSERT INTO canon.identity (email, display_name, legacy_mongo_user_id)
            VALUES {idents}
            ON CONFLICT (legacy_mongo_user_id) WHERE legacy_mongo_user_id IS NOT NULL
            DO NOTHING""")
        tenants = ",".join(
            f"({esc(u.get('name') or u['email'].split('@')[0])}, {esc('user:' + u['id'])})"
            for u in chunk)
        run_sql(f"""
            INSERT INTO canon.tenant (name, created_by_identity_id, legacy_ref)
            SELECT v.name || ' Household', i.id, v.legacy_ref
            FROM (VALUES {tenants}) AS v(name, legacy_ref)
            JOIN canon.identity i ON i.legacy_mongo_user_id = replace(v.legacy_ref, 'user:', '')
            ON CONFLICT (legacy_ref) WHERE legacy_ref IS NOT NULL
            DO NOTHING""")
        run_sql("""
            INSERT INTO canon.membership (tenant_id, identity_id, role_key, status, accepted_at)
            SELECT t.id, i.id, 'owner', 'active', now()
            FROM canon.tenant t
            JOIN canon.identity i ON t.legacy_ref = 'user:' || i.legacy_mongo_user_id
            WHERE NOT EXISTS (
              SELECT 1 FROM canon.membership m
              WHERE m.tenant_id = t.id AND m.identity_id = i.id AND m.status <> 'removed')""")
        print(f"  mapped {min(i + BATCH, len(users))}/{len(users)}")

    counts = run_sql("""
        SELECT (SELECT count(*) FROM canon.identity WHERE legacy_mongo_user_id IS NOT NULL) AS identities,
               (SELECT count(*) FROM canon.tenant WHERE legacy_ref LIKE 'user:%') AS tenants,
               (SELECT count(*) FROM canon.membership WHERE role_key = 'owner') AS owner_memberships""")
    print("canonical totals:", counts[0])


if __name__ == "__main__":
    asyncio.run(main())
