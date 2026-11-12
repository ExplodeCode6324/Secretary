# 常规迭代计划：可用的 World 记忆、身份、Scope 与 Shared

## 系列当前状态与执行入口（2026-11-12）

本文件保留 #111 完整总计划。下方 R5 原文（含“未获实施授权”等表述）记录计划交付时的状态，不代表当前进度。此次拆分只补执行顺序与追溯入口，不删减系列范围，也不冒称新一轮复核 PASS。

| Issue | 详细执行计划 | 当前状态 |
| --- | --- | --- |
| #112 World | [中文](fix_20261112_issue112_world.md) · [English](fix_20261112_issue112_world.en.md) | PR #115 已合并；隔离后端验证及合并后 CI 通过 |
| #113 Scope 导入 | [中文](fix_20261112_issue113_scope.md) · [English](fix_20261112_issue113_scope.en.md) | OPEN，待实施 |
| #114 Shared | [中文](fix_20261112_issue114_shared.md) · [English](fix_20261112_issue114_shared.en.md) | OPEN，待实施 |

#111 负责架构、公共约束、依赖、组合验收及部署/恢复边界。#113 扩展 #112 的逐动作 journal_apply 守卫；#114 可独立实现。Master 已将真实记忆和原生交互组合验收留到所有子项完成后在 agile 进行；各项仍须做合成后端/数据/恢复验证。这不自动授权 agile 部署或后续子项合并。Master 已授权本次文档整理并提交 main。

## 原始 R5 计划与复核记录


日期：2026-11-12（香港）。修订 R5，常规迭代交接版。状态：Fable 5.2 High 计划可执行性 PASS；待 Master 确认，未获实施授权。

