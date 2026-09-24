/* Generated from src/contracts/contracts.schema.json. Do not hand-edit. */

export type SecretaryDemoV1 =
  | Session
  | Input
  | Context
  | ModelCall
  | Consciousness
  | CompactionJob
  | TaskProposal
  | TaskPlan
  | Execution
  | Dispatch
  | WorkerReceipt
  | Checkpoint
  | TaskResult
  | Feedback
  | DecisionRequest
  | Operation
  | AuthorizationRequest
  | ApprovalCommand
  | AuthorizationRule
  | SafetyRule
  | ProgramRegistration
  | Notification
  | OperationLogRecord
  | ArchiveManifest
  | WorldChange
  | WorldCatalogChange
  | WorldCommand
  | WorldQuery
  | WorldReadResult
  | CommandReceipt
  | RuntimeConfig
  | TaskQuery
  | TaskControlCommand
  | MemoryReadRequest
  | MemoryReadResult
  | TaskQueryResult
  | ProgramInvocation
  | ProgramResult
  | JournalTransaction
  | UserInstructions
  | MainPromptSnapshot;
/**
 * 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。
 */
export type ID = string;
/**
 * UTC RFC3339；时区意图在 Trigger.timezone 另存。
 */
export type Time = string;
/**
 * 状态枚举对应 src/state_machine/catalog.json 的 Host
 */
export type HostState =
  | "STOPPED"
  | "RECOVERING"
  | "IDLE"
  | "RUNNING"
  | "CAPACITY_BLOCKED"
  | "RECOVERY_BLOCKED"
  | "DRAINING";
/**
 * 状态枚举对应 src/state_machine/catalog.json 的 Input
 */
export type InputState = "ACCEPTED" | "CLAIMED" | "HANDLED";
/**
 * 相对 data_root 或 workspace_root；运行时拒绝绝对路径、..、符号链接越界。
 */
export type RelativePath = string;
/**
 * 已保存原始字节 SHA-256 小写十六进制。
 */
export type Digest = string;
/**
 * 状态枚举对应 src/state_machine/catalog.json 的 Call
 */
export type CallState =
  "PREPARED" | "IN_FLIGHT" | "RESPONSE_SAVED" | "INTERRUPTED" | "FAILED";
/**
 * 状态枚举对应 src/state_machine/catalog.json 的 Compaction
 */
export type CompactionState =
  "QUEUED" | "SUMMARIZING" | "VALIDATING" | "COMMITTED" | "STALE" | "FAILED";
export type Trigger = {
  [k: string]: unknown;
} & {
  kind: "IMMEDIATE" | "AT" | "INTERVAL" | "EVENT";
  at: Time | null;
  interval_seconds: number | null;
  anchor_at: Time | null;
  /**
   * IANA 时区；UTC 时写 Etc/UTC
   */
  timezone: string;
  event_source: string | null;
  predicate_id: string | null;
  missed_policy: "REPORT_ONLY" | "SKIP" | "CATCH_UP_ONE";
  overlap_policy: "QUEUE" | "SKIP";
};
export type ExecutorSpec = {
  [k: string]: unknown;
} & {
  kind: "AGENT" | "PROGRAM";
  agent_profile: string | null;
  program_id: ID | null;
  program_revision: number | null;
  /**
   * 程序参数须再通过登记的 parameters_schema 校验；agent 参数为 {}。
   */
  parameters: {
    [k: string]: unknown;
  };
};
/**
 * 状态枚举对应 src/state_machine/catalog.json 的 Plan
 */
export type PlanState =
  "INITIALIZING" | "ACTIVE" | "PAUSED" | "INIT_FAILED" | "CLOSED";
/**
 * 执行生命周期与短期留存是独立维度；终结历史不可回到 RUNNING。
 */
export type Execution = {
  [k: string]: unknown;
} & {
  schema_version: 1;
  record_type: "Execution";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  task_id: ID;
  state: ExecutionState;
  retention_state: RetentionState;
  /**
   * task_id+trigger occurrence 唯一
   */
  occurrence_key: string;
  plan_revision: number;
  attempt_id: ID | null;
  owner_epoch: number;
  /**
   * @minItems 0
   */
  waiting_request_ids: ID[];
  /**
   * @minItems 0
   */
  condition_results: ConditionResult[];
  continuation_of: ID | null;
  /**
   * @minItems 0
   */
  pending_followup_ids: ID[];
  cancel_requested: boolean;
  started_at: Time | null;
  ended_at: Time | null;
  last_activity_at: Time;
  /**
   * 初始候选 172800，可配置；只限终结且无待处理。
   */
  retire_after_seconds: number;
  result_id: ID | null;
  checkpoint_id: ID | null;
  /**
   * @minItems 0
   */
  unknown_operation_ids: ID[];
};
/**
 * 状态枚举对应 src/state_machine/catalog.json 的 Execution
 */
