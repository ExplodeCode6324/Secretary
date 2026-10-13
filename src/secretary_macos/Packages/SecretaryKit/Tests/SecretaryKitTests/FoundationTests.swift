import Foundation
import Testing

@testable import SecretaryKit

private let owner = "10000000-0000-4000-8000-000000000001"
private let instance = "10000000-0000-4000-8000-000000000002"
private let session = "10000000-0000-4000-8000-000000000003"
private let requestID = "10000000-0000-4000-8000-000000000004"
private let noticeID = "10000000-0000-4000-8000-000000000008"
private let identity = Identity(owner: owner, domain: owner, session: session)
private func directory() throws -> URL {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent(
    "secretary-native-test-" + UUID().uuidString)
  try FileManager.default.createDirectory(
    at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  return url
}
private func raw(_ value: String) -> Data { Data(value.utf8) }
private func envelope(_ value: String) -> Data { raw("{\"data\":\(value)}") }
private func endpoint(domain: String = owner) throws -> Endpoint {
  try JSONDecoder().decode(
    Endpoint.self,
    from: raw(
      """
      {"api_version":"1","url":"http://127.0.0.1:12345","token":"\(String(repeating: "a", count: 64))","pid":123,"instance_id":"\(instance)","data_domain_id":"\(domain)"}
      """))
}
private func coreData(domain: String = owner, activeSession: String = session) -> Data {
  envelope(
    """
    {"api_version":"1","data_domain_id":"\(domain)","owner_id":"\(owner)","instance_id":"\(instance)","session_id":"\(activeSession)","state":"FUTURE_STATE","mode":"fixture","capabilities":{}}
    """)
}
private func receipt(_ id: String, state: String = "ACCEPTED") -> String {
  """
  {"request_id":"\(id)","command":"messages","acceptance":"ACCEPTED","state":"\(state)","revision":"9007199254740993","resource_ids":[]}
  """
}
private func command(_ id: String = requestID, text: String = "hello") -> Data {
  raw("{\"request_id\":\"\(id)\",\"text\":\"\(text)\"}")
}
private func tx(_ cursor: String = "c1", query: String = "assistant") throws -> SyncTransaction {
  try JSONDecoder().decode(
    SyncTransaction.self,
    from: raw(
      """
      {"cursor":"\(cursor)","changes":[{"kind":"invalidate","resource_type":"\(query)","query":"\(query)"}]}
      """))
}

private actor FakeTransport: CoreTransport {
  let core: Data
  var calls: [(String, Data?)] = []
  var responses: [String: [Result<Data, ClientError>]] = [:]
  var transactions: [SyncTransaction] = []
  var pause: String?
  var continuation: CheckedContinuation<Data, any Error>?
  init(domain: String = owner, activeSession: String = session) {
    core = coreData(domain: domain, activeSession: activeSession)
  }
  nonisolated func cancel() {}  // deliberately permit late responses to test generation checks
  func request(_ route: Route, body: Data?) async throws -> Data {
    calls.append((route.path, body))
    if pause == route.path {
      pause = nil
      return try await withCheckedThrowingContinuation { continuation = $0 }
    }
    if var queue = responses[route.path], !queue.isEmpty {
      let result = queue.removeFirst()
      responses[route.path] = queue
      return try result.get()
    }
    if let body {
      let id =
        (try JSONSerialization.jsonObject(with: body) as! [String: Any])["request_id"] as! String
      if route.path == "clients" {
        return envelope(
          receipt(id).replacingOccurrences(
            of: "\"resource_ids\":[]",
            with:
              "\"resource_ids\":[{\"type\":\"ClientRegistration\",\"id\":\"20000000-0000-4000-8000-000000000001\"}]"
          ))
      }
      return envelope(receipt(id))
    }
    switch route.path {
    case "core": return core
    case "sync/cursor":
      return envelope(
        "{\"cursor\":\"c0\",\"sequence\":\"9007199254740993\",\"instance_id\":\"\(instance)\"}")
    case "sync/changes":
      return envelope(
        "{\"transactions\":[],\"next_cursor\":\"\(route.query["after"]!)\",\"has_more\":false}")
    default:
      if route.path.hasPrefix("requests/") { throw ClientError.http(404, "NOT_FOUND") }
      return envelope("{\"value\":\"confirmed\"}")
    }
  }
  func stream(after: String, receive: @escaping @Sendable (SyncTransaction) async throws -> Void)
    async throws
  {
    calls.append(("stream:" + after, nil))
    for transaction in transactions { try await receive(transaction) }
  }
  func queue(_ route: String, _ values: [Result<Data, ClientError>]) { responses[route] = values }
  func setTransactions(_ values: [SyncTransaction]) { transactions = values }
  func hold(_ route: String) { pause = route }
  func held() -> Bool { continuation != nil }
  func release(_ data: Data) {
    continuation?.resume(returning: data)
    continuation = nil
  }
  func postBodies(_ path: String) -> [Data] { calls.filter { $0.0 == path }.compactMap { $0.1 } }
  func streamCursors() -> [String] { calls.map(\.0).filter { $0.hasPrefix("stream:") } }
}
private func waitForHold(_ transport: FakeTransport) async throws {
  for _ in 0..<2000 {
    if await transport.held() { return }
    try await Task.sleep(for: .milliseconds(1))
  }
  throw ClientError.unavailable
}

@Test func decimalPrecisionAndUnknownStates() throws {
  #expect(try DecimalString("9007199254740993") > DecimalString("9007199254740992"))
  #expect(try DecimalString("184467440737095516160") > DecimalString("99999999999999999999"))
  #expect(throws: (any Error).self) {
    try JSONDecoder().decode(DecimalString.self, from: raw("9007199254740993"))
  }
  #expect(throws: (any Error).self) { try DecimalString("01") }
  let core = try Contract.decode(Core.self, from: coreData())
  #expect(core.state == "FUTURE_STATE")
  struct Examples: Decodable {
    let core: Core
    let receipt: Receipt
    let sync_cursor: SyncCursor
    let sync_page: SyncPage
    let notification: NotificationDTO
  }
  let url = Bundle.module.url(
    forResource: "api-v1", withExtension: "json", subdirectory: "Fixtures")!
  let examples = try JSONDecoder().decode(Examples.self, from: Data(contentsOf: url))
  #expect(examples.sync_cursor.sequence.rawValue == "9007199254740993")
  #expect(examples.notification.content.truncated)
}

