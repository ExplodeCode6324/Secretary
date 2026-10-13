import CryptoKit
import Darwin
import Foundation
import Testing

@testable import SecretaryKit

@Test func resourceAcceptanceDownloadEvictionAndRawResponseLimit() async throws {
  let full = ProcessInfo.processInfo.environment["SECRETARY_RESOURCE_ACCEPTANCE"] == "1"
  let size = full ? 1_073_676_288 : 1_048_576
  let parent =
    ProcessInfo.processInfo.environment["SECRETARY_RESOURCE_ROOT"].map {
      URL(fileURLWithPath: $0)
    } ?? FileManager.default.temporaryDirectory
  let root = parent.appendingPathComponent("secretary-resource-" + UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  var repo = URL(fileURLWithPath: #filePath)
  for _ in 0..<7 { repo.deleteLastPathComponent() }
  let server = Process()
  server.executableURL = URL(fileURLWithPath: "/usr/bin/env")
  server.arguments = [
    "node", repo.appendingPathComponent("test_case/native/resource-server.mjs").path, root.path,
    String(size),
  ]
  try server.run()
  defer {
    server.terminate()
    server.waitUntilExit()
  }
  let config = root.appendingPathComponent("resource.json")
  for _ in 0..<1000 {
    if FileManager.default.fileExists(atPath: config.path) { break }
    try await Task.sleep(for: .milliseconds(10))
  }
  struct Config: Decodable {
    let version: String
    let endpoint: Endpoint
  }
  let value = try JSONDecoder().decode(Config.self, from: Data(contentsOf: config))
  let transport = try HTTPTransport(endpoint: value.endpoint)
  defer { transport.cancel() }
  let identity = Identity(owner: "synthetic", domain: "resources", session: "test")
  let cacheRoot = root.appendingPathComponent("cache")
  let cache = try ArtifactCache(root: cacheRoot, budget: Int64(full ? 1_073_741_824 : size))
  func artifact(_ id: String) throws -> MArtifact {
    try JSONDecoder().decode(
      MArtifact.self,
      from: JSONSerialization.data(withJSONObject: [
        "id": id, "name": "synthetic.bin", "task_id": "task", "execution_id": "execution",
        "content_version": value.version, "bytes": String(size),
        "media_type": "application/octet-stream",
        "state": "AVAILABLE", "path_base": "unknown", "path_unavailable_reason": "NONE",
      ]))
  }
  let start = Date()
  let first = try await cache.fetch(
    artifact("first"), identity: identity, transport: transport, progress: { _ in })
  #expect(try first.resourceValues(forKeys: [.fileSizeKey]).fileSize == size)
  let second = try await cache.fetch(
    artifact("second"), identity: identity, transport: transport, progress: { _ in })
  #expect(!FileManager.default.fileExists(atPath: first.path))
  #expect(try second.resourceValues(forKeys: [.fileSizeKey]).fileSize == size)
  let restored = try await cache.fetch(
    artifact("first"), identity: identity, transport: transport, progress: { _ in })
  #expect(restored == first)
  #expect(!FileManager.default.fileExists(atPath: second.path))
  #expect(try FileManager.default.contentsOfDirectory(atPath: cacheRoot.path).count == 1)
  do {
    _ = try await transport.request(Route("oversize"))
    Issue.record("oversized raw response accepted")
  } catch { #expect(error as? ClientError == .responseTooLarge) }
  var usage = rusage()
  getrusage(RUSAGE_SELF, &usage)
  if full { #expect(usage.ru_maxrss < 256 * 1024 * 1024) }
  print(
    "RESOURCE artifact_bytes=\(size) downloads=3 elapsed_seconds=\(Date().timeIntervalSince(start)) process_peak_rss_bytes=\(usage.ru_maxrss)"
  )
}

@Test func resourceAcceptanceProjectionEvictionPreservesOutboxAndDraft() throws {
  let full = ProcessInfo.processInfo.environment["SECRETARY_RESOURCE_ACCEPTANCE"] == "1"
  let chunk = full ? 8 * 1024 * 1024 : 1024
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(
    "secretary-projections-" + UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: root) }
  let file = root.appendingPathComponent("client.sqlite")
  let identity = Identity(owner: "synthetic", domain: "resources", session: "test")
  let id = UUID().uuidString
  do {
    let db = try Database(url: file, projectionBudget: 32 * chunk)
    try db.saveDraft(identity, key: "composer", data: Data("protected".utf8))
    try db.enqueue(
      identity, id: id, route: Route("messages"), body: Data("{\"request_id\":\"\(id)\"}".utf8))
    let bytes = Data(repeating: 97, count: chunk)
    for index in 0..<34 {
      try db.commit(identity, projections: ["p\(index)": bytes], cursor: "c\(index)")
    }
    #expect(try db.cached(identity, route: Route("p0")) == nil)
    #expect(try db.cached(identity, route: Route("p33"))?.data.count == chunk)
    try db.commit(identity, projections: ["p0": bytes], cursor: "restored")
    #expect(try db.cached(identity, route: Route("p0"))?.data.count == chunk)
  }
  let reopened = try Database(url: file)
  #expect(try reopened.draft(identity, key: "composer") == Data("protected".utf8))
  #expect(try reopened.commands(identity).map(\.id) == [id])
  #expect(try reopened.cursor(identity) == "restored")
  var usage = rusage()
  getrusage(RUSAGE_SELF, &usage)
  print(
    "RESOURCE projection_budget_bytes=\(32 * chunk) inserted_bytes=\(35 * chunk) sqlite_bytes=\((try file.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0) process_peak_rss_bytes=\(usage.ru_maxrss)"
  )
}

@Test func resourceAcceptanceSSERejectsOversizedIncompleteFrame() throws {
  var decoder = SSEDecoder()
  for _ in 0..<4_194_304 { #expect(try decoder.append(97) == nil) }
  #expect(throws: ClientError.responseTooLarge) { try decoder.append(97) }
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["SECRETARY_DISK_FULL_VOLUME"] != nil))
func resourceAcceptanceRealDiskFullRetainsDraftAndPendingCommand() throws {
  let volume = URL(
    fileURLWithPath: ProcessInfo.processInfo.environment["SECRETARY_DISK_FULL_VOLUME"]!)
  let attributes = try FileManager.default.attributesOfFileSystem(forPath: volume.path)
  guard let capacity = attributes[.systemSize] as? NSNumber,
    capacity.int64Value <= 128 * 1024 * 1024
  else {
    throw ClientError.invalidContract  // Never fill a workstation filesystem.
  }
  let root = volume.appendingPathComponent("isolated-" + UUID().uuidString)
  let file = root.appendingPathComponent("client.sqlite")
  let filler = root.appendingPathComponent("filler")
  defer { try? FileManager.default.removeItem(at: root) }
  let identity = Identity(owner: "synthetic", domain: "diskfull", session: "test")
  let id = UUID().uuidString
  do {
    let db = try Database(url: file)
    try db.saveDraft(identity, key: "composer", data: Data("original".utf8))
    try db.enqueue(
      identity, id: id, route: Route("messages"), body: Data("{\"request_id\":\"\(id)\"}".utf8))
    FileManager.default.createFile(atPath: filler.path, contents: nil)
    let output = try FileHandle(forWritingTo: filler)
    var bytes = Data(count: 65536)
    bytes.withUnsafeMutableBytes { arc4random_buf($0.baseAddress, $0.count) }
    var exhausted = false
    for _ in 0..<2048 {
      do { try output.write(contentsOf: bytes) } catch {
        exhausted = true
        break
      }
    }
    try? output.close()
    #expect(exhausted)
    #expect(throws: ClientError.storage) {
      try db.saveDraft(identity, key: "composer", data: Data(repeating: 98, count: 8 * 1024 * 1024))
    }
    try FileManager.default.removeItem(at: filler)
  }
  let reopened = try Database(url: file)
  #expect(try reopened.draft(identity, key: "composer") == Data("original".utf8))
  #expect(try reopened.commands(identity).map(\.id) == [id])
  print(
    "RESOURCE real isolated filesystem full; SQLite rejected write; original draft and pending ID survive reopen"
  )
}
