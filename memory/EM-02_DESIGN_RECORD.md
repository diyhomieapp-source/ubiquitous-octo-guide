# EM-02 — Identity, Tenancy, Consent, Recovery, Membership, Authorization (Design Record)

- **Packet:** EM-02 (second packet of the EM-01.2 corrected sequence), built
  **on** the accepted EM-03-MIN foundation.
- **Authorization:** Owner explicitly authorized ("Authorize EM-02: Let me
  build identity, tenancy, consent and membership on the new foundation") and
  supplied a Supabase personal access token for the non-production project.
- **Environment:** Supabase non-production project `diyhomie Project`
  (ref `axwzhvtzxwccwakqyjwt`, us-west-2). It was PAUSED and was restored via
  the management API before applying. All access uses env values in the
  git-ignored `backend/.env` (SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF,
  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).

## Delivered artifacts

| Artifact | Path |
|---|---|
| EM-03-MIN live apply + verification | migration 0001 applied via management API (RLS on, 0 policies, append-only + updated_at triggers verified live) |
| EM-02 migration | `supabase/migrations/0002_em02_identity_tenancy.sql` (applied live) |
| Legacy mapping importer (read-only Mongo) | `supabase/tools/map_legacy_identities.py` |
| Contract suite | `backend/tests/test_em02_identity_foundation.py` (17 green: 10 static + 7 live) |
| This design record | `memory/EM-02_DESIGN_RECORD.md` |

## Domain model (all in schema `canon`, EM-03-MIN conventions)

- **identity** — canonical person record. **Contains NO credentials**;
  authentication remains served by legacy Mongo (`backend/server.py`)
  untouched. `legacy_mongo_user_id` = unique read-only migration mapping.
- **tenant** — household boundary (`kind` household|organization),
  `legacy_ref` unique mapping (`user:<mongo id>` for personal households).
- **role / role_permission** — authorization catalog, explicit grants only
  (deny-by-default). Seeded system roles: owner, admin, editor, viewer with
  12 permission grants.
- **membership** — identity↔tenant with `role_key` FK, lifecycle
  invited→active→removed, one active membership per (tenant, identity)
  (partial unique index), supports email-only pending invites.
- **consent_record** — append-only consent ledger (terms/privacy/marketing/
  data_processing/story_sharing); current state = latest row; UPDATE/DELETE
  rejected by trigger.
- **recovery_method** — recovery channels storing **hashes only**
  (`value_hash`), never plaintext.

## Foundation integration

- `canon.domain_audit()` trigger on identity/tenant/membership/recovery_method
  writes a `canon.audit_event` row **and** a `canon.outbox` row
  (`<table>.<op>` topic) on every mutation — verified live.
- `set_updated_at` triggers on all mutable tables; RLS enabled with **zero
  policies** on every table; anon/authenticated privileges revoked.

## Legacy mapping (read-only)

`supabase/tools/map_legacy_identities.py` — Mongo `find()` only (no writes):
451 legacy users → 451 mapped identities + 451 personal-household tenants +
owner memberships. Idempotent (verified by immediate re-run: totals
unchanged). Deleted accounts (`account_state == 'deleted'`) excluded.

## Explicit exclusions

- No changes to legacy auth (login/register/JWT/password flows untouched).
- No Project/WorkItem/Safety or other domain families (EM-03 remainder/EM-04+).
- No RLS policies granted (policy grants arrive with the serving layer, per
  packet). No production provisioning. No Mongo writes.

## Findings status (unchanged)

**B0, FIN-4A, W0-4B, AFF-R0 remain OPEN** (homes: EM-05, post-EM-02
entitlement design, EM-04, later packets).

## Verification evidence

- `backend/tests/test_em02_identity_foundation.py` — 17/17 green (live checks
  hit the non-production project through the management API).
- `backend/tests/test_em03_min_foundation.py` — 11 green (DB-URL live test
  skipped by design; foundation re-verified live by the EM-02 suite).
- `bash scripts/scan_secrets.sh` — pass. Legacy suite untouched (fully green
  1583/0 at commit 5d0785e; zero legacy files modified since).

## Rollback

Foundation stays; EM-02 alone: drop the six domain tables +
`canon.domain_audit()`; revert the single EM-02 commit.