@Test func hiddenTimelineRequestCannotRepopulateCacheAfterUnwatch() async throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let engine = try ClientEngine(databaseURL: dir.appendingPathComponent("client.sqlite"))
  let transport = FakeTransport()
  _ = try await engine.connect(endpoint: endpoint(), expectedMode: "fixture", transport: transport)
  let route = ChatPreferences(streaming: true, thinking: true).route
  _ = try await engine.refresh(route)
  await transport.hold("timeline")
  let pending = Task { try await engine.refresh(route) }
  try await waitForHold(transport)
  try await engine.unwatch(route)
  await transport.release(envelope("{\"hidden\":\"late thinking\"}"))
  do {
    _ = try await pending.value
    Issue.record("late hidden response was accepted")
  } catch ClientError.staleConnection {}
  #expect(try await engine.cached(route) == nil)
}

@Test func discoveryRejectsSymlinkPermissionsAndUnsafeURL() throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let file = dir.appendingPathComponent("core-endpoint.json")
  let data = try JSONEncoder().encode([
    "api_version": "1", "url": "http://127.0.0.1:12345", "token": String(repeating: "a", count: 64),
    "pid": "123",
  ])
  try data.write(to: file)
  try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path)
  #expect(throws: ClientError.unsafeDiscovery) { try Endpoint.discover(in: dir) }
  try FileManager.default.removeItem(at: file)
  try FileManager.default.createSymbolicLink(
    at: file, withDestinationURL: dir.appendingPathComponent("target"))
  #expect(throws: ClientError.unsafeDiscovery) { try Endpoint.discover(in: dir) }
  for address in [
    "https://127.0.0.1:443", "http://localhost:80", "http://127.0.0.1:80/other",
    "http://user@127.0.0.1:80", "http://127.0.0.1:80?token=x",
  ] {
    let unsafe = Endpoint(
      api_version: "1", url: address, token: String(repeating: "a", count: 64), pid: 1,
      instance_id: instance, data_domain_id: owner)
    #expect(throws: ClientError.unsafeDiscovery) { try unsafe.validate() }
  }
  try endpoint().validate()
  #expect(throws: ClientError.invalidRoute) { try Route("../core") }
  #expect(throws: ClientError.invalidRoute) { try Route("https://elsewhere") }
  #expect(try Route("messages/message:abc").path == "messages/message:abc")
}

