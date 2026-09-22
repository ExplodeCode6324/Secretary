#!/usr/bin/env python3
"""Static contract checks, deliberately not a runtime implementation."""
from pathlib import Path
import argparse, copy, hashlib, json, re
from urllib.parse import unquote
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--report',required=True);args=p.parse_args()
checks=[]
def check(name,ok):
    checks.append({'case':name,'passed':bool(ok)})
    if not ok:raise AssertionError(name)
def read(path):return json.loads((ROOT/path).read_text())
schema=read('json/contracts.schema.json');storage=read('json/storage.schema.json')
Draft202012Validator.check_schema(schema);Draft202012Validator.check_schema(storage)
registry=Registry().with_resources([(s['$id'],Resource.from_contents(s)) for s in [schema,storage]])
v=Draft202012Validator(schema,format_checker=FormatChecker(),registry=registry)
check('strict_date_time_validator_enabled',not Draft202012Validator({'type':'string','format':'date-time'},format_checker=FormatChecker()).is_valid('tomorrow'))
valid=list((ROOT/'json/examples/valid').glob('*.json'))
for f in valid:
    errors=list(v.iter_errors(json.loads(f.read_text())))
    check('valid_shape:'+f.name,not errors)
index=read('json/examples/invalid/index.json')
for f in index:check('invalid_shape:'+f['file'],not v.is_valid(read('json/examples/invalid/'+f['file'])))
# Isolate path rejection; do not let a bad hash mask an ineffective path constraint.
for path in ['../escape','a/../../escape','/etc/passwd','objects/../file']:
    x=read('json/examples/valid/Context.json');x['raw_context']['path']=path
    check('path_rejected:'+path,not v.is_valid(x))
for field,value in [('received_at','2026-09-22T00:00:00'),('received_at','2026-13-22T00:00:00Z')]:
    x=read('json/examples/valid/Input.json');x[field]=value
    check('time_rejected:'+value,not v.is_valid(x))
for name,node in schema['$defs'].items():
    if node.get('type')=='object':check('closed_object:'+name,node.get('additionalProperties') is False)
# All schema local references resolve and contract catalog matches root discriminator.
def refs(node):
    if isinstance(node,dict):
        if '$ref' in node:yield node['$ref']
        for value in node.values():yield from refs(value)
    elif isinstance(node,list):
        for value in node:yield from refs(value)
for ref in refs(schema):check('schema_ref:'+ref,ref.startswith('#/$defs/') and ref.split('/')[-1] in schema['$defs'])
contracts=read('json/catalog.json')['contracts']
check('primary_contracts_have_examples',set(contracts)=={f.stem for f in valid})
check('unique_record_discriminators',all(schema['$defs'][n]['properties']['record_type']['const']==n for n in contracts))
# Storage schema with exact binary frame sample.
sv=Draft202012Validator(storage,format_checker=FormatChecker(),registry=registry)
check('storage_frame_shape',sv.is_valid({'payload_b64':'e30=','sha256':hashlib.sha256(b'{}').hexdigest()}))
check('storage_frame_unknown_key_rejected',not sv.is_valid({'payload_b64':'e30=','sha256':'a'*64,'execute':True}))
# Graph consistency/reachability; guards remain service obligations, not magically proven here.
machines=read('state_machine/catalog.json')['machines'];guarddoc=(ROOT/'state_machine/GUARDS.md').read_text()
transition_count=0
for name,m in machines.items():
    states=set(m['states']);check('enum:'+name,states==set(schema['$defs'][name+'State']['enum']))
    check('initial_and_terminal:'+name,m['initial'] in states and set(m['terminal'])<=states)
    edges=m['transitions'];transition_count+=len(edges)
    check('unique_events:'+name,len({(t['from'],t['event']) for t in edges})==len(edges))
    reachable={m['initial']}
    for _ in states:
        reachable.update(t['to'] for t in edges if t['from'] in reachable)
    check('all_states_reachable:'+name,reachable==states)
    for t in edges:
        check('edge:'+t['id'],t['from'] in states and t['to'] in states and t['from'] not in m['terminal'])
        check('guard:'+t['id'],'`'+t['guard']+'`' in guarddoc)
        check('table:'+t['id'],t['id'] in (ROOT/'state_machine'/f'{name}.md').read_text())
traces=read('demo_design/checks/traces.json')
for t in traces:
    m=machines[t['machine']];state=t.get('start',m['initial']);accepted=True
    for event in t['events']:
        edge=next((e for e in m['transitions'] if e['from']==state and e['event']==event),None)
        if edge is None:accepted=False;break
        state=edge['to']
    check('trace:'+t['name'],accepted==t['accept'] and (not accepted or state==t['end']))
# Local Markdown links, ignoring fenced code. No stale links to absent artifacts.
links=0;files=[ROOT/'README.md',ROOT/'BrainStorm_Baseline_v3.md']
for folder in ['state_machine','schema','json','demo_design']:files.extend((ROOT/folder).rglob('*.md'))
for f in files:
    body=re.sub(r'```.*?```','',f.read_text(),flags=re.S)
    for target in re.findall(r'\[[^\]\n]+\]\(([^)]+)\)',body):
        if re.match(r'[a-zA-Z][\w+.-]*:',target) or target.startswith('#'):continue
        clean=unquote(target.split('#')[0].strip('<>'))
        if not clean:continue
        links+=1;check('link:'+str(f.relative_to(ROOT))+':'+clean,(f.parent/clean).exists())
readme=(ROOT/'README.md').read_text();digest=hashlib.sha256((ROOT/'BrainStorm_Baseline_v3.md').read_bytes()).hexdigest()
check('baseline_hash_unchanged',digest in readme)
# Publication hygiene, without scanning credentials outside this design package.
for f in files:
    check('no_local_home_path:'+str(f.relative_to(ROOT)),not re.search(r'/Users/[^/\s]+/',f.read_text()))
report={'evidence_level':'DOC_ONLY','passed':True,'primary_contracts':len(contracts),'definitions':len(schema['$defs']),'storage_definitions':len(storage['$defs']),'positive_shape_examples':len(valid),'negative_shape_examples':len(index),'state_machines':len(machines),'transitions':transition_count,'graph_traces':len(traces),'markdown_files':len(files),'local_links':links,'baseline_sha256':digest,'checks_passed':len(checks),'limitations':['Shape fixtures use synthetic references; not an integrated persisted dataset','Graph traces validate allowed edges, not Go guard implementations','No Go runtime, model, power-loss or real-use tests performed']}
Path(args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
