// Public API v1 projections. Unknown state strings are preserved.
import Foundation

public struct MMemoryStatusExtractionItem: Codable, Sendable {
  public var id: String
  public var state: String
  public var round: Int
  public var next_attempt_at: String?
  public var error: String?
}

public struct MMemoryStatus: Codable, Sendable {
  public var revision: DecimalString
  public var state: String
  public var maintenance_mode: String
  public var last_success_at: String?
  public var pending_source_bytes: DecimalString
  public var errors: [String]
  public var covered_event_sequence: String?
  public var extraction: [MMemoryStatusExtractionItem]?
  public var next_attempt_at: String?
  public var retry_round: Int?
  public var extraction_pending_count: Int?
  public var extraction_failed_count: Int?
}

public struct MMemoryItem: Codable, Sendable {
  public var item_id: String
  public var tier: String
  public var summary: String
  public var goals: [String]
  public var constraints: [String]
  public var decisions: [String]
  public var open_questions: [String]
  public var task_ids: [String]
  public var sources: [MSource]
  public var updated_at: String
}

public struct MCommitment: Codable, Sendable {
  public var id: String
  public var text: String
  public var state: String
  public var task_ids: [String]
  public var resolution_event_ids: [String]
  public var sources: [MSource]
  public var source_event_ids: [String]
}

public struct MSource: Codable, Sendable {
  public var content_version: String
  public var bytes: DecimalString
  public var media_type: String
  public var event_ids: [String]
  public var locator_state: String
}

public struct MMemoryPage: Codable, Sendable {
  public var items: [MMemoryItem]
  public var version: String
  public var next_cursor: String?
}

public struct MCommitmentPage: Codable, Sendable {
  public var items: [MCommitment]
  public var version: String
  public var next_cursor: String?
}
