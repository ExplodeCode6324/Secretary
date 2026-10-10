-- Additive domain clock. Data and its version share the same SQL transaction.
BEGIN;
CREATE TABLE IF NOT EXISTS wm.sync_clock (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 history_id uuid NOT NULL DEFAULT gen_random_uuid(),
 version bigint NOT NULL DEFAULT 0 CHECK(version>=0)
);
INSERT INTO wm.sync_clock(singleton,version) SELECT true,count(*) FROM wm.change_receipt ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION wm.bump_sync_clock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE wm.sync_clock SET version=version+1 WHERE singleton;
 RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['entity','source','predicate','fact_slot','assertion','assertion_state','conflict','conflict_member','assertion_evidence','change_receipt'] LOOP
  EXECUTE format('CREATE OR REPLACE TRIGGER sync_clock_change AFTER INSERT OR UPDATE OR DELETE ON wm.%I FOR EACH STATEMENT EXECUTE FUNCTION wm.bump_sync_clock()', t);
 END LOOP;
END $$;
REVOKE ALL ON wm.sync_clock FROM PUBLIC;
INSERT INTO wm.schema_version(version) VALUES(4) ON CONFLICT DO NOTHING;
COMMIT;
