#!/usr/bin/env python3
"""Validate only the test-design package; standard library, no API/DB calls."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

import build

ROOT, TEST = build.ROOT, build.TEST


def main():
    errors = []
    def require(condition, message):
        if not condition:
            errors.append(message)

    catalog = build.read_json(TEST / 'catalog.json')
    cases = catalog['cases']
    groups = {g['id'] for g in catalog['groups']}
    machines = build.read_json(ROOT / 'state_machine/catalog.json')['machines']
    ids = [c['id'] for c in cases]
    require(len(ids) == len(set(ids)), 'duplicate case ID')
    baseline = (ROOT / 'BrainStorm_Baseline_v3.md').read_text()
    sections = set(re.findall(r'^#{2,4}\s+(\d+(?:\.\d+)*)\.?\s', baseline, re.M))
    all_rules = set()
    for case in cases:
        cid = case['id']
        require(case['group'] in groups, f'{cid}: unknown group')
        require(bool(re.fullmatch(re.escape(case['group']) + r'-\d{3}', cid)), f'{cid}: ID format')
        require(case['priority'] in {'P0','P1','P2'}, f'{cid}: priority')
        require(case['status'] == 'NOT_RUN', f'{cid}: design must not claim runtime verdict')
        require(case['evidence_level'] in {'OFFLINE_RUNTIME','POSTGRES_RUNTIME','LIVE_MODEL','UI_RUNTIME','REAL_USE','POWER_LOSS'}, f'{cid}: evidence level')
        for key in ['title','preconditions','steps','expected','evidence','sources','modules','baseline_sections','semantic_rules']:
            require(bool(case.get(key)), f'{cid}: empty {key}')
        for key in ['steps','expected','evidence']:
            require(isinstance(case[key], list) and all(isinstance(x,str) and x.strip() for x in case[key]), f'{cid}: invalid {key}')
        require(set(case['modules']) <= set(machines), f'{cid}: unknown module')
        require(set(case['baseline_sections']) <= sections, f'{cid}: unknown BrainStorm section')
        for source in case['sources']:
            require((ROOT / source).is_file(), f'{cid}: missing source {source}')
        all_rules.update(case['semantic_rules'])
    require(all_rules == {f'J{i:02}' for i in range(1,22)}, 'J01-J21 coverage incomplete/unknown')
    require({m for c in cases for m in c['modules']} == set(machines), 'module coverage incomplete')
    require({g for g in groups} == {c['group'] for c in cases}, 'empty group')

    manifest = build.read_json(TEST / 'sources.json')
    for entry in manifest['files']:
        source = ROOT / entry['path']
        require(source.is_file(), f'missing snapshotted source {entry["path"]}')
        if source.is_file():
            require(hashlib.sha256(source.read_bytes()).hexdigest() == entry['sha256'], f'source drift: {entry["path"]}; review design before refreshing baseline')

    expected_files = build.render()
    for name, content in expected_files.items():
        path = TEST / name
        require(path.is_file() and path.read_text() == content, f'generated file drift: {name}')
    transitions = build.read_json(TEST / 'transition-obligations.json')['obligations']
    require(len(transitions) == sum(len(m['transitions']) for m in machines.values()), 'transition count mismatch')
    for item in transitions:
        require(all(v == 'NOT_RUN' for v in item['subcases'].values()), f'{item["id"]}: design claims execution')

    fixture = build.read_json(TEST / 'fixtures/memory-timeline.json')
    events = {e['id']:e for e in fixture['events']}
    require(len(events) == len(fixture['events']), 'duplicate event ID')
    require([e['day'] for e in fixture['events']] == sorted(e['day'] for e in fixture['events']), 'events not ordered')
    require(fixture['gold_visibility'] == 'EVALUATOR_ONLY', 'gold visibility')
    probes = fixture['probes']
    require(len({q['id'] for q in probes}) == len(probes), 'duplicate probe ID')
    for probe in probes:
        require(bool(probe['expected_claims']) and bool(probe['forbidden_claims']), f'{probe["id"]}: missing oracle')
        for eid in probe['evidence_ids']:
            require(eid in events, f'{probe["id"]}: missing evidence {eid}')
            if eid in events:
                require(events[eid]['day'] <= probe['day'], f'{probe["id"]}: future evidence leakage')
        require(bool(probe['evidence_ids']) or probe['kind'] == 'missing', f'{probe["id"]}: ungrounded known-answer gold')
    require(max(e['day'] for e in events.values()) == 365, 'fixture duration')
    report_example = build.read_json(TEST / 'fixtures/run-record.example.json')
    require(report_example['case_id'] in ids and report_example['verdict'] == 'NOT_RUN' and report_example['evidence'] == [], 'example claims actual execution')

    link_count = 0
    for doc in TEST.rglob('*.md'):
        # Runtime snapshots contain third-party docs, not this design package.
        if 'runs' in doc.relative_to(TEST).parts:
            continue
        text = doc.read_text()
        for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', text):
            if '://' in target or target.startswith('mailto:'):
                continue
            link_count += 1
            path_part, _, anchor = unquote(target).partition('#')
            # Codex local source links may have a one-based line suffix.
            path_part = re.sub(r':\d+$', '', path_part)
            destination = (doc.parent / path_part).resolve() if path_part else doc
            # This report is created below, including on a clean first run.
            own_report = destination == (TEST / 'reports/design-check.json').resolve()
            require(destination.is_file() or own_report, f'{doc.relative_to(TEST)}: broken link {target}')
            if anchor and destination.is_file():
                linked = destination.read_text()
                require(f'id="{anchor}"' in linked, f'{doc.relative_to(TEST)}: missing explicit anchor {target}')
    report = dict(schema_version=1, evidence_level='DOC_ONLY', runtime_tests_executed=False,
                  generated_at=datetime.now(timezone.utc).isoformat(),
                  verdict='PASS' if not errors else 'FAIL',
                  counts=dict(cases=len(cases),machines=len(machines),transitions=len(transitions),
                              transition_subcase_obligations=4*len(transitions),semantic_rules=len(all_rules),
                              source_files=len(manifest['files']),memory_events=len(events),memory_probes=len(probes),local_links=link_count),
                  limitations=['No application, database, model, fault campaign, or semantic quality evaluation executed.',
                               'Source hashes and reference validity do not prove semantic coverage or correctness.'], errors=errors)
    (TEST / 'reports/design-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
