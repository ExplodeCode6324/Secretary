import Foundation

/// Only the public contract's open JSON fields use this type; forms never edit raw JSON.
public enum JSONValue: Codable, Equatable, Sendable {
  case null
  case string(String)
  case number(Decimal)
  case bool(Bool)
  case array([JSONValue])
  case object([String: JSONValue])
  public init(from decoder: any Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let v = try? c.decode(Bool.self) {
      self = .bool(v)
    } else if let v = try? c.decode(String.self) {
      self = .string(v)
    } else if let v = try? c.decode(Decimal.self) {
      self = .number(v)
    } else if let v = try? c.decode([JSONValue].self) {
      self = .array(v)
    } else {
      self = .object(try c.decode([String: JSONValue].self))
    }
  }
  public func encode(to encoder: any Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .null: try c.encodeNil()
    case .string(let v): try c.encode(v)
    case .number(let v): try c.encode(v)
    case .bool(let v): try c.encode(v)
    case .array(let v): try c.encode(v)
    case .object(let v): try c.encode(v)
    }
  }
  public subscript(_ key: String) -> JSONValue {
    if case .object(let v) = self { return v[key] ?? .null }
    return .null
  }
  public var string: String? {
    if case .string(let v) = self { return v }
    return nil
  }
  public var array: [JSONValue] {
    if case .array(let v) = self { return v }
    return []
  }
  public var object: [String: JSONValue] {
    if case .object(let v) = self { return v }
    return [:]
  }
  public var text: String {
    switch self {
    case .null: return "—"
    case .string(let v): return v
    case .number(let v): return NSDecimalNumber(decimal: v).stringValue
    case .bool(let v): return v ? "true" : "false"
    case .array(let v): return v.map(\.text).joined(separator: "\n")
    case .object(let v):
      return v.keys.sorted().map { $0 + ": " + v[$0]!.text }.joined(separator: "\n")
    }
  }
  public static func strings(_ values: [String]) -> Self { .array(values.map(Self.string)) }
}

public enum ApprovalChoice: String, Sendable {
  case approve = "APPROVE"
  case reject = "REJECT"
  case revoke = "REVOKE"
}
public enum OperationOutcome: String, CaseIterable, Sendable {
  case applied = "APPLIED"
  case notApplied = "NOT_APPLIED"
  case partial = "PARTIAL"
  case unverified = "UNVERIFIED"
}
public enum SimpleManagementAction: Sendable {
  case cancelRequest(String)
  case cancelExecution(String)
  case viewed(String)
  case compact, resume, retryExtraction
  case retryApplication(String)
  case verifyWrite(String)
  var path: String {
    switch self {
    case .cancelRequest(let id): return "task-requests/\(id)/cancel"
    case .cancelExecution(let id): return "executions/\(id)/cancel"
    case .viewed(let id): return "executions/\(id)/viewed"
    case .compact: return "session/compact"
    case .resume: return "session/resume"
    case .retryExtraction: return "memory/extraction/retry"
    case .retryApplication(let id): return "settings/applications/\(id)/retry"
    case .verifyWrite(let id): return "operations/\(id)/verify-write"
    }
  }
}

