import CryptoKit
import Foundation
import Testing

@testable import SecretaryKit

private func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T {
  try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: value))
}
private func temporary() throws -> URL {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(
    "secretary-management-" + UUID().uuidString)
  try FileManager.default.createDirectory(
    at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  return root
}
private let identity = Identity(owner: "owner", domain: "domain", session: "session")
private func approval() throws -> MAuthorization {
  try decode(
    MAuthorization.self,
    [
      "id": UUID().uuidString, "revision": "9007199254740993", "state": "PENDING",
      "display_hash": String(repeating: "a", count: 64), "expires_at": NSNull(),
      "scope": ["session_id": NSNull(), "task_id": NSNull(), "execution_id": NSNull()],
      "display": ["command": "printf 'one two'"],
      "remember_context": [
        "root": "/synthetic", "action": "shell.run", "path": NSNull(),
        "tokens": ["printf", "one two"],
      ],
    ])
}
@Test func approvalSnapshotAndRememberPreserveTokensRevisionAndNull() throws {
  let a = try approval()
  let command = try ManagementCommand.approval(a, choice: .approve, prefixTokens: 2)
  let value = try JSONDecoder().decode(JSONValue.self, from: command.body)
  #expect(value["expected_revision"].string == "9007199254740993")
  #expect(value["remember"]["expires_at"] == .null)
  #expect(value["remember"]["prefix_tokens"] == .number(2))
  #expect(value["display_hash"].string == a.display_hash)
  #expect(throws: ClientError.invalidContract) {
    try ManagementCommand.approval(a, choice: .reject, prefixTokens: 1)
  }
  #expect(throws: ClientError.invalidContract) {
    try ManagementCommand.approval(a, choice: .approve, prefixTokens: 3)
  }
  var unknown = a
  unknown.state = "FUTURE_STATE"
  #expect(throws: ClientError.invalidContract) {
    try ManagementCommand.approval(unknown, choice: .approve)
  }
}
@Test func operationFourOutcomesAndUnknownFieldsDecode() throws {
  let fixture = try Data(
    contentsOf: Bundle.module.url(
      forResource: "api-v1", withExtension: "json", subdirectory: "Fixtures")!)
  let root = try JSONSerialization.jsonObject(with: fixture) as! [String: Any]
  let op = try decode(MOperation.self, root["operation"]!)
  for outcome in OperationOutcome.allCases {
    let command = try ManagementCommand.resolve(op, outcome: outcome, note: "Synthetic evidence")
    let data = try JSONDecoder().decode(JSONValue.self, from: command.body)
    #expect(data["outcome"].string == outcome.rawValue)
    #expect(data["expected_revision"].string == op.revision.rawValue)
  }
  #expect(throws: ClientError.invalidContract) {
    try ManagementCommand.resolve(op, outcome: .applied, note: "")
  }
}
@Test @MainActor func editorAndCommandCommitTogetherAndRemainIsolated() throws {
  let root = try temporary()
  defer { try? FileManager.default.removeItem(at: root) }
  let url = root.appendingPathComponent("client.sqlite")
  let local = try ManagementLocalState(url: url)
  let command = try ManagementCommand.task(goal: "Synthetic task", scope: nil)
  let editor = Data("preserved input and request identity".utf8)
  try local.enqueue(command, identity: identity, key: "new-task", editor: editor)
  let reopened = try ManagementLocalState(url: url)
  #expect(try reopened.load(key: "new-task", identity: identity) == editor)
  #expect(
    try reopened.load(
      key: "new-task", identity: Identity(owner: "other", domain: "domain", session: "session"))
      == nil)
  let database = try Database(url: url)
  #expect(try database.command(identity, id: command.id)?.body == command.body)
  #expect(throws: ClientError.invalidContract) {
    try database.insertCommand(
      identity, id: UUID().uuidString, route: command.route, body: command.body)
  }
  let next = try ManagementCommand.task(goal: "Next synthetic task", scope: nil)
  database.beforeCommit = { throw ClientError.storage }
  #expect(throws: ClientError.storage) {
    try database.transaction {
      try database.saveDraft(identity, key: "management/new-task", data: Data("must rollback".utf8))
      try database.insertCommand(
        identity, id: next.id, route: next.route, body: next.body)
    }
  }
  #expect(try reopened.load(key: "new-task", identity: identity) == editor)
  #expect(try database.command(identity, id: next.id) == nil)
}
@Test func decimalJSONAndScopePathDoNotLoseMeaning() throws {
  let text = Data("{\"number\":9007199254740993,\"text\":\"中文 👩🏽‍💻\"}".utf8)
  let value = try JSONDecoder().decode(JSONValue.self, from: text)
  #expect(value["number"].text == "9007199254740993")
  #expect(try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value)) == value)
  let command = try ManagementCommand.scope(
    name: "Scope", description: "", root: "/synthetic/a b", notes: nil, defaultWrite: "ask")
  let body = try JSONDecoder().decode(JSONValue.self, from: command.body)
  #expect(body["root_path"].string == "/synthetic/a b")
  #expect(body["notes_path"] == .null)
}
private actor BinaryTransport: CoreTransport {
  let content: Data
  var count = 0
  var interrupt = false
  init(_ content: Data, interrupt: Bool = false) {
    self.content = content
    self.interrupt = interrupt
  }
  nonisolated func cancel() {}
  func request(_ route: Route, body: Data?) async throws -> Data { throw ClientError.unavailable }
  func stream(after: String, receive: @escaping @Sendable (SyncTransaction) async throws -> Void)
    async throws
  {}
  func download(
    _ route: Route, to: URL, bytes: Int64, version: String,
    progress: @escaping @Sendable (Double) async -> Void
  ) async throws {
    count += 1
    try content.write(to: to)
    if interrupt { throw CancellationError() }
    await progress(1)
  }
}
private func artifact(_ content: Data, id: String = "one", name: String = "../../outside.txt")
  throws -> MArtifact
{
  let hash = SHA256.hash(data: content).map { String(format: "%02x", $0) }.joined()
  return try decode(
    MArtifact.self,
    [
      "id": id, "name": name, "task_id": "task", "execution_id": "execution",
      "content_version": hash, "bytes": String(content.count), "media_type": "text/plain",
      "state": "AVAILABLE", "relative_path": NSNull(), "path_base": "unknown", "scope_id": NSNull(),
      "path_unavailable_reason": "NONE",
    ])
}
@Test func artifactCacheIdentityVersionBudgetAndInterruptedDownload() async throws {
  let root = try temporary()
  defer { try? FileManager.default.removeItem(at: root) }
  let cache = try ArtifactCache(root: root, budget: 10)
  let bytes = Data("123456".utf8)
  let other = Data("654321".utf8)
  let transport = BinaryTransport(bytes)
  let first = try await cache.fetch(
    artifact(bytes), identity: identity, transport: transport, progress: { _ in })
  #expect(
    first.deletingLastPathComponent().standardizedFileURL.path == root.standardizedFileURL.path)
  #expect(first.lastPathComponent != "outside.txt")
  _ = try await cache.fetch(
    artifact(bytes), identity: identity, transport: transport, progress: { _ in })
  #expect(await transport.count == 1)
  let second = try await cache.fetch(
    artifact(other, id: "two"), identity: identity, transport: BinaryTransport(other),
    progress: { _ in })
  #expect(first != second)
  #expect(!FileManager.default.fileExists(atPath: first.path))
  do {
    _ = try await cache.fetch(
      artifact(bytes, id: "interrupted"), identity: identity,
      transport: BinaryTransport(bytes, interrupt: true), progress: { _ in })
    Issue.record("must fail")
  } catch is CancellationError {}
  #expect(
    try FileManager.default.contentsOfDirectory(atPath: root.path).allSatisfy {
      !$0.hasPrefix("partial-")
    })
  do {
    _ = try await cache.fetch(
      artifact(bytes, id: "corrupt"), identity: identity, transport: BinaryTransport(other),
      progress: { _ in })
    Issue.record("must reject hash mismatch")
  } catch ClientError.invalidContract {}
}

@Test func blankTaskFieldsUseCoreDefaultsAndReuseKeepsBaseline() throws {
  let command = try ManagementCommand.task(
    goal: "Continue", scope: nil, reuse: "task", parent: "execution")
  let value = try JSONDecoder().decode(JSONValue.self, from: command.body)
  #expect(value.object["acceptance"] == nil)
  #expect(value.object["constraints"] == nil)
  #expect(value.object["scope_id"] == nil)
  #expect(value["parent_execution_id"].string == "execution")
  let context = MAuthorizationRememberContext(
    root: "/synthetic", action: "file.write", path: "reports/sub/result.txt", tokens: nil)
  #expect(ManagementCommand.directoryPrefixes(context) == [".", "reports", "reports/sub"])
}
