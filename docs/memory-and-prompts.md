# 提示词与工作记忆

## 三类模型上下文

主会话使用 [instructions.ts](../src/pi_secretary/src/instructions.ts) 的 BASE_SYSTEM 与 Master 自定义说明。执行 Agent 使用 [task-prompt.ts](../src/pi_secretary/src/task-prompt.ts) 的 `secretary.agent-task.v1` JSON 包。记忆和设置整理共用 [summary.ts](../src/pi_secretary/src/summary.ts) 的有界摘要流程；三者不共享任意可编辑 system prompt。

认证 owner 通过 `POST /api/v1/settings/draft` 保存 Secretary 说明为 SettingsDraft，统一应用成功后更新 UserInstructions：最多 2000 个 Unicode 字符、revision CAS、同文不增版本、空文关闭自定义部分。模型工具不能修改此设置。Host 领取输入时保存 MainPromptSnapshot（完整 system/工具声明、说明版本及 hash）；修改说明经过[统一设置流程](settings-activation.md)，中断轮次仍使用原快照恢复。

## 恢复记录与实际请求

CHECKPOINT 保存完整原件，即使超出模型容量也能保存；MODEL_REQUEST 记录实际发送的归一化请求，并关联 source_context_id、compaction_job_id、记忆 revision。活跃 loop 的 canonical 消息顺序和位置工具键保持不变；发送前使用独立数组投影。protected_from_index 保存本轮输入起点，恢复先用完整 CHECKPOINT 对账工具，再构造请求；旧检查点缺此字段时保守保护整个轮次。

内部记忆头使用可持久化的身份标记，与正文完全相同的真实输入分开；异常或未知标记保守保留。缺少有效 Consciousness id 时，头归一化保持原消息不变；正式契约要求该 id 必填。已验证适配器不会向 provider 发送这个内部标记。

`wm_fact_versions`、`omitted_refs` 当前仍为空，不据字段存在宣称完整 World 版本追踪。原始对象及已完成工具凭证不可改写。

## 两种维护

`CompactionJob.mode=WORKING_MEMORY` 更新 Consciousness 的事项/承诺和 covered_event_sequence，不删历史。完成回合累计 8 个或首个未覆盖完成回合等待 60 秒后到期；普通启动间隔至少 120 秒。已完成的 scheduler 反馈可绕过间隔。自然语言重要性不由关键词分类，普通回合批量覆盖。无新完成来源不调用模型；失败前缀自动停重试，新增输入不能绕过。

`CONTEXT_COMPACTION` 单独记录可裁剪的 canonical 前缀及替代内容，60% 可用输入占用时在安全边界处理，80% 强制阶段也必须先评估后发送。历史须先进入成功记忆；已覆盖来源不重复摘要/提取。目标占用为可用输入的 30%，保留原始 Master 输入锚点、有效 system/tools、当前轮次和完整工具协议。保留内容过大时目标可能不可达；硬预算超限显示 CAPACITY_BLOCKED，保留证据，不伪报达标。

`POST /api/v1/session/compact` 是显式维护入口；多来源历史转设置完整整理。维护期间新 ACCEPTED 输入排队，不单独使固定来源 STALE；基准记忆或用于摘要的任务事实变化仍会使候选过期。旧 journal 不改写，旧 last_job_id 裁剪语义仅用于尚未迁移至 maintenance_version=3 的记录；设置成功同时初始化独立边界。

## 摘要与承诺

默认摘要输出 16384，失败重试目标 32768，均受模型/部署上限约束。按较大重试预算冻结原始来源分段，不靠删除来源换取通过。最多 64 段，每段最多 2 次调用，计划总时限 20 分钟；候选整体字节、条目数量、工具调用及终止原因均检查。中断普通 job 标记失败并保留进度；设置流程按持久化候选恢复。

摘要完成后才执行独立承诺提取。完整 user/assistant 消息保留说话人及事件 ID，过大完整消息不能安全装入提取请求时显式阻塞，不截断条件。每个来源的提取尝试持久化；成功复用，失败/未知结果不自动再调用，后续新增消息或账本变化也不能绕过。工具正文不能成为新承诺引文证据；引文在解码原始文本后核验，支持引号和换行。

