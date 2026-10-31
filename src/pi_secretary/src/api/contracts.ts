/* Generated from docs/api/v1/schema.json. Do not hand-edit. */

/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ApiV1".
 */
export type ApiV1 =
  | Core
  | Assistant
  | Receipt
  | Error
  | Envelope
  | SyncCursor
  | SyncChange
  | SyncTransaction
  | SyncPage
  | PresentedCommand
  | NotificationContent
  | Notification
  | NotificationPage;
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Json".
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | unknown[]
  | {
      [k: string]: unknown;
    };
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "SyncChange".
 */
export type SyncChange =
  | {
      kind: "record";
      resource_type: string;
      resource_id: string;
      revision: string;
    }
  | {
      kind: "invalidate";
      resource_type: string;
      query: string;
    };
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Revision".
 */
export type Revision = string;
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "WorldEdit".
 */
export type WorldEdit = {
  [k: string]: unknown;
} & {
  kind: "FACT" | "ENTITY";
  expected_revision: string;
  entity_kind?:
    | "PERSON"
    | "ORGANIZATION"
    | "PROJECT"
    | "DEVICE"
    | "SERVICE"
    | "RESOURCE"
    | "GOAL";
  display_name?: string;
  external_key?: string | null;
  retire?: boolean;
  mode?: "ASSERT" | "CORRECT" | "RETRACT";
  predicate_key?: string;
  scope_key?: string;
  value?: unknown;
  resolution_note?: string | null;
  /**
   * 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。
   */
  entity_id?: string;
  /**
   * 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。
   */
  subject_id?: string;
  /**
   * 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。
   */
  assertion_id?: string;
  object_entity_id?: string | null;
  resolve_conflict_id?: string | null;
  /**
   * UTC RFC3339；时区意图在 Trigger.timezone 另存。
   */
  valid_from?: string;
  valid_to?: string | null;
  fresh_until?: string | null;
  /**
   * 实体别名；缺省时保留已有值，空数组清空。
   *
   * @maxItems 20
   */
  aliases?: string[];
};
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "RuleCommand".
 */
export type RuleCommand = {
  [k: string]: unknown;
};
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "TimelineItem".
 */
export type TimelineItem =
  | Message
  | {
      id: string;
      kind: "activity";
      revision: Revision;
      activity: Activity;
      [k: string]: unknown;
    };
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "OperationDetail".
 */
export type OperationDetail = Operation & {
  display: OperationDisplay;
  [k: string]: unknown;
};
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ID".
 */
export type ID = string;
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Time".
 */
export type Time = string;
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "TaskBrowserRow".
 */
export type TaskBrowserRow =
  | {
      id: string;
      kind: "group";
      group: TaskBrowserGroup;
    }
  | {
      id: string;
      kind: "task";
      task: TaskBrowserTask;
    };

export interface ApiV1Definitions {}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Core".
 */