@Test func outboxAndDraftCommitOrRollbackTogether() throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let db = try Database(url: dir.appendingPathComponent("client.sqlite"))
  try db.saveDraft(identity, key: "composer", data: raw("sole draft"))
  db.beforeCommit = { throw ClientError.storage }
  #expect(throws: ClientError.storage) {
    try db.enqueue(
      identity, id: requestID, route: Route("messages"), body: command(), draftKey: "composer")
  }
  #expect(try db.commands(identity).isEmpty)
  #expect(try db.draft(identity, key: "composer") == raw("sole draft"))
  db.beforeCommit = nil
  try db.enqueue(
    identity, id: requestID, route: Route("messages"), body: command(), draftKey: "composer")
  #expect(try db.draft(identity, key: "composer") == nil)
  #expect(try db.commands(identity).first?.body == command())
  #expect(throws: ClientError.requestConflict) {
    try db.enqueue(
      identity, id: requestID, route: Route("messages"), body: command(text: "changed"))
  }
}

@Test func cursorCacheAtomicityResyncAndProtectedData() throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let file = dir.appendingPathComponent("client.sqlite")
  var stableClient = ""
  do {
    let db = try Database(url: file, projectionBudget: 128)
    stableClient = try db.registrationID(identity)
    try db.saveDraft(identity, key: "composer", data: raw("keep"))
    try db.enqueue(identity, id: requestID, route: Route("messages"), body: command())
    try db.recordEvidence(identity, id: noticeID, evidence: "PRESENTED")
    try db.commit(identity, projections: ["tasks": raw("old")], cursor: "old")
    try db.markStale(identity, keys: ["tasks"])
    db.beforeCommit = { throw ClientError.storage }
    #expect(throws: ClientError.storage) {
      try db.commit(identity, projections: ["tasks": raw("new")], cursor: "new")
    }
    #expect(try db.cursor(identity) == "old")
    #expect(try db.cached(identity, route: Route("tasks"))?.data == raw("old"))
    #expect(try db.cached(identity, route: Route("tasks"))?.stale == true)
    db.beforeCommit = nil
    try db.commit(identity, projections: [:], cursor: "rebuilt", reset: true)
    #expect(try db.cached(identity, route: Route("tasks")) == nil)
  }
  let reopened = try Database(url: file)
  #expect(try reopened.registrationID(identity) == stableClient)
  #expect(try reopened.cursor(identity) == "rebuilt")
  #expect(try reopened.draft(identity, key: "composer") == raw("keep"))
  #expect(try reopened.commands(identity).count == 1)
  #expect(try reopened.evidence(identity, id: noticeID) == "PRESENTED")
  let other = Identity(owner: owner, domain: instance, session: session)
  #expect(try reopened.commands(other).isEmpty)
  #expect(try reopened.draft(other, key: "composer") == nil)
}

