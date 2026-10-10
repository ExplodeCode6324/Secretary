/* Generated from docs/api/v1/schema.json. Do not hand-edit. */

/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "ApiV1".
 */
export type ApiV1 = Core | Assistant | Receipt | Error | Envelope;
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
    [k: string]: Capability;
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
 * via the `definition` "RecoveryCommand".
 */
export interface RecoveryCommand {
  request_id: string;
  group_key: string;
  attempt_id: string;
  policy: string;
  implementation_version: string;
  config_hash: string;
  source_hash: string;
  expected_revision: string;
  model_call_id: string | null;
  model_request_hash: string | null;
  actual_payload_hash: string | null;
  authorization_id: string;
  issued_at: string;
  expires_at: string;
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
 * via the `definition` "RuleCommand".
 */
export interface RuleCommand {
  request_id: string;
  action: "file.write" | "program.run" | "world.change";
  resource: string;
  parameters: Json;
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
  [k: string]: unknown;
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
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "Activity".
 */
export interface Activity {
  id: string;
  kind?: string;
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
 * via the `definition` "RecoveryBinding".
 */
export interface RecoveryBinding {
  group_key: string;
  attempt_id: string;
  policy: string;
  implementation_version: string;
  config_hash: string;
  source_hash: string;
  expected_revision: string;
  model_call_id: string | null;
  model_request_hash: string | null;
  actual_payload_hash: string | null;
  authorization_id: string;
  issued_at: string;
  expires_at: string;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "RecoveryGroup".
 */
export interface RecoveryGroup {
  group_key: string;
  attempt_id: string;
  status: string;
  reason: string | null;
  binding: RecoveryBinding | null;
  source_count: number;
  sources: {
    id: string;
    role: string | null;
    sequence: string | null;
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ApiV1Definitions`'s JSON-Schema
 * via the `definition` "RecoveryPage".
 */
export interface RecoveryPage {
  items: RecoveryGroup[];
  version: string;
  next_cursor: string | null;
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
  [k: string]: unknown;
}
