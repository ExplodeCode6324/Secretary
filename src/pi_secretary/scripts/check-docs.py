"""Check repository-owned Markdown links and migration destinations; no API calls."""
from pathlib import Path
import json,re,sys
ROOT=Path(__file__).resolve().parents[3]
errors=[];links=0
files=[ROOT/'README.md',*(ROOT/'docs').rglob('*.md'),*(ROOT/'test_case').rglob('*.md')]
for p in files:
 for value in re.findall(r'\]\(([^)\s]+)\)',p.read_text()):
  target=value.split('#')[0]
  if not target or re.match(r'\w+://',target):continue
  links+=1
  if not (p.parent/target).exists():errors.append(f'{p.relative_to(ROOT)}: {value}')
for old,new in json.loads((ROOT/'docs/migration-map.json').read_text()).items():
 if new and not (ROOT/new).exists():errors.append(f'missing migration destination: {old} -> {new}')
for p in (ROOT/'test_case/offline').rglob('*.ts'):
 if 'process.env.SECRETARY_CREDENTIALS_FILE' in p.read_text():errors.append(f'online credentials in offline test: {p.relative_to(ROOT)}')
print(json.dumps({'markdown_files':len(files),'local_links':links,'errors':errors,'pass':not errors},ensure_ascii=False,indent=2))
sys.exit(bool(errors))