public struct ManagementCommand: Sendable {
  public let id: String
  public let route: Route
  public let body: Data
  private init(_ path: String, _ values: [String: JSONValue]) throws {
    id = UUID().uuidString.lowercased()
    route = try Route(path)
    var values = values
    values["request_id"] = .string(id)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    body = try encoder.encode(JSONValue.object(values))
    guard body.count <= 1_048_576 else { throw ClientError.responseTooLarge }
  }
  public static func simple(_ action: SimpleManagementAction) throws -> Self {
    try Self(action.path, [:])
  }
  public static func task(
    goal: String, scope: String?, reuse: String? = nil, parent: String? = nil,
    materials: [String] = [], constraints: [String] = [], acceptance: [String] = [],
    at: String? = nil,
    deadline: String? = nil, interval: Int? = nil
  ) throws -> Self {
    guard !goal.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw ClientError.invalidContract
    }
    var v: [String: JSONValue] = ["goal": .string(goal)]
    for (key, values) in [
      ("materials", materials), ("constraints", constraints), ("acceptance", acceptance),
    ] where !values.isEmpty { v[key] = .strings(values) }
    if let scope { v["scope_id"] = scope.isEmpty ? .null : .string(scope) }
    for (k, x) in [
      ("reuse_task_id", reuse), ("parent_execution_id", parent), ("at", at), ("deadline", deadline),
    ] { if let x, !x.isEmpty { v[k] = .string(x) } }
    if let interval {
      guard interval > 0 else { throw ClientError.invalidContract }
      v["interval_seconds"] = .number(Decimal(interval))
    }
    return try Self("task-requests", v)
  }
  public static func approval(
    _ auth: MAuthorization, choice: ApprovalChoice, prefixTokens: Int? = nil,
    pathPrefix: String? = nil, expires: String? = nil
  ) throws -> Self {
    guard auth.display != nil, auth.display_hash.count == 64,
      auth.state == "PENDING" && choice != .revoke || auth.state == "APPROVED" && choice == .revoke
    else { throw ClientError.invalidContract }
    var v: [String: JSONValue] = [
      "expected_revision": .string(auth.revision.rawValue),
      "display_hash": .string(auth.display_hash), "decision": .string(choice.rawValue),
    ]
    if prefixTokens != nil || pathPrefix != nil {
      guard choice == .approve, let context = auth.remember_context else {
        throw ClientError.invalidContract
      }
      var remember: [String: JSONValue] = ["expires_at": expires.map(JSONValue.string) ?? .null]
      if let count = prefixTokens {
        guard pathPrefix == nil, context.action == "shell.run", count > 0,
          count <= (context.tokens?.count ?? 0)
        else { throw ClientError.invalidContract }
        remember["prefix_tokens"] = .number(Decimal(count))
      } else if let path = pathPrefix {
        guard context.action == "file.write", directoryPrefixes(context).contains(path) else {
          throw ClientError.invalidContract
        }
        remember["path_prefix"] = .string(path)
      }
      v["remember"] = .object(remember)
    }
    return try Self("authorizations/\(auth.id)/decision", v)
  }
  /// Choices derive exclusively from the server path; no local tokenization or normalization.
  public static func directoryPrefixes(_ context: MAuthorizationRememberContext) -> [String] {
    guard let path = context.path, !path.hasPrefix("/"), !path.split(separator: "/").contains("..")
    else { return [] }
    let parts = path.split(separator: "/").dropLast()
    return ["."]
      + (1...max(1, parts.count)).compactMap {
        $0 <= parts.count ? parts.prefix($0).joined(separator: "/") : nil
      }
  }
  public static func answer(_ id: String, answer: String) throws -> Self {
    guard !answer.isEmpty else { throw ClientError.invalidContract }
    return try Self("decisions/\(id)/answer", ["answer": .string(answer)])
  }
  public static func resolve(_ operation: MOperation, outcome: OperationOutcome, note: String)
    throws -> Self
  {
    guard !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw ClientError.invalidContract
    }
    return try Self(
      "operations/\(operation.id)/resolve",
      [
        "expected_revision": .string(operation.revision.rawValue),
        "outcome": .string(outcome.rawValue), "note": .string(note),
      ])
  }
  public static func commitment(_ id: String, completed: Bool, note: String) throws -> Self {
    guard !note.isEmpty else { throw ClientError.invalidContract }
    return try Self(
      "memory/commitments/\(id)/resolve",
      ["state": .string(completed ? "COMPLETED" : "CANCELLED"), "note": .string(note)])
  }
  public static func profile(name: String, revision: DecimalString) throws -> Self {
    try Self(
      "assistant/profile", ["name": .string(name), "expected_revision": .string(revision.rawValue)])
  }
  public static func saveSettings(revision: DecimalString, payload: JSONValue) throws -> Self {
    guard case .array(let ids) = payload["command_ids"], ids.isEmpty,
      case .array = payload["edits"]
    else { throw ClientError.invalidContract }
    return try Self(
      "settings/draft", ["expected_revision": .string(revision.rawValue), "payload": payload])
  }
  public enum RevisionAction: Sendable {
    case apply
    case restore(String)
    case archiveScope(String)
    case disableRule(String)
  }
  public static func revision(_ action: RevisionAction, _ revision: DecimalString) throws -> Self {
    let path: String
    switch action {
    case .apply: path = "settings/apply"
    case .restore(let id): path = "settings/applications/\(id)/restore-draft"
    case .archiveScope(let id): path = "scopes/\(id)/archive"
    case .disableRule(let id): path = "admin/authorization-rules/\(id)/disable"
    }
    return try Self(path, ["expected_revision": .string(revision.rawValue)])
  }
  public static func scope(
    id: String? = nil, revision: DecimalString? = nil, name: String, description: String,
    root: String?, notes: String?, defaultWrite: String
  ) throws -> Self {
    guard !name.isEmpty, ["allow", "ask"].contains(defaultWrite), id == nil || revision != nil
    else { throw ClientError.invalidContract }
    var v: [String: JSONValue] = [
      "name": .string(name), "description": .string(description),
      "kind": .string(root == nil ? "NONE" : "DIRECTORY"),
      "root_path": root.map(JSONValue.string) ?? .null,
      "notes_path": notes.map(JSONValue.string) ?? .null, "default_write": .string(defaultWrite),
    ]
    if let revision { v["expected_revision"] = .string(revision.rawValue) }
    return try Self(id.map { "scopes/" + $0 } ?? "scopes", v)
  }
}

/// Synchronous UI persistence uses the same WAL database as ClientEngine, like ChatLocalState.
@MainActor public final class ManagementLocalState {
  private let database: Database
  public init(url: URL) throws { database = try Database(url: url) }
  public func save(_ data: Data, key: String, identity: Identity) throws {
    guard data.count <= 1_048_576 else { throw ClientError.responseTooLarge }
    try database.saveDraft(identity, key: "management/" + key, data: data)
  }
  public func load(key: String, identity: Identity) throws -> Data? {
    try database.draft(identity, key: "management/" + key)
  }
  public func enqueue(_ command: ManagementCommand, identity: Identity, key: String, editor: Data)
    throws
  {
    guard editor.count <= 1_048_576 else { throw ClientError.responseTooLarge }
    try database.transaction {
      try database.saveDraft(identity, key: "management/" + key, data: editor)
      try database.insertCommand(identity, id: command.id, route: command.route, body: command.body)
    }
  }
}
