#!/usr/bin/env python3
"""Audit the reviewable package, without printing possible secrets."""
import hashlib,json,pathlib,re,subprocess
root=pathlib.Path(__file__).resolve().parents[1];repo=root.parent
files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z','demo_src_go'],cwd=repo,text=True).split('\0')[:-1]
patterns=[re.compile(rb'oc_sk_[A-Za-z0-9_]{12,}'),re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')]
secret_files=[];absolute_files=[]
for name in files:
 p=repo/name
 if not p.is_file():continue
 raw=p.read_bytes()
 if any(pattern.search(raw) for pattern in patterns):secret_files.append(name)
 if (b'/Users/'+b'muy/') in raw:absolute_files.append(name)
checks={}
for src,dst in [('json/contracts.schema.json','assets/contracts.schema.json'),('state_machine/catalog.json','assets/state-machines.json'),('schema/001_world_model.sql','assets/001_world_model.sql'),('schema/002_predicates.sql','assets/002_predicates.sql')]:
 checks[dst]=hashlib.sha256((repo/src).read_bytes()).hexdigest()==hashlib.sha256((root/dst).read_bytes()).hexdigest()
ignored=subprocess.run(['git','check-ignore','--quiet','demo_src_go/.private/runtime.env'],cwd=repo).returncode==0
report={'evidence_level':'PACKAGE_AUDIT','files_checked':len(files),'canonical_assets_match':checks,'secret_matches':len(secret_files),'absolute_user_path_matches':len(absolute_files),'private_credentials_ignored':ignored,'private_file_mode':oct((root/'.private/runtime.env').stat().st_mode&0o777) if (root/'.private/runtime.env').exists() else 'not configured'}
(root/'reports/package-audit.json').write_text(json.dumps(report,indent=2)+'\n')
if secret_files or absolute_files or not all(checks.values()) or not ignored:raise SystemExit('Package audit failed; inspect affected file names without printing secret values.')
print('Package audit passed; no credential patterns or personal absolute paths in reviewable files.')