export type ExecutionState =
  | "CREATED"
  | "WAIT_PRECONDITION"
  | "READY"
  | "DISPATCHING"
  | "RUNNING"
  | "WAIT_DECISION"
  | "WAIT_AUTH"
  | "CANCEL_REQUESTED"
  | "RESULT_UNKNOWN"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";
/**
 * 状态枚举对应 src/state_machine/catalog.json 的 Retention
 */
export type RetentionState = "HOT" | "ARCHIVE_PENDING" | "RETIRED";
/**
 * 状态枚举对应 src/state_machine/catalog.json 的 Feedback
 */
export type FeedbackState = "QUEUED" | "DELIVERED" | "HANDLED";
/**
 * 状态枚举对应 src/state_machine/catalog.json 的 Decision
 */
export type DecisionState = "OPEN" | "ANSWERED" | "OBSOLETE" | "EXPIRED";
/**
 * 最终 gate 的单位；权限、取消、对象版本在此核验。
 */
export type Operation = {
  [k: string]: unknown;
} & {
  schema_version: 1;
  record_type: "Operation";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  scope: Scope;
  state: OperationState;
  action: ActionScope;
  authorization_id: ID | null;
  rule_id: ID | null;
  rule_revision: number | null;
  owner_epoch: number;
  attempt_id: ID | null;
  retry_of: ID | null;
  receipt: ObjectRef | null;
  effect: "NOT_STARTED" | "APPLIED" | "NOT_APPLIED" | "PARTIAL" | "UNKNOWN";
  error: string | null;
};
/**
 * 状态枚举对应 src/state_machine/catalog.json 的 Operation
 */
export type OperationState =
  | "PREPARED"
  | "WAIT_AUTH"
  | "AUTHORIZED"
  | "DISPATCHED"
  | "SUCCEEDED"
  | "FAILED"
  | "RESULT_UNKNOWN"
  | "CANCELLED";
/**
 * host/scheduler 私有记录，模型不可提交批准状态。
 */
export type AuthorizationRequest = {
  [k: string]: unknown;
} & {
  schema_version: 1;
  record_type: "AuthorizationRequest";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  state: AuthorizationState;
  operation_id: ID;
  action: ActionScope;
  scope: Scope;
  display_ref: ObjectRef4;
  display_hash: Digest;
  expires_at: Time | null;
  decision_id: ID | null;
  decided_at: Time | null;
  decided_by: "MASTER_UI" | null;
  consumed_at: Time | null;
};
/**
 * 状态枚举对应 src/state_machine/catalog.json 的 Authorization
 */
export type AuthorizationState =
  "PENDING" | "APPROVED" | "REJECTED" | "REVOKED" | "EXPIRED" | "CONSUMED";
/**
 * 状态枚举对应 src/state_machine/catalog.json 的 Program
 */
export type ProgramState = "REGISTERED" | "ENABLED" | "DISABLED";
/**
 * 状态枚举对应 src/state_machine/catalog.json 的 Notification
 */
export type NotificationState =
  "QUEUED" | "SENDING" | "SENT" | "FAILED" | "DELIVERY_UNKNOWN";
/**
 * 状态枚举对应 src/state_machine/catalog.json 的 WorldCommand
 */
export type WorldCommandState =
  | "RECEIVED"
  | "WAIT_AUTH"
  | "READY"
  | "APPLYING"
  | "COMMITTED"
  | "CONFLICT"
  | "REJECTED"
  | "RETRYABLE_ERROR";

/**
 * 逻辑主会话；状态变化由宿主单写，进程停止仍保留。
 */
export interface Session {
  schema_version: 1;
  record_type: "Session";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  state: HostState;
  owner_epoch: number;
  active_loop_id: ID | null;
  /**
   * @minItems 0
   */
  claimed_input_ids: ID[];
  last_context_id: ID | null;
  consciousness_id: ID;
  last_journal_seq: number;
  recovery_error: string | null;
}
/**
 * 外部输入；工具返回不创建此对象。
 */
export interface Input {
  schema_version: 1;
  record_type: "Input";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  session_id: ID;
  /**
   * producer 内稳定键
   */
  dedupe_key: string;
  producer: "MASTER" | "SCHEDULER" | "ENVIRONMENT";
  state: InputState;
  payload: ObjectRef;
  loop_id: ID | null;
  received_at: Time;
  feedback_id: ID | null;
}
/**
 * 不可变对象引用；必须校验内容散列。
 */
export interface ObjectRef {
  path: RelativePath;
  sha256: Digest;
  /**
   * 原始字节长度
   */
  bytes: number;
  /**
   * 如 application/json；不得用摘要代替原件。
   */
  media_type: string;
}
/**
 * 一次调用不可变快照；estimated+reserve<=budget 由业务检查。
 */
