BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS mem;
CREATE TABLE IF NOT EXISTS mem.document (
    source_id text NOT NULL,
    event_id uuid NOT NULL,
    log_sequence bigint NOT NULL,
    occurred_at timestamptz NOT NULL,
    kind text NOT NULL CHECK (kind IN ('input','reply','task','notification')),
    session_id uuid,
    scope_id uuid,
    task_id uuid,
    body_hash text NOT NULL,
    PRIMARY KEY (source_id,event_id)
);
CREATE TABLE IF NOT EXISTS mem.chunk (
    source_id text NOT NULL,
    event_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    body_offset integer NOT NULL,
    body text NOT NULL,
    PRIMARY KEY (source_id,event_id,chunk_index),
    FOREIGN KEY (source_id,event_id) REFERENCES mem.document ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS chunk_body_trgm ON mem.chunk USING gin (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS document_time ON mem.document (occurred_at DESC,event_id DESC);
CREATE INDEX IF NOT EXISTS document_scope ON mem.document (scope_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS document_task ON mem.document (task_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS document_kind ON mem.document (kind,occurred_at DESC);
CREATE TABLE IF NOT EXISTS mem.checkpoint (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    source_id text NOT NULL,
    policy_version integer NOT NULL,
    journal_sequence bigint NOT NULL,
    journal_digest text NOT NULL,
    document_count bigint NOT NULL,
    chunk_count bigint NOT NULL
);
ALTER TABLE wm.entity ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';
INSERT INTO wm.schema_version(version) VALUES (4) ON CONFLICT DO NOTHING;
COMMIT;
