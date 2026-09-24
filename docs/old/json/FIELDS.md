> 历史归档：设计阶段的原始设计或早期实现说明，和当前代码不构成证据对应。命令、路径与结论仅供历史追溯；当前入口见 [项目文档](../../README.md)。

# 字段字典

字段类型、必填及值域以 [contracts.schema.json](contracts.schema.json) 为准。本表从该契约生成；跨字段规则见 [SEMANTICS.md](SEMANTICS.md)。所有对象禁止未知属性，只有显式可扩展参数/value 允许任意 JSON，且仍须登记校验。

## ObjectRef

不可变对象引用；必须校验内容散列。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `path` | RelativePath | 是 | 相对 data_root 或 workspace_root；运行时拒绝绝对路径、..、符号链接越界。 |
| `sha256` | Digest | 是 | 已保存原始字节 SHA-256 小写十六进制。 |
| `bytes` | integer | 是 | 原始字节长度 |
| `media_type` | string | 是 | 如 application/json；不得用摘要代替原件。 |

## Scope

日志定位：main 至少 session；task 必须 task 与 execution；跨域见语义校验。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `session_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `task_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `execution_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## Message

逻辑消息；provider 扩展块由原始 context 对象保留。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `message_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `role` | system / developer / user / assistant / tool | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `content` | ObjectRef | 是 | 完整内容，含多模态引用；不在此做摘要。 |
| `tool_call_id` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `source_event_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## EvidenceRef

World Model 证据引用；同时定位原始事件与字节。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `log_event_id` | ID | 是 | 对应 OperationLogRecord.event_id |
| `content` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |

## Provenance



| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `source_kind` | MASTER / OBSERVATION / TASK_REPORT / MODEL_INFERENCE | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `source_id` | ID | 是 | wm.source 主键 |
| `evidence` | array of EvidenceRef | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `observed_at` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `received_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `scope` | string | 是 | 对象和适用范围 |
| `epistemic` | OBSERVED / REPORTED / INFERRED / UNRESOLVED | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## Precondition

运行前提只引用已登记检查器，禁止运行模型提交的表达式。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `condition_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `kind` | DEVICE_AVAILABLE / EXECUTION_SUCCEEDED / RESOURCE_PRESENT | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `target` | string | 是 | 登记设备/资源标识或 execution UUID |
| `required_revision` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## ConditionResult



| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `condition_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `status` | MET / NOT_MET / UNKNOWN | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `checked_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `evidence` | array of ObjectRef | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `reason` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## Trigger



| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `kind` | IMMEDIATE / AT / INTERVAL / EVENT | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `at` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `interval_seconds` | integer / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `anchor_at` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `timezone` | string | 是 | IANA 时区；UTC 时写 Etc/UTC |
| `event_source` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `predicate_id` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `missed_policy` | REPORT_ONLY / SKIP / CATCH_UP_ONE | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `overlap_policy` | QUEUE / SKIP | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## FeedbackPolicy



| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `terminal` | boolean | 是 | 一次性终结必须 true；周期可按约定筛选。 |
| `on_change` | boolean | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `on_blocker` | const True | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `on_unknown` | const True | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `milestones` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## ExecutorSpec



| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `kind` | AGENT / PROGRAM | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `agent_profile` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `program_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `program_revision` | integer / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `parameters` | JSON | 是 | 程序参数须再通过登记的 parameters_schema 校验；agent 参数为 {}。 |

## Session

逻辑主会话；状态变化由宿主单写，进程停止仍保留。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const Session | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `state` | HostState | 是 | 状态转换见 state_machine/catalog.json 的 Host |
| `owner_epoch` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `active_loop_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `claimed_input_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `last_context_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `consciousness_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `last_journal_seq` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `recovery_error` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## Input

外部输入；工具返回不创建此对象。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const Input | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `session_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `dedupe_key` | string | 是 | producer 内稳定键 |
| `producer` | MASTER / SCHEDULER / ENVIRONMENT | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `state` | InputState | 是 | 状态转换见 state_machine/catalog.json 的 Input |
| `payload` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |
| `loop_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `received_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `feedback_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## Context