export interface Context {
  schema_version: 1;
  record_type: "Context";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  session_id: ID | null;
  execution_id: ID | null;
  loop_id: ID;
  call_id: ID;
  purpose: "MAIN" | "TASK" | "COMPACTION";
  /**
   * @minItems 1
   */
  messages: Message[];
  raw_context: ObjectRef2;
  provider_profile: string;
  adapter_version: string;
  tools_schema: ObjectRef;
  consciousness_revision: number | null;
  /**
   * @minItems 0
   */
  input_ids: ID[];
  /**
   * @minItems 0
   */
  pending_tool_call_ids: string[];
  token_budget: number;
  estimated_tokens: number;
  reserve_tokens: number;
  /**
   * @minItems 0
   */
  omitted_refs: ObjectRef[];
  /**
   * @minItems 0
   */
  wm_fact_versions: string[];
  capture_kind?: "CHECKPOINT" | "MODEL_REQUEST";
  base_prompt_version?: string;
  instructions_revision?: number;
  system_prompt_hash?: Digest;
}
/**
 * 逻辑消息；provider 扩展块由原始 context 对象保留。
 */
export interface Message {
  message_id: ID;
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: ObjectRef1;
  tool_call_id: string | null;
  /**
   * @minItems 0
   */
  source_event_ids: ID[];
}
/**
 * 完整内容，含多模态引用；不在此做摘要。
 */
export interface ObjectRef1 {
  path: RelativePath;
  sha256: Digest;
  /**
   * 原始字节长度
   */
  bytes: number;
  /**
   * 如 application/json；不得用摘要代替原件。
   */
  media_type: string;
}
/**
 * 不可变对象引用；必须校验内容散列。
 */
export interface ObjectRef2 {
  path: RelativePath;
  sha256: Digest;
  /**
   * 原始字节长度
   */
  bytes: number;
  /**
   * 如 application/json；不得用摘要代替原件。
   */
  media_type: string;
}
/**
 * 模型传输生命周期；完整响应保存后才解析工具请求。
 */
export interface ModelCall {
  schema_version: 1;
  record_type: "ModelCall";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  state: CallState;
  context_id: ID;
  scope: Scope;
  transport_attempt: number;
  request: ObjectRef;
  response: ObjectRef | null;
  started_at: Time | null;
  completed_at: Time | null;
  error: string | null;
}
/**
 * 日志定位：main 至少 session；task 必须 task 与 execution；跨域见语义校验。
 */
export interface Scope {
  session_id: ID | null;
  task_id: ID | null;
  execution_id: ID | null;
}
/**
 * 当前工作记忆；全部摘要提交与原文承接集合一次保存。
 */
export interface Consciousness {
  schema_version: 1;
  record_type: "Consciousness";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  session_id: ID;
  /**
   * @minItems 0
   */
  items: WorkItem[];
  /**
   * @minItems 0
   */
  pending_raw_refs: ObjectRef[];
  /**
   * @minItems 0
   */
  covered_event_ids: ID[];
  last_job_id: ID | null;
  commitments?: MemoryCommitment[];
  covered_event_sequence?: number;
}
/**
 * 事项不等于任务；未履行且无人承接的事项不退出。
 */
export interface WorkItem {
  item_id: ID;
  tier: "ACTIVE" | "QUIET" | "MINIMAL";
  summary: string;
  /**
   * @minItems 0
   */
  goals: string[];
  /**
   * @minItems 0
   */
  constraints: string[];
  /**
   * @minItems 0
   */
  decisions: string[];
  /**
   * @minItems 0
   */
  open_questions: string[];
  /**
   * @minItems 0
   */
  unfulfilled_commitments: string[];
  /**
   * @minItems 0
   */
  task_refs: ID[];
  /**
   * @minItems 1
   */
  source_refs: ObjectRef[];
  last_activity_at: Time;
  pending_owner: ("MAIN" | "SCHEDULER") | null;
}
export interface MemoryCommitment {
  id: ID;
  text: string;
  state: "OPEN" | "COMPLETED" | "CANCELLED";
  /**
   * @minItems 1
   */
  source_refs: ObjectRef[];
  task_refs: ID[];
  resolution_event_ids: ID[];
}
/**
 * 固定范围摘要任务；新增输入不纳入覆盖集合。
 */
export interface CompactionJob {
  schema_version: 1;
  record_type: "CompactionJob";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  state: CompactionState;
  session_id: ID;
  base_revision: number;
  /**
   * @minItems 0
   */
  source_event_ids: ID[];
  /**
   * @minItems 1
   */
  source_refs: ObjectRef[];
  candidate_ref: ObjectRef | null;
  /**
   * @minItems 0
   */
  covered_event_ids: ID[];
  /**
   * @minItems 0
   */
  validation_errors: string[];
  memory_version?: 2;
  attempt?: number;
  source_end_sequence?: number;
}
/**
 * 主会话只提出任务；不接受 authorized、grant 等模型声明。
 */