@Test func cacheEvictionDoesNotEvictProtectedRows() throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let db = try Database(url: dir.appendingPathComponent("client.sqlite"), projectionBudget: 8)
  try db.saveDraft(identity, key: "empty", data: Data())
  try db.enqueue(identity, id: requestID, route: Route("messages"), body: command())
  try db.commit(identity, projections: ["a": raw("12345")], cursor: "a")
  try db.commit(identity, projections: ["b": raw("67890")], cursor: "b")
  #expect(try db.cached(identity, route: Route("a")) == nil)
  #expect(try db.cached(identity, route: Route("b")) != nil)
  #expect(try db.draft(identity, key: "empty") == Data())
  #expect(try db.commands(identity).count == 1)
}

@Test func sseRequiresCompleteFrameAndMatchingID() throws {
  let body = String(data: try JSONEncoder().encode(tx()), encoding: .utf8)!
  let frame = ": heartbeat\r\n\r\nevent: change\r\nid: c1\r\ndata: \(body)\r\n\r\n"
  var decoder = SSEDecoder()
  var values: [SyncTransaction] = []
  for byte in frame.utf8 { if let value = try decoder.append(byte) { values.append(value) } }
  #expect(values.count == 1)
  var partial = SSEDecoder()
  for byte in frame.dropLast(2).utf8 { #expect(try partial.append(byte) == nil) }
  var bad = SSEDecoder()
  #expect(throws: ClientError.streamMalformed) {
    for byte in "event: change\nid: other\ndata: \(body)\n\n".utf8 { _ = try bad.append(byte) }
  }
  var huge = SSEDecoder()
  #expect(throws: ClientError.responseTooLarge) {
    for _ in 0...4_194_304 { _ = try huge.append(65) }
  }
}

@Test func lostResponseReconcilesWithoutReposting() async throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let engine = try ClientEngine(databaseURL: dir.appendingPathComponent("client.sqlite"))
  let transport = FakeTransport()
  _ = try await engine.connect(endpoint: endpoint(), expectedMode: "fixture", transport: transport)
  try await engine.enqueue(
    id: requestID, route: Route("messages"), body: command(), destination: identity)
  await transport.queue("messages", [.failure(.unavailable)])
  await #expect(throws: ClientError.unavailable) { try await engine.drainOutbox() }
  await transport.queue(
    "requests/" + requestID, [.success(envelope("{\"receipt\":\(receipt(requestID))}"))])
  try await engine.drainOutbox()
  #expect(await transport.postBodies("messages").count == 1)
  #expect(
    try await engine.pendingCommands().first { $0.id == requestID }?.state == "RECEIPT:ACCEPTED")
}

@Test func unknownAndOldSessionNeverCreateNewLogicalCommand() async throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let engine = try ClientEngine(databaseURL: dir.appendingPathComponent("client.sqlite"))
  let first = FakeTransport()
  _ = try await engine.connect(endpoint: endpoint(), expectedMode: "fixture", transport: first)
  try await engine.enqueue(
    id: requestID, route: Route("messages"), body: command(), destination: identity)
  await first.queue(
    "requests/" + requestID,
    [.success(envelope("{\"receipt\":\(receipt(requestID, state: "UNKNOWN"))}"))])
  try await engine.drainOutbox()
  try await engine.drainOutbox()  // later unexpected 404 cannot erase known admission
  #expect(await first.postBodies("messages").isEmpty)
  let secondID = UUID().uuidString.lowercased()
  try await engine.enqueue(
    id: secondID, route: Route("messages"), body: command(secondID), destination: identity)
  let second = FakeTransport(activeSession: instance)
  _ = try await engine.connect(endpoint: endpoint(), expectedMode: "fixture", transport: second)
  try await engine.drainOutbox()
  #expect(await second.postBodies("messages").isEmpty)
}