一次调用不可变快照；estimated+reserve<=budget 由业务检查。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const Context | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `session_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `execution_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `loop_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `call_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `purpose` | MAIN / TASK / COMPACTION | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `messages` | array of Message | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `raw_context` | ObjectRef | 是 | 原始、可原封不动复载的 context；provider profile 在外部绑定。 |
| `provider_profile` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `adapter_version` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `tools_schema` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |
| `consciousness_revision` | integer / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `input_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `pending_tool_call_ids` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `token_budget` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `estimated_tokens` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `reserve_tokens` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `omitted_refs` | array of ObjectRef | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `wm_fact_versions` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## ModelCall

模型传输生命周期；完整响应保存后才解析工具请求。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const ModelCall | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `state` | CallState | 是 | 状态转换见 state_machine/catalog.json 的 Call |
| `context_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `scope` | Scope | 是 | 日志定位：main 至少 session；task 必须 task 与 execution；跨域见语义校验。 |
| `transport_attempt` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `request` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |
| `response` | ObjectRef / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `started_at` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `completed_at` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `error` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## WorkItem

事项不等于任务；未履行且无人承接的事项不退出。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `item_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `tier` | ACTIVE / QUIET / MINIMAL | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `summary` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `goals` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `constraints` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `decisions` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `open_questions` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `unfulfilled_commitments` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `task_refs` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `source_refs` | array of ObjectRef | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `last_activity_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `pending_owner` | MAIN / SCHEDULER / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## Consciousness

当前工作记忆；全部摘要提交与原文承接集合一次保存。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const Consciousness | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `session_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `items` | array of WorkItem | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `pending_raw_refs` | array of ObjectRef | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `covered_event_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `last_job_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## CompactionJob

固定范围摘要任务；新增输入不纳入覆盖集合。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const CompactionJob | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `state` | CompactionState | 是 | 状态转换见 state_machine/catalog.json 的 Compaction |
| `session_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `base_revision` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `source_event_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `source_refs` | array of ObjectRef | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `candidate_ref` | ObjectRef / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `covered_event_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `validation_errors` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## TaskProposal

主会话只提出任务；不接受 authorized、grant 等模型声明。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const TaskProposal | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `request_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `request_hash` | Digest | 是 | 已保存原始字节 SHA-256 小写十六进制。 |
| `submitted_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `session_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `goal` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `constraints` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `acceptance_criteria` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `trigger` | Trigger | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `preconditions` | array of Precondition | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `executor` | ExecutorSpec | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `feedback_policy` | FeedbackPolicy | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `deadline` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `context_refs` | array of ObjectRef | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `parent_execution_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `safety_rule_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `reuse_task_id` | ID / null | 是 | null 创建新计划；非空表示按同目标/约束接续现有计划，须与 parent_execution_id 所属计划一致。 |

## TaskPlan

id 即 task_id；先保存计划再建幂等目录，agent 在可执行时由 dispatch 拉起。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const TaskPlan | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `state` | PlanState | 是 | 状态转换见 state_machine/catalog.json 的 Plan |
| `proposal_request_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `proposal_ref` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |
| `workspace` | RelativePath | 是 | 相对 data_root 或 workspace_root；运行时拒绝绝对路径、..、符号链接越界。 |
| `trigger` | Trigger | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `preconditions` | array of Precondition | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `executor` | ExecutorSpec | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `feedback_policy` | FeedbackPolicy | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `next_due_at` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `pending_occurrences` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `active_execution_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `deadline` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `safety_rule_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `initialization_error` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## Execution

