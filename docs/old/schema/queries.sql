-- Query templates only. Bind parameters; not a migration.
-- $1 nullable subject UUID, $2 nullable predicate, $3 fact-valid-at,
-- $4 current server read time, $5 include historical states, $6 page limit,
-- $7/$8 nullable last slot/assertion UUID pair. Cursor revision checks live in the repository.
SELECT s.subject_id,s.predicate_key,s.scope_key,s.revision AS slot_revision,
 a.assertion_id,st.status,a.value,a.object_entity_id,
 jsonb_build_object(
  'source_kind',src.kind,'source_id',src.source_id,'observed_at',a.observed_at,
  'received_at',a.received_at,'scope',a.scope_description,'epistemic',a.epistemic,
  'evidence',(SELECT jsonb_agg(jsonb_build_object(
     'log_event_id',e.log_event_id,'content',jsonb_build_object(
       'path',e.object_path,'sha256',e.sha256,'bytes',e.byte_count,'media_type',e.media_type))
     ORDER BY e.evidence_id)
    FROM wm.assertion_evidence ae JOIN wm.evidence e USING(evidence_id)
    WHERE ae.assertion_id=a.assertion_id)) AS provenance,
 a.valid_from,a.valid_to,a.fresh_until,
 CASE WHEN a.fresh_until IS NULL THEN 'UNKNOWN'
      WHEN a.fresh_until < $4::timestamptz THEN 'STALE' ELSE 'CURRENT' END AS freshness
FROM wm.fact_slot s JOIN wm.assertion a USING(slot_id)
JOIN wm.assertion_state st USING(assertion_id,slot_id)
JOIN wm.source src USING(source_id)
WHERE ($1::uuid IS NULL OR s.subject_id=$1::uuid)
 AND ($2::text IS NULL OR s.predicate_key=$2::text)
 AND ($5::boolean OR st.status IN ('ACTIVE','SUPPORTING','CONTESTED'))
 AND a.valid_from <= $3::timestamptz AND (a.valid_to IS NULL OR a.valid_to > $3::timestamptz)
 AND ($7::uuid IS NULL OR (s.slot_id,a.assertion_id)>($7::uuid,$8::uuid))
ORDER BY s.slot_id,a.assertion_id LIMIT $6::integer;

-- Optimistic revision gate inside transaction; zero rows means conflict.
UPDATE wm.fact_slot SET revision=revision+1
WHERE slot_id=$1::uuid AND revision=$2::bigint RETURNING revision;

-- Committed receipt is authority even if the JSON acknowledgement was lost.
SELECT request_hash,outcome,result FROM wm.change_receipt WHERE change_id=$1::uuid;
-- Mark exported only after durable journal ack.
SELECT event_id,change_id,payload FROM wm.audit_outbox WHERE exported_at IS NULL ORDER BY created_at,event_id;
