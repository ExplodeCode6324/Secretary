# World Model 管理与设置生效规范

本规范对应 [Settings](../src/pi_secretary/src/settings.ts)、[完整来源整理](../src/pi_secretary/src/settings-memory.ts)、[World](../src/pi_secretary/src/world.ts) 和 [WebUI](../src/pi_secretary/web/app.js)。实现计划及验收记录见 [本次更新计划](fix/fix_20260928_world_model管理与统一设置生效.md)。

## 统一规则

凡改变 Secretary 模型行为、提示词或有效 World 知识的设置，必须先完整整理当前工作上下文的未摘要部分，再初始化 context，完成后才处理下一轮输入。新设置入口必须接入 Settings 协调器，不能直接修改有效记录后声称下一轮自然生效。

当前接入范围：WebUI World 管理、Secretary 说明，以及通过 TUI/模型提交并获准的 WorldCommand。启动时检测主/任务模型身份与容量、基础和执行提示词、数据库连接配置哈希及模型预算/整理/并发选项变化，自动排入同一流程。凭据原文不放入设置记录或摘要；界面布局、主题不触发整理。授权撤销和安全阻断仍按原守卫立即执行。

首次空会话记录运行配置哈希；已有上下文的旧数据目录缺少哈希时会执行一次切换。若存在未完成应用，必须先用原运行配置完成恢复，再更换模型或数据库；启动时拒绝用不同配置恢复一个提交结果未完成确认的批次。主会话与新任务调度在切换完成前暂停领取工作，已有异步任务不被重启。更换模型不会使旧任务 checkpoint 自动兼容新 provider。

## 页面与数据语义

管理页提供实体/属性筛选、分页、当前和历史事实、详情与来源、更正和撤回；表单根据属性类型及实体类型约束录入。可以先创建实体草稿，再为它登记同批事实。实体类型不可修改，停用实体时如存在 ACTIVE / SUPPORTING / CONTESTED 状态的事实或关系引用，整批拒绝并列出引用，不级联删除。

事实撤回将 `wm.assertion_state.status` 改为 `RETRACTED`；更正新增 assertion 并将旧陈述标为 `SUPERSEDED`。原始内容、证据、来源、回执和历史上下文仍保留在原存储。默认查询排除撤回和被替代记录，并检查有效时间；历史查询同时解除状态及有效时间筛选。撤回不表示相反事实，也不是彻底删除个人信息。

管理页每页默认 30 条，上限 100；游标绑定筛选、查询时间和数据库变更计数。期间数据变化时要求从首页重查，避免将混合版本展示为一组稳定结果。实体和属性选择目录当前一次加载，没有实体目录分页。旧 `World.read()` 工具路径仍最多返回 100 条；管理页分页不表示模型工具已支持无限遍历。

草稿保存为 SettingsDraft，最多 50 项 World 修改，可同时携带一份 Secretary 说明。草稿 CAS 防止多页覆盖；说明最多 2000 个 Unicode 字符，空文关闭自定义部分，相同有效说明不产生变更。应用冻结批次，清空工作草稿供下一批编辑；失败批次的原内容仍在 SettingsApplication，可以重试或恢复为草稿。页面对同一事实范围或实体的草稿编辑采用替换，后端对显式批次按给定顺序执行并检查 revision。

Master 点击应用即明确提交本批内容，后端保存 MASTER_UI 证据，不再要求第二张授权卡。模型和 TUI 的原始 World 提案仍经 Operation/Authorization，不能使用管理接口冒充 Master。

## 切换顺序

1. 持久化 QUEUED 应用及请求幂等回执，阻止主会话领取下一批输入，等待当前轮次和已有整理结束。未恢复的 CLAIMED 输入或未配对工具结果必须先解决。
2. 固定当前 Context、Consciousness revision、事件截止序号。合并全部 pending_raw_refs、当前 context 和未覆盖的主会话消息事件，按稳定事件 ID 保留不同事件，旧快照以消息出现次数承接，不能把同文不同事件合并；已有事件覆盖边界防止重复。重建时生成的记忆/设置包装消息标记为已覆盖，后续不重新摘要这些派生包装。
3. SUMMARIZING 按完整消息 JSON 分片并合并短片输入模型，逐片携带前序记忆和即将生效的设置变化。每片最多尝试两次，按较大重试输出预算冻结来源；候选和已完成片数逐步持久化。全部摘要片段完成后才独立提取承诺，完整消息装不下时明确阻塞；成功提取复用，失败或未知尝试不可因重启、改账本或加来源而自动重发。不会只保留工具输出开头就标记整段已覆盖。
4. 检查结构、覆盖、承诺和源版本，预先构建并检查新 context 容量。无新增来源且无旧记忆时不制造摘要模型调用。摘要候选不提前成为有效 Consciousness。
5. COMMITTING 在一个 PostgreSQL 事务内执行本批 World 修改，保存 `wm.settings_batch_receipt`、逐变更回执和 outbox。语义或版本冲突导致本批事实全部回滚。
6. REBUILDING 完成 outbox 桥接后，一次 Store 事务提交新的工作记忆、有效说明、Session context 指针、运行配置哈希和 APPLIED 状态。最后放行排队输入与新任务调度。