执行生命周期与短期留存是独立维度；终结历史不可回到 RUNNING。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const Execution | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `task_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `state` | ExecutionState | 是 | 状态转换见 state_machine/catalog.json 的 Execution |
| `retention_state` | RetentionState | 是 | 状态转换见 state_machine/catalog.json 的 Retention |
| `occurrence_key` | string | 是 | task_id+trigger occurrence 唯一 |
| `plan_revision` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `attempt_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `owner_epoch` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `waiting_request_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `condition_results` | array of ConditionResult | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `continuation_of` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `pending_followup_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `cancel_requested` | boolean | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `started_at` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `ended_at` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `last_activity_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `retire_after_seconds` | integer | 是 | 初始候选 172800，可配置；只限终结且无待处理。 |
| `result_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `checkpoint_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `unknown_operation_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## Dispatch

Scheduler -> worker 固定分派；重复 attempt_id 返回既有回执，不重新起进程。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const Dispatch | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `task_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `execution_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `attempt_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `owner_epoch` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `plan_revision` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `executor` | ExecutorSpec | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `workspace` | RelativePath | 是 | 相对 data_root 或 workspace_root；运行时拒绝绝对路径、..、符号链接越界。 |
| `resume_checkpoint_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `operation_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `issued_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |

## WorkerReceipt

PID 仅线索；核对 worker_instance/attempt，不能凭 PID 判断同一进程。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const WorkerReceipt | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `dispatch_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `attempt_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `execution_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `owner_epoch` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `worker_instance_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `pid` | integer / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `status` | STARTED / CHECKPOINT / EXITED / LOST | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `checkpoint_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `exit_code` | integer / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `observed_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |

## Checkpoint

宿主保存原 context + 接续说明；恢复不执行历史工具。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const Checkpoint | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `task_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `execution_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `executor_kind` | AGENT / PROGRAM | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `context_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `raw_context` | ObjectRef / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `program_resume_ref` | ObjectRef / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `continuation` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |
| `artifact_refs` | array of ObjectRef | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `completed_operation_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `pending_operation_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `pending_tool_call_ids` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `adapter_version` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `provider_profile` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## Artifact



| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `artifact_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `name` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `content` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |
| `workspace_path` | RelativePath | 是 | 相对 data_root 或 workspace_root；运行时拒绝绝对路径、..、符号链接越界。 |
| `producing_operation_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## TaskResult

完整结果先可查询，再反馈简要结论；PARTIAL/UNKNOWN 不意味着执行已结束。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const TaskResult | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `task_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `execution_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `outcome` | SUCCEEDED / FAILED / CANCELLED / EXPIRED / PARTIAL / UNKNOWN | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `summary` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `limitations` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `evidence` | array of ObjectRef | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `artifacts` | array of Artifact | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `detail_ref` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |
| `needs_action` | boolean | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `verified_by` | PROGRAM_CHECK / MAIN_REVIEW / NOT_VERIFIED | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `observed_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |

## Feedback

短结论与执行引用；主会话读到时详情已保存。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const Feedback | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `state` | FeedbackState | 是 | 状态转换见 state_machine/catalog.json 的 Feedback |
| `task_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `execution_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `kind` | RESULT / DECISION_REQUIRED / PROGRESS / UNKNOWN | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `summary` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `detail_ref` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |
| `result_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `decision_request_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `input_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `created_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |

## DecisionRequest

普通决定通过 TaskControl；授权走独立接口。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const DecisionRequest | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `state` | DecisionState | 是 | 状态转换见 state_machine/catalog.json 的 Decision |
| `task_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `execution_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `question` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `options` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `impact` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `materials` | array of ObjectRef | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `deadline` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `answer` | JSON / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `answered_by` | MAIN / MASTER / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `answer_request_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## ActionScope



| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `action` | string | 是 | 已登记操作类型，如 file.write、world.change；不能任意解释 natural-language。 |
| `resource` | string | 是 | 规范化对象标识 |
| `parameters_ref` | ObjectRef | 是 | 所有关键参数不可变内容 |
| `parameters_hash` | Digest | 是 | 已保存原始字节 SHA-256 小写十六进制。 |
| `expected_resource_revision` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `intent_id` | ID | 是 | 一个业务作用的身份；已成功作用不能因新 operation_id 重做。 |

## Operation

最终 gate 的单位；权限、取消、对象版本在此核验。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const Operation | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `scope` | Scope | 是 | 日志定位：main 至少 session；task 必须 task 与 execution；跨域见语义校验。 |
| `state` | OperationState | 是 | 状态转换见 state_machine/catalog.json 的 Operation |
| `action` | ActionScope | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `authorization_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `rule_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `rule_revision` | integer / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `owner_epoch` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `attempt_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `retry_of` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `receipt` | ObjectRef / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `effect` | NOT_STARTED / APPLIED / NOT_APPLIED / PARTIAL / UNKNOWN | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `error` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## AuthorizationRequest