export interface TaskProposal {
  schema_version: 1;
  record_type: "TaskProposal";
  request_id: ID;
  request_hash: Digest;
  submitted_at: Time;
  session_id: ID;
  goal: string;
  /**
   * @minItems 0
   */
  constraints: string[];
  /**
   * @minItems 1
   */
  acceptance_criteria: string[];
  trigger: Trigger;
  /**
   * @minItems 0
   */
  preconditions: Precondition[];
  executor: ExecutorSpec;
  feedback_policy: FeedbackPolicy;
  deadline: Time | null;
  /**
   * @minItems 0
   */
  context_refs: ObjectRef[];
  parent_execution_id: ID | null;
  safety_rule_id: ID;
  /**
   * null 创建新计划；非空表示按同目标/约束接续现有计划，须与 parent_execution_id 所属计划一致。
   */
  reuse_task_id: ID | null;
}
/**
 * 运行前提只引用已登记检查器，禁止运行模型提交的表达式。
 */
export interface Precondition {
  condition_id: ID;
  kind: "DEVICE_AVAILABLE" | "EXECUTION_SUCCEEDED" | "RESOURCE_PRESENT";
  /**
   * 登记设备/资源标识或 execution UUID
   */
  target: string;
  required_revision: string | null;
}
export interface FeedbackPolicy {
  /**
   * 一次性终结必须 true；周期可按约定筛选。
   */
  terminal: boolean;
  on_change: boolean;
  on_blocker: true;
  on_unknown: true;
  /**
   * @minItems 0
   */
  milestones: string[];
}
/**
 * id 即 task_id；先保存计划再建幂等目录，agent 在可执行时由 dispatch 拉起。
 */
export interface TaskPlan {
  schema_version: 1;
  record_type: "TaskPlan";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  state: PlanState;
  proposal_request_id: ID;
  proposal_ref: ObjectRef;
  workspace: RelativePath;
  trigger: Trigger;
  /**
   * @minItems 0
   */
  preconditions: Precondition[];
  executor: ExecutorSpec;
  feedback_policy: FeedbackPolicy;
  next_due_at: Time | null;
  /**
   * @minItems 0
   */
  pending_occurrences: string[];
  /**
   * @minItems 0
   */
  active_execution_ids: ID[];
  deadline: Time | null;
  safety_rule_id: ID;
  initialization_error: string | null;
}
export interface ConditionResult {
  condition_id: ID;
  status: "MET" | "NOT_MET" | "UNKNOWN";
  checked_at: Time;
  /**
   * @minItems 0
   */
  evidence: ObjectRef[];
  reason: string | null;
}
/**
 * Scheduler -> worker 固定分派；重复 attempt_id 返回既有回执，不重新起进程。
 */
export interface Dispatch {
  schema_version: 1;
  record_type: "Dispatch";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  task_id: ID;
  execution_id: ID;
  attempt_id: ID;
  owner_epoch: number;
  plan_revision: number;
  executor: ExecutorSpec;
  workspace: RelativePath;
  resume_checkpoint_id: ID | null;
  /**
   * @minItems 0
   */
  operation_ids: ID[];
  issued_at: Time;
}
/**
 * PID 仅线索；核对 worker_instance/attempt，不能凭 PID 判断同一进程。
 */
export interface WorkerReceipt {
  schema_version: 1;
  record_type: "WorkerReceipt";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  dispatch_id: ID;
  attempt_id: ID;
  execution_id: ID;
  owner_epoch: number;
  worker_instance_id: ID;
  pid: number | null;
  status: "STARTED" | "CHECKPOINT" | "EXITED" | "LOST";
  checkpoint_id: ID | null;
  exit_code: number | null;
  observed_at: Time;
}
/**
 * 宿主保存原 context + 接续说明；恢复不执行历史工具。
 */
export interface Checkpoint {
  schema_version: 1;
  record_type: "Checkpoint";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  task_id: ID;
  execution_id: ID;
  executor_kind: "AGENT" | "PROGRAM";
  context_id: ID | null;
  raw_context: ObjectRef | null;
  program_resume_ref: ObjectRef | null;
  continuation: ObjectRef;
  /**
   * @minItems 0
   */
  artifact_refs: ObjectRef[];
  /**
   * @minItems 0
   */
  completed_operation_ids: ID[];
  /**
   * @minItems 0
   */
  pending_operation_ids: ID[];
  /**
   * @minItems 0
   */
  pending_tool_call_ids: string[];
  adapter_version: string;
  provider_profile: string;
}
/**
 * 完整结果先可查询，再反馈简要结论；PARTIAL/UNKNOWN 不意味着执行已结束。
 */
