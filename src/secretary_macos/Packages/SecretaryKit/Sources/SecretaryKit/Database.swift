import CSQLite
import Darwin
import Foundation

public struct CachedProjection: Sendable {
  public let data: Data
  public let stale: Bool
  public let confirmedAt: Date
}
public struct PendingCommand: Sendable {
  public let id: String
  public let session: String
  public let path: String
  public let body: Data
  public let state: String
}
enum SQLValue {
  case text(String)
  case bytes(Data)
  case integer(Int64)
  case null
}

/// Synchronous and actor-confined. No await can split identity checks and writes.
final class Database {
  private var connection: OpaquePointer?
  var beforeCommit: (() throws -> Void)?  // deterministic disk-failure injection for tests
  let projectionBudget: Int
  private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

  init(url: URL, projectionBudget: Int = 256 * 1024 * 1024) throws {
    self.projectionBudget = projectionBudget
    let directory = url.deletingLastPathComponent()
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    var info = stat()
    guard lstat(directory.path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR,
      info.st_uid == getuid(), info.st_mode & 0o077 == 0
    else { throw ClientError.storage }
    let fd = open(url.path, O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0o600)
    guard fd >= 0 else { throw ClientError.storage }
    let safe =
      fstat(fd, &info) == 0 && info.st_mode & S_IFMT == S_IFREG && info.st_uid == getuid()
      && info.st_mode & 0o077 == 0
    close(fd)
    guard safe,
      sqlite3_open_v2(url.path, &connection, SQLITE_OPEN_READWRITE | SQLITE_OPEN_NOMUTEX, nil)
        == SQLITE_OK
    else {
      if connection != nil {
        sqlite3_close(connection)
        connection = nil
      }
      throw ClientError.storage
    }
    do {
      try execute("PRAGMA journal_mode=WAL")
      try execute("PRAGMA synchronous=FULL")
      try execute("PRAGMA busy_timeout=3000")
      let version = try rows("PRAGMA user_version").first?.first ?? nil
      guard version == "0" || version == "1" else { throw ClientError.storageVersion }
      try execute(
        """
        CREATE TABLE IF NOT EXISTS domains (domain TEXT PRIMARY KEY, registration TEXT NOT NULL, client TEXT, cursor TEXT, cutoff TEXT);
        CREATE TABLE IF NOT EXISTS applied (domain TEXT, cursor TEXT, PRIMARY KEY(domain,cursor));
        CREATE TABLE IF NOT EXISTS drafts (scope TEXT, key TEXT, body BLOB NOT NULL, PRIMARY KEY(scope,key));
        CREATE TABLE IF NOT EXISTS anchors (scope TEXT, key TEXT, value TEXT NOT NULL, PRIMARY KEY(scope,key));
        CREATE TABLE IF NOT EXISTS outbox (domain TEXT, id TEXT, session TEXT NOT NULL, path TEXT NOT NULL,
            body BLOB NOT NULL, state TEXT NOT NULL, PRIMARY KEY(domain,id));
        CREATE TABLE IF NOT EXISTS projections (scope TEXT, key TEXT, body BLOB NOT NULL, stale INTEGER NOT NULL,
            confirmed REAL NOT NULL, PRIMARY KEY(scope,key));
        CREATE TABLE IF NOT EXISTS invalidations (scope TEXT, key TEXT, PRIMARY KEY(scope,key));
        CREATE TABLE IF NOT EXISTS notification_responses (identifier TEXT PRIMARY KEY, opened INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS presentations (domain TEXT, id TEXT, evidence TEXT NOT NULL, PRIMARY KEY(domain,id));
        PRAGMA user_version=1;
        """)
    } catch {
      sqlite3_close(connection)
      connection = nil
      throw error
    }
  }
  deinit { if let connection { sqlite3_close(connection) } }

  private func execute(_ sql: String) throws {
    guard sqlite3_exec(connection, sql, nil, nil, nil) == SQLITE_OK else {
      throw ClientError.storage
    }
  }
  private func statement(_ sql: String, _ values: [SQLValue]) throws -> OpaquePointer {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(connection, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
      throw ClientError.storage
    }
    do {
      for (index, value) in values.enumerated() {
        let result: Int32
        switch value {
        case .text(let text):
          result = sqlite3_bind_text(stmt, Int32(index + 1), text, -1, transient)
        case .bytes(let data):
          result =
            data.isEmpty
            ? sqlite3_bind_zeroblob(stmt, Int32(index + 1), 0)
            : data.withUnsafeBytes {
              sqlite3_bind_blob(stmt, Int32(index + 1), $0.baseAddress, Int32($0.count), transient)
            }
        case .integer(let number): result = sqlite3_bind_int64(stmt, Int32(index + 1), number)
        case .null: result = sqlite3_bind_null(stmt, Int32(index + 1))
        }
        guard result == SQLITE_OK else { throw ClientError.storage }
      }
      return stmt
    } catch {
      sqlite3_finalize(stmt)
      throw error
    }
  }
  private func write(_ sql: String, _ values: [SQLValue] = []) throws {
    let stmt = try statement(sql, values)
    defer { sqlite3_finalize(stmt) }
    guard sqlite3_step(stmt) == SQLITE_DONE else { throw ClientError.storage }
  }
  private func rows(_ sql: String, _ values: [SQLValue] = []) throws -> [[String?]] {
    let stmt = try statement(sql, values)
    defer { sqlite3_finalize(stmt) }
    var result: [[String?]] = []
    while true {
      let code = sqlite3_step(stmt)
      if code == SQLITE_DONE { return result }
      guard code == SQLITE_ROW else { throw ClientError.storage }
      result.append(
        (0..<sqlite3_column_count(stmt)).map { index in
          guard let chars = sqlite3_column_text(stmt, index) else { return nil }
          return String(cString: chars)
        })
    }
  }
  private func blob(_ sql: String, _ values: [SQLValue]) throws -> Data? {
    let stmt = try statement(sql, values)
    defer { sqlite3_finalize(stmt) }
    let code = sqlite3_step(stmt)
    if code == SQLITE_DONE { return nil }
    guard code == SQLITE_ROW else { throw ClientError.storage }
    let size = Int(sqlite3_column_bytes(stmt, 0))
    guard size > 0, let ptr = sqlite3_column_blob(stmt, 0) else { return Data() }
    return Data(bytes: ptr, count: size)
  }
  func transaction(_ body: () throws -> Void) throws {
    try execute("BEGIN IMMEDIATE")
    do {
      try body()
      try beforeCommit?()
      try execute("COMMIT")
    } catch {
      try? execute("ROLLBACK")
      throw error
    }
  }
  func registrationID(_ identity: Identity) throws -> String {
    let key = identity.domainKey
    if let id = try rows("SELECT registration FROM domains WHERE domain=?", [.text(key)]).first?
      .first, let id
    {
      return id
    }
    let id = UUID().uuidString.lowercased()
    try write("INSERT INTO domains(domain,registration) VALUES(?,?)", [.text(key), .text(id)])
    return id
  }
  func clientID(_ identity: Identity) throws -> String {
    guard
      let id = try rows("SELECT client FROM domains WHERE domain=?", [.text(identity.domainKey)])
        .first?.first, let id
    else { throw ClientError.unavailable }
    return id
  }
  func accept(_ identity: Identity, command: PendingCommand, receipt: Receipt) throws {
    try transaction {
      if command.path == "clients",
        let client = receipt.resource_ids.first(where: { $0.type == "ClientRegistration" })
      {
        guard UUID(uuidString: client.id) != nil else { throw ClientError.invalidContract }
        try write(
          "UPDATE domains SET client=? WHERE domain=?",
          [.text(client.id), .text(identity.domainKey)])
      }
      try self.receipt(
        identity, id: command.id,
        state: receipt.state == "UNKNOWN" ? "UNKNOWN" : "RECEIPT:" + receipt.state)
    }
  }
  func saveDraft(_ identity: Identity, key: String, data: Data) throws {
    try write(
      "INSERT OR REPLACE INTO drafts VALUES(?,?,?)",
      [.text(identity.scope), .text(key), .bytes(data)])
  }
  func draft(_ identity: Identity, key: String) throws -> Data? {
    try blob(
      "SELECT body FROM drafts WHERE scope=? AND key=?", [.text(identity.scope), .text(key)])
  }
  func saveAnchor(_ identity: Identity, value: String) throws {
    try write(
      "INSERT OR REPLACE INTO anchors VALUES(?,?,?)",
      [.text(identity.scope), .text("chat"), .text(value)])
  }
  func anchor(_ identity: Identity) throws -> String? {
    try rows("SELECT value FROM anchors WHERE scope=? AND key='chat'", [.text(identity.scope)])
      .first?.first ?? nil
  }
  func chatCommands(_ identity: Identity) throws -> [PendingCommand] {
    let ids = try rows(
      "SELECT id FROM outbox WHERE domain=? AND session=? AND path='messages' ORDER BY rowid DESC LIMIT 30",
      [.text(identity.domainKey), .text(identity.session)])
    return try ids.compactMap { try command(identity, id: $0[0]!) }
  }
  func enqueue(_ identity: Identity, id: String, route: Route, body: Data, draftKey: String? = nil)
    throws
  {
    guard UUID(uuidString: id) != nil, body.count <= 1_048_576, route.query.isEmpty else {
      throw ClientError.invalidContract
    }
    struct Command: Decodable { let request_id: String }
    guard try JSONDecoder().decode(Command.self, from: body).request_id == id else {
      throw ClientError.invalidContract
    }
    if let old = try command(identity, id: id) {
      guard old.body == body, old.path == route.path, old.session == identity.session else {
        throw ClientError.requestConflict
      }
      return
    }
    try transaction {
      try write(
        "INSERT INTO outbox VALUES(?,?,?,?,?,?)",
        [
          .text(identity.domainKey), .text(id), .text(identity.session), .text(route.path),
          .bytes(body), .text("PENDING"),
        ])
      if let draftKey {
        try write(
          "DELETE FROM drafts WHERE scope=? AND key=?", [.text(identity.scope), .text(draftKey)])
      }
    }
  }
  // Called only inside an existing transaction by the management editor.
  func insertCommand(_ identity: Identity, id: String, route: Route, body: Data) throws {
    guard UUID(uuidString: id) != nil, body.count <= 1_048_576, route.query.isEmpty,
      try command(identity, id: id) == nil
    else { throw ClientError.requestConflict }
    struct Command: Decodable { let request_id: String }
    guard try JSONDecoder().decode(Command.self, from: body).request_id == id else {
      throw ClientError.invalidContract
    }
    try write(
      "INSERT INTO outbox VALUES(?,?,?,?,?,?)",
      [
        .text(identity.domainKey), .text(id), .text(identity.session), .text(route.path),
        .bytes(body), .text("PENDING"),
      ])
  }
  func command(_ identity: Identity, id: String) throws -> PendingCommand? {
    guard
      let row = try rows(
        "SELECT id,session,path,state FROM outbox WHERE domain=? AND id=?",
        [.text(identity.domainKey), .text(id)]
      ).first
    else { return nil }
    let data = try blob(
      "SELECT body FROM outbox WHERE domain=? AND id=?", [.text(identity.domainKey), .text(id)])!
    return PendingCommand(id: row[0]!, session: row[1]!, path: row[2]!, body: data, state: row[3]!)
  }
  func commands(_ identity: Identity) throws -> [PendingCommand] {
    // Inspection is a bounded first page; reconciliation below uses a one-row iterator.
    let ids = try rows(
      "SELECT id FROM outbox WHERE domain=? ORDER BY rowid LIMIT 8", [.text(identity.domainKey)])
    return try ids.compactMap { try command(identity, id: $0[0]!) }
  }
  func nextPending(_ identity: Identity, after: Int64) throws -> (Int64, PendingCommand)? {
    guard
      let row = try rows(
        "SELECT rowid,id FROM outbox WHERE domain=? AND rowid>? AND state IN ('PENDING','UNKNOWN') ORDER BY rowid LIMIT 1",
        [.text(identity.domainKey), .integer(after)]
      ).first,
      let command = try command(identity, id: row[1]!)
    else { return nil }
    return (Int64(row[0]!)!, command)
  }
  func receipt(_ identity: Identity, id: String, state: String) throws {
    try write(
      "UPDATE outbox SET state=? WHERE domain=? AND id=?",
      [.text(state), .text(identity.domainKey), .text(id)])
  }
  func alreadyApplied(_ identity: Identity, cursor: String) throws -> Bool {
    try !rows(
      "SELECT cursor FROM applied WHERE domain=? AND cursor=?",
      [.text(identity.domainKey), .text(cursor)]
    ).isEmpty
  }
  func cursor(_ identity: Identity) throws -> String? {
    try rows("SELECT cursor FROM domains WHERE domain=?", [.text(identity.domainKey)]).first?.first
      ?? nil
  }
  func cutoff(_ identity: Identity) throws -> DecimalString? {
    guard
      let value = try rows("SELECT cutoff FROM domains WHERE domain=?", [.text(identity.domainKey)])
        .first?.first, let value
    else { return nil }
    return try DecimalString(value)
  }
  func cached(_ identity: Identity, route: Route) throws -> CachedProjection? {
    guard
      let row = try rows(
        "SELECT stale,confirmed FROM projections WHERE scope=? AND key=?",
        [.text(identity.scope), .text(route.key)]
      ).first,
      let data = try blob(
        "SELECT body FROM projections WHERE scope=? AND key=?",
        [.text(identity.scope), .text(route.key)])
    else { return nil }
    return CachedProjection(
      data: data, stale: row[0] == "1", confirmedAt: Date(timeIntervalSince1970: Double(row[1]!)!))
  }
  func forget(_ identity: Identity, route: Route) throws {
    try write(
      "DELETE FROM projections WHERE scope=? AND key=?", [.text(identity.scope), .text(route.key)])
  }
  func markStale(_ identity: Identity, keys: [String]) throws {
    try transaction { try invalidate(identity, keys: keys) }
  }
  private func invalidate(_ identity: Identity, keys: [String]) throws {
    let cachedKeys = try rows("SELECT key FROM projections WHERE scope=?", [.text(identity.scope)])
      .compactMap { $0[0] }
    for cachedKey in cachedKeys {
      let path = String(cachedKey.split(separator: "?", maxSplits: 1)[0])
      if keys.contains(where: { key in
        ClientEngine.affects(key, route: path, type: String(key.split(separator: "/")[0]))
      }) {
        try write(
          "UPDATE projections SET stale=1 WHERE scope=? AND key=?",
          [.text(identity.scope), .text(cachedKey)])
      }
    }
    for key in keys {
      try write(
        "INSERT OR IGNORE INTO invalidations VALUES(?,?)", [.text(identity.scope), .text(key)])
      try write(
        "UPDATE projections SET stale=1 WHERE scope=? AND key=?",
        [.text(identity.scope), .text(key)])
    }
  }
  private func put(_ identity: Identity, key: String, data: Data) throws {
    guard data.count <= projectionBudget else { throw ClientError.responseTooLarge }
    try write(
      "INSERT OR REPLACE INTO projections VALUES(?,?,?,0,?)",
      [
        .text(identity.scope), .text(key), .bytes(data),
        .integer(Int64(Date().timeIntervalSince1970)),
      ])
    try write(
      "DELETE FROM invalidations WHERE scope=? AND key=?", [.text(identity.scope), .text(key)])
  }
  func commit(
    _ identity: Identity, projections: [String: Data], invalidations: [String] = [],
    cursor: String? = nil, cutoff: DecimalString? = nil, reset: Bool = false
  ) throws {
    _ = try registrationID(identity)
    try transaction {
      if reset {
        try write("DELETE FROM applied WHERE domain=?", [.text(identity.domainKey)])
        // All sessions in this domain must lose reconstructible projections. Protected tables stay.
        let scopes = try rows("SELECT DISTINCT scope FROM projections").compactMap { $0[0] }.filter
        { $0.hasPrefix(identity.domainKey) }
        for scope in scopes {
          try write("DELETE FROM projections WHERE scope=?", [.text(scope)])
          try write("DELETE FROM invalidations WHERE scope=?", [.text(scope)])
        }
      }
      try invalidate(identity, keys: invalidations)
      for (key, data) in projections { try put(identity, key: key, data: data) }
      if let cursor {
        try write(
          "UPDATE domains SET cursor=? WHERE domain=?", [.text(cursor), .text(identity.domainKey)])
        try write(
          "INSERT OR IGNORE INTO applied VALUES(?,?)", [.text(identity.domainKey), .text(cursor)])
        try write(
          "DELETE FROM applied WHERE domain=? AND rowid NOT IN (SELECT rowid FROM applied WHERE domain=? ORDER BY rowid DESC LIMIT 1024)",
          [.text(identity.domainKey), .text(identity.domainKey)])
      }
      if let cutoff {
        try write(
          "UPDATE domains SET cutoff=COALESCE(cutoff,?) WHERE domain=?",
          [.text(cutoff.rawValue), .text(identity.domainKey)])
      }
      while Int(try rows("SELECT COALESCE(SUM(length(body)),0) FROM projections")[0][0]!)!
        > projectionBudget
      {
        try execute(
          "DELETE FROM projections WHERE rowid=(SELECT rowid FROM projections ORDER BY confirmed,rowid LIMIT 1)"
        )
      }
    }
  }
  func captureResponse(identifier: String, opened: Bool) throws {
    try write(
      "INSERT INTO notification_responses VALUES(?,?) ON CONFLICT(identifier) DO UPDATE SET opened=MAX(opened,excluded.opened)",
      [.text(identifier), .integer(opened ? 1 : 0)])
  }
  func responses(prefix: String) throws -> [(String, Bool)] {
    // UUID-based prefix has no LIKE wildcards. Only this registered client is replayed.
    try rows(
      "SELECT identifier,opened FROM notification_responses WHERE identifier LIKE ? ORDER BY rowid LIMIT 100",
      [.text(prefix + "%")]
    ).map { ($0[0]!, $0[1] == "1") }
  }
  func removeResponse(_ identifier: String) throws {
    try write("DELETE FROM notification_responses WHERE identifier=?", [.text(identifier)])
  }
  func evidence(_ identity: Identity, id: String) throws -> String? {
    try rows(
      "SELECT evidence FROM presentations WHERE domain=? AND id=?",
      [.text(identity.domainKey), .text(id)]
    ).first?.first ?? nil
  }
  func recordEvidence(_ identity: Identity, id: String, evidence: String) throws {
    try write(
      "INSERT OR REPLACE INTO presentations VALUES(?,?,?)",
      [.text(identity.domainKey), .text(id), .text(evidence)])
  }
}