交接入口：[交接记录](evidence/issue111-world-model-scope/README.md)。GitHub：[总跟踪 #111](https://github.com/ExplodeCode6324/Secretary/issues/111)、[World #112](https://github.com/ExplodeCode6324/Secretary/issues/112)、[Scope #113](https://github.com/ExplodeCode6324/Secretary/issues/113)、[Shared #114](https://github.com/ExplodeCode6324/Secretary/issues/114)。

## 一、范围、证据与建议选择

本轮按 secretary-pr-fix 只编计划及复核。仓库 https://github.com/ExplodeCode6324/Secretary；实施项目 /Users/muy/Desktop/Codex_Work/secretary-core。已核对本地 main 基线 6b33008f7f1daa010a05e3386b045bcdd1a873ec，实施时重新检查远端 main 与工作区。Master 于 2026-11-12 因后端改造范围较大，将本计划改为常规迭代，并要求建立 GitHub issue，留待新会话实施。2026-11-12 目录整理后，双语计划位于 secretary-core 仓库内的 `docs/fix/fix_20261112_issue111_world_model_scope.md` 与同名 `.en.md`；交接及历史快照位于 `docs/fix/evidence/issue111-world-model-scope/`。本次仅整理路径、命名和入口，技术方案仍为已复核 R5。

技术方案保留已通过复核的 R5；第十节依 Master 要求替换原敏捷专用开发/部署流程，此次流程调整不冒称经过新一轮 Fable 复核。未开始实现、PR、合并或部署。唯一持久 secretary-agile 实例及全部数据继续保全，本常规迭代不授权变更或停止它。历史敏捷源码基线为 b4a6e8838fd5e2bba5102b69d9ed839fd495a4dd。

原四项需求全部保留：Main 可请求创建/导入 Scope；Master/Secretary 身份先于 World 使用就绪；未指定 Scope 自动 Shared，任务目录明确且持久；退役 person.height 并补齐别名。Master 随后通过已有 World model optimization review 会话增加：系统化常驻画像、Secretary 自我记录、真正可用的事实召回，以及删除 World 过度防御机制。R3 的 Opus PASS 只覆盖原较窄范围；R4 替代其 World 架构，保留 Scope/Shared/数据保全要求。

只读观察：Core 在线且 IDLE，当前 Scope/实体/任务 API 返回空，height 仍在活动目录。这不代表部署时必为空。未改产品、配置、数据、数据库或服务，未运行实现测试/CI。源码确认：已有 aliases；memory_search 只查日志；MULTI slot 是值散列；每次生产 World 写入均走 Settings 摘要；SQL 收据/outbox 桥接第二个权威存储。

建议 Master 最终批准的方向：
- World 使用持久 Store 记录及 journal 回放得到的内存视图；本轮不建 PostgreSQL World 投影。不是仅存内存，重启可恢复。PG 继续承载既有日志搜索与历史数据。
- 模型发起的 World 写入仍逐批批准，参数精确固定；普通事实不再触发 Settings/意识摘要重建。World 的成功/拒绝/撤销/到期/应用失败只更新持久结果、UI 与查询，不自动唤醒 Main。Scope 导入仍单独强制授权，每个终态通知触发一次独立只读/报告 Main 调用；这笔模型调用成本属于明确产品选择。
- 删除 slot 和 World 专属版本/散列重复机制，保留通用 Store 完整性及针对字段/目标的过期检查。
- 加 entity.guideline（Master 来源守则）与 entity.note（按主题描述）。统一 Master 上下文片段只呈现一次原 UserInstructions，再附带引用的派生画像；不自动有损迁移既有指令。
- 使用常规 codex/ 功能分支与 PR，执行完整隔离验证，并完成构建、启动测试实例。已有数据域升级仍须完整备份与非破坏性 genesis 导入。部署到 secretary-agile 单独决定；合入 main 仍另行授权。
- height 与重复 person.display_name 一并退役；guideline 主体限 Master/Secretary 角色。联系方式和无结构 free note 仅按需召回，不每次调用常驻。
- 首次升级启动执行一次依赖模型的 runtime Settings 激活，APPLIED 前 Main/新任务认领阻塞；之后普通事实写入不重复触发。首条新格式 journal 后旧二进制不能回放，只能向前修复/兼容构建恢复，不用旧快照丢弃新数据。

## 二、Main 的 Scope 导入

增加 Main 专用 `scope_import` 与只读 `scope_query`。支持创建 NONE 分组，或导入已存在的 DIRECTORY；本轮不做递归扫描、任意创建主机目录、模型修改/归档已有 Scope。

导入需有本轮同会话、未撤回、无附件的 Master 原文证据，复用来源分类校验；授权请求有效期 24 小时，到期只失效不删除历史。每次模型导入必须产生 `scope.import` Operation 和精确参数授权请求，目录默认 `default_write=ask`。Master 在现有授权界面批准后才生效；不允许持久规则、通配规则、记住授权或模型自行批准绕过。展示规范化路径、写入策略、来源事件与参数摘要。反馈、定时器及失败处理轮次不得自行开启此类变更。

提议和应用时都检查：绝对且存在的物理目录、祖先无符号链接、与 Core 数据/活动及仍占用目录无冲突、notes 相对路径安全；记录并复查目录设备/inode，替换后旧批准失效。说明现有文件路径检查的竞争窗口限制，不能宣称完全消除了主机文件系统竞态。

使用 operation 派生的稳定 scope ID。新增仅对 `scope.import`、`world.change` 开放、分别校验所需变更组合的 `AUTHORIZED --journal_apply--> SUCCEEDED` 状态边；Store.stage 校验同一帧包含精确批准的 grant 从 APPROVED 到 CONSUMED、revision=1 的稳定 Scope、Operation 成功/回执事件和完成 Input。每条记录只修改一次；其他外部操作不可使用此边。最终文件系统检查至提交之间不 await。提交前崩溃仍待应用，提交后回放同一结果。

应用时发现路径替换/冲突等确定无效果失败，则同帧把 Operation 取消、effect=NOT_STARTED、批准作废（HOST 原因；仅实际到期才标 EXPIRED）并保存失败通知；不创建 Scope。批准/撤销竞争由版本检查串行裁决，提交后不能以撤销倒退已经完成的效果。显式跳过 match()，拒绝 remember 与此动作的持久规则。来源通过事件/Operation 关联表达，不增加 WorkScope 存储字段，不伪造 MASTER_UI。

完成通知复用 `Input.producer=ENVIRONMENT`，稳定去重键 `scope-import-result:<operation_id>`，携带结果和原 Master 事件引用，以 HOST 审计；成功/应用失败通知同帧落盘。owner 路径拒绝/撤销/到期后，由每次 pump 和启动时运行的幂等协调步骤补齐恰好一条终态通知，正常运行即可送达，重启亦可恢复。不能冒造 Task/Execution 来套用 Feedback。该 Input 唤醒 Main 做查询和报告；独立轮次仅允许读/报告，不能导入、改实体或创建 Task，下一次明确 Master 输入才可委派到新 Scope。在 main-loop 的批次边界按原有输入顺序隔离该通知，不能与新 Master 输入混批；BASE_SYSTEM 明确 ENVIRONMENT 通知不是 Master 授权。

将失败处理工具限制由黑名单改为明确白名单，避免新增变更工具默认放行；完成通知也采用读/报告白名单。scope_query 仅提供分页活动 Scope、精确 ID 和本会话导入状态，覆盖 prompt 列表上限之外的项目，不扫描文件系统。错误说明 macOS /tmp、/var 为符号链接时须提供真实路径。新增 HOST 到期步骤，每次 pump 和启动时检查 scope.import：超出 expires_at 的 PENDING 或未消费 APPROVED grant → EXPIRED，同帧取消 WAIT_AUTH/AUTHORIZED Operation、effect=NOT_STARTED、写入明确到期结果 Input。已消费/终态跳过，通知只生成一次；拒绝/撤销后的缺失通知在下次 pump 补齐，不等重启。到期不能只从界面消失却永留 WAIT_AUTH。决定/到期/应用由版本和同步事务裁决。decided_by 保留原 MASTER_UI 批准者或 null，HOST 作废原因写审计及 UI，不显示成 Master 撤销。journal_apply 还必须检查 owner_epoch，拒绝 STALE_OWNER。MasterAttention/TUI 已支持 Main 授权，实施时验证整条链路。


## 三、World：一个持久权威来源和内存读取接口

复用 Store 的追加 journal、CAS、回放记录。新增 WorldEntity、WorldAssertion、小型 WorldGenesis 标记，进入生成的 Stored 联合类型；补齐 sync-service 分类/失效通知、引用验证、状态目录和回放约束。这些是持久记录，不是易失缓存。不另建 World SQL 投影、bootstrap 注册表、outbox 或专属 checkpoint。

WorldEntity 包含通用 Store 元数据、kind、display_name、aliases、role（MASTER/SECRETARY/null）、external_key、retired_at。WorldAssertion 包含通用元数据、subject_id、predicate_key、topic、value 或 object_entity_id、keywords、HOST 判定的 source_kind、evidence_event_ids、valid_from/valid_to、observed_at、可选 fresh_until/note、LIVE/SUPERSEDED/RETRACTED、replaces_id、稳定 change_id。旧字段完整保存在 genesis CAS 清单。断言创建后仅允许 LIVE→SUPERSEDED/RETRACTED，正文/值/出处不改；纠正同帧新增断言并 supersede 明确旧目标。通用 Store revision 仍是 journal 内部约束，删除的是额外 World slot/entity/assertion_state/predicate 计数器及客户端 expected_revision。

唯一同步 acceptWorldChange(change, authority, currentState) 在 Store.commit 紧前准备变更与事件，中间不 await。模型、owner、初始化、历史导入均通过它，使用明确 authority 模式；提议预览复用同一验证器 dry-run。检查证据事件存在/未撤回、事件类型/会话/附件出处，重新判定来源，验证值/谓词/实体/当前目标、角色保护、精确批准参数和 owner epoch。普通模型证据来自当前会话真实事件；owner 编辑来自认证 MASTER_UI 请求事件；HOST seed/已核实历史导入是受限特殊模式，不伪造 Master 证据。CAS 完整性由 Store 负责，不复制 sha/path/bytes 再反复校验。已撤回事件不能支持新提交；历史导入可引用同数据域已核实的旧会话，保留原出处。

模型审批复用 Operation/AuthorizationRequest，但 world.change 用 AUTHORIZED --journal_apply--> SUCCEEDED，移除外部副作用的 DISPATCHED/RESULT_UNKNOWN/resumeWorldDispatch。Store 守卫仅允许 scope.import 与 world.change，分别验证其精确变更/结果/grant 组合。同帧消费 grant、写 World 记录与 world.changed/result、完成 Operation 并记录持久批结果，不生成 World 结果 Input、不唤醒 Main；owner UI/timeline 以及 Main 可调用的 memory_read world_batch 视图可见（batch_id，限当前会话，返回 PENDING/APPROVED/COMMITTED/REJECTED/EXPIRED/FAILED 及已提交结果 ID），不能只给 owner 查询路由。BASE_SYSTEM 明确提议/批准不代表事实已记录，Main 宣称写入前须查询 committed 状态；自然触发的下一 Main 批看到新 World。拒绝/撤销/24 小时到期复用在线及启动状态协调器，只有 scope.import 生成独立终态通知；其他外部操作语义不变。

模型只有一个 memory_propose_change 工具，changes 数组可混合实体创建/改名/别名和事实 ASSERT/CORRECT/RETRACT，不另建 memory_propose_entity。批内新实体本地引用由 HOST 归一为稳定 ID 并展示，新人物及其事实可一次批准。每批 1–20 项明确展示的 World 变更对应一次 grant：显示实体、值、topic、keywords、来源及证据引文。每个 ASSERT 在卡片渲染时重新 dry-run，显示已有 LIVE 组、 产生的 CONTESTED/POSSIBLY-CONFLICTING 及适用的 CORRECT 提示；实体行显示当前别名。预览标时间，最终结果记实际冲突状态，不暗示 ASSERT 覆盖旧事实。Main 可主动合并相关修改为一批；不能把不同工具调用悄悄汇成改变参数的批准。任一项不合法整批不生效。用暂存视图校验本批前面创建的实体引用，最终每条 Store 记录只提交一次；拒绝互相矛盾的重复修改。批/变更 ID 从工具调用稳定派生；同 ID 重试返回原结果，同 ID 不同内容由现有参数绑定拒绝。不再建 World request_id/request_hash/SQL 收据。恢复查找读取新 Operation/结果/记录，不再写 WorldCommand。本轮新 World 路径跳过历史通配/记忆规则，强制模型逐批批准，不新增持久绕过规则。认证 owner 可经公共 acceptor 直接应用，保留其通用命令收据和审计。

移除 world.coordinate/enqueueCommand。新 Settings payload 拒绝 World edits/command_ids，明确指向新的 World 接口，并更新调用方；不悄悄拆分混合请求。owner World 修改不重建 Consciousness。Settings 保留既有 owner 指令/运行配置及 Context/Consciousness/APPLIED 原子过程。旧 payload/命令可读，升级前必须在旧代码上完成。任务与意识记忆不重构。

所有 World 读取、画像、召回使用同一 Store 接口。分页改为有校验的 keyset，不再因任意 World 写入而全局失效；跨页是变化中的视图，不承诺快照。谓词改为带中英文标签、值 schema、主体类型、topic 与 retired 标志的版本化源文件，不允许模型动态定义本体。保留其余八个活动谓词，同时退役 height 与重复的 person.display_name，WorldEntity.display_name 是当前人物名称唯一来源；仅新增 guideline/note。本轮 guideline 主体限两条角色锚点，普通人物/服务不能经召回变成指令来源。历史 world.change 持久规则保留但对新路径惰性不生效。清理未使用的活动 DTO/World.read/查询模板前先查调用及持久 CAS；必要的旧解码器继续保留。旧 SQL schema、权限与历史材料不删。

## 四、稳定角色与派生画像

只写 system prompt 无法提供持久事实主体；另建可变资料库会重复名称/历史。推荐两条受保护的 Store 实体，role 唯一字段直接映射，配合角色选择器与派生上下文；无需新实体 kind 或额外绑定表。ID 从既有 CoreIdentity.owner_id 派生；Master 为 PERSON，Secretary 为 SERVICE。role:master/role:secretary 均支持主体和实体值，不依赖名称/别名。保留大小写不敏感的 role: 前缀，检查普通名称/别名及会同步到 Secretary 的 assistant/profile 改名入口；现有冲突名称先盘点，不能静默改名；普通同名返回歧义候选。

用中立公共 helper 提前初始化既有 CoreIdentity/AssistantProfile，不换数据域/owner。Store.stage 保护角色 id/kind/role/external_key 及不可退役状态，覆盖 owner 路径。不接管普通同名 Master 实体；ID/映射冲突交 Master 决定。Secretary 名称只有一个权威来源：既有 AssistantProfile；genesis 后 owner 改名与 World 标签同帧更新，普通实体工具不能另建竞争名称。Secretary 别名仍是 World 标签。不编造个人资料、凭据或权限。

本轮画像是确定性的摘录，不做模型画像摘要：挑选当前有效 LIVE 断言，按栏目排列，原文加事实 ID。Master：身份、指示、偏好、目标/项目、人物/组织、冲突。Secretary：身份、守则、受控资源、工作笔记。entity.note 提供 identity/goals/current_context/working_notes 等主题描述；只允许列入常驻名单的主题，不把任意 free note 或联系方式常驻。推断性的 Secretary 工作笔记明确标资料。只有 Master 来源 entity.guideline 可渲染为行为指示；批准推断并不把其来源升级为 MASTER。

Main 与 Settings 两处组装路径共用一个 assembler：BASE_SYSTEM（不变量/授权）→统一 Master 上下文片段（原样 UserInstructions 在前，派生画像在后）→Scope→按条件保留 FAILURE_SYSTEM→标注为资料的 recall。统一 assembler 必须保留现有结构化失败 prompt 及限制。现有 UserInstructions/默认中文语言称呼逐字保留，只渲染一次，不在两段 prompt 重复，也不自动概括成事实。prompt 明确它优先于 guideline；不声称能自动语义检测任意 UserInstructions 与 guideline 的冲突。以后把其存储迁入事实属于单独明确选择。本轮在呈现上将可变指令与画像整合，保留原指令权威。画像/召回都不能产生执行授权或覆盖 BASE_SYSTEM。

派生画像上限：Master 40 行/3 KiB，Secretary 20 行/1.5 KiB；按 UTF-8 计入引用/标签，不半行截断。UserInstructions 仍用既有限制，独立于派生描述额度，避免丢失最多 2000 个中文字符。冲突组整组呈现或整组省略并提供数量/读取指针，不把争议一方呈现为定论。超量显示 +N 与 memory_read 路径。联系方式和无结构自由笔记仅按需召回；画像/召回仅给 Main，HOST 不自动复制进任务材料。守则超量也明确省略及读取方式，不声称全部常驻；关键 owner 指令仍在 UserInstructions。

认领一批输入时计算一次画像/召回，MainPromptSnapshot 同 CLAIMED 提交精确 system_message 与可选 recall_ref（ID、分数、状态、策略、as-of 时间）。资料块有明确边界且不作为指令。工具接续/崩溃恢复复用快照，新增或纠正事实到下一批出现。纯函数生成，不新增摘要模型任务或长期过期缓存。所有组装、输入投影、压缩路径按完整配置的画像/召回上限预留预算，而不是只算当前长度；动态画像/事实/召回与 off/shadow/on 开关不进入 Settings.runtimeHash，代码策略版本和每批快照仍有版本约束。

## 五、默认 Shared 与持久任务目录

将 Shared 明确为内建虚拟 Scope，统一 admission/query/browser/prompt/packet 的解析和展示；保留 `scope_id=null` 兼容已有数据/API，并在视图增加 `scope_kind=SHARED`、`scope_name=Shared`。省略/null 自动选 Shared；显式无效或已归档 ID 报错。AGENT/PROGRAM、Main/API 入口一致；接续继承既有 scope，不允许换绑。

Shared 的每个 Task 独立使用 `data/core/workspaces/<task_id>/work`，接续保持同一路径。NONE 仍是独立命名分组；DIRECTORY 使用批准的外部根。不能把 Shared 改成所有任务共用一个目录，不能迁移/回写历史 Execution 的不可变绑定。

没有任何普通 Scope 时也向 Main 说明默认 Shared。task_query、详情 API/TUI、执行上下文与相关产物视图提供 Core 主机绝对路径、根类型、可用状态及 Scope 名称；尚未绑定的推导路径标作“计划位置”，不能冒充已验证目录。远程客户端明确这是 Core 主机路径，沿用 /open 安全限制。旧目录缺失/不安全要报错，不用新空目录掩盖。保持 CAS 固定交付及既有历史；完成/退役不删除工作区，也不把其他任务路径当成本任务可访问目录。


## 六、height、别名、冲突与出处

活动谓词文件将 person.height 及重复 person.display_name 标 retired=true；WorldEntity.display_name 为当前名称唯一字段，旧姓名断言仅作历史；新 ASSERT/CORRECT 拒绝，RETRACT 和明确历史读取继续支持。旧 002 SQL、事实、journal 和收据全部保留，不物理删除、不增加旧方案的 SQL 005。通用测试改用测试专用合理字段，不再生产环境补另一个垃圾字段。

统一 memory_propose_change 批提供普通实体创建与字段增量。改名携带 {from,to}，当前值匹配或目标已达成才成功，否则 STALE_BASE。别名用 add/remove，沿用 trim/去重/数量长度限制和大小写不敏感匹配；省略不动，不支持整表替换或 [] 清空。增删是幂等集合操作，两集合不能重叠；删除无效的 expected-membership 绑定，不声称检测 add-remove 的 ABA。批准卡显示当前别名，Master 明确批准是对涉及别名的最新决定。内部批准批按持久 authorization.decided 事件顺序应用，保证竞争决定有确定次序；不同别名可交换，同一别名相反修改不可交换；已达成结果为 no-op。kind/role/external_key 创建后 HOST 持有且不可改。角色不可退役；其他实体有 LIVE 主客体引用则拒绝退役。角色别名修改与普通实体一样要求真实 Master 证据。稳定调用 ID 防重复；不同实体共用外号仍返回歧义。

删除 fact_slot/值散列 scope_key。SINGLE 按主体/谓词分组；MULTI 加谓词目录的小型 topic。other 只代表未分类，不代表没有冲突。SINGLE 多个不同 LIVE 值为 CONTESTED；同一非 other MULTI topic 的不同陈述为 POSSIBLY-CONFLICTING，提示而不冒充语义判断。模型不自动合并/裁决。ASSERT 不因更新或来源权重高而自动覆盖旧断言；必须显式 CORRECT/RETRACT 当前目标，保留历史。解决多个冲突需在批准批中明确目标集合。来源/日期仅影响排序和显示，不授予覆盖权限。关系为直接主体/对象引用；当前冲突只包含查询时刻有效期重叠的成员。

去掉来源注册及首个事实 source_registration_required 的往返。acceptor 根据真实事件判定来源；guideline 只允许 role:master/role:secretary，且需要 Master 陈述或认证 owner 明确编辑，任务报告、模型推断和批准按钮本身不能冒充 Master 陈述。保留证据 ID、有效时间、观察时间；note 可空。历史 UNRESOLVED/epistemic/fresh_until 不丢。新观察可用 fresh_until 或显式目录时限标过期；过期是带时间的状态，不是假事实。Store 所有权、CAS、revision 回放、API 幂等和数据库访问权限继续保留。

## 七、可测量、可迭代的召回

自动和主动检索共用纯 recall(snapshot,input,config,asOf)。根据 Store 构建并按已提交变更更新内存词项/实体索引，重启可回放重建，不依赖 PG。ID/名称/别名/目录读取同源。查询取当前批输入文字，UTF-8 4 KiB 上限且不切断 Unicode；记录截断，不读取未检查附件字节。名称/别名 NFKC+大小写归一；拉丁词边界、汉字子串，自动链接至少 3 拉丁字母/2 汉字。短别名仍可显式读。歧义返回全部候选或明确截断的歧义清单，不择一猜测。

索引主体名称/别名、中英文谓词/topic 标签、完整断言、可选 note 和批准的 keywords。统一 tokenizer：拉丁≥3 的词及固定停用词表、汉字重叠双字；呈现完整语句以保留否定。候选来自实体链接与词项并集，不用整句 ILIKE。初始词汇分数为 IDF 加权查询词覆盖率，实体命中底分 .5；乘来源 MASTER 1/.9 OBSERVATION/.7 TASK_REPORT/.4 MODEL_INFERENCE 和时间权重（90 天内 1，衰减最低 .6）。初始阈值 .25，仅在开发题调参。keywords 是检索提示，不是额外事实。匹配的 LIVE person.member_of/resource.depends_on 允许一跳扩展，visited 去环，最多 20 条关系候选，不递归；扩展结果也经过全部过滤与排序。

每次新画像/召回构建及显式读取检查当前证据撤回状态：全部支持证据已撤回则标 EVIDENCE_WITHDRAWN，排除常驻及自动召回，显式/历史读取仍显示原证据及标记。部分撤回也标注，不提升来源；指示须有剩余有效 Master 支持。既有冻结快照作为审计不追溯改写，新事实提交仍重新验证出处。

硬过滤：LIVE、主客体未退役、valid_from≤asOf<valid_to（若设置）。被 supersede/retract、未到/超出有效期只在明确历史请求出现。退役谓词不自动召回/常驻。冲突按组选择：全体当前成员一起出现，放不下则整组省略，给预算内的未决组读取指针，不能截掉反方。过期观察显示时间且靠后，不称当前事实。与画像去重时仍保持冲突组完整。

自动召回最多 12 条/1.5 KiB、每实体最多 5 条，所有标题/引用/指针算额度。长语句整条省略给读取指针，不截掉否定和限定词。recall_ref 明确 hit/no_hit/unavailable；no_hit 不注入事实块。只有 genesis 未完成/World 状态错误才 unavailable；genesis 后 PG 故障不影响 World 召回。BASE_SYSTEM 要求引用实际读取的事实 ID、没命中不代表不存在、召回资料不给权限。memory_search 加 kinds:[fact]，共用排名和显式 history 开关；memory_read world 加事实 ID/主体/谓词/topic 及实体/角色/谓词目录。原日志搜索独立，可报告 PG 故障而不禁用事实读取。

验收题集：40 开发题；在明确候选提交冻结 tokenizer/权重/阈值后，由 Codex 编写 40 道保留题，再运行。保留题不随结果改期望，失败结果保留，实施复核把 fixture/证据交 Fable；不声称独立作者。覆盖名称/外号、歧义、无姓名改述、跨语言、否定、纠正/撤回、时间/过期、冲突、无相关事实、一跳关系。纯内存 fixture 不开 App/Core；集成/崩溃测试在托管 CI。首轮不自动挖掘历史 journal；由 Master 主动提供及明确标记的验收事实播种。

40 保留题固定分配：名称/别名 10 题至少 9 题通过；歧义 4 题全部正确标明；改述 3、跨语言 3 仅报数量不设门槛；否定 2、纠正/撤回 3、有效/过期 3、冲突 2、一跳 2 各类全部通过；应为空 8 题至少 7 题为空。正例须包含全部预期事实/组 ID 和标记且无禁入 ID；fixture 在预算内，超量冲突组另测。总门槛：禁止的旧/无效/全证据撤回 ID 零泄漏；过期/冲突不冒充唯一确定事实；预算不超；记录 CI 硬件、1 万断言合成规模下纯召回 p95≤50ms，否则优化后再开启。报告各类别 precision@K/recall@K、时延、字节、内存与启动开销。改述/跨语言本轮明确作为不设硬门槛的词汇基线限制：双语标签/keywords 有帮助但不宣称通用语义召回；重要类别漏召回须说明，embedding/新 provider 需另有证据支持的提案。真实模型回合验证使用与引用，不只看命中 ID。

owner-only、只读 POST preview 将文本放 body，避免 URL 查询串带原文；不写 journal、不调用模型。profile off/on、recall off/shadow/on 随快照记录且不进 runtimeHash。先 shadow、跑固定题，再受控开启真实回合。shadow 的“模型后来查了什么”仅诊断，不作正确性标签。

## 八、完整简化清单

| 清单编号 | R4 处理 |
|---|---|
| A1 | 删除普通 World 写入触发 Settings 摘要和阻塞。 |
| A2 | 删除活动 SQL 权威/receipt/outbox/batch 桥；使用 Store 记录和内存索引，不建 World PG 投影。 |
| A3 | 切换后 DSN 不进入认知运行指纹；日志搜索配置/就绪独立。 |
| A4 | 保留通用精确参数 Operation/grant 审批，删除 World dispatch/unknown/resume。 |
| B1/B3 | 删除 slot_revision/expected slot revision/world/slot，保留当前目标 ID 校验。 |
| B2 | 删除 World 专属计数器，保留 Store revision；用改名/涉及别名增量避免旧整行覆盖。 |
| B4 | 删除活动 World SQL 写锁，保留必要旧迁移锁和 Store 所有权。 |
| B5 | 校验 keyset 分页，不 count(receipts) 全局失效；原 API 游标解析/防篡改仍在。 |
| B6 | 稳定 change ID 加既有 Operation/请求绑定，不再单独 World request/hash/receipt。 |
| C1/C3 | 使用事实证据 event ID，去掉活动复制 CAS 身份和证据关系表/触发器，历史元数据保留。 |
| C2/C4/F1/F2 | 统一提交验证器，提议 dry-run 复用，所有入口覆盖。 |
| C5 | owner 请求出处和模型修改可追溯性保留，不引入来源注册仪式。 |
| D1/D2 | 删除 REGISTER_SOURCE 和首次事实两阶段，来源从事件推导。 |
| E1/E2/E3 | 活动路径删除冲突/member/state SQL 表；冲突派生，Store 断言保留 live/superseded/retracted。 |
| E4 | 直接主体/谓词/topic，无 slot/值散列；单值 ASSERT 不自动覆盖。 |
| F3 | 不新增 World SQL 不可变触发器；旧 wm/数据库权限不动。 |
| G1–G4 | 删可派生的重复字段/未用枚举；保留旧 epistemic/freshness、有效/观察时间与可选 note。 |
| G5/G6 | 审计后清理未用活动 DTO/测试专用读取路径；旧解码器/CAS 兼容和历史证据保留。 |
| G7 | 只有一个生产 World 接受路径。 |
| G8 | 保留不可变 external_key/角色身份。 |
| H1 | 不重写/重置 live SQL；一次明确 genesis 导入 journal，旧 wm 保留。 |
| H2 | World 恢复权威为 journal+CAS；完整实例备份范围不缩。 |

## 九、非破坏性切换与启动

在精确旧代码下盘点全部旧 World 表、待处理 command/operation/grant、Settings draft/application 与未导出 outbox。不能假设九月记录属于当前实例。门槛：无非终态 SettingsApplication、无任何非终态 WorldCommand（含未知状态）、outbox exported_at NULL 为零。待批事项由 Master 决定，不能为过门槛自动取消。陌生/不一致数据或身份映射先报告，不 reset。未应用 draft 保留并呈现需手动适配之处，不静默丢弃。停机前 Main 无 active_loop_id/CLAIMED。

新代码首次启动，在任何新 World 记录或 SQL 修改、auth.recover 之前做纯 Settings 兼容/空闲检查，不换 Store/Core 身份。对本升级实例用一个 REPEATABLE READ 读取旧 wm；原始全部行/元数据进入受保护 CAS 清单，核对实体/断言 ID、证据/CAS、最后状态/值、已导出的 world 事件。保留原 UUID 和历史状态；ACTIVE/SUPPORTING/CONTESTED→LIVE，冲突重新派生。不能只看活动行或 API 零页就认为完整；包括退役/撤回及 source/receipt/conflict 历史清单。差异阻断 World 导入，不连带阻断无关 Core 能力。

全部验证后，同一 journal 帧提交导入实体/断言、受保护角色和 WorldGenesis（稳定 ID、数量、digest、manifest 引用），重试不重复。零行可作为核实后的正常导入。fresh/legacy 根据 journal 证据及确认的 schema 存在性判断：已有数据域具有旧 journal/配置证据时选 legacy，即使目录为空；只有明确新建数据域、无旧证据且确认没有 wm schema 才 fresh。PG 不可达不能证明不存在。未完成时 Core 状态/TUI/恢复可用，prompt 有确定角色引用，World 工具/画像/召回报告 legacy-import-pending；Main/新任务认领还必须通过下述独立 runtime Settings 激活门槛；single-flight 有限退避。genesis 前不接受新 World 写入。若超安全帧大小或意外映射，暂停该切换并制定有界迁移，不未经复核拆成半导入。迁移测试使用隔离合成数据域，不使用或复制 live agile 运行数据。

genesis 后旧 wm.* 全部保留但不再被新 World 读写，去掉 launcher 反复 world.migrate。新增明确 mem-only 初始化器 src/schema/memory_search.sql，由 initializeMemorySearchSchema 调用，只含幂等 extension/mem 表/索引/checkpoint 与既有权限，不含 wm.entity ALTER 或 wm.schema_version INSERT。历史 004 不改，新启动/CI/新域使用 mem-only 文件；这是日志索引 SQL 初始化，不是新的 World SQL 迁移，不把旧 wm baseline 再执行到归档数据。PG 仍随同一实例启停，凭据/权限不变。World 无 DSN 也存在；mem 的域/来源/策略/digest 检查保留，不借机截断旧 wm。失败关闭连接。正常部署必须 genesis 完成、首次 runtime-change SettingsApplication APPLIED 且 World 可用，不把一直降级/Settings 阻塞算完成。

旧记录/Settings payload 保持可回放可读。live commit/API admission 拒绝新旧格式 World 写入；不能在回放也用的 stage 中无条件拒绝旧类型。注册新引用、sync world 失效；Store.stage 校验形状/不可变角色/断言和对应动作整帧约束。顺序：Store.open/回放→既有 task/core/profile 身份→纯 Settings/空闲门槛→legacy/genesis readiness→授权恢复/新内部到期协调→Scheduler 恢复→Host/App/Settings 构建→排队的 runtime-change Settings 激活→APPLIED readiness。本次 BASE_SYSTEM 与指纹组成改变，旧会话会排一次正常 runtime-change SettingsApplication，调用既有摘要模型，APPLIED 前阻塞 Main/新任务认领；之后普通 World 写入不会再触发它。维护/激活估时须包含模型与重试的可变耗时，实测报告、不承诺固定分钟数；状态/TUI 可看。失败走相同新代码/配置下的现有显式 Settings 重试，不强改 hash、丢应用或绕门槛；已越新 journal 边界只能兼容/向前修复。Settings 需要的日志搜索就绪纳入激活；激活后 PG 故障可影响日志搜索，不影响 World 事实。

首次新增 WorldEntity/Assertion/Genesis/snapshot 或 journal_apply 帧就跨过旧读者单向边界，即使画像/召回关着也一样。在此之前回退旧代码还须无新导入/World 待批 grant、无未处理的新结果 Input；之后只向前修复/兼容构建。不得用旧备份覆盖较新数据。

## 十、常规实现、验证与交付

Master 在新会话启动实施后，先核对 secretary-core 的最新 origin/main、无关改动与子模块；按需要建立独立 worktree/checkout，使用 codex/ 功能分支。保留无关改动，按功能分支 → PR → CI → 复核 → Master 裁定交付，不推 remote agile、不建 agile→main PR。运行中的敏捷源码、守护、配置、数据库及运行目录不动。预期不改依赖/子模块；必要变更说明理由并验证。

先跑针对缺陷的回归，再执行生成合同/文档/类型检查及仓库要求的完整检查（包括 npm run verify 和相关托管 macOS/Linux 检查）。本常规迭代允许在本地用独立合成数据、明确的测试数据库名/DSN 和端口启动 Core/PG，运行完整测试；禁止向测试/清库 helper 传 agile DSN 或运行目录。生成物从源定义生成，历史解码器与报告保留。覆盖 journal 回放、撤回、过期修改、授权、并发/崩溃边界、Settings 分离、角色保护、画像指令来源、别名、召回和迁移。使用非空合成 legacy fixture，验证导入重试、outbox/Settings 未完成、PG 不可达、首次激活及向前恢复，不只验空库。

完成构建后必须实际拉起测试。项目经 tsx 运行，按实际 package scripts、生成/类型校验和精确源码启动验证，不虚构 bundle 命令。启动独立常规验收实例，使用合成数据；记录 commit/tree/config、genesis readiness，以及升级会话 fixture 的首次 Settings application ID/状态/模型耗时。进程存在不等于就绪。保留首次失败与持久证据，测试数据的保存/清理明确记录，绝不触及持久敏捷实例。

验收覆盖 Main 导入 Scope 的批准/拒绝/撤销/到期；角色/守则/名称/别名；首事实一次批准写入且不绕来源注册或普通 Settings 摘要；画像下一轮更新而工具接续/恢复保持快照；固定开发/保留题及真实模型引用；两 Shared Task 同名文件隔离、接续读原文件；受控重启后事实/别名/收据/任务文件仍在。DIRECTORY 根使用 Core 测试数据外的持久目录。按 PASS/FAIL/NOT_TESTED 记录证据与精确 SHA，区分自动化/API、原生终端 TUI、真实 provider 和 Master 手动验收。现有 TUI 只有通用 attention，无专用 World 编辑器；验证批准/详情与 owner API。

逐项审计 Scope 结果的 ENVIRONMENT 消费：main-loop 准入/actor/分批/活动；main-tools 权限与失败白名单；input-origin/projection；settings-memory/memory-extraction；historical-inputs；memory-search；conversation/timeline；activity/attention；附件出处。input.accepted actor 显式为 HOST，不落当前 SCHEDULER 默认分支；摘要/投影保留 producer，不升格为 Master 证据。World 结果不产生该 Input。

记录 PR HEAD 与 CI 实际检查的 head/merge SHA/tree，处理基线变化并验证最终交付源码。在指定复核会话复核最终实现 HEAD；CI、源码审阅、原生验收、真实 provider 证据分别记录。合 main 需 Master 单独授权；获准合并后另查 main CI。不因已有 PR 或 CI 全绿就自动关闭 issue；总跟踪 issue 负责组合验收并关联各子项证据。

部署已有生产数据域不是本常规实现的自动步骤。若 Master 后续明确授权更新 secretary-agile，须再次确认目标、维护窗口与精确获批/实测源码，再执行第九节；保留同一数据域和全部迭代数据。先盘点工作/授权/Settings 及全部记录文件，静止写入而不取消工作，干净停止 Core 和专用 PG；在 live 根外完成并验证全量冷备份（PG、journal/CAS/workspaces、TUI、私有配置凭据、外部 Scope、源码配置清单），不启动备份成为第二个 agile 实例。未知映射、无法静止的外部写入、破坏性迁移先处理。跨新格式首条记录前准备兼容向前恢复，不用旧快照覆盖新数据。部署时重查维护/守护语义；此前观察到 start 提前清维护标记，失败时需恢复维护避免循环重试。恢复同一实例，核对真实 readiness/数据身份，保持运行、不加累计配额，保留全部敏捷验收数据；恢复受阻立即报告。本次搬迁计划与登记 issue 不授权此部署。

## 十一、复核记录与最终门槛

Opus 5.5 Extra 首两轮要求修订，R3 对较窄方案 PASS：已补原子 journal_apply、ENVIRONMENT 完成、在线到期、早期 Settings 空闲检查、候选源码隔离、精确 tree CI、真实旧读者边界。原文/截图仅保存在忽略的 .local/reviews/agile-iteration-01/。

Master 追加指定 Fable 5.2 High 会话 https://claude.ai/chat/36d65a61-76d2-48ef-85b8-726b2eda7a24 。Fable 源码审阅提出 A1–H2 及 Store-only World；接受 Codex 关于统一校验、字段增量、历史保全、完整备份、固定题集的修正。该轮是设计建议，不是最终 PASS。R4 整合并修正同别名相反修改、取消 SINGLE 自动覆盖、无损统一 UserInstructions 呈现、冲突组超限处理、一跳扩展与旧解码器。Fable 已复核至 R5 并给出 PASS，见第十三节；中文版由 Codex 对齐，不冒称 reviewer 已查中文。源码审阅不等于运行验收；实现/CI/真实验收均待执行。实现留待新的常规迭代会话；live agile 部署与合 main 分别授权。第十节替代历史敏捷工作流。

## 十二、Fable R4 处理与 R5

Fable 给出 CHANGES_REQUIRED（窄范围），认可架构、完整 A1–H2 与切换。R5 落实十项：去掉无效别名 membership 绑定并明确决定顺序；统一混合批工具；批准显示冲突后果；退役重复 person.display_name；guideline 限角色；证据撤回感知读取；固定分类题数；首次 runtime Settings 激活/恢复；mem-only 初始化器；World 默认不自动唤醒、Scope 终态唤醒的明确选择。非阻塞提醒也已纳入：完整上下文上限预留、ENVIRONMENT/HOST 消费审计、观察不自动覆盖、指令优先级不冒充语义检测、fresh/legacy 判断、旧规则留存不生效。保留题仍由 Codex 编写并说明局限，不自行增加子代理或作者。这些仍是计划，非已执行证据。

## 十三、最终复核结论（2026-11-12，香港）

Fable 5.2 High 对 R5 给出 **PASS for plan readiness**：十项必改关闭，无新增阻塞。会话：https://claude.ai/chat/36d65a61-76d2-48ef-85b8-726b2eda7a24 。实际提交 R5 原文、回复、截图已私有归档；本交付副本仅加入 reviewer 非阻塞提醒及审批摘要：保留 FAILURE_SYSTEM，Main 可查批状态且“提议不等于已记录”，assistant/profile 保留前缀检查、文案更新，并把四项重要选择提升到第一节。

Fable 跨轮次核查了 World 写入、Settings、prompt 快照、Store commit、memory-search schema 和撤回。Scope 导入内部、Shared、部署只检查相互影响，沿用此前 Opus 窄范围 PASS，不宣称两次独立穷尽审计。它未独立核实中文或 live 状态。Codex 已同步中文，并只读确认同一 Core 仍 IDLE、域/实例 ID 未变；没有产品测试、CI、迁移或重启。

下一步由 Master 按交接说明与关联 issue 新开会话。本次仅迁移/改类计划及登记 issue，未开始实现；按第十节执行常规实现与测试。合 main 和持久实例部署分别决定。原始复核证据保留在原私有忽略目录。
