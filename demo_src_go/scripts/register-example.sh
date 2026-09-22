#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p bin .local
go build -o bin/example-report ./programs/report.go
python3 - <<'PY'
import json,pathlib
r=pathlib.Path.cwd()
spec={'name':'Local JSON report','description':'Reads a title from JSON stdin and emits a timestamped JSON report; no file or network writes.','entrypoint':str(r/'bin/example-report'),'parameters_schema':{'type':'object','properties':{'title':{'type':'string','minLength':1}},'required':['title'],'additionalProperties':False},'result_schema':{'type':'object','properties':{'title':{'type':'string'},'generated_at':{'type':'string'},'status':{'const':'complete'}},'required':['title','generated_at','status'],'additionalProperties':False}}
(r/'.local/program-example.json').write_text(json.dumps(spec,indent=2)+'\n')
PY
id=$(./bin/secretary program import .local/program-example.json)
./bin/secretary program enable "$id"
printf '%s\n' "$id" > .local/example-program.id
echo "Registered and enabled the local JSON report program. Starting it still requires UI approval."