@Test func lateDomainResponseCannotWriteNewDomain() async throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let engine = try ClientEngine(databaseURL: dir.appendingPathComponent("client.sqlite"))
  let first = FakeTransport()
  _ = try await engine.connect(endpoint: endpoint(), expectedMode: "fixture", transport: first)
  await first.hold("assistant")
  let late = Task { try await engine.refresh(Route("assistant")) }
  try await waitForHold(first)
  let second = FakeTransport(domain: instance)
  _ = try await engine.connect(
    endpoint: endpoint(domain: instance), expectedMode: "fixture", transport: second,
    routes: [Route("assistant")])
  await first.release(envelope("{\"value\":\"old domain\"}"))
  await #expect(throws: ClientError.staleConnection) { try await late.value }
  #expect(
    try await engine.cached(Route("assistant"))?.data == envelope("{\"value\":\"confirmed\"}"))
}

@Test func latestFailureKeepsStaleDespiteOlderSuccess() async throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let engine = try ClientEngine(databaseURL: dir.appendingPathComponent("client.sqlite"))
  let transport = FakeTransport()
  _ = try await engine.connect(
    endpoint: endpoint(), expectedMode: "fixture", transport: transport,
    routes: [Route("assistant")])
  await transport.hold("assistant")
  let old = Task { try await engine.refresh(Route("assistant")) }
  try await waitForHold(transport)
  await transport.queue("assistant", [.failure(.unavailable)])
  await #expect(throws: ClientError.unavailable) { try await engine.refresh(Route("assistant")) }
  await transport.release(envelope("{\"value\":\"older\"}"))
  await #expect(throws: ClientError.staleConnection) { try await old.value }
  #expect(try await engine.cached(Route("assistant"))?.stale == true)
}

@Test func failedInvalidationKeepsCursorForReplay() async throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let engine = try ClientEngine(databaseURL: dir.appendingPathComponent("client.sqlite"))
  let transport = FakeTransport()
  _ = try await engine.connect(
    endpoint: endpoint(), expectedMode: "fixture", transport: transport,
    routes: [Route("assistant")])
  await transport.setTransactions([try tx()])
  await transport.queue("assistant", [.failure(.unavailable)])
  await #expect(throws: ClientError.unavailable) { try await engine.runStream() }
  #expect(try await engine.cached(Route("assistant"))?.stale == true)
  try await engine.runStream()
  await transport.setTransactions([try tx("c2"), try tx("c1")])
  try await engine.runStream()  // an already applied older cursor must not regress c2
  await transport.setTransactions([])
  try await engine.runStream()
  #expect(await transport.streamCursors() == ["stream:c0", "stream:c0", "stream:c1", "stream:c2"])
  #expect(try await engine.cached(Route("assistant"))?.stale == false)
}

@Test func resyncPreservesDraftAndOutbox() async throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let engine = try ClientEngine(databaseURL: dir.appendingPathComponent("client.sqlite"))
  let transport = FakeTransport()
  _ = try await engine.connect(endpoint: endpoint(), expectedMode: "fixture", transport: transport)
  try await engine.saveDraft(key: "composer", data: raw("retain"), destination: identity)
  try await engine.enqueue(
    id: requestID, route: Route("messages"), body: command(), destination: identity)
  await transport.queue("sync/changes", [.failure(.http(409, "RESYNC_REQUIRED"))])
  _ = try await engine.connect(endpoint: endpoint(), expectedMode: "fixture", transport: transport)
  #expect(try await engine.draft(key: "composer") == raw("retain"))
  #expect(try await engine.pendingCommands().contains { $0.id == requestID })
}

