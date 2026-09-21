# DIYHomie — Canonical Supabase Foundation (EM-03-MIN)

Isolated canonical-schema directory created by **EM-03-MIN — Canonical
Foundation Bootstrap**. This directory has **zero coupling** to the running
product (legacy FastAPI + MongoDB): nothing in `backend/` or `frontend/`
imports from or depends on it.

## Contents

| Path | Purpose |
|---|---|
| `migrations/0001_foundation_bootstrap.sql` | Bootstrap: `canon` schema, conventions, `audit_event`, `outbox`, deny-by-default RLS skeleton |
| `migrations/0002_em02_identity_tenancy.sql` | EM-02: identity, tenant, role/role_permission, membership, consent_record (append-only), recovery_method + domain audit/outbox triggers |
| `tools/map_legacy_identities.py` | Read-only legacy-Mongo → canonical identity/tenant/membership mapping (idempotent) |

## Schema conventions (binding for all future canonical tables)

- Schema: all canonical tables live in schema **`canon`** (never `public`).
- Naming: `snake_case` tables/columns, singular table names.
- Stable IDs: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`.
- Timestamps: `created_at timestamptz NOT NULL DEFAULT now()`,
  `updated_at timestamptz NOT NULL DEFAULT now()` (maintained by
  `canon.set_updated_at()` trigger).
- Soft delete: `deleted_at timestamptz NULL` on soft-deletable tables.
- Audit: domain mutations record rows in the shared `canon.audit_event`
  (append-only, enforced by `canon.forbid_mutation()` trigger).
- Events: cross-boundary side effects go through the durable `canon.outbox`
  (dispatch contract documented on the table; no consumers exist yet).
- Access: **deny-by-default** — RLS enabled on every table at creation time
  with zero policies; explicit policies are added per-packet under owner
  authorization. `anon`/`authenticated` have no privileges on schema `canon`;
  only the backend (service role) may touch canonical data.

## Environment variable names (values are NEVER tracked)

Values live only in git-ignored env files (`backend/.env` /
`backend/.env.test`).

| Env name | Purpose |
|---|---|
| `SUPABASE_URL` | Non-production project URL |
| `SUPABASE_ANON_KEY` | Public anon key (client-facing; no canon access) |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend service-role key (bypasses RLS) |
| `SUPABASE_DB_URL` | Direct Postgres connection string (migrations/verification only) |
| `SUPABASE_ACCESS_TOKEN` | Management-API personal access token (migrations/verification) |
| `SUPABASE_PROJECT_REF` | Non-production project ref |

## Applying (non-production only)

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_foundation_bootstrap.sql
```

Idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE` / guarded `DO` blocks).

## Rollback

```sql
DROP SCHEMA canon CASCADE;
```

## Verification

- Static contract suite: `backend/tests/test_em03_min_foundation.py`
  (runs without any database; performs a live apply + contract check only
  when `SUPABASE_DB_URL` is set).
- Secret scan: `bash scripts/scan_secrets.sh`.