export interface Core {
  api_version: "1";
  data_domain_id: string;
  owner_id: string;
  instance_id: string;
  session_id: string;
  state: string;
  mode: string;
  capabilities: {
    [k: string]: Capability | AttachmentCapability;
  };
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Capability".
 */
export interface Capability {
  state: "supported" | "not_supported" | "not_configured";
  allowed: boolean;
  reason: string | null;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "AttachmentCapability".
 */
export interface AttachmentCapability {
  state: "supported" | "not_supported" | "not_configured";
  allowed: boolean;
  reason: string | null;
  formats?: ("image/png" | "image/jpeg")[];
  limits?: {
    [k: string]: string | number;
  };
  import_allowed?: boolean;
  reserved_bytes?: string;
  import_count?: number;
  residency_policy?: "attachment-residency-v1";
  handled_image_loops?: 0;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Assistant".
 */
export interface Assistant {
  name: string;
  actor_id: "assistant";
  revision: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Receipt".
 */
export interface Receipt {
  request_id: string;
  command: string;
  acceptance: "ACCEPTED";
  state: "ACCEPTED" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "UNKNOWN";
  revision: string;
  resource_ids: ResourceLink[];
  error_code: string | null;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ResourceLink".
 */
export interface ResourceLink {
  type: string;
  id: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Error".
 */
export interface Error {
  code: string;
  message: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Envelope".
 */
export interface Envelope {
  api_version: "1";
  data: Json;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "SyncCursor".
 */
export interface SyncCursor {
  cursor: string;
  sequence: string;
  instance_id: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "SyncTransaction".
 */
export interface SyncTransaction {
  cursor: string;
  changes: SyncChange[];
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "SyncPage".
 */
export interface SyncPage {
  transactions: SyncTransaction[];
  next_cursor: string;
  has_more: boolean;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "PresentedCommand".
 */
export interface PresentedCommand {
  request_id: string;
  client_id: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "NotificationContent".
 */
export interface NotificationContent {
  text: string;
  media_type: string;
  content_version: string;
  bytes: string;
  truncated: boolean;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Notification".
 */
export interface Notification {
  id: string;
  revision: string;
  state: "QUEUED" | "SENDING" | "SENT" | "FAILED" | "DELIVERY_UNKNOWN";
  session_id: string;
  channel: string;
  requested_at: string;
  updated_at: string;
  created_sequence: string;
  read_at: string | null;
  presented: {
    client_id: string;
    presented_at: string;
  }[];
  content: NotificationContent;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "NotificationPage".
 */
export interface NotificationPage {
  items: Notification[];
  version: string;
  next_cursor: string | null;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "EmptyCommand".
 */
export interface EmptyCommand {
  request_id: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ProfileCommand".
 */
export interface ProfileCommand {
  request_id: string;
  name: string;
  expected_revision: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ClientCommand".
 */
export interface ClientCommand {
  request_id: string;
  name: string;
  client_id?: string;
  instance_id?: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "MessageCommand".
 */
export interface MessageCommand {
  request_id: string;
  text: string;
  /**
   * @maxItems 4
   */
  attachment_ids?: string[];
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "TaskCommand".
 */
export interface TaskCommand {
  request_id: string;
  goal: string;
  reuse_task_id?: string;
  parent_execution_id?: string;
  program_id?: string;
  at?: string;
  interval_seconds?: number;
  deadline?: string;
  /**
   * @maxItems 100
   */
  materials?: string[];
  /**
   * @maxItems 100
   */
  constraints?: string[];
  /**
   * @maxItems 100
   */
  acceptance?: string[];
  /**
   * @maxItems 100
   */
  preconditions?: {
    /**
     * 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。
     */
    condition_id: string;
    kind: "DEVICE_AVAILABLE" | "EXECUTION_SUCCEEDED" | "RESOURCE_PRESENT";
    /**
     * 登记设备/资源标识或 execution UUID
     */
    target: string;
    required_revision: string | null;
  }[];
  scope_id?: string | null;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "AnswerCommand".
 */
export interface AnswerCommand {
  request_id: string;
  answer: Json;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ApprovalCommand".
 */
export interface ApprovalCommand {
  request_id: string;
  expected_revision: string;
  display_hash: string;
  decision: "APPROVE" | "REJECT" | "REVOKE";
  remember?:
    | {
        prefix_tokens: number;
        expires_at: string | null;
      }
    | {
        path_prefix: string;
        expires_at: string | null;
      };
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "RevisionCommand".
 */
export interface RevisionCommand {
  request_id: string;
  expected_revision: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "DraftCommand".
 */
export interface DraftCommand {
  request_id: string;
  expected_revision: string;
  payload: {
    instructions: null | {
      content: string;
      expected_revision: string;
    };
    /**
     * @maxItems 100
     */
    edits: WorldEdit[];
    /**
     * @maxItems 0
     */
    command_ids: unknown[];
  };
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ResolveCommand".
 */
export interface ResolveCommand {
  request_id: string;
  state: "COMPLETED" | "CANCELLED";
  note: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ProgramCommand".
 */
export interface ProgramCommand {
  request_id: string;
  entrypoint: string;
  name: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Session".
 */
export interface Session {
  id: string;
  revision: Revision;
  state: string;
  recovery_error: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Source".
 */
export interface Source {
  content_version: string;
  bytes: string;
  media_type: string;
  event_ids: string[];
  locator_state: string;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "TaskSummary".
 */
export interface TaskSummary {
  id: string;
  revision: Revision;
  state: string;
  goal: string;
  active_execution_ids: string[];
  scope_id?: string | null;
  active_executions: {
    id: string;
    state: string;
  }[];
  latest_execution_id: string | null;
  latest_execution_state: string | null;
  pending_request_count: number;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Result".
 */
export interface Result {
  id: string;
  revision: Revision;
  outcome: string;
  summary: string;
  limitations: string[];
  artifact_ids: string[];
  needs_action: boolean;
  verified_by: string;
  observed_at: string;
  scope_id?: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Proposal".
 */
export interface Proposal {
  goal: string;
  constraints: string[];
  acceptance_criteria: string[];
  scope_id?: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "TaskDetail".
 */
export interface TaskDetail {
  id: string;
  revision: Revision;
  state: string;
  goal: string;
  baseline: Proposal;
  effective_proposal: Proposal | null;
  latest_execution_id: string | null;
  latest_state: string | null;
  continuation: {
    allowed: boolean;
    reason: string | null;
    [k: string]: unknown;
  };
  pending_requests: {
    request_id: string;
    due_at: string;
    [k: string]: unknown;
  }[];
  pending_request_count: number;
  result: Result | null;
  scope_id?: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Execution".
 */
export interface Execution {
  id: string;
  revision: Revision;
  task_id: string;
  state: string;
  retention_state: string;
  last_activity_at: string;
  waiting_request_ids: string[];
  unknown_operation_ids: string[];
  cancel_requested: boolean;
  result: Result | null;
  scope_id?: string | null;
  condition_results: ConditionResult[];
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ConditionResult".
 */
export interface ConditionResult {
  condition_id: string;
  status: "MET" | "NOT_MET" | "UNKNOWN";
  checked_at: string;
  evidence: {
    content_version: string;
    bytes: string;
    media_type: string;
  }[];
  reason: string | null;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Artifact".
 */
export interface Artifact {
  id: string;
  name: string;
  task_id: string;
  execution_id: string;
  content_version: string;
  bytes: string;
  media_type: string;
  state: string;
  relative_path: string | null;
  path_base: "scope" | "task" | "unknown";
  scope_id: string | null;
  path_unavailable_reason: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Message".
 */
export interface Message {
  id: string;
  kind: "message";
  revision: Revision;
  role: string;
  at?: string;
  text: string;
  thinking?: string;
  call_id: string | null;
  incomplete: boolean;
  next_cursor: string | null;
  persistence?: "transient" | "durable";
  preview_status?: "running" | "saved" | "incomplete";
  truncated?: boolean;
  source_event_id?: string;
  request_id?: string;
  task_id?: string;
  execution_id?: string;
  result_id?: string;
  decision_request_id?: string;
  notification_id?: string;
  source_kind?:
    | "master_input"
    | "assistant_response"
    | "task_feedback"
    | "notification"
    | "system_input";
  outcome?:
    | "completed"
    | "continued"
    | "truncated"
    | "failed"
    | "interrupted"
    | "unknown";
  preview_availability?: "active" | "expired";
  thinking_preview?: ThinkingPreview;
  input_id?: string;
  input_revision?: string;
  input_state?: "ACCEPTED" | "CLAIMED" | "HANDLED" | "WITHDRAWN";
  /**
   * @maxItems 4
   */
  attachments?: AttachmentMetadata[];
  withdrawn?: boolean;
  tool_name?: string;
  [k: string]: unknown;
}
/**
 * Non-authoritative visible reasoning prefix: at most 20 extended grapheme clusters and 4096 JSON-encoded text bytes including an added ellipsis. No redacted blocks or signatures.
 *
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ThinkingPreview".
 */
export interface ThinkingPreview {
  /**
   * Raw model text; terminal consumers must escape or sanitize control characters and ANSI sequences before rendering.
   */
  text: string;
  /**
   * Visible source was omitted from this preview; independent of response outcome and retained-body truncation.
   */
  truncated: boolean;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "AttachmentMetadata".
 */
export interface AttachmentMetadata {
  attachment_id: string;
  import_request_id: string;
  name: string;
  media_type: "image/png" | "image/jpeg";
  bytes: string;
  sha256: string;
  width: number;
  height: number;
  created_at: string;
  availability: "available" | "unavailable";
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Activity".
 */
export interface Activity {
  id: string;
  kind?: string;
  /**
   * Display status. Includes truncated for a persisted length-limited model response; persistence and parent business states are unchanged.
   */
  status?: string;
  phase?: string;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Timeline".
 */
export interface Timeline {
  items: TimelineItem[];
  version: string;
  generation: string;
  before: string | null;
  after: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "MemoryItem".
 */
export interface MemoryItem {
  item_id: string;
  tier: string;
  summary: string;
  goals: string[];
  constraints: string[];
  decisions: string[];
  open_questions: string[];
  task_ids: string[];
  sources: Source[];
  updated_at: string;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Commitment".
 */
export interface Commitment {
  id: string;
  text: string;
  state: string;
  task_ids: string[];
  resolution_event_ids: string[];
  sources: Source[];
  source_event_ids: string[];
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Decision".
 */
export interface Decision {
  id: string;
  revision: Revision;
  state: string;
  task_id: string;
  execution_id: string;
  question: string;
  options: string[];
  impact: string;
  deadline: string | null;
  answer: Json | null;
  answered_by: string | null;
  answer_request_id: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Authorization".
 */
export interface Authorization {
  id: string;
  revision: Revision;
  state: string;
  display_hash: string;
  expires_at: string | null;
  scope: {
    session_id: string | null;
    task_id: string | null;
    execution_id: string | null;
    [k: string]: unknown;
  };
  display?: Json;
  remembered_rule_id?: string | null;
  remember_context?: null | {
    root: string;
    action: "file.write" | "shell.run";
    path: string | null;
    tokens: string[] | null;
  };
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Settings".
 */
export interface Settings {
  draft: {
    id: string;
    revision: Revision;
    payload: Json;
    [k: string]: unknown;
  };
  applications: {
    id: string;
    revision: Revision;
    state: string;
    [k: string]: unknown;
  }[];
  blocked: boolean;
  world_available: boolean;
  effective_instructions: {
    revision: string;
    content: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "MemoryStatus".
 */
export interface MemoryStatus {
  revision: Revision;
  state: string;
  maintenance_mode: string;
  last_success_at: string | null;
  pending_source_bytes: string;
  errors: string[];
  covered_event_sequence: string | null;
  extraction?: {
    id: string;
    state: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
    round: number;
    next_attempt_at: string | null;
    error: string | null;
  }[];
  next_attempt_at?: string | null;
  retry_round?: number;
  extraction_pending_count?: number;
  extraction_failed_count?: number;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "AttentionItem".
 */
export interface AttentionItem {
  id: string;
  type: string;
  revision: Revision;
  expires_at: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Attention".
 */
export interface Attention {
  items: AttentionItem[];
  version: string;
  next_cursor: string | null;
  counts: {
    authorizations: number;
    decisions: number;
    [k: string]: unknown;
  };
  as_of: string;
  valid_until: string | null;
  session_id: string;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "TaskPage".
 */
export interface TaskPage {
  items: TaskSummary[];
  version: string;
  next_cursor: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ExecutionPage".
 */
export interface ExecutionPage {
  items: Execution[];
  version: string;
  next_cursor: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ArtifactPage".
 */
export interface ArtifactPage {
  items: Artifact[];
  version: string;
  next_cursor: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "MemoryPage".
 */
export interface MemoryPage {
  items: MemoryItem[];
  version: string;
  next_cursor: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "CommitmentPage".
 */
export interface CommitmentPage {
  items: Commitment[];
  version: string;
  next_cursor: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "DecisionPage".
 */
export interface DecisionPage {
  items: Decision[];
  version: string;
  next_cursor: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "AuthorizationPage".
 */
export interface AuthorizationPage {
  items: Authorization[];
  version: string;
  next_cursor: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "RelatedPage".
 */
export interface RelatedPage {
  items: {
    id: string;
    type: string;
    basis: string;
    [k: string]: unknown;
  }[];
  version: string;
  next_cursor: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "RequestStatus".
 */
export interface RequestStatus {
  receipt: Receipt;
  resources: {
    id: string;
    type: string;
    state: string | null;
    revision: string | null;
    [k: string]: unknown;
  }[];
  result: Json | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "WorldPage".
 */
export interface WorldPage {
  items: Json[];
  world_version: string;
  next_cursor: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "WorldSlot".
 */
export interface WorldSlot {
  slot: {
    slot_id: string;
    subject_id: string;
    predicate_key: string;
    scope_key: string;
    revision: string;
    [k: string]: unknown;
  } | null;
  world_version: string;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ClientRegistration".
 */
export interface ClientRegistration {
  id: string;
  revision: Revision;
  name: string;
  owner_id: string;
  updated_at: string;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "TaskRequestStatus".
 */
export interface TaskRequestStatus {
  request_id: string;
  task_id: string;
  occurrence_key: string | null;
  execution_id: string | null;
  state: string;
  reason: Json | null;
  goal: string;
  constraints: string[];
  acceptance_criteria: string[];
  scope_id?: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "PendingRequestPage".
 */
export interface PendingRequestPage {
  items: {
    request_id: string;
    due_at: string;
    goal: string;
    constraints: string[];
    acceptance_criteria: string[];
    [k: string]: unknown;
  }[];
  version: string;
  next_cursor: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Operation".
 */
export interface Operation {
  id: string;
  revision: Revision;
  state: string;
  scope: {
    session_id: string | null;
    task_id: string | null;
    execution_id: string | null;
    [k: string]: unknown;
  };
  action: {
    action: string;
    resource: string;
    parameters_hash: string;
    intent_id: string;
    [k: string]: unknown;
  };
  effect?: string;
  resolution?: {
    outcome: "APPLIED" | "NOT_APPLIED" | "PARTIAL" | "UNVERIFIED";
    resolved_by: "MASTER_UI";
    note: string;
    resolved_at: string;
    note_truncated?: boolean;
    [k: string]: unknown;
  } | null;
  process_state?: "STARTING" | "RUNNING" | "STOPPED" | "UNCONFIRMED" | null;
  scope_id?: string | null;
  display?: OperationDisplay;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "OperationDisplay".
 */
export interface OperationDisplay {
  parameters: OperationText;
  stdout: OperationText;
  stderr: OperationText;
  reason: OperationText;
  source_truncated: boolean | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "OperationText".
 */
export interface OperationText {
  state: "available" | "unavailable";
  text: string;
  bytes: string;
  content_version: string | null;
  truncated: boolean;
  next_cursor: string | null;
  unavailable_reason: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "OperationPage".
 */
export interface OperationPage {
  items: Operation[];
  version: string;
  next_cursor: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Program".
 */
export interface Program {
  id: string;
  revision: Revision;
  state: string;
  name: string;
  description: string;
  code_digest: string;
  supports_resume: boolean;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ProgramPage".
 */
export interface ProgramPage {
  items: Program[];
  version: string;
  next_cursor: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "AuthorizationRule".
 */
export interface AuthorizationRule {
  id: string;
  revision: Revision;
  state: string;
  actions: string[];
  resource_prefixes: string[];
  valid_from: string;
  expires_at: string | null;
  constraints:
    | {
        parameter_hash: string;
      }
    | {
        kind: "file-prefix";
      }
    | {
        kind: "command-prefix";
        /**
         * @minItems 1
         */
        command_prefix: string[];
      }
    | {
        kind: "program";
        program_id: string;
      };
  match_count: number;
  last_matched_at: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "RulePage".
 */
export interface RulePage {
  items: AuthorizationRule[];
  version: string;
  next_cursor: string | null;
  builtin_policies: {
    id: "builtin:workspace-write" | "builtin:readonly-shell";
    revision: number;
    description: string;
    match_count: number;
    last_matched_at: string | null;
  }[];
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "OperationResolveCommand".
 */
export interface OperationResolveCommand {
  request_id: string;
  expected_revision: Revision;
  outcome: "APPLIED" | "NOT_APPLIED" | "PARTIAL" | "UNVERIFIED";
  note: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Scope".
 */
export interface Scope {
  id: string;
  revision: Revision;
  updated_at: string;
  name: string;
  description: string;
  kind: "DIRECTORY" | "NONE";
  root_path: string | null;
  notes_path: string | null;
  state: "ACTIVE" | "ARCHIVED";
  default_write?: "allow" | "ask";
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ScopeCreateCommand".
 */
export interface ScopeCreateCommand {
  request_id: string;
  name: string;
  description?: string;
  kind: "DIRECTORY" | "NONE";
  root_path?: string | null;
  notes_path?: string | null;
  default_write?: "allow" | "ask";
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ScopeUpdateCommand".
 */
export interface ScopeUpdateCommand {
  request_id: string;
  name?: string;
  description?: string;
  kind?: "DIRECTORY" | "NONE";
  root_path?: string | null;
  notes_path?: string | null;
  expected_revision: Revision;
  default_write?: "allow" | "ask";
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ScopePage".
 */
export interface ScopePage {
  items: Scope[];
  version: string;
  next_cursor: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Wakeup".
 */
export interface Wakeup {
  id: string;
  revision: string;
  session_id: string;
  updated_at: string;
  at: string;
  note: string;
  state: "PENDING" | "FIRED" | "CANCELLED";
  source_event_ids: string[];
  fired_at: string | null;
  cancelled_at: string | null;
  input_id: string | null;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "WakeupPage".
 */
export interface WakeupPage {
  items: Wakeup[];
  version: string;
  next_cursor: string | null;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "PushTargetConfig".
 */
export interface PushTargetConfig {
  name: string;
  kind: "NTFY" | "BARK" | "MACOS_NOTIFICATION";
  endpoint: string | null;
  enabled: boolean;
  quiet_hours: {
    timezone: string;
    start: string;
    end: string;
  } | null;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "PushTarget".
 */
export interface PushTarget {
  id: ID;
  revision: string;
  updated_at: Time;
  name: string;
  kind: "NTFY" | "BARK" | "MACOS_NOTIFICATION";
  endpoint: string | null;
  enabled: boolean;
  quiet_hours: {
    timezone: string;
    start: string;
    end: string;
  } | null;
  generation: ID;
  after_sequence: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "PushTargetPage".
 */
export interface PushTargetPage {
  items: PushTarget[];
  version: string;
  next_cursor: string | null;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "PushDispatch".
 */
export interface PushDispatch {
  id: ID;
  revision: string;
  updated_at: Time;
  target_id: ID;
  generation: ID;
  notification_id: ID;
  state: "PENDING" | "SENDING" | "DISPATCHED" | "FAILED" | "CANCELLED";
  batch_id: ID | null;
  attempts: number;
  /**
   * @maxItems 4
   */
  attempt_history: {
    id: ID;
    at: Time;
  }[];
  next_attempt_at: Time;
  dispatched_at: Time | null;
  error_code:
    | (
        | "SECRET_UNAVAILABLE"
        | "PROVIDER_REJECTED"
        | "TRANSPORT_FAILED"
        | "UNSUPPORTED_PLATFORM"
        | "CONTENT_UNAVAILABLE"
        | "INTERRUPTED"
      )
    | null;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "PushDispatchPage".
 */
export interface PushDispatchPage {
  items: PushDispatch[];
  version: string;
  next_cursor: string | null;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "PushTargetCreateCommand".
 */
export interface PushTargetCreateCommand {
  request_id: ID;
  name: string;
  kind: "NTFY" | "BARK" | "MACOS_NOTIFICATION";
  endpoint: string | null;
  enabled: boolean;
  quiet_hours: {
    timezone: string;
    start: string;
    end: string;
  } | null;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "PushTargetUpdateCommand".
 */
export interface PushTargetUpdateCommand {
  request_id: ID;
  expected_revision: Revision;
  name: string;
  kind: "NTFY" | "BARK" | "MACOS_NOTIFICATION";
  endpoint: string | null;
  enabled: boolean;
  quiet_hours: {
    timezone: string;
    start: string;
    end: string;
  } | null;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "SSEPreview".
 */
export interface SSEPreview {
  id: string;
  version: number;
  status: "running" | "saved" | "incomplete";
  truncated: boolean;
  blocks: {
    index: number;
    type: "text";
    text: string;
    [k: string]: unknown;
  }[];
  thinking_preview?: ThinkingPreview;
  [k: string]: unknown;
}
/**
 * Data of the transient SSE event; no durable cursor and no full reasoning blocks. Activities remain an open sampled snapshot.
 *
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "SSETransient".
 */
export interface SSETransient {
  previews: SSEPreview[];
  activities: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "AttachmentImportCommand".
 */
export interface AttachmentImportCommand {
  request_id: string;
  source_path: string;
  expected_sha256: string;
  expected_bytes: string;
  name: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "TaskBrowserExecution".
 */
export interface TaskBrowserExecution {
  id: string;
  state: string;
  kind: string;
  retention_state: string;
  created_at: string | null;
  created_sequence: string;
  started_at: string | null;
  ended_at: string | null;
  invoked_at: string | null;
  ordering_source: string;
  history_availability: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "TaskBrowserTask".
 */
export interface TaskBrowserTask {
  id: string;
  scope_id: string | null;
  scope_name: string;
  revision: string;
  goal: string;
  goal_truncated: boolean;
  state: string;
  executor: string;
  trigger: string;
  next_due_at: string | null;
  deadline: string | null;
  schedule_status: string;
  current_reasons: string[];
  active_executions: TaskBrowserExecution[];
  latest_execution: TaskBrowserExecution | null;
  pending_request_count: number;
  pending_occurrence_count: number;
  pending_due_at: string | null;
  attention_ids: string[];
  unknown_operation_ids: string[];
  latest_result: string | null;
  initialization_error: string | null;
  current: boolean;
  latest_result_observed_at: string | null;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "TaskBrowserGroup".
 */
export interface TaskBrowserGroup {
  id: string;
  scope_id: string | null;
  name: string;
  count: number;
  created_at: string | null;
  created_sequence: string | null;
  active_at: string | null;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "TaskBrowserCounts".
 */
export interface TaskBrowserCounts {
  scopes: number;
  archived_scopes: number;
  shared_tasks: number;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "TaskBrowserPage".
 */
export interface TaskBrowserPage {
  items: TaskBrowserRow[];
  counts: TaskBrowserCounts;
  generation: string;
  version: string;
  before: string | null;
  after: string | null;
  as_of: string;
  valid_until: string | null;
  target: string | null;
  historical: TaskBrowserTask | null;
  suggestions: string[];
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "TaskBrowserDetail".
 */
export interface TaskBrowserDetail {
  id: string;
  kind: "message";
  revision: Revision;
  role: string;
  at?: string;
  text: string;
  thinking?: string;
  call_id: string | null;
  incomplete: boolean;
  next_cursor: string | null;
  persistence?: "transient" | "durable";
  preview_status?: "running" | "saved" | "incomplete";
  truncated?: boolean;
  source_event_id?: string;
  request_id?: string;
  task_id?: string;
  execution_id?: string;
  result_id?: string;
  decision_request_id?: string;
  notification_id?: string;
  source_kind?:
    | "master_input"
    | "assistant_response"
    | "task_feedback"
    | "notification"
    | "system_input";
  outcome?:
    | "completed"
    | "continued"
    | "truncated"
    | "failed"
    | "interrupted"
    | "unknown";
  preview_availability?: "active" | "expired";
  thinking_preview?: ThinkingPreview;
  input_id?: string;
  input_revision?: string;
  input_state?: "ACCEPTED" | "CLAIMED" | "HANDLED" | "WITHDRAWN";
  /**
   * @maxItems 4
   */
  attachments?: AttachmentMetadata[];
  withdrawn?: boolean;
  task: TaskBrowserTask;
  executions: TaskBrowserExecution[];
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "TaskBrowserMessages".
 */
export interface TaskBrowserMessages {
  items: Message[];
  generation: string;
  version: string;
  before: string | null;
  after: string | null;
  availability: string;
}