private actor Delivery: NotificationDelivery {
  var scheduled: [String] = []
  var delivered: Set<String> = []
  func schedule(identifier: String, text: String) -> Bool {
    scheduled.append(identifier)
    return true
  }
  func deliveredIdentifiers() -> Set<String> { delivered }
  func deliver() { delivered = Set(scheduled) }
  func count() -> Int { scheduled.count }
}
private func notice(sequence: String) throws -> NotificationDTO {
  try JSONDecoder().decode(
    NotificationDTO.self,
    from: raw(
      """
      {"id":"\(noticeID)","revision":"1","state":"FUTURE","created_sequence":"\(sequence)","read_at":null,"presented":[],"content":{"text":"hello","media_type":"text/plain","content_version":"v1","bytes":"5","truncated":false}}
      """))
}
@Test func notificationsRequireProofAndDoNotConfuseRead() async throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let engine = try ClientEngine(databaseURL: dir.appendingPathComponent("client.sqlite"))
  _ = try await engine.connect(
    endpoint: endpoint(), expectedMode: "fixture", transport: FakeTransport())
  let delivery = Delivery()
  let adapter = NotificationAdapter(engine: engine, delivery: delivery)
  try await adapter.update(
    [notice(sequence: "9007199254740993")], generation: engine.connectionGeneration())
  #expect(await delivery.count() == 0)
  let newer = try notice(sequence: "9007199254740994")
  try await adapter.update([newer], generation: engine.connectionGeneration())
  try await adapter.update([newer], generation: engine.connectionGeneration())
  #expect(await delivery.count() == 1)
  #expect(try await engine.pendingCommands().filter { $0.path.hasSuffix("/presented") }.isEmpty)
  await delivery.deliver()
  try await adapter.update([newer], generation: engine.connectionGeneration())
  #expect(try await engine.pendingCommands().filter { $0.path.hasSuffix("/presented") }.count == 1)
  let generation = await engine.connectionGeneration()
  try await engine.recordPresentation(
    noticeID, proof: .userDismissed, generation: generation, markRead: true)
  #expect(try await engine.pendingCommands().filter { $0.path.hasSuffix("/read") }.isEmpty)
  try await engine.recordPresentation(
    noticeID, proof: .userOpened, generation: generation, markRead: true)
  #expect(try await engine.pendingCommands().filter { $0.path.hasSuffix("/read") }.count == 1)
  await engine.disconnect()
  await #expect(throws: ClientError.staleConnection) {
    try await engine.recordPresentation(
      noticeID, proof: .deliveredNotification, generation: generation)
  }
}

private actor NoticeCollector {
  var values: [NotificationDTO] = []
  func append(_ page: [NotificationDTO]) { values += page }
  func sequences() -> [String] { values.map { $0.created_sequence.rawValue } }
}
@Test func notificationWalkerIncludesPagesBeyondHistory() async throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let engine = try ClientEngine(databaseURL: dir.appendingPathComponent("client.sqlite"))
  let transport = FakeTransport()
  _ = try await engine.connect(endpoint: endpoint(), expectedMode: "fixture", transport: transport)
  let first = envelope("{\"items\":[],\"version\":\"1\",\"next_cursor\":\"page2\"}")
  let fixture = try Data(
    contentsOf: Bundle.module.url(
      forResource: "api-v1", withExtension: "json", subdirectory: "Fixtures")!)
  let source = try JSONSerialization.jsonObject(with: fixture) as! [String: Any]
  let second = try JSONSerialization.data(withJSONObject: [
    "data": ["items": [source["notification"]!], "version": "2", "next_cursor": NSNull()]
  ])
  await transport.queue("notifications", [.success(first), .success(second)])
  let collector = NoticeCollector()
  try await engine.visitNotifications(generation: engine.connectionGeneration()) {
    await collector.append($0)
  }
  #expect(await collector.sequences() == ["9007199254740992"])
}

@Test func coldStartNotificationResponseSurvivesUntilMatchingDomain() async throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let file = dir.appendingPathComponent("client.sqlite")
  let engine = try ClientEngine(databaseURL: file)
  _ = try await engine.connect(
    endpoint: endpoint(), expectedMode: "fixture", transport: FakeTransport())
  let identifier = try await engine.notificationIdentifier(noticeID)
  await engine.disconnect()
  let cold = try ClientEngine(databaseURL: file)
  try await cold.captureNotificationResponse(identifier: identifier, opened: true)
  let reopened = try ClientEngine(databaseURL: file)
  _ = try await reopened.connect(
    endpoint: endpoint(), expectedMode: "fixture", transport: FakeTransport())
  #expect(
    try await reopened.pendingCommands().filter { $0.path.hasSuffix("/presented") }.count == 1)
  #expect(try await reopened.pendingCommands().filter { $0.path.hasSuffix("/read") }.count == 1)
}

