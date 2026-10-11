# 提示词与工作记忆

## 三类模型上下文

主会话使用 [instructions.ts](../src/pi_secretary/src/instructions.ts) 的 BASE_SYSTEM 与 Master 自定义说明。执行 Agent 使用 [task-prompt.ts](../src/pi_secretary/src/task-prompt.ts) 的 `secretary.agent-task.v1` JSON 包。记忆和设置整理共用 [summary.ts](../src/pi_secretary/src/summary.ts) 的有界摘要流程；三者不共享任意可编辑 system prompt。

认证 owner 通过 `POST /api/v1/settings/draft` 保存 Secretary 说明为 SettingsDraft，统一应用成功后更新 UserInstructions：最多 2000 个 Unicode 字符、revision CAS、同文不增版本、空文关闭自定义部分。模型工具不能修改此设置。Host 领取输入时保存 MainPromptSnapshot（完整 system/工具声明、说明版本及 hash）；修改说明经过[统一设置流程](settings-activation.md)，中断轮次仍使用原快照恢复。

## 恢复记录与实际请求

CHECKPOINT 保存完整原件，即使超出模型容量也能保存；MODEL_REQUEST 记录实际发送的归一化请求，并关联 source_context_id、compaction_job_id、记忆 revision。活跃 loop 的 canonical 消息顺序和位置工具键保持不变；发送前使用独立数组投影。protected_from_index 保存本轮输入起点，恢复先用完整 CHECKPOINT 对账工具，再构造请求；旧检查点缺此字段时保守保护整个轮次。

内部记忆头使用可持久化的身份标记，与正文完全相同的真实输入分开；异常或未知标记保守保留。缺少有效 Consciousness id 时，头归一化保持原消息不变；正式契约要求该 id 必填。已验证适配器不会向 provider 发送这个内部标记。

`wm_fact_versions`、`omitted_refs` 当前仍为空，不据字段存在宣称完整 World 版本追踪。原始对象及已完成工具凭证不可改写。

## 两种维护

`CompactionJob.mode=WORKING_MEMORY` 更新 Consciousness 的事项/承诺和 covered_event_sequence，不删历史。完成回合累计 8 个或首个未覆盖完成回合等待 60 秒后到期；普通启动间隔至少 120 秒。已完成的 scheduler 反馈可绕过间隔。自然语言重要性不由关键词分类，普通回合批量覆盖。无新完成来源不创建摘要任务；已有失败任务按持久到期时间重试，新增输入不能重置次数。

`CONTEXT_COMPACTION` 单独记录可裁剪的 canonical 前缀及替代内容，60% 可用输入占用时在安全边界处理，80% 强制阶段也必须先评估后发送。历史须先进入成功记忆；已覆盖来源不重复摘要/提取。目标占用为可用输入的 30%，保留原始 Master 输入锚点、有效 system/tools、当前轮次和完整工具协议。保留内容过大时目标可能不可达；硬预算超限显示 CAPACITY_BLOCKED，保留证据，不伪报达标。

`POST /api/v1/session/compact` 是显式维护入口；多来源历史转设置完整整理。维护期间新 ACCEPTED 输入排队，不单独使固定来源 STALE；基准记忆或用于摘要的任务事实变化仍会使候选过期。旧 journal 不改写，旧 last_job_id 裁剪语义仅用于尚未迁移至 maintenance_version=3 的记录；设置成功同时初始化独立边界。

## 摘要与承诺

默认摘要输出 16384，后续维护轮次目标 32768，均受模型/部署上限约束。冻结完整来源分段，最多 64 段；每段每轮只生成一个候选，协议不符留到下一轮。完整成功分段保存检查点，重启复用；容量、整体字节、工具调用及终止原因继续校验。

模型传输统一最多 3 次：首次立即，后两次前等待约 2 秒、10 秒，Retry-After 更长时服从服务端间隔。网络错误、单次超时、408 / 409 / 429 / 5xx 和明确过载可重试；认证、格式、容量和显式取消不重试。每次 ModelCall 留存尝试序号和诊断；只有 RESPONSE_SAVED 的成功响应可交给 Agent，失败诊断即使有 response 也不视为成功。重启复用已保存成功响应，未完成请求的已消耗次数不归零。

正常摘要或提取初次失败后，再补试三轮，依次等待约 5 分钟、30 分钟、2 小时；第四次维护执行仍失败则停止。原始失败原因、轮次、到期时间保存在 journal；不需要新对话推动。不可重试的认证、容量和来源错误停止自动补试。`POST /api/v1/session/compact` 重置摘要退避；`POST /api/v1/memory/extraction/retry {request_id}` 对受理时的失败来源集合重排，重复 request_id 不再次重置。

摘要覆盖进度与 MemoryExtractionJob 分开保存。成功摘要和 Settings 可独立提交；待补提任务保留来源事件 ID、完整原文引用及已完成分段，来源不会因覆盖水位前进而丢失。后台从 journal / CAS 补提，不依赖旧输入常驻主模型。完整消息超限时保留失败，绝不截断条件。补提按当前账本合并；成功终态和承诺合并同一事务落盘，已解决的状态不会退回 OPEN。

