-- Incremental, additive migration. Never rewrite existing fact history.
BEGIN;
CREATE TABLE IF NOT EXISTS wm.settings_batch_receipt (
    application_id uuid PRIMARY KEY,
    request_hash text NOT NULL,
    result jsonb NOT NULL,
    committed_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE TRIGGER immutable_settings_batch_receipt BEFORE UPDATE OR DELETE ON wm.settings_batch_receipt FOR EACH ROW EXECUTE FUNCTION wm.immutable_record();
REVOKE ALL ON wm.settings_batch_receipt FROM PUBLIC;
INSERT INTO wm.schema_version(version) VALUES (3) ON CONFLICT DO NOTHING;
COMMIT;
