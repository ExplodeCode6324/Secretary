import Foundation

public actor ClientEngine {
  private let database: Database
  private var transport: (any CoreTransport)?
  private var identity: Identity?
  private var core: Core?
  private var generation: UInt64 = 0
  private var tickets: [String: UInt64] = [:]
  private var watched: Set<Route> = []
  private var reads = 0
  private var readWaiters: [CheckedContinuation<Void, Never>] = []
  private var draining = false
  private var applying = false
  public init(databaseURL: URL) throws { database = try Database(url: databaseURL) }

  public func disconnect() {
    generation &+= 1
    transport?.cancel()
    transport = nil
    tickets.removeAll()
    let waiting = readWaiters
    readWaiters.removeAll()
    for continuation in waiting { continuation.resume() }
  }
  private func check(_ expected: UInt64) throws {
    guard generation == expected, transport != nil else { throw ClientError.staleConnection }
  }
  public func connect(
    endpoint: Endpoint, expectedMode: String, transport supplied: (any CoreTransport)? = nil,
    routes: [Route] = []
  ) async throws -> Core {
    try endpoint.validate()
    disconnect()
    let version = generation
    let candidate: any CoreTransport = try supplied ?? HTTPTransport(endpoint: endpoint)
    transport = candidate
    do {
      let response = try await read(Route("core"), version: version)
      let core = try Contract.decode(Core.self, from: response)
      guard core.api_version == "1", core.instance_id == endpoint.instance_id,
        core.data_domain_id == endpoint.data_domain_id, core.mode == expectedMode,
        UUID(uuidString: core.owner_id) != nil, UUID(uuidString: core.session_id) != nil
      else { throw ClientError.identityMismatch }
      let identity = Identity(
        owner: core.owner_id, domain: core.data_domain_id, session: core.session_id)
      self.core = core
      self.identity = identity
      watched = Set(routes)
      _ = try database.registrationID(identity)
      if try database.cursor(identity) == nil {
        try await bootstrap(version: version, reset: false)
      } else {
        // Page cursors belong to an instance. Re-query required first pages on every attach.
        for route in routes { _ = try await refresh(route) }
      }
      try await catchUp(version: version)
      try check(version)
      let registration = try database.registrationID(identity)
      struct Registration: Encodable {
        let request_id: String
        let name = "Secretary macOS"
      }
      if try database.command(identity, id: registration) == nil {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try database.enqueue(
          identity, id: registration, route: Route("clients"),
          body: encoder.encode(Registration(request_id: registration)))
      }
      try await drainOutbox()
      try check(version)
      _ = try database.clientID(identity)
      try reconcileNotificationResponses()
      return core
    } catch {
      if generation == version {
        candidate.cancel()
        transport = nil
      }
      throw error
    }
  }
  private func read(_ route: Route, version: UInt64) async throws -> Data {
    try check(version)
    while reads >= 2 {
      guard readWaiters.count < 16 else { throw ClientError.unavailable }
      await withCheckedContinuation { readWaiters.append($0) }
      try check(version)
      try Task.checkCancellation()
    }
    guard let transport else { throw ClientError.unavailable }
    reads += 1
    defer {
      reads -= 1
      if !readWaiters.isEmpty { readWaiters.removeFirst().resume() }
    }
    let data = try await transport.request(route, body: nil)
    try check(version)
    guard data.count <= 8_388_608 else { throw ClientError.responseTooLarge }
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      object["data"] != nil
    else { throw ClientError.invalidContract }
    return data
  }
  public func refresh(_ route: Route) async throws -> CachedProjection {
    guard let identity else { throw ClientError.unavailable }
    let version = generation
    let ticket = (tickets[route.key] ?? 0) &+ 1
    tickets[route.key] = ticket
    watched.insert(route)
    try database.markStale(identity, keys: [route.key])
    let data = try await read(route, version: version)
    guard tickets[route.key] == ticket else { throw ClientError.staleConnection }
    try database.commit(identity, projections: [route.key: data])
    return try database.cached(identity, route: route)!
  }
  public func cached(_ route: Route) throws -> CachedProjection? {
    guard let identity else { return nil }
    return try database.cached(identity, route: route)
  }
  /// One-off pages must not grow the watched set or replay expired instance cursors on reconnect.
  public func query(_ route: Route, destination: Identity) async throws -> Data {
    guard destination == identity else { throw ClientError.staleConnection }
    return try await read(route, version: generation)
  }
  public func unwatch(_ route: Route) throws {
    watched.remove(route)
    tickets[route.key] = (tickets[route.key] ?? 0) &+ 1
    if let identity { try database.forget(identity, route: route) }
  }
  private func bootstrap(version: UInt64, reset: Bool) async throws {
    guard let identity, let core else { throw ClientError.unavailable }
    let watermark = try Contract.decode(
      SyncCursor.self, from: await read(Route("sync/cursor"), version: version))
    guard watermark.instance_id == core.instance_id else { throw ClientError.identityMismatch }
    let routes = Array(watched)
    try database.markStale(identity, keys: routes.map(\.key))
    var projections: [String: Data] = [:]
    var expectedTickets: [String: UInt64] = [:]
    for route in routes {
      let ticket = (tickets[route.key] ?? 0) &+ 1
      tickets[route.key] = ticket
      expectedTickets[route.key] = ticket
      projections[route.key] = try await read(route, version: version)
      guard projections.values.reduce(0, { $0 + $1.count }) <= 8 * 1024 * 1024 else {
        throw ClientError.responseTooLarge
      }
    }
    try check(version)
    guard expectedTickets.allSatisfy({ tickets[$0.key] == $0.value }) else {
      throw ClientError.staleConnection
    }
    try database.commit(
      identity, projections: projections, cursor: watermark.cursor, cutoff: watermark.sequence,
      reset: reset)
  }
  private func catchUp(version: UInt64) async throws {
    guard let identity else { throw ClientError.unavailable }
    var rebuilt = false
    while true {
      try check(version)
      guard let cursor = try database.cursor(identity) else { throw ClientError.invalidContract }
      let page: SyncPage
      do {
        page = try Contract.decode(
          SyncPage.self,
          from: await read(Route("sync/changes", query: ["after": cursor]), version: version))
      } catch ClientError.http(409, "RESYNC_REQUIRED") {
        guard !rebuilt else { throw ClientError.unavailable }
        rebuilt = true
        try await bootstrap(version: version, reset: true)
        continue
      }
      for transaction in page.transactions { try await apply(transaction, version: version) }
      // Do not advance to a page cursor without applying all its transactions.
      guard page.next_cursor == (try database.cursor(identity)),
        !page.has_more || !page.transactions.isEmpty
      else { throw ClientError.invalidContract }
      if !page.has_more { return }
    }
  }
  public func runStream(
    onChange: @escaping @Sendable () async throws -> Void = {},
    onTransient: @escaping @Sendable (Data) async throws -> Void = { _ in }
  ) async throws {
    guard let identity, let transport, let cursor = try database.cursor(identity) else {
      throw ClientError.unavailable
    }
    let version = generation
    try await transport.stream(
      after: cursor,
      receive: { [weak self] transaction in
        guard let self else { throw CancellationError() }
        try await self.apply(transaction, version: version)
        try await onChange()
      },
      transient: { [weak self] data in
        guard let self else { throw CancellationError() }
        try await self.requireGeneration(version)
        try await onTransient(data)
      })
  }
  private func apply(_ transaction: SyncTransaction, version: UInt64) async throws {
    try check(version)
    guard let identity, !applying else { throw ClientError.unavailable }
    if try database.alreadyApplied(identity, cursor: transaction.cursor) { return }
    applying = true
    defer { applying = false }
    // A session switch is a new scope, never a continuation of the old UI/outbox.
    if transaction.changes.contains(where: { $0.resource_type == "session" }) {
      let latest = try Contract.decode(Core.self, from: await read(Route("core"), version: version))
      guard latest.session_id == identity.session, latest.instance_id == core?.instance_id,
        latest.data_domain_id == identity.domain, latest.owner_id == identity.owner
      else { throw ClientError.sessionChanged }
    }
    var invalidated = Set<String>()
    var affected = Set<Route>()
    for change in transaction.changes {
      guard ["record", "invalidate"].contains(change.kind) else {
        throw ClientError.invalidContract
      }
      let key: String
      if change.kind == "invalidate" {
        guard let query = change.query else { throw ClientError.invalidContract }
        key = query
      } else {
        guard let id = change.resource_id, change.revision != nil else {
          throw ClientError.invalidContract
        }
        key = change.resource_type + "/" + id
      }
      _ = try Route(key)
      invalidated.insert(key)
      // Root revisions never suppress an aggregate invalidation.
      for route in watched where Self.affects(key, route: route.path, type: change.resource_type) {
        affected.insert(route)
        invalidated.insert(route.key)
      }
    }
    try database.markStale(identity, keys: Array(invalidated))
    var projections: [String: Data] = [:]
    var expectedTickets: [String: UInt64] = [:]
    for route in affected {
      let ticket = (tickets[route.key] ?? 0) &+ 1
      tickets[route.key] = ticket
      expectedTickets[route.key] = ticket
      projections[route.key] = try await read(route, version: version)
      guard projections.values.reduce(0, { $0 + $1.count }) <= 8 * 1024 * 1024 else {
        throw ClientError.responseTooLarge
      }
    }
    try check(version)
    guard expectedTickets.allSatisfy({ tickets[$0.key] == $0.value }) else {
      throw ClientError.staleConnection
    }
    try database.commit(
      identity, projections: projections, invalidations: Array(invalidated),
      cursor: transaction.cursor)
  }
  nonisolated static func affects(_ key: String, route: String, type: String) -> Bool {
    route == key || route.hasPrefix(key + "/") || key.hasPrefix(route + "/")
      || (type == "executions" && route.contains("/executions"))
      || (type == "session" && route == "session")
  }
  public func saveDraft(key: String, data: Data, destination: Identity) throws {
    guard let identity, identity == destination else { throw ClientError.unavailable }
    try database.saveDraft(identity, key: key, data: data)
  }
  public func draft(key: String) throws -> Data? {
    guard let identity else { return nil }
    return try database.draft(identity, key: key)
  }
  public func enqueue(
    id: String, route: Route, body: Data, destination: Identity, draftKey: String? = nil
  ) throws {
    guard let identity, identity == destination else { throw ClientError.unavailable }
    try database.enqueue(identity, id: id, route: route, body: body, draftKey: draftKey)
  }
  public func command(id: String, destination: Identity) throws -> PendingCommand? {
    guard destination == identity else { throw ClientError.staleConnection }
    return try database.command(destination, id: id)
  }
  public func pendingCommands() throws -> [PendingCommand] {
    guard let identity else { return [] }
    return try database.commands(identity)
  }
  public func drainOutbox() async throws {
    guard let identity, let transport, !draining else { throw ClientError.unavailable }
    let version = generation
    draining = true
    defer { draining = false }
    var position: Int64 = 0
    while let (row, command) = try database.nextPending(identity, after: position) {
      position = row
      try check(version)
      do {
        let response = try await read(Route("requests/" + command.id), version: version)
        let receipt = try Contract.decode(RequestStatus.self, from: response).receipt
        guard receipt.request_id == command.id else { throw ClientError.invalidContract }
        try database.accept(identity, command: command, receipt: receipt)
      } catch ClientError.http(404, "NOT_FOUND") {
        try check(version)
        let isDomainCommand =
          command.path == "clients"
          || command.path.range(
            of: "^notifications/[0-9a-fA-F-]+/(presented|read)$", options: .regularExpression)
            != nil
        guard command.session == identity.session || isDomainCommand, command.state != "UNKNOWN"
        else { continue }
        do {
          let data = try await transport.request(Route(command.path), body: command.body)
          try check(version)
          let receipt = try Contract.decode(Receipt.self, from: data)
          guard receipt.request_id == command.id else { throw ClientError.invalidContract }
          try database.accept(identity, command: command, receipt: receipt)
        } catch ClientError.http(let status, let code)
          where [400, 404, 409, 410, 422].contains(status)
        {
          try check(version)
          // API v1 returns these before admission. Keep the original body for inspection,
          // stop replaying this rejected intent, and allow unrelated pending commands to drain.
          try database.receipt(identity, id: command.id, state: "REJECTED:" + code)
        }
      }
    }
  }

  /// Ascending notification pages must all be visited: the first page may contain only history.
  /// Page cursors are deliberately local to this invocation and never survive an instance change.
  public func visitNotifications(
    generation expected: UInt64,
    consume: @escaping @Sendable ([NotificationDTO]) async throws -> Void
  ) async throws {
    var cursor: String?
    var previous: String?
    repeat {
      try check(expected)
      var query = ["limit": "100"]
      if let cursor { query["cursor"] = cursor }
      let page = try Contract.decode(
        NotificationPage.self,
        from: await read(Route("notifications", query: query), version: expected))
      try await consume(page.items)
      try check(expected)
      previous = cursor
      cursor = page.next_cursor
      guard cursor == nil || cursor != previous else { throw ClientError.invalidContract }
    } while cursor != nil
  }

  public func download(
    _ artifact: MArtifact, destination: Identity, cache: ArtifactCache,
    progress: @escaping @Sendable (Double) async -> Void
  ) async throws -> URL {
    guard destination == identity, let transport else { throw ClientError.staleConnection }
    let version = generation
    let url = try await cache.fetch(
      artifact, identity: destination, transport: transport, progress: progress)
    try check(version)
    return url
  }

  public func currentIdentity() -> Identity? { identity }
  public func connectionGeneration() -> UInt64 { generation }
  public func requireGeneration(_ expected: UInt64) throws { try check(expected) }

  public func captureNotificationResponse(identifier: String, opened: Bool) throws {
    let parts = identifier.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3, parts[0] == "secretary", UUID(uuidString: String(parts[1])) != nil,
      UUID(uuidString: String(parts[2])) != nil
    else { throw ClientError.invalidContract }
    try database.captureResponse(identifier: identifier, opened: opened)
    if transport != nil, identity != nil { try reconcileNotificationResponses() }
  }
  private func reconcileNotificationResponses() throws {
    guard let identity else { return }
    let prefix = "secretary.\(try database.clientID(identity))."
    while true {
      let responses = try database.responses(prefix: prefix)
      if responses.isEmpty { return }
      for (identifier, opened) in responses {
        let id = String(identifier.dropFirst(prefix.count))
        try recordPresentation(
          id, proof: opened ? .userOpened : .userDismissed, generation: generation, markRead: opened
        )
        try database.removeResponse(identifier)
      }
    }
  }
  public func notificationIdentifier(_ id: String) throws -> String {
    guard let identity else { throw ClientError.unavailable }
    return "secretary.\(try database.clientID(identity)).\(id)"
  }
  public func shouldSchedule(_ notice: NotificationDTO) throws -> Bool {
    guard let identity, let cutoff = try database.cutoff(identity) else { return false }
    let client = try database.clientID(identity)
    let evidence = try database.evidence(identity, id: notice.id)
    return notice.created_sequence > cutoff && notice.read_at == nil
      && !notice.presented.contains { $0.client_id == client } && evidence == nil
  }
  public func markScheduled(_ id: String, generation expected: UInt64) throws {
    try check(expected)
    guard let identity else { throw ClientError.unavailable }
    try database.recordEvidence(identity, id: id, evidence: "SCHEDULED")
  }
  public func recordPresentation(
    _ id: String, proof: PresentationProof, generation expected: UInt64, markRead: Bool = false
  ) throws {
    try check(expected)
    guard let identity, UUID(uuidString: id) != nil else { throw ClientError.invalidContract }
    struct Presented: Encodable {
      let request_id: String
      let client_id: String
    }
    struct Read: Encodable { let request_id: String }
    // Queue the receipt before marking evidence. A crash can at worst repeat an idempotent presentation,
    // never leave a local 'presented' bit without a durable command to Core.
    if try database.evidence(identity, id: id) != "PRESENTED" {
      let request = UUID().uuidString.lowercased()
      try database.enqueue(
        identity, id: request, route: Route("notifications/\(id)/presented"),
        body: JSONEncoder().encode(
          Presented(request_id: request, client_id: database.clientID(identity))))
      try database.recordEvidence(identity, id: id, evidence: "PRESENTED")
    }
    if markRead && proof == .userOpened {
      let request = UUID().uuidString.lowercased()
      try database.enqueue(
        identity, id: request, route: Route("notifications/\(id)/read"),
        body: JSONEncoder().encode(Read(request_id: request)))
    }
  }
}

public enum PresentationProof: Sendable {
  case visibleInActiveWindow, deliveredNotification, userOpened, userDismissed
}
