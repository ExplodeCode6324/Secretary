import Foundation

/// Synchronous editing writes complete before the editor reports success or allows quit.
/// Uses the same WAL database and transactions as ClientEngine; no separate authority.
@MainActor
public final class ChatLocalState {
  private let database: Database
  public init(url: URL) throws { database = try Database(url: url) }
  public func draft(_ identity: Identity) throws -> String {
    guard let data = try database.draft(identity, key: "chat") else { return "" }
    guard let value = String(data: data, encoding: .utf8) else { throw ClientError.storage }
    return value
  }
  public func saveDraft(_ text: String, for identity: Identity) throws {
    guard text.utf8.count <= 1_000_000 else { throw ClientError.responseTooLarge }
    try database.saveDraft(identity, key: "chat", data: Data(text.utf8))
  }
  public func enqueue(_ text: String, for identity: Identity) throws -> String {
    struct Message: Encodable {
      let request_id: String
      let text: String
    }
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw ClientError.invalidContract
    }
    let id = UUID().uuidString.lowercased()
    let body = try JSONEncoder().encode(Message(request_id: id, text: text))
    try database.enqueue(identity, id: id, route: Route("messages"), body: body, draftKey: "chat")
    return id
  }
  public func commands(_ identity: Identity) throws -> [PendingCommand] {
    try database.chatCommands(identity)
  }
  public func anchor(_ identity: Identity) throws -> ReadingAnchor? {
    guard let text = try database.anchor(identity) else { return nil }
    return try JSONDecoder().decode(ReadingAnchor.self, from: Data(text.utf8))
  }
  public func saveAnchor(_ anchor: ReadingAnchor, for identity: Identity) throws {
    guard anchor.offset.isFinite, anchor.offset >= 0 else { throw ClientError.invalidContract }
    let data = try JSONEncoder().encode(anchor)
    try database.saveAnchor(identity, value: String(decoding: data, as: UTF8.self))
  }
}