export interface TaskResult {
  schema_version: 1;
  record_type: "TaskResult";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  task_id: ID;
  execution_id: ID;
  outcome:
    "SUCCEEDED" | "FAILED" | "CANCELLED" | "EXPIRED" | "PARTIAL" | "UNKNOWN";
  summary: string;
  /**
   * @minItems 0
   */
  limitations: string[];
  /**
   * @minItems 1
   */
  evidence: ObjectRef[];
  /**
   * @minItems 0
   */
  artifacts: Artifact[];
  detail_ref: ObjectRef;
  needs_action: boolean;
  verified_by: "PROGRAM_CHECK" | "MAIN_REVIEW" | "NOT_VERIFIED";
  observed_at: Time;
}
export interface Artifact {
  artifact_id: ID;
  name: string;
  content: ObjectRef;
  workspace_path: RelativePath;
  producing_operation_id: ID | null;
}
/**
 * 短结论与执行引用；主会话读到时详情已保存。
 */
export interface Feedback {
  schema_version: 1;
  record_type: "Feedback";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  state: FeedbackState;
  task_id: ID;
  execution_id: ID;
  kind: "RESULT" | "DECISION_REQUIRED" | "PROGRESS" | "UNKNOWN";
  summary: string;
  detail_ref: ObjectRef;
  result_id: ID | null;
  decision_request_id: ID | null;
  input_id: ID | null;
  created_at: Time;
}
/**
 * 普通决定通过 TaskControl；授权走独立接口。
 */
export interface DecisionRequest {
  schema_version: 1;
  record_type: "DecisionRequest";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  state: DecisionState;
  task_id: ID;
  execution_id: ID;
  question: string;
  /**
   * @minItems 0
   */
  options: string[];
  impact: string;
  /**
   * @minItems 0
   */
  materials: ObjectRef[];
  deadline: Time | null;
  answer: {
    [k: string]: unknown;
  } | null;
  answered_by: ("MAIN" | "MASTER") | null;
  answer_request_id: ID | null;
}
export interface ActionScope {
  /**
   * 已登记操作类型，如 file.write、world.change；不能任意解释 natural-language。
   */
  action: string;
  /**
   * 规范化对象标识
   */
  resource: string;
  parameters_ref: ObjectRef3;
  parameters_hash: Digest;
  expected_resource_revision: string | null;
  /**
   * 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。
   */
  intent_id: string;
}
/**
 * 不可变对象引用；必须校验内容散列。
 */
export interface ObjectRef3 {
  path: RelativePath;
  sha256: Digest;
  /**
   * 原始字节长度
   */
  bytes: number;
  /**
   * 如 application/json；不得用摘要代替原件。
   */
  media_type: string;
}
/**
 * 不可变对象引用；必须校验内容散列。
 */
export interface ObjectRef4 {
  path: RelativePath;
  sha256: Digest;
  /**
   * 原始字节长度
   */
  bytes: number;
  /**
   * 如 application/json；不得用摘要代替原件。
   */
  media_type: string;
}
/**
 * 仅已认证 Master UI 可调用；身份取服务端 session，不能从 body 信任。
 */
export interface ApprovalCommand {
  schema_version: 1;
  record_type: "ApprovalCommand";
  request_id: ID;
  authorization_id: ID;
  expected_revision: number;
  display_hash: Digest;
  decision: "APPROVE" | "REJECT" | "REVOKE";
}
/**
 * 手工确认的持续规则，主会话无写入口；每次操作匹配当前 revision。
 */
export interface AuthorizationRule {
  schema_version: 1;
  record_type: "AuthorizationRule";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  state: "ENABLED" | "DISABLED";
  /**
   * @minItems 1
   */
  actions: string[];
  /**
   * @minItems 1
   */
  resource_prefixes: string[];
  parameter_constraints: ObjectRef5;
  valid_from: Time;
  expires_at: Time | null;
  created_by: "MASTER_UI";
  confirmation_ref: ObjectRef;
}
/**
 * 不可变对象引用；必须校验内容散列。
 */
export interface ObjectRef5 {
  path: RelativePath;
  sha256: Digest;
  /**
   * 原始字节长度
   */
  bytes: number;
  /**
   * 如 application/json；不得用摘要代替原件。
   */
  media_type: string;
}
/**
 * 只能收紧执行条件；不能生成授权或改变未知停止要求。
 */
export interface SafetyRule {
  schema_version: 1;
  record_type: "SafetyRule";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  created_by: "MASTER_UI" | "MAIN";
  max_known_failure_retries: number;
  /**
   * @minItems 0
   */
  retryable_error_codes: string[];
  require_no_effect_for_retry: true;
  stop_on_unknown: true;
  /**
   * @minItems 0
   */
  extra_checks: string[];
}
/**
 * 人工登记；dispatch 固定 revision+code digest，更新不改历史。
 */
