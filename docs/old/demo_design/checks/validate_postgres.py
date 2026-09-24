#!/usr/bin/env python3
"""Validate DDL/constraints in a disposable local cluster, never a supplied DSN."""
from pathlib import Path
import argparse, json, os, shutil, subprocess, tempfile, uuid
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--pg-bin',required=True);p.add_argument('--report',required=True);args=p.parse_args()
bin=Path(args.pg_bin); checks=[]
def run(cmd,**kwargs):return subprocess.run([str(v) for v in cmd],text=True,capture_output=True,**kwargs)
def uid(n):return f'00000000-0000-4000-8000-{n:012d}'
def q(n):return "'"+uid(n)+"'"
with tempfile.TemporaryDirectory(prefix='secretary-pg-') as tmp:
    base=Path(tmp); data=base/'data'; sock=base/'s';sock.mkdir()
    # Unix socket paths must be short even on hosts with a long TMPDIR.
    socket_tmp=tempfile.TemporaryDirectory(prefix='sec-pg-',dir='/tmp');sock=Path(socket_tmp.name)
    env={**os.environ,'LC_ALL':'C','PGCONNECT_TIMEOUT':'5'}
    started=False
    try:
        r=run([bin/'initdb','-D',data,'--no-locale','--encoding=UTF8','--auth=trust'],env=env)
        if r.returncode:raise RuntimeError(r.stderr)
        r=run([bin/'pg_ctl','-D',data,'-l',base/'postgres.log','-o',f"-k {sock} -c listen_addresses='' -c fsync=on",'-w','start'],env=env)
        if r.returncode:raise RuntimeError(r.stderr+(base/'postgres.log').read_text())
        started=True
        def sql(text):
            return run([bin/'psql','-X','-h',sock,'-d','postgres','-v','ON_ERROR_STOP=1','-At'],input=text,env=env)
        def success(name,text,contains=None):
            r=sql(text);ok=r.returncode==0 and (contains is None or contains in r.stdout)
            checks.append({'case':name,'passed':ok})
            if not ok:raise AssertionError(name+': '+r.stdout+r.stderr)
            return r.stdout
        def rejected(name,text,reason):
            r=sql('BEGIN;\n'+text+'\nSET CONSTRAINTS ALL IMMEDIATE;\nROLLBACK;')
            ok=r.returncode!=0 and reason.lower() in r.stderr.lower()
            checks.append({'case':name,'passed':ok})
            if not ok:raise AssertionError(name+': '+r.stdout+r.stderr)
        version=success('server_version','SHOW server_version;').strip()
        success('empty_database_migration',(ROOT/'schema/001_world_model.sql').read_text())
        success('predicate_seed',(ROOT/'schema/002_predicates.sql').read_text())
        # Fixtures include the real deferred receipt FK + end-of-transaction evidence check.
        fixture=f"""
BEGIN;
INSERT INTO wm.entity(entity_id,kind,display_name) VALUES({q(1)},'PERSON','Synthetic person'),({q(2)},'DEVICE','Synthetic device');
INSERT INTO wm.source(source_id,kind,source_key,description) VALUES({q(3)},'MASTER','test-master','synthetic only');
INSERT INTO wm.fact_slot(slot_id,subject_id,predicate_key,revision) VALUES({q(4)},{q(1)},'person.display_name',1);
INSERT INTO wm.assertion(assertion_id,slot_id,slot_revision,source_id,change_id,value,epistemic,received_at,valid_from,scope_description)
VALUES({q(5)},{q(4)},1,{q(3)},{q(6)},'"Example"','REPORTED','2026-09-22Z','2026-09-22Z','test');
INSERT INTO wm.evidence(evidence_id,log_event_id,object_path,sha256,media_type,byte_count)
VALUES({q(7)},{q(8)},'objects/test',repeat('a',64),'text/plain',3);
INSERT INTO wm.assertion_evidence VALUES({q(5)},{q(7)});
INSERT INTO wm.assertion_state(assertion_id,slot_id,status,changed_by) VALUES({q(5)},{q(4)},'ACTIVE',{q(6)});
INSERT INTO wm.change_receipt(change_id,request_id,request_hash,outcome,result) VALUES({q(6)},{q(9)},repeat('b',64),'APPLIED','{{}}');
INSERT INTO wm.audit_outbox(event_id,change_id,payload) VALUES({q(10)},{q(6)},'{{"case":"synthetic"}}');
COMMIT;
""".replace('2026-09-22Z','2026-09-22T00:00:00Z')
        success('atomic_assertion_receipt_evidence_outbox',fixture)
        def assertion(a=15,value='"Other"',extra='',source=3):
            return f"""UPDATE wm.fact_slot SET revision=2 WHERE slot_id={q(4)};
INSERT INTO wm.assertion(assertion_id,slot_id,slot_revision,source_id,change_id,value,epistemic,received_at,valid_from,scope_description{',valid_to' if extra else ''})
VALUES({q(a)},{q(4)},2,{q(source)},{q(6)},'{value}','REPORTED','2026-09-22T00:00:00Z','2026-09-22T00:00:00Z','test'{extra});"""
        rejected('wrong_predicate_value_type',assertion(value='123'),'predicate value type mismatch')
        rejected('missing_evidence',assertion(),'assertion requires evidence')
        rejected('invalid_validity_interval',assertion(extra=",'2026-09-21T00:00:00Z'"),'check constraint')
        rejected('foreign_source_missing',assertion(source=999),'foreign key')
        rejected('assertion_immutable',f"UPDATE wm.assertion SET value='\"Changed\"' WHERE assertion_id={q(5)};",'immutable')
        rejected('receipt_immutable',f"UPDATE wm.change_receipt SET outcome='REJECTED' WHERE change_id={q(6)};",'immutable')
        rejected('evidence_link_immutable',f"DELETE FROM wm.assertion_evidence WHERE assertion_id={q(5)};",'immutable')
        rejected('source_cannot_be_promoted',f"UPDATE wm.source SET kind='OBSERVATION' WHERE source_id={q(3)};",'immutable')
        rejected('wrong_subject_kind',f"INSERT INTO wm.fact_slot(slot_id,subject_id,predicate_key) VALUES({q(11)},{q(2)},'person.display_name');",'subject kind incompatible')
        rejected('single_value_scope_must_be_empty',f"INSERT INTO wm.fact_slot(slot_id,subject_id,predicate_key,scope_key) VALUES({q(11)},{q(1)},'person.display_name','escape');",'scope_key incompatible')
        rejected('receipt_request_unique',f"INSERT INTO wm.change_receipt VALUES({q(16)},{q(9)},repeat('c',64),'APPLIED','{{}}',now());",'duplicate key')
        rejected('evidence_path_escape',f"INSERT INTO wm.evidence VALUES({q(16)},{q(17)},'../escape',repeat('c',64),'text/plain',2);",'check constraint')
        rejected('resolved_conflict_needs_note',f"INSERT INTO wm.conflict(conflict_id,slot_id,status,opened_by,resolved_by) VALUES({q(18)},{q(4)},'RESOLVED',{q(6)},{q(6)});",'check constraint')
        rejected('one_active_per_slot',assertion()+f"INSERT INTO wm.assertion_evidence VALUES({q(15)},{q(7)}); INSERT INTO wm.assertion_state(assertion_id,slot_id,status,changed_by) VALUES({q(15)},{q(4)},'ACTIVE',{q(6)});",'duplicate key')
        success('equivalent_support_keeps_provenance','BEGIN;'+assertion(value='\"Example\"')+f"INSERT INTO wm.assertion_evidence VALUES({q(15)},{q(7)}); INSERT INTO wm.assertion_state(assertion_id,slot_id,status,changed_by) VALUES({q(15)},{q(4)},'SUPPORTING',{q(6)}); SET CONSTRAINTS ALL IMMEDIATE; SELECT 'support='||count(*) FROM wm.assertion_state WHERE status='SUPPORTING'; ROLLBACK;",'support=1')
        success('retain_conflicting_candidates','BEGIN;'+assertion()+f"""
INSERT INTO wm.assertion_evidence VALUES({q(15)},{q(7)});
UPDATE wm.assertion_state SET status='CONTESTED',revision=2 WHERE assertion_id={q(5)};
INSERT INTO wm.assertion_state(assertion_id,slot_id,status,changed_by) VALUES({q(15)},{q(4)},'CONTESTED',{q(6)});
INSERT INTO wm.conflict(conflict_id,slot_id,status,opened_by) VALUES({q(18)},{q(4)},'OPEN',{q(6)});
INSERT INTO wm.conflict_member VALUES({q(18)},{q(4)},{q(5)}),({q(18)},{q(4)},{q(15)});
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'contested='||count(*) FROM wm.assertion_state WHERE status='CONTESTED';ROLLBACK;
""",'contested=2')
        success('rollback_preserves_original',"SELECT 'assertions='||count(*) FROM wm.assertion;",'assertions=1')
        success('stale_revision_updates_zero',f"WITH x AS (UPDATE wm.fact_slot SET revision=revision+1 WHERE slot_id={q(4)} AND revision=0 RETURNING *) SELECT 'updated='||count(*) FROM x;",'updated=0')
        rejected('observed_needs_timestamp',assertion().replace("'REPORTED'","'OBSERVED'"),'check constraint')
        rejected('wrong_slot_revision',assertion().replace('SET revision=2','SET revision=3'),'slot revision mismatch')
        rejected('outbox_export_pair',f"UPDATE wm.audit_outbox SET exported_at=now() WHERE event_id={q(10)};",'check constraint')
        query='\n'.join(line for line in (ROOT/'schema/queries.sql').read_text().splitlines() if not line.lstrip().startswith('--')).split(';',1)[0]+';'
        success('fact_query_projection',"PREPARE facts(uuid,text,timestamptz,timestamptz,boolean,integer,uuid,uuid) AS "+query+" EXECUTE facts(NULL,NULL,'2026-09-22T00:00:00Z','2026-09-22T00:00:00Z',false,100,NULL,NULL);",'Example')
        tables=success('only_world_model_tables',"SELECT string_agg(table_name,',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='wm';").strip().split(',')
        expected={'schema_version','entity','source','predicate','fact_slot','change_receipt','assertion','assertion_state','evidence','assertion_evidence','conflict','conflict_member','audit_outbox'}
        assert set(tables)==expected,tables
        report={'evidence_level':'SQL_DDL','postgres_version':version,'checks':checks,'table_count':len(tables),'limitations':['No application repository or authorization runtime tested','No power-loss, multi-process journal or live-model validation','DDL validation is not proof of application transaction protocol']}
        Path(args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(f'{len(checks)} PostgreSQL checks passed; {len(tables)} tables; server {version}')
    finally:
        if started:
            r=run([bin/'pg_ctl','-D',data,'-m','fast','-w','stop'],env=env)
            if r.returncode:raise RuntimeError('Temporary PostgreSQL stop failed: '+r.stderr)
        socket_tmp.cleanup()
