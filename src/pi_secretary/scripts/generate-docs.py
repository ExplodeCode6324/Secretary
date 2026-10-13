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
text=['# PostgreSQL schema','', 'World Model 权威事实使用 `wm` schema；可重建的历史正文索引使用 `mem` schema。Session、Task、授权规则、Context 与 Consciousness 存储在本地 journal，不是 PostgreSQL 表。', '', '权威 SQL：[001_world_model.sql](../src/schema/001_world_model.sql)、[002_predicates.sql](../src/schema/002_predicates.sql)、[003_settings.sql](../src/schema/003_settings.sql)、[004_memory_search.sql](../src/schema/004_memory_search.sql)、[queries.sql](../src/schema/queries.sql)。执行仓储：[world.ts](../src/pi_secretary/src/world.ts)。', '', '## 迁移与事务','', 'World.migrate 使用 advisory lock 串行化迁移；不存在 schema_version 时执行基线，再应用 predicate seed 并记录版本 2，再执行 settings_batch_receipt 的版本 3 和 mem/aliases 的版本 4 迁移。基线/seed 自带事务；migrate 在失败时 rollback 并释放锁。当前入口为 owner 显式 POST /api/v1/admin/world/migrate，再按请求回执确认；Core CLI 不处理 --migrate。', '', '变更通过 Settings 协调器先摘要并预检 context。认证 local-owner 的 Settings API 记录明确应用证据；模型提案仍经授权。数据库事务检查实体、predicate 与 slot revision；整批原子提交并保存 settings_batch_receipt。change_id/request_id/request_hash 支持回执去重和冲突检查。assertion、状态投影、冲突、证据、change_receipt 与 audit_outbox 在事务中提交；JSONL 审计导出属于独立可恢复桥接。', '', '## 关系图','', '```mermaid','erDiagram','  entity ||--o{ fact_slot : subject','  predicate ||--o{ fact_slot : defines','  fact_slot ||--o{ assertion : versions','  source ||--o{ assertion : provenance','  assertion ||--|| assertion_state : projection','  assertion ||--o{ assertion_evidence : evidence','  evidence ||--o{ assertion_evidence : content','  fact_slot ||--o{ conflict : conflicts','  conflict ||--o{ conflict_member : members','  change_receipt ||--o| audit_outbox : export','```','', '## 表字段与约束','', '以下定义直接从当前 SQL 生成，包含默认值、外键、CHECK、UNIQUE 与延迟约束。']
for namespace,name,body in re.findall(r'CREATE TABLE (?:IF NOT EXISTS )?(wm|mem)\.(\w+) \((.*?)\n\);',sql,re.S):text +=['',f'### {namespace}.{name}','','```sql',body.strip(),'```']
text+=['','## 索引、触发器与读模型','','assertion_state 以部分唯一索引保证每个 slot 至多一个 ACTIVE；conflict 每个 slot 至多一个 OPEN。来源/slot 时间索引支持事实读取，pending_audit_exports 支持未导出事件扫描。','','validate_slot 检查 subject kind 与 SINGLE/MULTI 的 scope_key；validate_assertion 检查 slot revision、值类型与 ENTITY 引用。assertion、receipt、evidence 及证据关联禁止修改删除；source 身份字段不可改；延迟触发器要求每条 assertion 有证据。更正与撤回通过新的变更和投影表达。settings_batch_receipt 也禁止更新和删除，以保留批次幂等依据。','','World 仓储使用 Ajv 验证 predicate.value_schema，并检查证据对象和 CAS。queries.sql 返回当前投影、冲突、来源及有效性信息。','','## Predicate 初始目录','','初始十项：person.display_name、person.height、person.contact、person.member_of、preference.statement、goal.statement、project.constraint、resource.location、resource.depends_on、resource.observed_state。类型、基数、单位和 JSON 值约束以 002_predicates.sql 为准。这些 predicate 描述 World 中可登记的事实类型。','','## 数据库配置','','World 使用专用数据库，连接角色和备份由部署环境配置。DDL 撤销 PUBLIC 权限；Core 的 owner 授权在应用层处理。']
text+=['','## 历史检索与别名','','版本 4 安装 pg_trgm，增加 wm.entity.aliases（非空 text[]，默认空数组），并建立 mem.document、mem.chunk 与 mem.checkpoint。别名经 Settings/WorldCatalogChange 授权维护；旧 ENTITY 编辑缺省保留已有别名。实体名称或别名有多个匹配时返回候选。','','检索投影从 journal 事务帧有界推进，完整正文按 Unicode 边界分块，正文与水位同事务提交。水位绑定来源、策略版本与 journal digest；重启发现来源不符或数据缺失则重建。wm 权威事实不受索引重建影响。','','正文使用 GIN pg_trgm 与参数化字面 ILIKE，按事件去重、时间倒序和稳定事件键返回。时间范围为 [from,to)，过滤联合生效；SQL 超时为 5 秒并返回 search_timeout。locale 决定 trigram 提取，中文命中与性能在实际 locale 下分别验证。两字模式可能退化为扫描。','','部署验收只读核对 server_version、datctype、datcollate、datlocprovider、datlocale 与 datcollversion；配置不同则在匹配隔离库重复中文验证。业务数据实例不用于测试。原文从 journal/CAS 分片读取，mem 可重建。']
(ROOT/'docs/database.md').write_text('\n'.join(text)+'\n')
print(f'Generated {len(defs)} contract definitions and database reference')
