import CryptoKit
import Foundation
import Testing

@testable import SecretaryKit

private func waitForFile(_ url: URL) async throws {
  for _ in 0..<1000 {
    if FileManager.default.fileExists(atPath: url.path) { return }
    try await Task.sleep(for: .milliseconds(10))
  }
  throw ClientError.unavailable
}

@Test func realDownloadsSeparateIdleTimeoutAndValidateBeforeOpening() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(
    "secretary-download-" + UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  var repo = URL(fileURLWithPath: #filePath)
  for _ in 0..<7 { repo.deleteLastPathComponent() }
  let server = Process()
  server.executableURL = URL(fileURLWithPath: "/usr/bin/env")
  server.arguments = [
    "node", repo.appendingPathComponent("test_case/native/download-server.mjs").path, root.path,
  ]
  try server.run()
  defer {
    server.terminate()
    server.waitUntilExit()
  }
  let endpointFile = root.appendingPathComponent("endpoint.json")
  try await waitForFile(endpointFile)
  let endpoint = try JSONDecoder().decode(Endpoint.self, from: Data(contentsOf: endpointFile))
  let production = try HTTPTransport(endpoint: endpoint)
  #expect(production.downloadSession.configuration.timeoutIntervalForRequest == 30)
  #expect(
    production.downloadSession.configuration.timeoutIntervalForResource
      == URLSessionConfiguration.ephemeral.timeoutIntervalForResource)
  #expect(production.downloadSession.configuration.timeoutIntervalForResource > 60)
  production.cancel()
  let transport = try HTTPTransport(endpoint: endpoint, downloadIdleTimeout: 1)
  defer { transport.cancel() }
  let content = Data(repeating: 97, count: 4096)
  let hash = SHA256.hash(data: content).map { String(format: "%02x", $0) }.joined()
  let identity = Identity(owner: "synthetic", domain: "downloads", session: "test")
  func artifact(_ id: String) throws -> MArtifact {
    try JSONDecoder().decode(
      MArtifact.self,
      from: JSONSerialization.data(withJSONObject: [
        "id": id, "name": "test.txt", "task_id": "task", "execution_id": "execution",
        "content_version": hash, "bytes": "4096", "media_type": "text/plain", "state": "AVAILABLE",
        "relative_path": NSNull(), "path_base": "unknown", "path_unavailable_reason": "NONE",
      ]))
  }
  let cacheRoot = root.appendingPathComponent("cache")
  let cache = try ArtifactCache(root: cacheRoot)
  for id in ["normal", "drip"] {
    let start = ContinuousClock.now
    let file = try await cache.fetch(
      artifact(id), identity: identity, transport: transport, progress: { _ in })
    #expect(try Data(contentsOf: file) == content)
    if id == "drip" { #expect(start.duration(to: .now) > .seconds(1)) }
  }
  for id in ["stall", "short", "oversize", "etag", "redirect", "corrupt"] {
    let before = try FileManager.default.contentsOfDirectory(atPath: cacheRoot.path).sorted()
    do {
      _ = try await cache.fetch(
        artifact(id), identity: identity, transport: transport, progress: { _ in })
      Issue.record("invalid download published: \(id)")
    } catch {
      if id == "stall" { #expect((error as? URLError)?.code == .timedOut) }
    }
    #expect(try FileManager.default.contentsOfDirectory(atPath: cacheRoot.path).sorted() == before)
  }
  for id in ["cancel", "disconnect"] {
    let ownTransport = try HTTPTransport(endpoint: endpoint)
    let item = try artifact(id)
    let transfer = Task {
      try await cache.fetch(item, identity: identity, transport: ownTransport, progress: { _ in })
    }
    try await waitForFile(root.appendingPathComponent("started-" + id))
    if id == "cancel" { transfer.cancel() } else { ownTransport.cancel() }
    do {
      _ = try await transfer.value
      Issue.record("cancelled download published")
    } catch {}
    ownTransport.cancel()
    try await waitForFile(root.appendingPathComponent("closed-" + id))
    #expect(
      try FileManager.default.contentsOfDirectory(atPath: cacheRoot.path).allSatisfy {
        !$0.hasPrefix("partial-")
      })
  }
  // A bad same-length body satisfies transport metadata but must fail cache admission.
  let untrusted = root.appendingPathComponent("untrusted")
  try await transport.download(
    Route("artifacts/corrupt/content"), to: untrusted, bytes: 4096, version: hash,
    progress: { _ in })
  #expect(try Data(contentsOf: untrusted) != content)
}
