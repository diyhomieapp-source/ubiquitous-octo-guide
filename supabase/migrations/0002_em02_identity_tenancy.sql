-- ============================================================================
-- EM-02 — Identity, Tenancy, Consent, Recovery, Membership, Authorization
-- Built ON the EM-03-MIN foundation (schema canon, uuid ids, audit/outbox,
-- deny-by-default RLS). Legacy Mongo auth in backend/server.py keeps serving,
-- untouched — legacy identities are referenced READ-ONLY via mapping columns.
-- Rollback: drop the six domain tables + canon.domain_audit() (foundation stays).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Shared domain audit/outbox trigger (writes to EM-03-MIN foundation tables)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION canon.domain_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ent_id  text;
  act     text;
BEGIN
  act    := lower(TG_OP);                       -- insert | update | delete
  ent_id := COALESCE((CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END)::text, '');
  INSERT INTO canon.audit_event (actor_type, actor_id, action, entity_type, entity_id, payload)
  VALUES ('service', current_user, act, TG_TABLE_NAME, ent_id, '{}'::jsonb);
  INSERT INTO canon.outbox (topic, aggregate_type, aggregate_id)
  VALUES (TG_TABLE_NAME || '.' || act, TG_TABLE_NAME, ent_id);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Identity — canonical person/account record (NO credentials here;
--    authentication remains on legacy Mongo until its own packet)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canon.identity (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                text        NOT NULL,
  email_verified_at    timestamptz,
  display_name         text,
  status               text        NOT NULL DEFAULT 'active',
  legacy_mongo_user_id text,                    -- read-only migration mapping (users.id)
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,

  CONSTRAINT identity_status_check CHECK (status IN ('active', 'suspended', 'deleted'))
);
COMMENT ON TABLE canon.identity IS
  'EM-02 canonical identity. Credentials/authentication stay on legacy Mongo; '
  'legacy_mongo_user_id is the read-only migration mapping.';