host/scheduler 私有记录，模型不可提交批准状态。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const AuthorizationRequest | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `state` | AuthorizationState | 是 | 状态转换见 state_machine/catalog.json 的 Authorization |
| `operation_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `action` | ActionScope | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `scope` | Scope | 是 | 日志定位：main 至少 session；task 必须 task 与 execution；跨域见语义校验。 |
| `display_ref` | ObjectRef | 是 | Master 实际看到的固定展示内容 |
| `display_hash` | Digest | 是 | 已保存原始字节 SHA-256 小写十六进制。 |
| `expires_at` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `decision_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `decided_at` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `decided_by` | const MASTER_UI / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `consumed_at` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## ApprovalCommand

仅已认证 Master UI 可调用；身份取服务端 session，不能从 body 信任。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const ApprovalCommand | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `request_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `authorization_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `expected_revision` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `display_hash` | Digest | 是 | 已保存原始字节 SHA-256 小写十六进制。 |
| `decision` | APPROVE / REJECT / REVOKE | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## AuthorizationRule

手工确认的持续规则，主会话无写入口；每次操作匹配当前 revision。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const AuthorizationRule | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `state` | ENABLED / DISABLED | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `actions` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `resource_prefixes` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `parameter_constraints` | ObjectRef | 是 | 由注册校验器解释的约束，不运行任意代码 |
| `valid_from` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `expires_at` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `created_by` | const MASTER_UI | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `confirmation_ref` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |

## SafetyRule

只能收紧执行条件；不能生成授权或改变未知停止要求。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const SafetyRule | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `created_by` | MASTER_UI / MAIN | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `max_known_failure_retries` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `retryable_error_codes` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `require_no_effect_for_retry` | const True | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `stop_on_unknown` | const True | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `extra_checks` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## ProgramRegistration

人工登记；dispatch 固定 revision+code digest，更新不改历史。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const ProgramRegistration | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `state` | ProgramState | 是 | 状态转换见 state_machine/catalog.json 的 Program |
| `name` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `description` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `entrypoint` | string | 是 | 受人工登记控制；参数用 argv，禁止模型拼 shell 字符串。 |
| `code_digest` | Digest | 是 | 已保存原始字节 SHA-256 小写十六进制。 |
| `parameters_schema` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |
| `result_schema` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |
| `preconditions` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `operation_kinds` | array of string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `supports_resume` | boolean | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `maintained_by` | const HUMAN | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `validation_ref` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |

## Notification

主会话普通通知；独立于授权 UI 展示。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const Notification | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `state` | NotificationState | 是 | 状态转换见 state_machine/catalog.json 的 Notification |
| `session_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `channel` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `message` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |
| `delivery_key` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `receipt` | ObjectRef / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `requested_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |

## OperationLogRecord

逻辑原始日志；MAIN/TASK 并列，不替代任务查询状态。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const OperationLogRecord | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `event_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `stream` | MAIN / TASK / SYSTEM | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `scope` | Scope | 是 | 日志定位：main 至少 session；task 必须 task 与 execution；跨域见语义校验。 |
| `sequence` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `event_type` | string | 是 | 事件注册表命名；如 input.accepted / tool.result / authorization.approved。 |
| `occurred_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `recorded_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `actor` | MASTER_UI / MAIN / EXECUTOR / SCHEDULER / HOST / PROGRAM | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `payload` | ObjectRef | 是 | 原始完整内容；敏感 credential 本体不作提示材料。 |
| `causation_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `correlation_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `related_object_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## ArchiveManifest

