// Public API v1 projections. Unknown state strings are preserved.
import Foundation

public struct MAuthorizationScope: Codable, Sendable {
  public var session_id: String?
  public var task_id: String?
  public var execution_id: String?
}

public struct MAuthorizationRememberContext: Codable, Sendable {
  public var root: String
  public var action: String
  public var path: String?
  public var tokens: [String]?
}

public struct MAuthorization: Codable, Sendable {
  public var id: String
  public var revision: DecimalString
  public var state: String
  public var display_hash: String
  public var expires_at: String?
  public var scope: MAuthorizationScope
  public var display: JSONValue?
  public var remembered_rule_id: String?
  public var remember_context: MAuthorizationRememberContext?
}

public struct MDecision: Codable, Sendable {
  public var id: String
  public var revision: DecimalString
  public var state: String
  public var task_id: String
  public var execution_id: String
  public var question: String
  public var options: [String]
  public var impact: String
  public var deadline: String?
  public var answer: JSONValue?
  public var answered_by: String?
  public var answer_request_id: String?
}

public struct MOperationScope: Codable, Sendable {
  public var session_id: String?
  public var task_id: String?
  public var execution_id: String?
}

public struct MOperationAction: Codable, Sendable {
  public var action: String
  public var resource: String
  public var parameters_hash: String
  public var intent_id: String
}

public struct MOperationResolution: Codable, Sendable {
  public var outcome: String
  public var resolved_by: String
  public var note: String
  public var resolved_at: String
  public var note_truncated: Bool?
}

public struct MOperation: Codable, Sendable {
  public var id: String
  public var revision: DecimalString
  public var state: String
  public var scope: MOperationScope
  public var action: MOperationAction
  public var effect: String?
  public var resolution: MOperationResolution?
  public var process_state: String?
  public var scope_id: String?
  public var display: MOperationDisplay?
}

public struct MOperationDisplay: Codable, Sendable {
  public var parameters: MOperationText
  public var stdout: MOperationText
  public var stderr: MOperationText
  public var reason: MOperationText
  public var source_truncated: Bool?
}

public struct MOperationText: Codable, Sendable {
  public var state: String
  public var text: String
  public var bytes: DecimalString
  public var content_version: String?
  public var truncated: Bool
  public var next_cursor: String?
  public var unavailable_reason: String?
}

public struct MAuthorizationRule: Codable, Sendable {
  public var id: String
  public var revision: DecimalString
  public var state: String
  public var actions: [String]
  public var resource_prefixes: [String]
  public var valid_from: String
  public var expires_at: String?
  public var constraints: JSONValue
  public var match_count: Int
  public var last_matched_at: String?
}

public struct MAuthorizationPage: Codable, Sendable {
  public var items: [MAuthorization]
  public var version: String
  public var next_cursor: String?
}

public struct MDecisionPage: Codable, Sendable {
  public var items: [MDecision]
  public var version: String
  public var next_cursor: String?
}

public struct MOperationPage: Codable, Sendable {
  public var items: [MOperation]
  public var version: String
  public var next_cursor: String?
}

public struct MRulePageBuiltinPoliciesItem: Codable, Sendable {
  public var id: String
  public var revision: Int
  public var description: String
  public var match_count: Int
  public var last_matched_at: String?
}

public struct MRulePage: Codable, Sendable {
  public var items: [MAuthorizationRule]
  public var version: String
  public var next_cursor: String?
  public var builtin_policies: [MRulePageBuiltinPoliciesItem]
}