CREATE UNIQUE INDEX IF NOT EXISTS identity_email_uq
  ON canon.identity (lower(email)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS identity_legacy_uq
  ON canon.identity (legacy_mongo_user_id) WHERE legacy_mongo_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Tenancy — household boundary every domain object will hang off
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canon.tenant (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text        NOT NULL,
  kind                    text        NOT NULL DEFAULT 'household',
  created_by_identity_id  uuid        REFERENCES canon.identity (id),
  legacy_ref              text,                 -- read-only migration mapping (future property/household source)
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,

  CONSTRAINT tenant_kind_check CHECK (kind IN ('household', 'organization'))
);
COMMENT ON TABLE canon.tenant IS 'EM-02 tenancy boundary (household by default).';
CREATE UNIQUE INDEX IF NOT EXISTS tenant_legacy_uq
  ON canon.tenant (legacy_ref) WHERE legacy_ref IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Authorization — role catalog + permission grants (deny-by-default)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canon.role (
  key         text        PRIMARY KEY,
  description text        NOT NULL,
  is_system   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canon.role_permission (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key       text        NOT NULL REFERENCES canon.role (key) ON DELETE CASCADE,
  permission_key text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT role_permission_uq UNIQUE (role_key, permission_key)
);
COMMENT ON TABLE canon.role_permission IS
  'EM-02 authorization: permissions are explicit grants per role — anything not granted is denied.';

INSERT INTO canon.role (key, description) VALUES
  ('owner',  'Full control of the tenant, including membership and deletion'),
  ('admin',  'Manage tenant data and members, cannot delete the tenant'),
  ('editor', 'Create and modify tenant data'),
  ('viewer', 'Read-only access to tenant data')
ON CONFLICT (key) DO NOTHING;

INSERT INTO canon.role_permission (role_key, permission_key) VALUES
  ('owner',  'tenant.delete'), ('owner', 'tenant.manage'), ('owner', 'member.manage'),
  ('owner',  'data.write'),    ('owner', 'data.read'),
  ('admin',  'tenant.manage'), ('admin', 'member.manage'),
  ('admin',  'data.write'),    ('admin', 'data.read'),
  ('editor', 'data.write'),    ('editor', 'data.read'),
  ('viewer', 'data.read')
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Membership — identity ↔ tenant with role + lifecycle
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canon.membership (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL REFERENCES canon.tenant (id),
  identity_id             uuid        REFERENCES canon.identity (id),  -- NULL while invite is pending for a non-user
  invited_email           text,
  role_key                text        NOT NULL REFERENCES canon.role (key),
  status                  text        NOT NULL DEFAULT 'active',
  invited_by_identity_id  uuid        REFERENCES canon.identity (id),
  accepted_at             timestamptz,
  removed_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT membership_status_check CHECK (status IN ('invited', 'active', 'removed')),
  CONSTRAINT membership_subject_check CHECK (identity_id IS NOT NULL OR invited_email IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS membership_active_uq
  ON canon.membership (tenant_id, identity_id)
  WHERE identity_id IS NOT NULL AND status <> 'removed';
CREATE INDEX IF NOT EXISTS membership_identity_idx ON canon.membership (identity_id, status);

-- ---------------------------------------------------------------------------
-- 6. Consent — append-only record of every consent grant/withdrawal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canon.consent_record (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id  uuid        NOT NULL REFERENCES canon.identity (id),
  consent_type text        NOT NULL,
  version      text        NOT NULL DEFAULT '1',
  granted      boolean     NOT NULL,
  source       text        NOT NULL DEFAULT 'app',
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT consent_type_check
    CHECK (consent_type IN ('terms', 'privacy', 'marketing', 'data_processing', 'story_sharing'))
);
COMMENT ON TABLE canon.consent_record IS
  'EM-02 append-only consent ledger — current state is the latest row per (identity, type).';
CREATE INDEX IF NOT EXISTS consent_lookup_idx
  ON canon.consent_record (identity_id, consent_type, occurred_at DESC);

DROP TRIGGER IF EXISTS consent_record_append_only ON canon.consent_record;
CREATE TRIGGER consent_record_append_only
  BEFORE UPDATE OR DELETE ON canon.consent_record
  FOR EACH ROW EXECUTE FUNCTION canon.forbid_mutation();

-- ---------------------------------------------------------------------------
-- 7. Recovery — account-recovery channels (hashed values only, never secrets)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canon.recovery_method (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id  uuid        NOT NULL REFERENCES canon.identity (id),
  channel      text        NOT NULL,
  value_hash   text        NOT NULL,   -- sha256 of the channel value; plaintext never stored
  verified_at  timestamptz,
  status       text        NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT recovery_channel_check CHECK (channel IN ('email', 'phone')),
  CONSTRAINT recovery_status_check  CHECK (status IN ('active', 'revoked'))
);
CREATE INDEX IF NOT EXISTS recovery_identity_idx ON canon.recovery_method (identity_id, status);

-- ---------------------------------------------------------------------------
-- 8. Convention wiring: updated_at + domain audit/outbox on mutable tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['identity', 'tenant', 'role', 'role_permission', 'membership', 'recovery_method'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_set_updated_at ON canon.%I', t, t);
    IF t NOT IN ('role_permission') THEN
      EXECUTE format('CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON canon.%I
                      FOR EACH ROW EXECUTE FUNCTION canon.set_updated_at()', t, t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['identity', 'tenant', 'membership', 'recovery_method'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_domain_audit ON canon.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_domain_audit AFTER INSERT OR UPDATE OR DELETE ON canon.%I
                    FOR EACH ROW EXECUTE FUNCTION canon.domain_audit()', t, t);
  END LOOP;
END;
$$;

-- role has a PK 'key' not 'id' — domain_audit expects id; role/role_permission
-- are catalog tables mutated only by migrations, so they are audited via the
-- migration record itself, not row triggers.

-- ---------------------------------------------------------------------------
-- 9. Deny-by-default: RLS on every EM-02 table, zero policies
-- ---------------------------------------------------------------------------
ALTER TABLE canon.identity        ENABLE ROW LEVEL SECURITY;
ALTER TABLE canon.tenant          ENABLE ROW LEVEL SECURITY;
ALTER TABLE canon.role            ENABLE ROW LEVEL SECURITY;
ALTER TABLE canon.role_permission ENABLE ROW LEVEL SECURITY;
ALTER TABLE canon.membership      ENABLE ROW LEVEL SECURITY;
ALTER TABLE canon.consent_record  ENABLE ROW LEVEL SECURITY;
ALTER TABLE canon.recovery_method ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA canon FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA canon FROM authenticated;
  END IF;
END;
$$;