切换期间的新消息和任务反馈继续可靠持久化，归入截止序号之后的队列；不让持续到达的新消息无限使本次候选过期。原始历史保留，新 context 由当前 system、工作记忆、设置变化记录和历史 Master 输入约束档案构成，不复制旧的整段 assistant/tool 对话。

为避免摘要遗漏删除明确约束，当前实现保守保留已处理 Master 输入的完整文本，标记为历史材料而非待执行请求。旧偏好/事实不能覆盖当前设置；World 更正和撤回作为独立变化记录承接。承诺台账继续由宿主持有。材料进入摘要不证明模型语义完全无损，真实模型质量需另行验证。如果必要输入档案和记忆仍超过上下文容量，应用在数据库写入前失败；当前没有自动舍弃原始约束的机制。

## 失败与恢复

| 状态 | 行为 |
| --- | --- |
| FAILED | 确定尚未提交有效变更；旧 context/有效说明保留。可重试；人工批次可恢复为草稿，重新查询修正版本冲突 |
| BLOCKED | 提交结果未知，或已提交但未完成桥接/重建；保持会话 gate，先查回执再继续 |
| COMMITTING / REBUILDING 重启 | 自动从持久阶段恢复；先查询回执，不能盲目重写 |
| SUMMARIZING 重启 | 用固定来源和持久候选继续剩余分片，不提前更新有效记忆 |

查批次回执使用与提交相同的数据库事务锁；必须等待正在进行的提交结束，才可判定回执不存在。不存在且能确认结果时可报告 FAILED；数据库不可访问时保持 BLOCKED。模型 WorldCommand 遇到可确认回滚的暂时数据库错误时保留 RETRYABLE_ERROR，人工重试仍查回执并复核原许可，不消费为永久业务拒绝。提交成功后不能通过取消、清空记录或删除历史伪装回滚；恢复旧设置应再提交一次反向变更。当前页面不提供取消正在应用批次的按钮。

普通人工修改失败时可继续旧配置下的工作。启动配置已经变化但重建失败时仍保持 gate，需重试成功或恢复原配置，不能在失败后直接使用新模型。切换运行配置前如有未恢复的主会话轮次，应先在原配置下恢复它。

普通单来源 `/compact` 使用 CompactionJob 的 WORKING_MEMORY 增量更新，并仅在容量阈值到达时另记 CONTEXT_COMPACTION 裁剪；发现多个 pending_raw_refs 时转完整来源流程。自动、手动整理与设置应用不能并发提交记忆。`/memory` 显示最近设置应用成功时间和 SETTINGS_APPLIED；它不等于证明模型摘要语义质量合格。

## HTTP API

所有路径沿用 localhost Host/Origin、bearer token 与 client 校验。POST 请求体上限 1 MiB。

| 方法与路径 | 请求与返回 |
| --- | --- |
| GET `/api/world` | `subject`、`predicate`、`history`、`cursor`、`limit`；返回 rows、next_cursor、version 和实体/属性/来源目录 |
| GET `/api/settings` | 草稿及 payload、最近 30 次应用记录、blocked、world_available、effective_instructions |
| POST `/api/settings/draft` | `client`、`expected_revision`、`payload`；整份替换草稿。payload 为 SettingsPayload，Master 不可设置 command_ids |
| POST `/api/settings/apply` | `client`、`expected_revision`、UUID `request_id`；返回持久应用记录，或 NO_CHANGES；HTTP 202 不是已生效证明 |
| POST `/api/settings/retry` | `client`、`application_id`；重试 FAILED/BLOCKED，不重复提交已完成批次 |
| POST `/api/settings/restore` | `client`、`application_id`、`expected_revision`；将 FAILED 人工批次恢复到空草稿，模型命令需重新提案 |
| GET/POST `/api/instructions` | GET 返回有效说明和 management；POST 用 `content`、有效说明 `expected_revision`、`draft_revision` 保存草稿，`applies=SUMMARY_AND_REBUILD` |

新增设置时必须补充：草稿/有效版本的契约、影响范围、摘要与重建入口、运行中工作边界、失败与恢复测试、文档和实际模型证据范围。

运行配置指纹包含摘要策略、main/task 容量及输出预算、记忆节流参数。旧未完成应用指纹不匹配时，需使用备份对应的完整旧代码与配置，在隔离副本核对阶段与 World 回执，再完成对账；只恢复环境变量不足以跨版本恢复，已提交的外部设置不能通过删除本地记录假装回滚。详见[容量与记忆规范](memory-and-prompts.md)。
