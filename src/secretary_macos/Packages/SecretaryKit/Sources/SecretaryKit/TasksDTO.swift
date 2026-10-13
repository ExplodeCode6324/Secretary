// Public API v1 projections. Unknown state strings are preserved.
import Foundation

public struct MTaskSummary: Codable, Sendable {
  public var id: String
  public var revision: DecimalString
  public var state: String
  public var goal: String
  public var active_execution_ids: [String]
  public var scope_id: String?
}

public struct MTaskDetailContinuation: Codable, Sendable {
  public var allowed: Bool
  public var reason: String?
}

public struct MTaskDetailPendingRequestsItem: Codable, Sendable {
  public var request_id: String
  public var due_at: String
}

public struct MTaskDetail: Codable, Sendable {
  public var id: String
  public var revision: DecimalString
  public var state: String
  public var goal: String
  public var baseline: MProposal
  public var effective_proposal: MProposal?
  public var latest_execution_id: String?
  public var latest_state: String?
  public var continuation: MTaskDetailContinuation
  public var pending_requests: [MTaskDetailPendingRequestsItem]
  public var pending_request_count: Int
  public var result: MResult?
  public var scope_id: String?
}

public struct MExecution: Codable, Sendable {
  public var id: String
  public var revision: DecimalString
  public var task_id: String
  public var state: String
  public var retention_state: String
  public var last_activity_at: String
  public var waiting_request_ids: [String]
  public var unknown_operation_ids: [String]
  public var cancel_requested: Bool
  public var result: MResult?
  public var scope_id: String?
  public var condition_results: [MConditionResult]
}

public struct MTaskRequestStatus: Codable, Sendable {
  public var request_id: String
  public var task_id: String
  public var occurrence_key: String?
  public var execution_id: String?
  public var state: String
  public var reason: JSONValue?
  public var goal: String
  public var constraints: [String]
  public var acceptance_criteria: [String]
  public var scope_id: String?
}

public struct MProposal: Codable, Sendable {
  public var goal: String
  public var constraints: [String]
  public var acceptance_criteria: [String]
  public var scope_id: String?
}

public struct MResult: Codable, Sendable {
  public var id: String
  public var revision: DecimalString
  public var outcome: String
  public var summary: String
  public var limitations: [String]
  public var artifact_ids: [String]
  public var needs_action: Bool
  public var verified_by: String
  public var observed_at: String
  public var scope_id: String?
}

public struct MConditionResultEvidenceItem: Codable, Sendable {
  public var content_version: String
  public var bytes: DecimalString
  public var media_type: String
}

public struct MConditionResult: Codable, Sendable {
  public var condition_id: String
  public var status: String
  public var checked_at: String
  public var evidence: [MConditionResultEvidenceItem]
  public var reason: String?
}

public struct MTaskPage: Codable, Sendable {
  public var items: [MTaskSummary]
  public var version: String
  public var next_cursor: String?
}

public struct MExecutionPage: Codable, Sendable {
  public var items: [MExecution]
  public var version: String
  public var next_cursor: String?
}

public struct MPendingRequestPageItemsItem: Codable, Sendable {
  public var request_id: String
  public var due_at: String
  public var goal: String
  public var constraints: [String]
  public var acceptance_criteria: [String]
}

public struct MPendingRequestPage: Codable, Sendable {
  public var items: [MPendingRequestPageItemsItem]
  public var version: String
  public var next_cursor: String?
}