export interface ProgramRegistration {
  schema_version: 1;
  record_type: "ProgramRegistration";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  state: ProgramState;
  name: string;
  description: string;
  /**
   * 受人工登记控制；参数用 argv，禁止模型拼 shell 字符串。
   */
  entrypoint: string;
  code_digest: Digest;
  parameters_schema: ObjectRef;
  result_schema: ObjectRef;
  /**
   * @minItems 0
   */
  preconditions: string[];
  /**
   * @minItems 0
   */
  operation_kinds: string[];
  supports_resume: boolean;
  maintained_by: "HUMAN";
  validation_ref: ObjectRef;
}
/**
 * 主会话普通通知；独立于授权 UI 展示。
 */
export interface Notification {
  schema_version: 1;
  record_type: "Notification";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  state: NotificationState;
  session_id: ID;
  channel: string;
  message: ObjectRef;
  delivery_key: ID;
  receipt: ObjectRef | null;
  requested_at: Time;
}
/**
 * 逻辑原始日志；MAIN/TASK 并列，不替代任务查询状态。
 */
export interface OperationLogRecord {
  schema_version: 1;
  record_type: "OperationLogRecord";
  event_id: ID;
  stream: "MAIN" | "TASK" | "SYSTEM";
  scope: Scope;
  sequence: number;
  /**
   * 事件注册表命名；如 input.accepted / tool.result / authorization.approved。
   */
  event_type: string;
  occurred_at: Time;
  recorded_at: Time;
  actor: "MASTER_UI" | "MAIN" | "EXECUTOR" | "SCHEDULER" | "HOST" | "PROGRAM";
  payload: ObjectRef6;
  causation_id: ID | null;
  correlation_id: ID;
  /**
   * @minItems 0
   */
  related_object_ids: ID[];
}
/**
 * 不可变对象引用；必须校验内容散列。
 */
export interface ObjectRef6 {
  path: RelativePath;
  sha256: Digest;
  /**
   * 原始字节长度
   */
  bytes: number;
  /**
   * 如 application/json；不得用摘要代替原件。
   */
  media_type: string;
}
/**
 * 退出 Scheduler 前完整性检查；归档不删除长期历史。
 */
export interface ArchiveManifest {
  schema_version: 1;
  record_type: "ArchiveManifest";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  task_id: ID;
  execution_id: ID;
  /**
   * @minItems 0
   */
  log_event_ids: ID[];
  /**
   * @minItems 1
   */
  objects: ObjectRef[];
  verified_at: Time | null;
  retired_at: Time | null;
}
/**
 * 主会话或登记来源提案；SQL 内不保存授权范围。
 */
export interface WorldChange {
  schema_version: 1;
  record_type: "WorldChange";
  request_id: ID;
  change_id: ID;
  request_hash: Digest;
  source_id: ID;
  subject_id: ID;
  predicate_key: string;
  /**
   * 单值为空，多值为稳定实例键；不能用随机键逃避冲突。
   */
  scope_key: string;
  expected_revision: number;
  mode: "ASSERT" | "CORRECT" | "RETRACT";
  value:
    | string
    | number
    | boolean
    | null
    | {
        [k: string]: unknown;
      }
    | unknown[];
  object_entity_id: ID | null;
  assertion_id: ID;
  replaces_assertion_id: ID | null;
  resolve_conflict_id: ID | null;
  resolution_note: string | null;
  provenance: Provenance;
  valid_from: Time;
  valid_to: Time | null;
  fresh_until: Time | null;
}
export interface Provenance {
  source_kind: "MASTER" | "OBSERVATION" | "TASK_REPORT" | "MODEL_INFERENCE";
  /**
   * 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。
   */
  source_id: string;
  /**
   * @minItems 1
   */
  evidence: EvidenceRef[];
  observed_at: Time | null;
  received_at: Time;
  /**
   * 对象和适用范围
   */
  scope: string;
  epistemic: "OBSERVED" | "REPORTED" | "INFERRED" | "UNRESOLVED";
}
/**
 * World Model 证据引用；同时定位原始事件与字节。
 */
export interface EvidenceRef {
  /**
   * 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。
   */
  log_event_id: string;
  content: ObjectRef;
}
/**
 * 实体登记/名称修订和不可变来源登记；仍经 Scheduler 授权。谓词由人工迁移维护。
 */
