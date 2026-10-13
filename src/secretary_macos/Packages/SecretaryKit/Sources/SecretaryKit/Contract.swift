import Foundation

/// Revisions, sizes and sequences never pass through a floating point value.
public struct DecimalString: Codable, Hashable, Sendable, Comparable {
  public let rawValue: String
  public init(_ value: String) throws {
    guard !value.isEmpty, value.utf8.allSatisfy({ (48...57).contains($0) }),
      value == "0" || !value.hasPrefix("0")
    else { throw ClientError.invalidContract }
    rawValue = value
  }
  public init(from decoder: any Decoder) throws {
    try self.init(decoder.singleValueContainer().decode(String.self))
  }
  public func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(rawValue)
  }
  public static func < (lhs: Self, rhs: Self) -> Bool {
    lhs.rawValue.count == rhs.rawValue.count
      ? lhs.rawValue < rhs.rawValue : lhs.rawValue.count < rhs.rawValue.count
  }
}

public enum ClientError: Error, Equatable, Sendable {
  case invalidContract, unsafeDiscovery, identityMismatch, staleConnection, responseTooLarge
  case invalidRoute, storage, storageVersion, requestConflict, sessionChanged, streamMalformed
  case http(Int, String)
  case unavailable, downloadBusy
}

public struct Capability: Decodable, Sendable {
  public let state: String
  public let allowed: Bool
  public let reason: String?
}
public struct Core: Decodable, Sendable {
  public let api_version: String
  public let data_domain_id: String
  public let owner_id: String
  public let instance_id: String
  public let session_id: String
  public let state: String
  public let mode: String
  public let capabilities: [String: Capability]
}
public struct ResourceID: Codable, Sendable {
  public let type: String
  public let id: String
}
public struct Receipt: Decodable, Sendable {
  public let request_id: String
  public let command: String
  public let acceptance: String
  public let state: String
  public let revision: DecimalString
  public let resource_ids: [ResourceID]
  public let error_code: String?
}
public struct RequestStatus: Decodable, Sendable { public let receipt: Receipt }
public struct SyncCursor: Codable, Sendable {
  public let cursor: String
  public let sequence: DecimalString
  public let instance_id: String
}
public struct SyncChange: Codable, Sendable {
  public let kind: String
  public let resource_type: String
  public let resource_id: String?
  public let revision: DecimalString?
  public let query: String?
}
public struct SyncTransaction: Codable, Sendable {
  public let cursor: String
  public let changes: [SyncChange]
}
public struct SyncPage: Decodable, Sendable {
  public let transactions: [SyncTransaction]
  public let next_cursor: String
  public let has_more: Bool
}
public struct NotificationDTO: Decodable, Sendable {
  public struct Content: Decodable, Sendable {
    public let text: String
    public let media_type: String
    public let content_version: String
    public let bytes: DecimalString
    public let truncated: Bool
  }
  public struct Presentation: Decodable, Sendable {
    public let client_id: String
    public let presented_at: String
  }
  public let id: String
  public let revision: DecimalString
  public let state: String
  public let created_sequence: DecimalString
  public let read_at: String?
  public let presented: [Presentation]
  public let content: Content
}

public struct NotificationPage: Decodable, Sendable {
  public let items: [NotificationDTO]
  public let version: DecimalString
  public let next_cursor: String?
}

public struct Identity: Hashable, Sendable {
  public let owner: String
  public let domain: String
  public let session: String
  public init(owner: String, domain: String, session: String) {
    self.owner = owner
    self.domain = domain
    self.session = session
  }
  // Length-prefixed components cannot collide even if a future ID contains separators.
  var domainKey: String { "\(owner.utf8.count):\(owner)\(domain.utf8.count):\(domain)" }
  var scope: String { "\(domainKey)\(session.utf8.count):\(session)" }
}

struct Envelope<T: Decodable>: Decodable { let data: T }
public enum Contract {
  public static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
    try JSONDecoder().decode(Envelope<T>.self, from: data).data
  }
}