设置整理与主流程共用事件来源身份；仅用于显示的助手 `display_call_id` 不会把同一消息变成第二个来源，文本相同但事件 ID 不同仍是独立来源。`settings.retry` 会重新排队设置整理，`POST /api/v1/session/compact` 会重新请求维护，但两者都不会清除承诺提取的来源级失败/未知结果；重复调用仍保持失败并报告 `COMMITMENT_EXTRACTION_REPLAY_BLOCKED`，重启也不解除此保护。旧设置的哈希来源通过已持久化的历史设置快照映射到事件，成功结果可复用；若部分旧快照无法区分多个完全相同消息对象对应的事件，则报告 `COMMITMENT_EXTRACTION_LEGACY_IDENTITY_AMBIGUOUS` 并停止提取，需另行核验证据后修复，不自动猜测或重试。

commitments 是宿主账本，含稳定 ID、原文、状态、来源与处理凭证。摘要遗漏不能删除承诺；狭义结果汇报承诺只有匹配任务结果及来源之后的可验证展示证据才可自动完成（旧 SENT+presented receipt 或新版 NotificationDelivery presented）。一般承诺由 `POST /api/v1/memory/commitments/{id}/resolve`（state 与 note） 明确处理。

Issue 4 增加独立的用户显式单次提取恢复服务；每来源最多一次**自动**提取的约束不变。先只读预检失败分组，冻结旧 attempt、session、来源原件/边界、policy、实现与运行配置版本、工作记忆 revision，再以 request_id 和完整绑定请求授权所选分组。旧 attempt 不修改或删除，新恢复记录关联 parent_attempt 和精确 ModelCall；同 ID 同参数对账，同 ID 改参拒绝。授权消费在发送前落盘，来源拥有者和领取代次阻止并发发送及迟到提交。

先复用已提交回执或已保存合法完整响应，执行确定性解析、证据校验和原 owner 提交，不重复摘要或模型提取。恢复不扩展到其他尚未提取分段。`FAILED` 只表示本地处理失败，不能证明供应商未收到请求；超时、无完整结果、旧执行不能确认静止或隔离、legacy 不能精确关联时保持 `BLOCKED`。重启仅对账，不重新发送不明调用。一次授权最多一次新调用，再失败仍需停发；不能承诺网络 exactly-once，允许新调用的明确授权也可能产生再次计费。主模型工具、设置重试、普通整理、消息到达及重启均不构成授权。

新提取承诺同时保存 `source_batch`：实际创建它的 CompactionJob 或 SettingsApplication、固定事件 ID 集合及结束序列。完成校验只使用该 owner 已提交候选中记录的这条承诺，并核对固定来源、事件批次、会话和时间；相同消息 blob 在另一个批次再次出现，不能借用旧批次的送达通知。设置来源即使含规范 Context，也必须通过当前绑定事件批次校验。旧记录缺少此字段时，不从 blob hash 猜测事件 owner；旧事件来源（含与 Context 同 hash 的已知事件证据）保守保持 OPEN，仍可按原有显式处理入口处理承诺状态（不清除提取失败记录，也不恢复提取重试）；不存在该事件归属歧义的旧规范 Context 来源继续兼容。

设置的新承诺只使用本次冻结提取输入对应的完整证据快照，不能先按相同引文选用旧 Context。开始模型调用前校验每条输入与证据的角色、文本和完整消息身份；证据不匹配时报 `INVALID_SETTINGS_EXTRACTION_EVIDENCE`。早于固定计划格式、缺少 `plan` 或 `extraction_messages` 的旧待处理 SettingsSource 原本已无法直接运行当前摘要流程，现在明确报 `SETTINGS_SOURCE_UPGRADE_REQUIRED` 并保留失败状态，不自动转换旧来源或解除提取失败保护。

## 容量与配置

[budget.ts](../src/pi_secretary/src/budget.ts) 使用完整归一化文本/JSON 请求的 UTF-8 字节上界估算及封装开销，包含 system、工具声明、记忆、历史和工具返回。不是 tokenizer 精确计数，也不把 usage/cache 指标当下一请求值。可用输入 U = 有效窗口 C − 实际输出 O − 工具增长预留 T − 安全余量 S；发送需 I ≤ U。默认 O=4096，有工具时 T=4096，S=max(2048,5%×C)。注册容量与服务声明取较低值，缺声明显示服务上限未核验。

