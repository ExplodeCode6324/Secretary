# World Model 管理与设置生效规范

当前通过认证 local-owner 的 [Core API v1](api/v1/README.md)访问 Settings 与 World。实现依据：[Settings](../src/pi_secretary/src/settings.ts)、[完整来源整理](../src/pi_secretary/src/settings-memory.ts)、[World](../src/pi_secretary/src/world.ts) 和 [ApplicationService](../src/pi_secretary/src/application-service.ts)。旧 Web/TUI 不是当前操作入口，原界面报告只提供历史证据。

## 统一规则

凡改变 Secretary 模型行为、提示词或有效 World 知识的设置，必须先完整整理当前工作上下文的未摘要部分，再初始化 context，完成后才处理下一轮输入。新设置入口必须接入 Settings 协调器，不能直接修改有效记录后声称下一轮自然生效。

当前接入范围：API Settings 草稿内的 World 修改和 Secretary 说明，以及模型提出并获准的 WorldCommand。助手显示名属于 AssistantProfile，不触发本流程。启动时检测主/任务模型身份与容量、基础和执行提示词、数据库连接配置哈希及模型预算/整理/并发选项变化，自动排入同一流程。凭据原文不放入设置记录或摘要；界面布局、主题不触发整理。授权撤销和安全阻断仍按原守卫立即执行。

首次空会话记录运行配置哈希；已有上下文的旧数据目录缺少哈希时会执行一次切换。若存在未完成应用，必须先用原运行配置完成恢复，再更换模型或数据库；启动时拒绝用不同配置恢复一个提交结果未完成确认的批次。主会话与新任务调度在切换完成前暂停领取工作，已有异步任务不被重启。更换模型不会使旧任务 checkpoint 自动兼容新 provider。

## 公共查询与数据语义

World API 提供目录/事实分页、当前和历史事实、详情与来源；更正/撤回通过 Settings 草稿提交。类型、引用和 revision 由领域代码校验，客户端表单尚待实现。可以先创建实体草稿，再为它登记同批事实。实体类型不可修改，停用实体时如存在 ACTIVE / SUPPORTING / CONTESTED 状态的事实或关系引用，整批拒绝并列出引用，不级联删除。

事实撤回将 `wm.assertion_state.status` 改为 `RETRACTED`；更正新增 assertion 并将旧陈述标为 `SUPERSEDED`。原始内容、证据、来源、回执和历史上下文仍保留在原存储。默认查询排除撤回和被替代记录，并检查有效时间；历史查询同时解除状态及有效时间筛选。撤回不表示相反事实，也不是彻底删除个人信息。

`world/facts` 与 `world/catalog` 默认每页 30 条、上限 100，catalog 支持 entities/predicates/sources。事实游标绑定查询范围及数据库读版本，API 再按服务实例签名；版本变化或重启后可能需要从首页重查。World.read() 模型工具仍有独立读取边界，客户端分页不表示模型可以无限遍历。

草稿保存为 SettingsDraft，领域校验最多 50 项 World 修改（公开 DraftCommand.edits 结构上限为 100，但 SettingsPayload 的 50 项限制仍会执行），可同时携带一份 Secretary 说明。草稿 CAS 防止多页覆盖；说明最多 2000 个 Unicode 字符，空文关闭自定义部分，相同有效说明不产生变更。应用冻结批次，清空工作草稿供下一批编辑；失败批次的原内容仍在 SettingsApplication，可以重试或恢复为草稿，但不能借此清除承诺提取来源的失败/未知结果，具体限制见下文。保存命令整份替换草稿 payload，后端对批次按给定顺序执行并检查 revision；前端如何合并编辑不属于当前已实现能力。

local-owner 提交 settings/apply 即明确应用本批内容，领域证据仍使用 MASTER_UI 标记，不再为同一人工批次建立第二张授权卡。该标记沿用内部命名，不意味着旧界面仍在运行；模型提案仍经 Operation/Authorization，不能冒充 owner 管理命令。

## 切换顺序