退出 Scheduler 前完整性检查；归档不删除长期历史。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const ArchiveManifest | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `task_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `execution_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `log_event_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `objects` | array of ObjectRef | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `verified_at` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `retired_at` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## WorldChange

主会话或登记来源提案；SQL 内不保存授权范围。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const WorldChange | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `request_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `change_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `request_hash` | Digest | 是 | 已保存原始字节 SHA-256 小写十六进制。 |
| `source_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `subject_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `predicate_key` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `scope_key` | string | 是 | 单值为空，多值为稳定实例键；不能用随机键逃避冲突。 |
| `expected_revision` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `mode` | ASSERT / CORRECT / RETRACT | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `value` | JSON | 是 | 按 predicate 定义校验；关系采用 object_entity_id，标量采用 value。 |
| `object_entity_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `assertion_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `replaces_assertion_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `resolve_conflict_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `resolution_note` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `provenance` | Provenance | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `valid_from` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `valid_to` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `fresh_until` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## WorldCatalogChange

实体登记/名称修订和不可变来源登记；仍经 Scheduler 授权。谓词由人工迁移维护。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const WorldCatalogChange | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `request_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `change_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `request_hash` | Digest | 是 | 已保存原始字节 SHA-256 小写十六进制。 |
| `kind` | UPSERT_ENTITY / REGISTER_SOURCE | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `entity_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `entity_kind` | PERSON / ORGANIZATION / PROJECT / DEVICE / SERVICE / RESOURCE / GOAL / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `display_name` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `external_key` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `source_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `source_kind` | MASTER / OBSERVATION / TASK_REPORT / MODEL_INFERENCE / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `source_key` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `description` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `expected_revision` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `evidence` | array of EvidenceRef | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## WorldCommand

跨 JSON journal / PG 的桥接状态；PG commit receipt 才证明已写。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const WorldCommand | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 |
| `updated_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `state` | WorldCommandState | 是 | 状态转换见 state_machine/catalog.json 的 WorldCommand |
| `change` | oneOf WorldChange / WorldCatalogChange | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `operation_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `receipt_ref` | ObjectRef / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `error` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## WorldQuery

memory_read 的 World Model 查询分支；游标绑定筛选与快照。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const WorldQuery | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `request_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `subject_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `predicate_key` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `as_of` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `include_history` | boolean | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `limit` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `cursor` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## WorldFact



| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `subject_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `predicate_key` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `scope_key` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `slot_revision` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `assertion_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `status` | ACTIVE / SUPPORTING / CONTESTED / RETRACTED / SUPERSEDED | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `value` | JSON | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `object_entity_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `provenance` | Provenance | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `valid_from` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `valid_to` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `freshness` | CURRENT / STALE / UNKNOWN | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `fresh_until` | Time / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## WorldReadResult

空结果不自动解释为事实不存在；CONTESTED 全部候选可查询。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const WorldReadResult | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `request_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `facts` | array of WorldFact | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `observed_db_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| `next_cursor` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `omitted_count` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `missing_reason` | NOT_FOUND / UNAVAILABLE / FILTERED / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## CommandReceipt

入口幂等回执；同 request_id 不同 hash 返回冲突。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const CommandReceipt | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `request_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `request_hash` | Digest | 是 | 已保存原始字节 SHA-256 小写十六进制。 |
| `status` | ACCEPTED / REJECTED | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `object_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `reason` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `journal_seq` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## RuntimeConfig

复核默认值见 demo_design/DECISIONS.md，参数不等于 BrainStorm 最终结论。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const RuntimeConfig | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `data_root` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `workspace_root` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `postgres_dsn_env` | string | 是 | 仅环境变量名，不存口令 |
| `retention_seconds` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `context_budget` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `context_reserve` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `compaction_threshold` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `max_workers` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `max_frame_bytes` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `max_input_bytes` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## TaskQuery

