"""Check repository-owned Markdown links and migration destinations; no API calls."""
from pathlib import Path
import json,re,subprocess,sys
ROOT=Path(__file__).resolve().parents[3]
errors=[];links=0
tracked=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
files=[ROOT/name for name in tracked if name.endswith('.md') and (name.startswith('README') or name.startswith(('docs/','test_case/')))]
for p in files:
 if not p.is_file():
  errors.append(f'missing tracked document: {p.relative_to(ROOT)}');continue
 for value in re.findall(r'\]\(([^)\s]+)\)',p.read_text()):
  target=value.split('#')[0]
  if not target or re.match(r'\w+://',target):continue
  links+=1
  if not (p.parent/target).exists():errors.append(f'{p.relative_to(ROOT)}: {value}')
for old,new in json.loads((ROOT/'docs/migration-map.json').read_text()).items():
 if new and not (ROOT/new).exists():errors.append(f'missing migration destination: {old} -> {new}')
# TUI requirements are the current client route; Core usage remains independent.
for name in ('docs/tui/requirements-and-backend-plan.md','docs/tui/api-coverage.md'):
 if not (ROOT/name).is_file():errors.append(f'missing current TUI document: {name}')
for name in ('README.zh-CN.md','docs/README.md'):
 if not (ROOT/name).is_file() or 'tui/requirements-and-backend-plan.md' not in (ROOT/name).read_text():errors.append(f'missing current TUI navigation: {name}')
for p in (ROOT/'test_case/offline').rglob('*.ts'):
 if 'process.env.SECRETARY_CREDENTIALS_FILE' in p.read_text():errors.append(f'online credentials in offline test: {p.relative_to(ROOT)}')
print(json.dumps({'markdown_files':len(files),'local_links':links,'errors':errors,'pass':not errors},ensure_ascii=False,indent=2))
sys.exit(bool(errors))