export interface WorldCatalogChange {
  schema_version: 1;
  record_type: "WorldCatalogChange";
  request_id: ID;
  change_id: ID;
  request_hash: Digest;
  kind: "UPSERT_ENTITY" | "REGISTER_SOURCE";
  entity_id: ID | null;
  entity_kind:
    | (
        | "PERSON"
        | "ORGANIZATION"
        | "PROJECT"
        | "DEVICE"
        | "SERVICE"
        | "RESOURCE"
        | "GOAL"
      )
    | null;
  display_name: string | null;
  external_key: string | null;
  source_id: ID | null;
  source_kind:
    ("MASTER" | "OBSERVATION" | "TASK_REPORT" | "MODEL_INFERENCE") | null;
  source_key: string | null;
  description: string | null;
  expected_revision: number;
  /**
   * @minItems 1
   */
  evidence: EvidenceRef[];
}
/**
 * 跨 JSON journal / PG 的桥接状态；PG commit receipt 才证明已写。
 */
export interface WorldCommand {
  schema_version: 1;
  record_type: "WorldCommand";
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  state: WorldCommandState;
  change: WorldChange | WorldCatalogChange;
  operation_id: ID;
  receipt_ref: ObjectRef | null;
  error: string | null;
}
/**
 * memory_read 的 World Model 查询分支；游标绑定筛选与快照。
 */
export interface WorldQuery {
  schema_version: 1;
  record_type: "WorldQuery";
  request_id: ID;
  subject_id: ID | null;
  predicate_key: string | null;
  as_of: Time;
  include_history: boolean;
  limit: number;
  cursor: string | null;
}
/**
 * 空结果不自动解释为事实不存在；CONTESTED 全部候选可查询。
 */
export interface WorldReadResult {
  schema_version: 1;
  record_type: "WorldReadResult";
  request_id: ID;
  /**
   * @minItems 0
   */
  facts: WorldFact[];
  observed_db_at: Time;
  next_cursor: string | null;
  omitted_count: number;
  missing_reason: ("NOT_FOUND" | "UNAVAILABLE" | "FILTERED") | null;
}
export interface WorldFact {
  subject_id: ID;
  predicate_key: string;
  scope_key: string;
  slot_revision: number;
  assertion_id: ID;
  status: "ACTIVE" | "SUPPORTING" | "CONTESTED" | "RETRACTED" | "SUPERSEDED";
  value:
    | string
    | number
    | boolean
    | null
    | {
        [k: string]: unknown;
      }
    | unknown[];
  object_entity_id: ID | null;
  provenance: Provenance;
  valid_from: Time;
  valid_to: Time | null;
  freshness: "CURRENT" | "STALE" | "UNKNOWN";
  fresh_until: Time | null;
}
/**
 * 入口幂等回执；同 request_id 不同 hash 返回冲突。
 */
export interface CommandReceipt {
  schema_version: 1;
  record_type: "CommandReceipt";
  request_id: ID;
  request_hash: Digest;
  status: "ACCEPTED" | "REJECTED";
  object_id: ID | null;
  reason: string | null;
  journal_seq: number;
}
/**
 * 复核默认值见 demo_design/DECISIONS.md，参数不等于 BrainStorm 最终结论。
 */
export interface RuntimeConfig {
  schema_version: 1;
  record_type: "RuntimeConfig";
  data_root: string;
  workspace_root: string;
  /**
   * 仅环境变量名，不存口令
   */
  postgres_dsn_env: string;
  retention_seconds: number;
  context_budget: number;
  context_reserve: number;
  compaction_threshold: number;
  max_workers: number;
  max_frame_bytes: number;
  max_input_bytes: number;
}
/**
 * DETAIL 成功且 execution 仍 HOT 时刷新留存；LIST 不刷新。
 */
export interface TaskQuery {
  schema_version: 1;
  record_type: "TaskQuery";
  request_id: ID;
  kind: "CAPABILITIES" | "LIST" | "DETAIL";
  task_id: ID | null;
  execution_id: ID | null;
  limit: number;
  cursor: string | null;
}
/**
 * 普通任务控制；无 APPROVE 授权操作。
 */
export interface TaskControlCommand {
  schema_version: 1;
  record_type: "TaskControlCommand";
  request_id: ID;
  expected_revision: number;
  action:
    | "PAUSE_PLAN"
    | "RESUME_PLAN"
    | "CLOSE_PLAN"
    | "CANCEL_EXECUTION"
    | "ANSWER_DECISION";
  target_id: ID;
  answer: {
    [k: string]: unknown;
  } | null;
  decision_request_id: ID | null;
}
/**
 * MemoryUtil 统一读入口；WORLD 需 world_query，其余分支必须为空。
 */
export interface MemoryReadRequest {
  schema_version: 1;
  record_type: "MemoryReadRequest";
  request_id: ID;
  source: "WORLD" | "CONSCIOUSNESS" | "OPERATION_LOG";
  world_query: WorldQuery | null;
  /**
   * @minItems 0
   */
  item_ids: ID[];
  /**
   * @minItems 0
   */
  event_ids: ID[];
  /**
   * @minItems 0
   */
  object_refs: ObjectRef[];
  limit: number;
  cursor: string | null;
}
/**
 * 读取只读，不更改 authority 或引发异步新输入。
 */