@Test(arguments: [400, 404, 409, 410, 422])
func rejectedManagementIntentDoesNotReplayOrBlockOtherCommands(status: Int) async throws {
  let dir = try directory(); defer { try? FileManager.default.removeItem(at: dir) }
  let engine = try ClientEngine(databaseURL: dir.appendingPathComponent("client.sqlite"))
  let transport = FakeTransport()
  _ = try await engine.connect(endpoint: endpoint(), expectedMode: "fixture", transport: transport)
  let conflict = try ManagementCommand.profile(name: "conflict", revision: DecimalString("1"))
  let next = try ManagementCommand.simple(.retryExtraction)
  try await engine.enqueue(id: conflict.id, route: conflict.route, body: conflict.body, destination: identity)
  try await engine.enqueue(id: next.id, route: next.route, body: next.body, destination: identity)
  await transport.queue(conflict.route.path, [.failure(.http(status, "INTENT_REJECTED"))])
  try await engine.drainOutbox()
  #expect(try await engine.command(id: conflict.id, destination: identity)?.state == "REJECTED:INTENT_REJECTED")
  #expect(try await engine.command(id: next.id, destination: identity)?.state == "RECEIPT:ACCEPTED")
  try await engine.drainOutbox()
  #expect(await transport.postBodies(conflict.route.path).count == 1)
  #expect(await transport.postBodies(next.route.path).count == 1)
}

@Test func receiptLookupFailureCannotRejectOrRepostAnIntent() async throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let engine = try ClientEngine(databaseURL: dir.appendingPathComponent("client.sqlite"))
  let transport = FakeTransport()
  _ = try await engine.connect(endpoint: endpoint(), expectedMode: "fixture", transport: transport)
  try await engine.enqueue(id: requestID, route: Route("messages"), body: command(), destination: identity)
  await transport.queue("requests/" + requestID, [.failure(.http(409, "LOOKUP_CONFLICT"))])
  await #expect(throws: ClientError.http(409, "LOOKUP_CONFLICT")) { try await engine.drainOutbox() }
  #expect(await transport.postBodies("messages").isEmpty)
  #expect(try await engine.command(id: requestID, destination: identity)?.body == command())
  await transport.queue("requests/" + requestID, [.success(envelope("{\"receipt\":\(receipt(requestID, state: "UNKNOWN"))}"))])
  try await engine.drainOutbox()
  #expect(try await engine.command(id: requestID, destination: identity)?.state == "UNKNOWN")
  #expect(await transport.postBodies("messages").isEmpty)
}

@Test func unreceivedCommandResendsExactBytesAndPreservesAdmittedFailure() async throws {
  let dir = try directory()
  defer { try? FileManager.default.removeItem(at: dir) }
  let engine = try ClientEngine(databaseURL: dir.appendingPathComponent("client.sqlite"))
  let transport = FakeTransport()
  _ = try await engine.connect(endpoint: endpoint(), expectedMode: "fixture", transport: transport)
  let body = command()
  try await engine.enqueue(id: requestID, route: Route("messages"), body: body, destination: identity)
  await transport.queue("messages", [.failure(.unavailable), .success(envelope(receipt(requestID, state: "UNKNOWN")))])
  await #expect(throws: ClientError.unavailable) { try await engine.drainOutbox() }
  try await engine.drainOutbox()
  #expect(await transport.postBodies("messages") == [body, body])
  #expect(try await engine.command(id: requestID, destination: identity)?.state == "UNKNOWN")
  try await engine.drainOutbox()
  #expect(await transport.postBodies("messages") == [body, body])
}