| 参数 | 默认/用途 |
| --- | --- |
| SECRETARY_MAIN_CONTEXT_WINDOW / INPUT_TOKENS / OUTPUT_TOKENS | 可选 main 服务上限 |
| SECRETARY_TASK_CONTEXT_WINDOW / INPUT_TOKENS / OUTPUT_TOKENS | 可选 task 服务上限 |
| SECRETARY_MAX_OUTPUT_TOKENS | 4096，一般调用输出目标 |
| SECRETARY_COMPACTION_OUTPUT_TOKENS | 16384，摘要首轮目标 |
| SECRETARY_COMPACTION_RETRY_OUTPUT_TOKENS | 32768，摘要重试目标 |
| SECRETARY_TOOL_GROWTH_RESERVE | 4096，有有效工具时使用 |
| SECRETARY_CONTEXT_SAFETY_TOKENS / SAFETY_RATIO | 固定安全余量可选；比例默认 0.05 |
| SECRETARY_COMPACTION_TARGET / THRESHOLD / FORCED_THRESHOLD | 0.30 / 0.60 / 0.80，严格有序 |
| SECRETARY_MEMORY_UPDATE_TURNS / UPDATE_SECONDS / MIN_INTERVAL_SECONDS | 8 / 60 / 120 |

参数均校验，纳入设置 runtimeHash。旧 SECRETARY_COMPACTION_BYTES 不再触发维护。当前 live 硬门禁支持实际验证的 openai-completions 和 openai-responses；最终 payload 的模型、输出字段和完整体积发送前再核验。不支持的路径明确阻塞，供应商失败不自动重试。task 同样门禁，超限保留检查点及失败原因，本次不新增 task 自动压缩。

内部状态和历史显示投影保留最近 MAIN MODEL_REQUEST 的预算与 usage，与恢复 CHECKPOINT 分开；下一请求发送前重算。当前 API 的 session 仅公开身份/状态/revision/recovery_error，不能把遗留 UI 的完整容量面板当作新版已实现接口。真实 usage 属于对应已完成调用，不混加 input/cache 指标。

## 升级与验证

升级前结束或核对旧 SettingsApplication，备份 session store 与 World 数据库。未完成应用的 runtimeHash 不匹配会阻塞；不能只切换环境变量绕过。恢复须使用备份对应的完整旧代码与配置，在隔离副本核对 application/request receipt；已存在外部 World receipt 时按原请求对账完成，禁止撤销本地记录冒充未提交。新设置在 World 写入前对完整重建请求做显式容量预检。

验收计划与覆盖矩阵见 [Issue #2 计划](fix/fix_20261005_issue2_上下文容量与记忆分离计划.md)。合成回归、HTTP 捕获、真实模型、浏览器及部署是不同证据；本次运行报告会分别记录，不能用离线绿灯代替部署证明。

恢复对账还核对精确 ModelCall 的完整 session/task/execution scope、Context 与调用/loop/用途/revision 的关联，以及原始 system 和完整请求证据；不能因 user 来源文本相同就接受不同 system 请求。该校验针对证据完整性，不意味着存在正常用户入口可以修改持久记录。预检签发的未消费凭证在 5 分钟后或服务重启时失效，须重新预检；已消费的幂等回执仍可对账，不重新调用模型。


## 新版读入口与验证边界

`GET /api/v1/memory` 返回维护状态；summary 与 commitments 分页接口返回有界摘要、承诺和来源投影，不透传 PromptSnapshot 或完整 Consciousness。来源无明确事件绑定时为 locator_state=unavailable；承诺有 source_batch 才公开其 source_event_ids，不用同内容 hash 猜来源。

显式提取恢复使用 `GET /api/v1/memory/recovery` 取得完整 binding，再 POST 同路径持久受理并通过 requests 对账；不再通过旧终端命令。TaskResult 的完成与 Notification SENT 的送达证明不同，当前 API 通过 deliveries/{id}/ack 提供显式 presented 确认，不能把普通读取当成自动完成承诺的依据。

已验收的合成记忆场景证明整理后两个真实 OS 进程之间的持久连续性，重启后确有真实 provider 请求；原始事实仍在请求上下文中，不能宣称仅凭摘要回忆。详见[API 验证记录](api/v1/verification.md)。
