#!/usr/bin/env python3
"""Explicit paid synthetic memory regression; never touches the review session.
Run after exporting private role credentials. Original comparison rubric retained.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
def sources():
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for folder in ['internal', 'cmd', 'assets'] for p in sorted((ROOT/folder).rglob('*'))
            if p.is_file() and not p.name.endswith('_test.go')}

def score(report):
    answer = json.loads(next(m['text'] for m in reversed(report['messages']) if m['text']))
    def contains(key, *parts):
        return isinstance(answer.get(key), str) and all(s in answer[key] for s in parts)
    checks = {
        'default_language': answer.get('default_language') == '中文',
        'orion_external_language': answer.get('orion_external_language') == '英文',
        'person_a_role': contains('person_a_role', 'Orion', '设计'),
        'person_b_role': contains('person_b_role', 'Lyra', '财务'),
        'contract_status': contains('contract_status', '7', '未', '草稿', '等待'),
        'height_d0_cm': answer.get('height_d0_cm') == 173.4,
        'height_d30_cm': answer.get('height_d30_cm') == 173.5,
        'release_day_status': contains('release_day_status', 'D20', 'D22', '未确定'),
        'device_now': contains('device_now', '不能确定', 'D365', '在线'),
        'birthday': contains('birthday', '不知道'),
        'write_scope': contains('write_scope', '工作目录') and any(contains('write_scope', s) for s in ['自己', '自身']),
    }
    return {'passed': sum(checks.values()), 'total': len(checks), 'fields': checks, 'answers': answer,
            'calls': report['calls'], 'phase_errors': [x['error'] for x in report['phase']]}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--attempts', type=int, default=1)
    parser.add_argument('--label', default='final-memory')
    parser.add_argument('--output', default='reports/improvements-20260922')
    parser.add_argument('--score-only', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.attempts <= 5 or not re.fullmatch(r'[a-z0-9-]+', args.label):
        parser.error('attempts must be 1..5; label must be lowercase letters, digits or hyphens')
    out = (ROOT/args.output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    before = sources()
    results = []
    for attempt in range(1, args.attempts+1):
        report = out/f'{args.label}-{attempt}.json'
        entry = {'attempt': attempt, 'report': report.name}
        if not args.score_only:
            if report.exists():
                raise SystemExit(f'Refusing to overwrite evidence: {report.name}')
            if not os.environ.get('SECRETARY_MAIN_API_KEY'):
                raise SystemExit('Export the private main-role credential before this explicit live test')
            data_parent = ROOT/'.local/verification'
            data_parent.mkdir(parents=True, exist_ok=True)
            data = tempfile.mkdtemp(prefix='memory-verification-', dir=data_parent)
            env = os.environ.copy()
            env.update(SECRETARY_LIVE_TEST='1', AUDIT_MEMORY_DATA=data,
                       AUDIT_MEMORY_BATTERY=str(ROOT/'testdata/memory-battery.json'), AUDIT_MEMORY_REPORT=str(report))
            with (out/f'{args.label}-{attempt}.log').open('w') as log:
                proc = subprocess.run(['go','test','./internal/engine','-run','^TestAuditLiveMemory$','-count=1','-v','-timeout','420s'],
                                      cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            entry['exit_code'] = proc.returncode
        try:
            entry.update(score(json.loads(report.read_text())))
        except (OSError, ValueError, KeyError, StopIteration) as error:
            entry['score_error'] = type(error).__name__
        results.append(entry)
        summary = {'evidence_level':'LIVE_MODEL_SYNTHETIC', 'results':results,
                   'source_unchanged_during_run': before == sources(),
                   'limitations':['same fixed input order; independent runs, not provider-controlled seeds',
                                  'short 11-question battery, not general memory accuracy or long-duration acceptance',
                                  'original literal scoring rubric can reject semantically equivalent wording']}
        (out/f'{args.label}-scores.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
        print(args.label, attempt, entry.get('passed',0), '/', entry.get('total',11), flush=True)
        if entry.get('exit_code',0) != 0:
            break
    if not args.score_only:
        (out/f'{args.label}-sources.json').write_text(json.dumps(before,indent=2)+'\n')

if __name__ == '__main__':
    main()