1. 持久化 QUEUED 应用及请求幂等回执，阻止主会话领取下一批输入，等待当前轮次和已有整理结束。未恢复的 CLAIMED 输入或未配对工具结果必须先解决。
2. 固定当前 Context、Consciousness revision、事件截止序号。合并全部 pending_raw_refs、当前 context 和未覆盖的主会话消息事件，按稳定事件 ID 保留不同事件，旧快照以消息出现次数承接，不能把同文不同事件合并；已有事件覆盖边界防止重复。重建时生成的记忆/设置包装消息标记为已覆盖，后续不重新摘要这些派生包装。
3. SUMMARIZING 按完整消息 JSON 分片并合并短片输入模型，逐片携带前序记忆和即将生效的设置变化。每片最多尝试两次，按较大重试输出预算冻结来源；候选和已完成片数逐步持久化。全部摘要片段完成后才独立提取承诺，完整消息装不下时明确阻塞；成功提取复用，失败或未知尝试不可因重启、改账本或加来源而自动重发。不会只保留工具输出开头就标记整段已覆盖。
4. 检查结构、覆盖、承诺和源版本，预先构建并检查新 context 容量。无新增来源且无旧记忆时不制造摘要模型调用。摘要候选不提前成为有效 Consciousness。
5. COMMITTING 在一个 PostgreSQL 事务内执行本批 World 修改，保存 `wm.settings_batch_receipt`、逐变更回执和 outbox。语义或版本冲突导致本批事实全部回滚。
6. REBUILDING 完成 outbox 桥接后，一次 Store 事务提交新的工作记忆、有效说明、Session context 指针、运行配置哈希和 APPLIED 状态。最后放行排队输入与新任务调度。

切换期间的新消息和任务反馈继续可靠持久化，归入截止序号之后的队列；不让持续到达的新消息无限使本次候选过期。原始历史保留，新 context 由当前 system、工作记忆、设置变化记录和历史 Master 输入约束档案构成，不复制旧的整段 assistant/tool 对话。

为避免摘要遗漏删除明确约束，当前实现保守保留已处理 Master 输入的完整文本，标记为历史材料而非待执行请求。旧偏好/事实不能覆盖当前设置；World 更正和撤回作为独立变化记录承接。承诺台账继续由宿主持有。材料进入摘要不证明模型语义完全无损，真实模型质量需另行验证。如果必要输入档案和记忆仍超过上下文容量，应用在数据库写入前失败；当前没有自动舍弃原始约束的机制。

历史档案在后续上下文压缩中同样属于必须保留的输入证据：投影按成功设置的 Context 消息 CAS、冻结来源和原 Input 记录核验身份，保留原文及历史材料说明，跨重启继续生效。仅有相同文字前缀的普通消息不能获得档案身份；已匹配档案的证据损坏则停止投影，不能静默删除原文。必要档案超过后续模型容量时仍停止发送。

旧裁剪映射若仍匹配完整 checkpoint，却删除其中已认证的历史档案，将被弃用并重新计算。若修复前原文已经从后续完整 checkpoint 消失，本次不自动重建这类历史受损数据；该恢复场景不属于本轮通过证据。

当前历史全部已覆盖、没有新消息时，设置来源仍保存明确的空提取证据。该证据接受与非空来源相同的匹配校验，但不产生新的承诺提取调用；既有承诺继续保留。

## 失败与恢复

| 状态 | 行为 |
| --- | --- |
| FAILED | 确定尚未提交有效变更；旧 context/有效说明保留。可重新排队应用，但已失败/结果未知的同一承诺提取来源仍禁止再次调用；人工批次可恢复为草稿，重新查询修正版本冲突 |
| BLOCKED | 提交结果未知，或已提交但未完成桥接/重建；保持会话 gate，先查回执再继续 |
| COMMITTING / REBUILDING 重启 | 自动从持久阶段恢复；先查询回执，不能盲目重写 |
| SUMMARIZING 重启 | 用固定来源和持久候选继续剩余分片，不提前更新有效记忆 |

查批次回执使用与提交相同的数据库事务锁；必须等待正在进行的提交结束，才可判定回执不存在。不存在且能确认结果时可报告 FAILED；数据库不可访问时保持 BLOCKED。模型 WorldCommand 遇到可确认回滚的暂时数据库错误时保留 RETRYABLE_ERROR，人工重试仍查回执并复核原许可，不消费为永久业务拒绝。提交成功后不能通过取消、清空记录或删除历史伪装回滚；恢复旧设置应再提交一次反向变更。当前 API 不提供取消正在应用 Settings 批次的命令。

