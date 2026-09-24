-- Empty-database baseline. Only World Model domain data and its commit/audit bridge live here.
BEGIN;
CREATE SCHEMA wm;
CREATE TABLE wm.schema_version (
    version integer PRIMARY KEY CHECK (version > 0),
    installed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO wm.schema_version(version) VALUES (1);
CREATE TABLE wm.entity (
    entity_id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('PERSON','ORGANIZATION','PROJECT','DEVICE','SERVICE','RESOURCE','GOAL')),
    display_name text NOT NULL CHECK (length(display_name)>0),
    external_key text UNIQUE,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
    retired_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wm.source (
    source_id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('MASTER','OBSERVATION','TASK_REPORT','MODEL_INFERENCE')),
    source_key text NOT NULL UNIQUE,
    description text NOT NULL,
    retired_at timestamptz
);
CREATE TABLE wm.predicate (
    predicate_key text PRIMARY KEY CHECK (predicate_key ~ '^[a-z][a-z0-9_.]+$'),
    description text NOT NULL,
    subject_kinds text[] NOT NULL CHECK (cardinality(subject_kinds)>0),
    value_type text NOT NULL CHECK (value_type IN ('STRING','NUMBER','BOOLEAN','OBJECT','ARRAY','ENTITY')),
    cardinality text NOT NULL CHECK (cardinality IN ('SINGLE','MULTI')),
    unit text,
    value_schema jsonb NOT NULL CHECK (jsonb_typeof(value_schema)='object'),
    definition_revision bigint NOT NULL DEFAULT 1 CHECK (definition_revision>0)
);
CREATE TABLE wm.fact_slot (
    slot_id uuid PRIMARY KEY,
    subject_id uuid NOT NULL REFERENCES wm.entity(entity_id),
    predicate_key text NOT NULL REFERENCES wm.predicate(predicate_key),
    scope_key text NOT NULL DEFAULT '',
    revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0),
    UNIQUE(subject_id,predicate_key,scope_key)
);
CREATE TABLE wm.change_receipt (
    change_id uuid PRIMARY KEY,
    request_id uuid NOT NULL UNIQUE,
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    outcome text NOT NULL CHECK (outcome IN ('APPLIED','CONFLICT','REJECTED')),
    result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
    committed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wm.assertion (
    assertion_id uuid PRIMARY KEY,
    slot_id uuid NOT NULL REFERENCES wm.fact_slot(slot_id),
    slot_revision bigint NOT NULL CHECK (slot_revision>0),
    source_id uuid NOT NULL REFERENCES wm.source(source_id),
    change_id uuid NOT NULL REFERENCES wm.change_receipt(change_id) DEFERRABLE INITIALLY DEFERRED,
    value jsonb,
    object_entity_id uuid REFERENCES wm.entity(entity_id),
    epistemic text NOT NULL CHECK (epistemic IN ('OBSERVED','REPORTED','INFERRED','UNRESOLVED')),
    observed_at timestamptz,
    received_at timestamptz NOT NULL,
    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    fresh_until timestamptz,
    scope_description text NOT NULL CHECK (length(scope_description)>0),
    replaces_assertion_id uuid,
    UNIQUE(assertion_id,slot_id),
    UNIQUE(slot_id,slot_revision),
    FOREIGN KEY(replaces_assertion_id,slot_id) REFERENCES wm.assertion(assertion_id,slot_id),
    CHECK ((value IS NOT NULL AND value <> 'null'::jsonb AND object_entity_id IS NULL)
        OR (value IS NULL AND object_entity_id IS NOT NULL)),
    CHECK (valid_to IS NULL OR valid_to>valid_from),
    CHECK (fresh_until IS NULL OR fresh_until>=valid_from),
    CHECK (epistemic<>'OBSERVED' OR observed_at IS NOT NULL),
    CHECK (replaces_assertion_id IS NULL OR replaces_assertion_id<>assertion_id)
);
CREATE TABLE wm.assertion_state (
    assertion_id uuid PRIMARY KEY,
    slot_id uuid NOT NULL,
    status text NOT NULL CHECK (status IN ('ACTIVE','SUPPORTING','CONTESTED','RETRACTED','SUPERSEDED')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
    changed_by uuid NOT NULL REFERENCES wm.change_receipt(change_id) DEFERRABLE INITIALLY DEFERRED,
    changed_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(assertion_id,slot_id) REFERENCES wm.assertion(assertion_id,slot_id)
);
CREATE UNIQUE INDEX one_active_per_slot ON wm.assertion_state(slot_id) WHERE status='ACTIVE';
CREATE TABLE wm.evidence (
    evidence_id uuid PRIMARY KEY,
    log_event_id uuid NOT NULL,
    object_path text NOT NULL CHECK (object_path !~ '(^/|(^|/)\.\.(/|$))'),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    media_type text NOT NULL,
    byte_count bigint NOT NULL CHECK (byte_count>=0),
    UNIQUE(log_event_id,sha256)
);
CREATE TABLE wm.assertion_evidence (
    assertion_id uuid NOT NULL REFERENCES wm.assertion(assertion_id),
    evidence_id uuid NOT NULL REFERENCES wm.evidence(evidence_id),
    PRIMARY KEY(assertion_id,evidence_id)
);
CREATE TABLE wm.conflict (
    conflict_id uuid PRIMARY KEY,
    slot_id uuid NOT NULL REFERENCES wm.fact_slot(slot_id),
    status text NOT NULL CHECK (status IN ('OPEN','RESOLVED')),
    opened_by uuid NOT NULL REFERENCES wm.change_receipt(change_id) DEFERRABLE INITIALLY DEFERRED,
    resolved_by uuid REFERENCES wm.change_receipt(change_id) DEFERRABLE INITIALLY DEFERRED,
    resolution_note text,
    UNIQUE(conflict_id,slot_id),
    CHECK ((status='OPEN' AND resolved_by IS NULL AND resolution_note IS NULL)
       OR (status='RESOLVED' AND resolved_by IS NOT NULL AND resolution_note IS NOT NULL AND length(resolution_note)>0))
);
CREATE UNIQUE INDEX one_open_conflict_per_slot ON wm.conflict(slot_id) WHERE status='OPEN';
CREATE TABLE wm.conflict_member (
    conflict_id uuid NOT NULL,
    slot_id uuid NOT NULL,
    assertion_id uuid NOT NULL,
    PRIMARY KEY(conflict_id,assertion_id),
    FOREIGN KEY(conflict_id,slot_id) REFERENCES wm.conflict(conflict_id,slot_id),
    FOREIGN KEY(assertion_id,slot_id) REFERENCES wm.assertion(assertion_id,slot_id)
);
CREATE TABLE wm.audit_outbox (
    event_id uuid PRIMARY KEY,
    change_id uuid NOT NULL UNIQUE REFERENCES wm.change_receipt(change_id),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    exported_journal_txn uuid,
    exported_at timestamptz,
    CHECK ((exported_journal_txn IS NULL)=(exported_at IS NULL))
);
CREATE INDEX assertions_by_source_time ON wm.assertion(source_id,observed_at DESC);
CREATE INDEX assertions_by_slot_time ON wm.assertion(slot_id,valid_from DESC);
CREATE INDEX entity_by_kind ON wm.entity(kind,display_name);
CREATE INDEX evidence_by_log ON wm.evidence(log_event_id);
CREATE INDEX pending_audit_exports ON wm.audit_outbox(created_at) WHERE exported_at IS NULL;

CREATE FUNCTION wm.validate_slot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p wm.predicate; k text;
BEGIN
 SELECT * INTO STRICT p FROM wm.predicate WHERE predicate_key=NEW.predicate_key;
 SELECT kind INTO STRICT k FROM wm.entity WHERE entity_id=NEW.subject_id;
 IF NOT (k=ANY(p.subject_kinds)) THEN RAISE EXCEPTION 'subject kind incompatible'; END IF;
 IF (p.cardinality='SINGLE' AND NEW.scope_key<>'') OR (p.cardinality='MULTI' AND NEW.scope_key='') THEN
   RAISE EXCEPTION 'scope_key incompatible with cardinality';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_slot BEFORE INSERT OR UPDATE ON wm.fact_slot FOR EACH ROW EXECUTE FUNCTION wm.validate_slot();
CREATE FUNCTION wm.validate_assertion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text; slotrev bigint;
BEGIN
 SELECT p.value_type,s.revision INTO STRICT t,slotrev FROM wm.fact_slot s JOIN wm.predicate p USING(predicate_key) WHERE s.slot_id=NEW.slot_id;
 IF slotrev<>NEW.slot_revision THEN RAISE EXCEPTION 'slot revision mismatch'; END IF;
 IF (t='ENTITY' AND NEW.object_entity_id IS NULL) OR
    (t<>'ENTITY' AND (NEW.value IS NULL OR jsonb_typeof(NEW.value)<>lower(t))) THEN
   RAISE EXCEPTION 'predicate value type mismatch';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_assertion BEFORE INSERT ON wm.assertion FOR EACH ROW EXECUTE FUNCTION wm.validate_assertion();
CREATE FUNCTION wm.immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable World Model record'; END $$;
CREATE TRIGGER immutable_assertion BEFORE UPDATE OR DELETE ON wm.assertion FOR EACH ROW EXECUTE FUNCTION wm.immutable_record();
CREATE TRIGGER immutable_receipt BEFORE UPDATE OR DELETE ON wm.change_receipt FOR EACH ROW EXECUTE FUNCTION wm.immutable_record();
CREATE TRIGGER immutable_evidence BEFORE UPDATE OR DELETE ON wm.evidence FOR EACH ROW EXECUTE FUNCTION wm.immutable_record();
CREATE TRIGGER immutable_evidence_link BEFORE UPDATE OR DELETE ON wm.assertion_evidence FOR EACH ROW EXECUTE FUNCTION wm.immutable_record();
CREATE FUNCTION wm.source_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_id<>OLD.source_id OR NEW.kind<>OLD.kind OR NEW.source_key<>OLD.source_key THEN
  RAISE EXCEPTION 'source identity is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_source_identity BEFORE UPDATE ON wm.source FOR EACH ROW EXECUTE FUNCTION wm.source_identity_immutable();
CREATE FUNCTION wm.require_assertion_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE aid uuid;
BEGIN
 aid := CASE WHEN TG_OP='DELETE' THEN OLD.assertion_id ELSE NEW.assertion_id END;
 IF EXISTS(SELECT 1 FROM wm.assertion WHERE assertion_id=aid) AND NOT EXISTS(SELECT 1 FROM wm.assertion_evidence WHERE assertion_id=aid) THEN
   RAISE EXCEPTION 'assertion requires evidence';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER assertion_needs_evidence AFTER INSERT ON wm.assertion DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wm.require_assertion_evidence();
CREATE CONSTRAINT TRIGGER evidence_cannot_disappear AFTER DELETE OR UPDATE ON wm.assertion_evidence DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wm.require_assertion_evidence();
-- Caller receives no direct table credentials. Role provisioning is deployment work, not done here.
REVOKE ALL ON SCHEMA wm FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA wm FROM PUBLIC;
COMMIT;