export interface MemoryReadResult {
  schema_version: 1;
  record_type: "MemoryReadResult";
  request_id: ID;
  source: "WORLD" | "CONSCIOUSNESS" | "OPERATION_LOG";
  world_result: WorldReadResult | null;
  /**
   * @minItems 0
   */
  items: WorkItem[];
  /**
   * @minItems 0
   */
  records: OperationLogRecord[];
  next_cursor: string | null;
  omitted_count: number;
  missing_reason: ("NOT_FOUND" | "UNAVAILABLE" | "FILTERED") | null;
}
/**
 * RETIRED 不复活旧执行，返回历史引用。
 */
export interface TaskQueryResult {
  schema_version: 1;
  record_type: "TaskQueryResult";
  request_id: ID;
  /**
   * @minItems 0
   */
  plans: TaskPlan[];
  /**
   * @minItems 0
   */
  executions: Execution[];
  /**
   * @minItems 0
   */
  results: TaskResult[];
  /**
   * @minItems 0
   */
  programs: ProgramRegistration[];
  next_cursor: string | null;
  /**
   * @minItems 0
   */
  historical_refs: ObjectRef[];
  unavailable_reason: ("NOT_FOUND" | "RETIRED" | "UNAVAILABLE") | null;
}
/**
 * 程序 stdin JSON 协议；stdout 输出结果，stderr 过程日志；超大内容写文件并由宿主收录。
 */
export interface ProgramInvocation {
  schema_version: 1;
  record_type: "ProgramInvocation";
  dispatch_id: ID;
  execution_id: ID;
  program_id: ID;
  program_revision: number;
  code_digest: Digest;
  workspace: RelativePath;
  parameters: {
    [k: string]: unknown;
  };
  resume_ref: ObjectRef | null;
}
/**
 * 必须校验登记 result_schema；退出码 0 不足以证明业务成功。
 */
export interface ProgramResult {
  schema_version: 1;
  record_type: "ProgramResult";
  dispatch_id: ID;
  execution_id: ID;
  outcome: "SUCCEEDED" | "FAILED" | "WAITING" | "UNKNOWN";
  summary: string;
  detail: ObjectRef;
  /**
   * @minItems 0
   */
  artifacts: Artifact[];
  effect: "NOT_STARTED" | "APPLIED" | "NOT_APPLIED" | "PARTIAL" | "UNKNOWN";
  resume_ref: ObjectRef | null;
  /**
   * @minItems 1
   */
  evidence: ObjectRef[];
}
/**
 * 单写事务，frame 原始 payload 字节 checksum 外包；同帧全生效或全不生效。
 */
export interface JournalTransaction {
  schema_version: 1;
  record_type: "JournalTransaction";
  txn_id: ID;
  sequence: number;
  owner_epoch: number;
  previous_digest: Digest;
  /**
   * @minItems 0
   */
  mutations: Mutation[];
  /**
   * @minItems 0
   */
  log_records: OperationLogRecord[];
  /**
   * @minItems 0
   */
  receipts: CommandReceipt[];
  committed_at: Time;
}
/**
 * 服务端加载 snapshot 后按 object_type 校验并执行状态 guards；revision 必须 +1。
 */
export interface Mutation {
  object_type:
    | "Session"
    | "Input"
    | "Context"
    | "ModelCall"
    | "Consciousness"
    | "CompactionJob"
    | "TaskPlan"
    | "Execution"
    | "Dispatch"
    | "WorkerReceipt"
    | "Checkpoint"
    | "TaskResult"
    | "Feedback"
    | "DecisionRequest"
    | "Operation"
    | "AuthorizationRequest"
    | "AuthorizationRule"
    | "SafetyRule"
    | "ProgramRegistration"
    | "Notification"
    | "ArchiveManifest"
    | "WorldCommand"
    | "UserInstructions"
    | "MainPromptSnapshot";
  object_id: ID;
  expected_revision: number;
  new_revision: number;
  snapshot: ObjectRef;
}
export interface UserInstructions {
  schema_version: 1;
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  record_type: "UserInstructions";
  content: string;
  updated_by: "MASTER_UI" | "DEFAULT";
}
export interface MainPromptSnapshot {
  schema_version: 1;
  id: ID;
  /**
   * 宿主 CAS revision；从 1 开始。
   */
  revision: number;
  updated_at: Time;
  record_type: "MainPromptSnapshot";
  session_id: ID;
  base_prompt_version: string;
  instructions_revision: number;
  system_prompt_hash: Digest;
  system_message: ObjectRef;
}

export type Contract = SecretaryDemoV1;
