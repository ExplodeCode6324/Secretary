# -*- coding: utf-8 -*-
"""Generate field and SQL references from the contracts actually loaded by Pi."""
from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/data';OUT.mkdir(parents=True,exist_ok=True)
schema=json.loads((ROOT/'src/contracts/contracts.schema.json').read_text());defs=schema['$defs']
def cell(v):return str(v).replace('|','\\|').replace('\n',' ')
def type_of(d):
 if '$ref' in d:return d['$ref'].split('/')[-1]
 if 'const' in d:return json.dumps(d['const'],ensure_ascii=False)
 if 'enum' in d:return ' / '.join(map(str,d['enum']))
 for k in ['oneOf','anyOf']:
  if k in d:return ' 或 '.join(type_of(x) for x in d[k])
 if 'allOf' in d:return ' & '.join(type_of(x) for x in d['allOf'])
 if d.get('type')=='array':return 'array<'+type_of(d.get('items',{}))+'>'
 return str(d.get('type','JSON'))
def props(d):
 out={};req=set(d.get('required',[]))
 if '$ref' in d:
  p,r=props(defs[d['$ref'].split('/')[-1]]);out.update(p);req.update(r)
 for x in d.get('allOf',[]):
  p,r=props(x);out.update(p);req.update(r)
 out.update(d.get('properties',{}));return out,req
lines=['# 结构化数据字段索引','', '由 `npm run docs:generate` 从运行时 JSON Schema 生成。逐字段说明包括继承字段；required 表示必须出现，nullable 是否允许 null 由类型/组合约束决定。完整条件约束见各页引用的 Schema。', '', '这里是内部持久化/领域合同，客户端 DTO 另见 [API v1](../api/v1/README.md)。Schema 是结构校验来源，TypeScript contracts.ts 是生成类型。使用方式见 [数据模型](../data-model.md) 和 [状态与调度](../state-machines.md)。', '', '所有持久化记录由 Store.shape 校验，普通请求与嵌套定义由调用点 shape/shapeDefinition 或宿主逻辑校验。`record_type + id` 定位记录，revision 用于版本检查，ObjectRef 用 SHA-256 引用不可变原件。', '', '运行源码：[contracts.schema.json](../../src/contracts/contracts.schema.json)、[contracts.ts](../../src/pi_secretary/src/contracts.ts)、[Store](../../src/pi_secretary/src/store.ts)。', '', '| 定义 | 字段数 | 说明 |','| --- | ---: | --- |']
# Fix references relative to docs/data.
lines=[x.replace('(../../src/','(../../src/') for x in lines]
for name,d in defs.items():
 p,required=props(d)
 desc=d.get('description','')
 lines.append(f'| [{name}]({name}.md) | {len(p)} | {cell(desc)} |')
 text=[f'# {name}','',desc or '当前运行契约中的结构或共享类型。','',f'来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/{name})。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。','']
 if p:
  text+=['| 字段 | 类型 / 值域 | 必填 | 说明与约束 |','| --- | --- | --- | --- |']
  for key,v in p.items():
   extra={k:v[k] for k in ['format','pattern','minimum','maximum','exclusiveMinimum','minLength','maxLength','minItems','maxItems','additionalProperties'] if k in v}
   refs=sorted(set(re.findall(r'"\$ref": "#\/\$defs\/([^"/]+)"',json.dumps(v))))
   desc=v.get('description','')+(' '+json.dumps(extra,ensure_ascii=False) if extra else '')
   if refs:desc+=' 关联：'+', '.join(f'[{r}]({r}.md)' for r in refs)
   text.append(f'| `{key}` | {cell(type_of(v))} | {"是" if key in required else "否"} | {cell(desc)} |')
 else:text+=['```json',json.dumps(d,ensure_ascii=False,indent=2),'```']
 conditions={k:v for k,v in d.items() if k in ['if','then','else','oneOf','anyOf','allOf','not','dependentRequired','additionalProperties']}
 if conditions:text+=['','## 组合约束','', '```json',json.dumps(conditions,ensure_ascii=False,indent=2),'```']
 (OUT/(name+'.md')).write_text('\n'.join(text)+'\n')
(OUT/'README.md').write_text('\n'.join(lines)+'\n')
sql='\n'.join((ROOT/'src/schema'/name).read_text() for name in ['001_world_model.sql','003_settings.sql','004_memory_search.sql'])
text=['# PostgreSQL schema', '', 'WorldEntity, WorldAssertion and WorldGenesis are authoritative journal records. PostgreSQL only serves the rebuildable mem log-search index; wm tables below are preserved legacy archives.', '', 'Active initializer: [memory_search.sql](../src/schema/memory_search.sql), called by World.initializeMemorySearchSchema. It never creates or alters wm tables. Read-only legacy import uses one REPEATABLE READ snapshot and one validated journal genesis frame.', '', 'World model batches require exact one-shot approval and use AUTHORIZED → SUCCEEDED in one journal frame with consumed grant, facts and receipt. Ordinary World writes never run Settings or wake Main. See [World memory](world-memory.md).', '', '## Archived SQL tables', '', 'The following historical table definitions remain intact for import and audit. They are not current World write interfaces.']
for namespace,name,body in re.findall(r'CREATE TABLE (?:IF NOT EXISTS )?(wm|mem)\.(\w+) \((.*?)\n\);',sql,re.S):text +=['',f'### {namespace}.{name}','','```sql',body.strip(),'```']
text+=['', '## Current log search', '', 'mem.document, mem.chunk and mem.checkpoint are disposable projections of journal events. Checkpoints bind domain, policy and digest; PostgreSQL failure does not disable Store-backed World reads after genesis. Existing wm privileges and immutable historical rows remain unchanged.']
(ROOT/'docs/database.md').write_text('\n'.join(text)+'\n')
print(f'Generated {len(defs)} contract definitions and database reference')
