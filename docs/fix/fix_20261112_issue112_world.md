# #112 执行计划：World 持久记忆、角色画像与召回

日期：2026-11-12（香港）。来源：[#111 R5 总计划](fix_20261112_issue111_world_model_scope.md) §3–4、§6–9；本文件将已复核方案按执行顺序展开，保留已完成实现的追溯记录。[English](fix_20261112_issue112_world.en.md)。

**当前状态：已实施并合并。** [Issue #112](https://github.com/ExplodeCode6324/Secretary/issues/112) 已关闭；[PR #115](https://github.com/ExplodeCode6324/Secretary/pull/115) 合入 main `301d8a59af2e1ef44076beda10022f2db7627d5c`。下列步骤用于审计与后续联调，不要求重复迁移或重做已完成代码。Scope 导入由 [#113](fix_20261112_issue113_scope.md) 实施，Shared 由 [#114](fix_20261112_issue114_shared.md) 实施。

## 执行顺序与落点

1. **建立 Store 权威及角色不变量。** 从 Stored 源定义生成 WorldEntity/WorldAssertion/WorldGenesis 合同；补 Store 回放、引用、sync 失效与整帧守卫。由既有 CoreIdentity 派生 Master/Secretary 固定角色，不接管普通同名实体；AssistantProfile 保持 Secretary 名称唯一权威。断言正文/证据不可改，纠正通过新增与 supersede 同帧完成。
2. **统一提交、预览及逐批批准。** 在 `world-accept.ts`/`world-invariants.ts`/`world.ts` 统一 authority、证据、字段增量与目标检查；一次混合实体/事实批对应一次精确 grant。同步最终验证后原子提交 grant 消耗、World 记录、Operation/结果；重试不重复。`journal_apply` 按动作守卫，当前不能提前开放未实施的 `scope.import`。撤销/到期/失败持久可查，World 结果不产生 ENVIRONMENT Input、不自动唤醒 Main。
3. **切离 Settings 与旧 SQL 活动路径。** 新 Settings 请求拒绝 World edits/command_ids，保留旧记录解码与通用 Settings 摘要流程；移除 World dispatch/outbox/slot/专属计数器等活动依赖，旧 SQL schema、数据、权限及历史测试保留。普通 World 写入不重建 Settings/Consciousness。
4. **完成非破坏性 genesis。** `world-import.ts` 在恢复授权或写入前检查旧 Settings/command/outbox 空闲；只读 REPEATABLE READ 导出全部旧行与元数据到 CAS 清单，验证证据和最终状态，再一帧提交角色/实体/断言/genesis。未知 schema/不一致映射/过大帧停下报告；不按空 API 推断 fresh、不因 PG 不可达认定无历史。mem-only 初始化不修改旧 wm；首次升级 runtime Settings 激活成功后才放行 Main/新任务。
5. **统一读取、画像、提示快照与来源。** `world-memory.ts` 与 Main/Settings 共用组装路径；UserInstructions 原样只出现一次，保留 FAILURE_SYSTEM。在 CLAIMED 同帧冻结完整 prompt/recall，工具接续及恢复不重算；预算按完整上限预留，动态事实及开关不进 runtimeHash。guideline 仅限角色且必须有明确 Master 来源；批准按钮不提升推断来源。
6. **接入有界词汇召回。** `world-catalog.ts`/`world-recall.ts` 统一名称/别名/标签/keywords 索引、有效期与证据撤回过滤、完整冲突组、一跳关系、历史读取和预算指针；memory_search fact 与自动召回同源。owner POST preview 只读；默认 shadow，固定政策后跑保留题再判断启用。
7. **接通公共接口与保留历史。** Main 混合批工具、owner API、批状态查询、合同/文档及本地化同步；批准卡展示精确变更和冲突后果。height/display_name 退役但历史可读，aliases 增量更新及改名 from/to 保留 stale 检查。清理活动接口前查持久 CAS/旧解码依赖。

## 测试矩阵与实际完成情况

| 场景 | 验证位置 / 要求 |
| --- | --- |
| 无 PG、角色保护、混合批、拒绝/到期/旧 owner、顺序竞争、撤回 | `test_case/offline/issue112/world.test.ts`；整批失败零部分效果，批准事实和模型推断来源不混淆 |
| owner API、只读预览、Secretary 同帧改名、Settings 分离 | `issue112/api.test.ts`；预览无 journal 副作用，普通事实不触发 Settings |
| 非空旧数据、重试/启动中断、首次激活、PG 不可达 | `issue112/migration.test.ts`、`review-r1.test.ts`；旧值/ID/历史元数据保全，genesis 恰好一次 |
| prompt 冻结、撤回、提交前后 SIGKILL/回放 | `issue112/snapshot.test.ts`；恢复复用快照，无重复提交 |
| 40 开发题及 40 固定保留题、冲突/否定/时间/规模 | `issue112/recall.test.ts`、`heldout.test.ts`；完整分类门槛见下方 R5 摘录与召回报告 |
| 外部 Operation、日志 SQL、Settings 和附件独立能力 | `issue25/transitions.test.ts`、`issue21/{crash,read,world}.test.ts`、既有 Settings/附件回归 |

最终实现 HEAD `83f9c1394db15c574c2a1f5c23260e9fc9dc6191` 经 Claude Opus 5.5 Extra R3 源码就绪复核 PASS；前两轮关于升级恢复、回放、历史状态、空闲扫描及 guideline 证据绑定的问题均已处理。记录见 [PR #115](https://github.com/ExplodeCode6324/Secretary/pull/115)、[测试覆盖](evidence/issue112-world/acceptance.md) 与[召回评估](evidence/issue112-world/retrieval-evaluation.md)。这些附件保留形成时原文，授权和完成状态以本节及 PR 最终记录为准。

- 本地完整验证 1135/1135 通过；追加隔离回归 48/48 通过。
- 非空隔离 PG：100 联系人、500 条多状态旧断言；迁移前后旧 wm 行及列/约束定义摘要一致。验证一次 genesis、原子批失败、无 PG 重启与继续写入、重连后日志搜索；最终 103 实体/502 断言。专用测试库已清理，PG 已停止，合成证据保留。
- 40 保留题 38/40，硬门槛通过；无姓名改述 1/3 是明确局限，不宣称通用语义/跨语言召回。原 10,015 断言门槛通过；更大实体索引冷启动和热路径成本单独披露，不混为同一规模结论。
- 隔离 CLI 启停/重启及有限真实 provider 引用场景通过；原生 Terminal 操作未测，真实用户记忆验收未做。[合并后 main CI](https://github.com/ExplodeCode6324/Secretary/actions/runs/43141195887) 通过。

Master 已在隔离测试通过后授权并完成本项合并；该授权不自动覆盖 #113/#114 或 agile 部署。

## 验证、交付与数据边界

执行时先刷新 `origin/main`、核对工作区及项目说明，使用独立 `codex/` 分支。先验证针对性回归，再运行生成合同/文档检查、`npm run verify` 和 required Linux/macOS CI；生成文件从源定义更新。记录候选 HEAD、CI 实测 head/merge SHA/tree、首次失败及修复依据。构建/类型检查后实际启动隔离 Core；使用独立合成数据域、回环端口和专用 `secretary_test_*` 数据库，检查 readiness，而不以进程存在代替就绪。不得向测试清理工具传入 agile 路径或 DSN。

按 secretary-pr-fix 在原指定 Claude 会话复核最终实现，区分 reviewer 源码结论、自动化/API、真实 provider、原生 TUI 和 Master 验收。逐项记录 PASS/FAIL/NOT_TESTED。Master 已将本系列真实记忆和原生交互组合验收留到全部完成后在 agile 进行；隔离后端测试仍必须完成，不能用空实例代替非空合成数据验证。当前文档拆分不代表新一轮技术复核，也不代表 #113/#114 已获实现或合并授权；实现交付按 Master 当时指令执行，合并后确认 main CI。

保护正在运行的 agile 及全部 journal/CAS/数据库/任务目录/配置，当前任务不部署、不重启、不复制真实数据。未来部署另经明确授权，按总计划 §9–10 盘点待处理状态、静止写入而不取消任务、验证全量冷备份、保留同域身份并执行非破坏性升级及 readiness 检查。跨新格式 journal 边界后只向前兼容修复，不用旧备份覆盖新写入。#111 保留组合验收及跨 issue 数据恢复门槛。

## 保留的 R5 技术合同

以下逐字摘录总计划对应章节，保留原节号；它们是技术要求，不是新增测试证据。公共交付/恢复要求仍见总计划 §8–10。未来若 Master 调整方案，总计划与对应子计划同步修改。

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