设置与普通维护共用事件身份；显示用 display_call_id 不产生第二个来源，文本相同但事件 ID 不同仍独立。旧哈希来源通过历史设置快照映射；身份有歧义时保留明确错误，不猜测事件归属。`GET /api/v1/memory` 提供提取状态、轮次、下次到期时间与失败原因。

commitments 是宿主账本，含稳定 ID、原文、状态、来源与处理凭证。摘要遗漏不能删除承诺；狭义结果汇报承诺只有匹配任务结果及来源之后的 SENT 通知才可自动完成。一般承诺由 `POST /api/v1/memory/commitments/{id}/resolve`（state 与 note） 明确处理。

旧 ExtractionRecovery 的预检、绑定、票据和公开路由已退役；schema 保留历史记录读取，生产路径不再创建该类型。工具执行、World 提交与授权回执仍沿用原规则，未知外部副作用不自动重放。

新提取承诺同时保存 `source_batch`：实际创建它的 MemoryExtractionJob（历史记录可为 CompactionJob 或 SettingsApplication）、固定事件 ID 集合及结束序列。完成校验只使用该 owner 已提交候选中记录的这条承诺，并核对固定来源、事件批次、会话和时间；相同消息 blob 在另一个批次再次出现，不能借用旧批次的送达通知。设置来源即使含规范 Context，也必须通过当前绑定事件批次校验。旧记录缺少此字段时，不从 blob hash 猜测事件 owner；旧事件来源（含与 Context 同 hash 的已知事件证据）保守保持 OPEN，仍可按原有显式处理入口处理承诺状态；不存在该事件归属歧义的旧规范 Context 来源继续兼容。

设置的新承诺只使用本次冻结提取输入对应的完整证据快照，不能先按相同引文选用旧 Context。开始模型调用前校验每条输入与证据的角色、文本和完整消息身份；证据不匹配时报 `INVALID_SETTINGS_EXTRACTION_EVIDENCE`。早于固定计划格式、缺少 `plan` 或 `extraction_messages` 的旧待处理 SettingsSource 原本已无法直接运行当前摘要流程，现在明确报 `SETTINGS_SOURCE_UPGRADE_REQUIRED` 并保留失败状态，不猜测缺失的来源证据。

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

参数均校验，纳入设置 runtimeHash。旧 SECRETARY_COMPACTION_BYTES 不再触发维护。当前 live 硬门禁支持实际验证的 openai-completions 和 openai-responses；最终 payload 的模型、输出字段和完整体积发送前再核验。不支持的路径明确阻塞，可重试供应商错误按上述有界策略处理。task 同样门禁，超限保留检查点及失败原因，本次不新增 task 自动压缩。

内部状态和历史显示投影保留最近 MAIN MODEL_REQUEST 的预算与 usage，与恢复 CHECKPOINT 分开；下一请求发送前重算。当前 API 的 session 仅公开身份/状态/revision/recovery_error，不能把遗留 UI 的完整容量面板当作新版已实现接口。真实 usage 属于对应已完成调用，不混加 input/cache 指标。

## 升级与验证

升级前结束或核对旧 SettingsApplication，备份 session store 与 World 数据库。未完成应用的 runtimeHash 不匹配会阻塞；不能只切换环境变量绕过。恢复须使用备份对应的完整旧代码与配置，在隔离副本核对 application/request receipt；已存在外部 World receipt 时按原请求对账完成，禁止撤销本地记录冒充未提交。新设置在 World 写入前对完整重建请求做显式容量预检。

验收计划与覆盖矩阵见 [Issue #2 计划](fix/fix_20261005_issue2_上下文容量与记忆分离计划.md)。合成回归、HTTP 捕获、真实模型、浏览器及部署是不同证据；本次运行报告会分别记录，不能用离线绿灯代替部署证明。

模型恢复按 session/task/execution scope、loop、调用位置、模型和持久请求身份关联。相同文本不构成跨调用缓存；成功响应复用，失败诊断与次数保留。手动恢复主会话或重排维护会建立新的重试代次，后台 tick 和重启不会重置预算。


## 新版读入口与验证边界

`GET /api/v1/memory` 返回维护状态；summary 与 commitments 分页接口返回有界摘要、承诺和来源投影，不透传 PromptSnapshot 或完整 Consciousness。来源无明确事件绑定时为 locator_state=unavailable；承诺有 source_batch 才公开其 source_event_ids，不用同内容 hash 猜来源。

提取重排使用 `POST /api/v1/memory/extraction/retry`，只需稳定 request_id；通过 requests 与 memory 状态对账。TaskResult 的完成与 Notification SENT 的送达证明不同，当前 API 尚未提供 presented 确认命令，不能把普通读取当成自动完成承诺的依据。

已验收的合成记忆场景证明整理后两个真实 OS 进程之间的持久连续性，重启后确有真实 provider 请求；原始事实仍在请求上下文中，不能宣称仅凭摘要回忆。详见[API 验证记录](api/v1/verification.md)。
