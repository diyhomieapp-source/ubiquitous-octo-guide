-- ============================================================================
-- EM-03-MIN — Canonical Foundation Bootstrap (DIYHomie)
-- Non-production Supabase shared foundation. ZERO domain tables.
-- Contents: schema conventions, shared audit_event table, durable outbox
-- table, deny-by-default access/RLS skeleton.
-- Rollback: DROP SCHEMA canon CASCADE; (zero coupling to running product)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions (gen_random_uuid; built into Supabase, guarded for local PG)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Canonical schema (isolated from `public`)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS canon;

COMMENT ON SCHEMA canon IS
  'DIYHomie canonical application data (EM-03-MIN bootstrap). '
  'Conventions: uuid v4 primary keys named id; timestamptz created_at/updated_at; '
  'soft delete via deleted_at timestamptz NULL; snake_case names; '
  'RLS enabled deny-by-default on every table.';

-- ---------------------------------------------------------------------------
-- 2. Shared convention helpers
-- ---------------------------------------------------------------------------

-- updated_at maintenance trigger (attach to every mutable canonical table)
CREATE OR REPLACE FUNCTION canon.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- append-only guard (attach to immutable tables such as audit_event)
CREATE OR REPLACE FUNCTION canon.forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% on %.% is forbidden (append-only table)',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Shared audit table (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canon.audit_event (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_type   text        NOT NULL,             -- 'user' | 'system' | 'service' | 'migration'
  actor_id     text,                             -- stable actor identifier (nullable for system)
  action       text        NOT NULL,             -- verb, e.g. 'create', 'update', 'authorize'
  entity_type  text        NOT NULL,             -- canonical entity family name
  entity_id    text,                             -- stable entity identifier
  payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_event_actor_type_check
    CHECK (actor_type IN ('user', 'system', 'service', 'migration'))
);

COMMENT ON TABLE canon.audit_event IS
  'Shared append-only audit log for all canonical domains (EM-03-MIN). '
  'INSERT-only: UPDATE/DELETE are rejected by trigger.';

CREATE INDEX IF NOT EXISTS audit_event_entity_idx
  ON canon.audit_event (entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_event_actor_idx
  ON canon.audit_event (actor_type, actor_id, occurred_at DESC);

DROP TRIGGER IF EXISTS audit_event_append_only ON canon.audit_event;
CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON canon.audit_event
  FOR EACH ROW EXECUTE FUNCTION canon.forbid_mutation();

-- ---------------------------------------------------------------------------
-- 4. Durable outbox table (dispatch contract defined; NO consumers yet)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canon.outbox (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          text        NOT NULL,           -- routing key, e.g. 'identity.user.created'
  aggregate_type text        NOT NULL,           -- canonical entity family of the source
  aggregate_id   text        NOT NULL,           -- stable id of the source entity
  payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status         text        NOT NULL DEFAULT 'pending',
  attempts       integer     NOT NULL DEFAULT 0,
  available_at   timestamptz NOT NULL DEFAULT now(),  -- earliest dispatch time (backoff)
  dispatched_at  timestamptz,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT outbox_status_check
    CHECK (status IN ('pending', 'dispatching', 'dispatched', 'failed'))
);

COMMENT ON TABLE canon.outbox IS
  'Durable transactional outbox (EM-03-MIN). Dispatch contract: a dispatcher '
  'claims rows WHERE status = ''pending'' AND available_at <= now() ORDER BY '
  'created_at FOR UPDATE SKIP LOCKED, sets status = ''dispatching'', publishes, '
  'then marks ''dispatched'' (dispatched_at = now()) or increments attempts, '
  'records last_error, sets backoff via available_at and returns to ''pending'' '
  '(or ''failed'' after max attempts). No consumers exist in this packet.';

CREATE INDEX IF NOT EXISTS outbox_dispatch_idx
  ON canon.outbox (status, available_at, created_at)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS outbox_set_updated_at ON canon.outbox;
CREATE TRIGGER outbox_set_updated_at
  BEFORE UPDATE ON canon.outbox
  FOR EACH ROW EXECUTE FUNCTION canon.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Base access-policy skeleton: DENY BY DEFAULT
--    RLS enabled with zero policies = all access denied for anon/authenticated.
--    service_role (backend) bypasses RLS by design in Supabase.
-- ---------------------------------------------------------------------------
ALTER TABLE canon.audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE canon.outbox      ENABLE ROW LEVEL SECURITY;

-- Belt-and-braces: strip schema/table privileges from client-facing roles.
-- Guarded so the file also applies cleanly on plain PostgreSQL (local verify).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA canon FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA canon FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA canon FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA canon FROM authenticated;
  END IF;
END;
$$;

-- Future canonical tables (EM-02+) MUST: live in schema canon, use uuid id,
-- carry created_at/updated_at (+ deleted_at when soft-deletable), enable RLS
-- immediately, and start from deny-by-default with explicit policies added
-- per-packet under owner authorization.