承诺提取另有持久化的来源级保护：同一来源的 FAILED/未知结果不会随设置批次重新排队而解除。`settings.retry`、`POST /api/v1/session/compact` 和进程重启都不提供解除入口；再次遇到该来源仍停止提取并报告 `COMMITMENT_EXTRACTION_REPLAY_BLOCKED`。新增来源、改账本或恢复为草稿也不能绕过该限制；成功来源则复用已有结果。Issue 4 的独立显式恢复入口只授权预检选中的一个失败分组，精确绑定旧 attempt、来源、配置与 revision，不能把设置应用的“可重试”理解为允许重新调用失败来源。已有提取 attempt 的 FAILED 应用，普通 retry 保持原 FAILED 记录，并在 error 中明确返回 `MEMORY_EXTRACTION_RECOVERY_REQUIRED`，保留固定候选并引导到该独立入口；即使提取已经成功而后续提交失败，也只做原批次确定性对账，不清空来源重新摘要。恢复使用原 SettingsApplication 的固定来源与候选，先对账 World 批次回执，不重复提交 World，不重新生成摘要或扩大到未授权来源。跨设置/主流程身份、未知结果与旧来源歧义处理见[容量与记忆规范](memory-and-prompts.md)。

普通人工修改失败时可继续旧配置下的工作。启动配置已经变化但重建失败时仍保持 gate，需重试成功或恢复原配置，不能在失败后直接使用新模型。切换运行配置前如有未恢复的主会话轮次，应先在原配置下恢复它。

普通单来源 `POST /api/v1/session/compact` 使用 CompactionJob 的 WORKING_MEMORY 增量更新，并仅在容量阈值到达时另记 CONTEXT_COMPACTION 裁剪；发现多个 pending_raw_refs 时转完整来源流程。自动、手动整理与设置应用不能并发提交记忆。`GET /api/v1/memory` 返回维护状态，`GET /api/v1/settings` 返回应用状态；成功状态不等于模型摘要语义质量合格。

## HTTP API

所有请求按 Core 的 loopback Host/Origin 与 bearer owner 认证；client 登记不是权限来源。POST body 上限 1 MiB，必须包含 UUID request_id。revision 在公开 DTO 中为十进制字符串，新增 World 资源用 "0"。下表路径均有 `/api/v1` 前缀，准确字段以[操作表](api/v1/operations.json)和[schema](api/v1/schema.json)为准。

| 方法与路径 | 请求与返回 |
| --- | --- |
| GET `/world/catalog` | kind=entities/predicates/sources，limit/cursor；返回分页目录和 World 版本 |
| GET `/world/facts` | subject/predicate/history/limit/cursor；返回 items、world_version、next_cursor |
| GET `/world/slot` | subject/predicate/scope，精确查询 slot revision |
| GET `/settings` | 共享草稿、payload、最近应用、blocked、world_available、有效说明 |
| POST `/settings/draft` | request_id、草稿 expected_revision、整份 payload；instructions/edits/command_ids 必须出现，人工 command_ids=[] |
| POST `/settings/apply` | request_id、草稿 expected_revision；回执可能记录 NO_CHANGES，202 不是已生效证明 |
| POST `/settings/applications/{id}/retry` | request_id；按领域规则重排/对账，不清除提取失败保护 |
| POST `/settings/applications/{id}/restore-draft` | request_id、目标草稿 expected_revision；恢复 FAILED 人工批次到空草稿 |

Secretary 说明是 payload.instructions，包含 content 与有效说明 expected_revision；null 表示不更改说明。没有旧 `/api/instructions` 或 `/api/settings/*` 接口。异步业务进度从 settings/applications/{id}、settings 与 requests/{id} 读取；SettingsApplication 状态是生效权威。

新增设置时必须补充：草稿/有效版本的契约、影响范围、摘要与重建入口、运行中工作边界、失败与恢复测试、文档和实际模型证据范围。

运行配置指纹包含摘要策略、main/task 容量及输出预算、记忆节流参数。旧未完成应用指纹不匹配时，需使用备份对应的完整旧代码与配置，在隔离副本核对阶段与 World 回执，再完成对账；只恢复环境变量不足以跨版本恢复，已提交的外部设置不能通过删除本地记录假装回滚。详见[容量与记忆规范](memory-and-prompts.md)。

显式提取恢复的首次消费还要求当前服务签发的 5 分钟预检凭证。期限不扩大 SettingsApplication 原授权，也不改变固定来源和 World 先查回执的规则；过期或重启后的未消费凭证须重新预检，已消费同请求只对账。
