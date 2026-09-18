# EM-03-MIN — Canonical Foundation Bootstrap (Design Record)

- **Packet:** EM-03-MIN (first implementation packet of the EM-01.2 corrected
  sequence: EM-03-MIN → EM-02 → EM-03 remainder → EM-04 → EM-05).
- **Authorization:** Owner authorized EM-03-MIN explicitly ("Yes — proceed
  exactly as bounded in EM-01.2 §3"), with GitHub checkpoint via "Save to
  GitHub" and Supabase non-production credentials to be supplied by owner
  (env values never tracked).
- **Objective:** stand up the smallest shared persistence foundation so EM-02
  has somewhere canonical to persist — nothing else.

## Delivered artifacts

| Artifact | Path |
|---|---|
| Bootstrap migration | `supabase/migrations/0001_foundation_bootstrap.sql` |
| Conventions + env-name record | `supabase/README.md` |
| Isolated contract suite | `backend/tests/test_em03_min_foundation.py` |
| This design record | `memory/EM-03-MIN_DESIGN_RECORD.md` |

## Design decisions

1. **Schema `canon`, not `public`** — hard isolation from anything Supabase
   auto-provisions; client roles (`anon`, `authenticated`) hold zero
   privileges on it.
2. **Stable ID strategy** — `uuid` v4 (`gen_random_uuid()`), column name `id`,
   generated at the database. Legacy Mongo string ids will be mapped via
   explicit migration-source columns in later packets (EM-03 remainder), never
   reused as canonical PKs.
3. **Timestamps/soft-delete conventions** — `created_at` / `updated_at`
   (`timestamptz`, trigger-maintained) on every table; `deleted_at NULL`
   soft-delete marker on soft-deletable tables (neither bootstrap table is
   soft-deletable: audit is append-only, outbox rows are terminal-status).
4. **Shared `canon.audit_event`** — one append-only audit table for all
   canonical domains; UPDATE/DELETE rejected by trigger
   (`canon.forbid_mutation`). Indexed by entity and actor.
5. **Durable `canon.outbox`** — transactional outbox with dispatch contract
   (claim `pending` rows past `available_at` with `FOR UPDATE SKIP LOCKED`,
   mark `dispatching` → `dispatched`/backoff-to-`pending`/`failed`). Contract
   defined only; **no consumers/dispatchers exist** in this packet.
6. **Deny-by-default access skeleton** — RLS enabled with zero policies on
   both tables; privileges revoked from `anon`/`authenticated`; only the
   backend service role can operate on `canon`. Every future canonical table
   must enable RLS at creation and add policies per-packet.

## Explicit exclusions (verified honored)

- No domain tables (no identity/tenancy/consent/recovery/membership — EM-02;
  no Project/WorkItem/Safety/Evidence/O&V/Measurement/Procurement/Readiness/
  Memory/provider/billing/entitlement objects).
- No edits to `backend/server.py` or any of the 84 `backend/*_engine.py`
  modules; no Mongo writes; no data migration; no Firebase work; no
  production provisioning.

## Verification evidence

- `backend/tests/test_em03_min_foundation.py` — static contract validation
  (tables/columns/RLS/append-only/deny-by-default/zero-domain-tables/no
  secret values), plus optional live apply gated on `SUPABASE_DB_URL`.
- `bash scripts/scan_secrets.sh` — pass.
- Full legacy suite in `backend/tests/` untouched and green (zero legacy
  impact proof).
- Single revertible commit (hash recorded at completion).

## Findings status (unchanged by this packet)

**B0, FIN-4A, W0-4B, AFF-R0 all remain OPEN.** Their remediation homes are
EM-05, post-EM-02 entitlement design, EM-04, and later packets respectively.

## Rollback

Delete the commit (or `supabase/` directory + this record + the isolated test
file). In a provisioned environment: `DROP SCHEMA canon CASCADE;`.