DETAIL 成功且 execution 仍 HOT 时刷新留存；LIST 不刷新。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const TaskQuery | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `request_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `kind` | CAPABILITIES / LIST / DETAIL | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `task_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `execution_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `limit` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `cursor` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## TaskControlCommand

普通任务控制；无 APPROVE 授权操作。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const TaskControlCommand | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `request_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `expected_revision` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `action` | PAUSE_PLAN / RESUME_PLAN / CLOSE_PLAN / CANCEL_EXECUTION / ANSWER_DECISION | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `target_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `answer` | JSON / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `decision_request_id` | ID / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## MemoryReadRequest

MemoryUtil 统一读入口；WORLD 需 world_query，其余分支必须为空。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const MemoryReadRequest | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `request_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `source` | WORLD / CONSCIOUSNESS / OPERATION_LOG | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `world_query` | WorldQuery / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `item_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `event_ids` | array of ID | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `object_refs` | array of ObjectRef | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `limit` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `cursor` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## MemoryReadResult

读取只读，不更改 authority 或引发异步新输入。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const MemoryReadResult | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `request_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `source` | WORLD / CONSCIOUSNESS / OPERATION_LOG | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `world_result` | WorldReadResult / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `items` | array of WorkItem | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `records` | array of OperationLogRecord | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `next_cursor` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `omitted_count` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `missing_reason` | NOT_FOUND / UNAVAILABLE / FILTERED / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## TaskQueryResult

RETIRED 不复活旧执行，返回历史引用。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const TaskQueryResult | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `request_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `plans` | array of TaskPlan | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `executions` | array of Execution | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `results` | array of TaskResult | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `programs` | array of ProgramRegistration | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `next_cursor` | string / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `historical_refs` | array of ObjectRef | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `unavailable_reason` | NOT_FOUND / RETIRED / UNAVAILABLE / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## ProgramInvocation

程序 stdin JSON 协议；stdout 输出结果，stderr 过程日志；超大内容写文件并由宿主收录。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const ProgramInvocation | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `dispatch_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `execution_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `program_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `program_revision` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `code_digest` | Digest | 是 | 已保存原始字节 SHA-256 小写十六进制。 |
| `workspace` | RelativePath | 是 | 相对 data_root 或 workspace_root；运行时拒绝绝对路径、..、符号链接越界。 |
| `parameters` | JSON | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `resume_ref` | ObjectRef / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## ProgramResult

必须校验登记 result_schema；退出码 0 不足以证明业务成功。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const ProgramResult | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `dispatch_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `execution_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `outcome` | SUCCEEDED / FAILED / WAITING / UNKNOWN | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `summary` | string | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `detail` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |
| `artifacts` | array of Artifact | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `effect` | NOT_STARTED / APPLIED / NOT_APPLIED / PARTIAL / UNKNOWN | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `resume_ref` | ObjectRef / null | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `evidence` | array of ObjectRef | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |

## Mutation

服务端加载 snapshot 后按 object_type 校验并执行状态 guards；revision 必须 +1。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `object_type` | Session / Input / Context / ModelCall / Consciousness / CompactionJob / TaskPlan / Execution / Dispatch / WorkerReceipt / Checkpoint / TaskResult / Feedback / DecisionRequest / Operation / AuthorizationRequest / AuthorizationRule / SafetyRule / ProgramRegistration / Notification / ArchiveManifest / WorldCommand | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `object_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `expected_revision` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `new_revision` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `snapshot` | ObjectRef | 是 | 不可变对象引用；必须校验内容散列。 |

## JournalTransaction

单写事务，frame 原始 payload 字节 checksum 外包；同帧全生效或全不生效。

| 字段 | 类型/范围 | 必填 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | const 1 | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `record_type` | const JournalTransaction | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `txn_id` | ID | 是 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| `sequence` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `owner_epoch` | integer | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `previous_digest` | Digest | 是 | 已保存原始字节 SHA-256 小写十六进制。 |
| `mutations` | array of Mutation | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `log_records` | array of OperationLogRecord | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `receipts` | array of CommandReceipt | 是 | 按对象职责及语义约束使用；null 明确表示尚无值。 |
| `committed_at` | Time | 是 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
