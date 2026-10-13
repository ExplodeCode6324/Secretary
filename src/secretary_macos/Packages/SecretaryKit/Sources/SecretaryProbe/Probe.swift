import Foundation
import SecretaryKit

enum ProbeSignal: Error { case observed }

@main
struct Probe {
  static func main() async throws {
    guard CommandLine.arguments.count == 5 else { throw ClientError.invalidContract }
    let node = URL(fileURLWithPath: CommandLine.arguments[1])
    let repository = URL(fileURLWithPath: CommandLine.arguments[2])
    let root = URL(fileURLWithPath: CommandLine.arguments[3])
    let hostile = URL(fileURLWithPath: CommandLine.arguments[4])
    let directory = root.appendingPathComponent("core")
    print("probe: launch")
    try await LocalCoreLauncher.start(
      node: node, repository: repository, directory: directory, mode: "fixture")
    let endpoint = try Endpoint.discover(in: directory)
    let control = try HTTPTransport(endpoint: endpoint)
    do {
      let database = root.appendingPathComponent("client/client.sqlite")
      let engine = try ClientEngine(databaseURL: database)
      print("probe: bootstrap")
      let core = try await engine.connect(
        endpoint: endpoint, expectedMode: "fixture",
        routes: [Route("assistant"), Route("session"), Route("notifications")])
      guard core.mode == "fixture" else { throw ClientError.invalidContract }
      print("probe: reconcile")
      try await engine.drainOutbox()
      let commands = try await engine.pendingCommands()
      guard commands.count == 1, commands[0].state.hasPrefix("RECEIPT:") else {
        throw ClientError.invalidContract
      }
      print("probe: SSE")
      do {
        try await withThrowingTaskGroup(of: Void.self) { group in
          group.addTask { try await engine.runStream { throw ProbeSignal.observed } }
          group.addTask {
            try await Task.sleep(for: .seconds(10))
            throw ClientError.unavailable
          }
          defer { group.cancelAll() }
          _ = try await group.next()
        }
      } catch ProbeSignal.observed { /* real authenticated SSE transaction applied */  }
      await engine.disconnect()
      let stillRunning = try Contract.decode(Core.self, from: await control.request(Route("core")))
      guard stillRunning.instance_id == core.instance_id else { throw ClientError.invalidContract }
      print("probe: reopen")
      let reopened = try ClientEngine(databaseURL: database)
      _ = try await reopened.connect(
        endpoint: endpoint, expectedMode: "fixture", routes: [Route("notifications")])
      try await reopened.drainOutbox()
      guard try await reopened.pendingCommands().first?.id == commands[0].id else {
        throw ClientError.invalidContract
      }
      await reopened.disconnect()
      print("probe: redirect")
      let malicious = try HTTPTransport(endpoint: Endpoint.discover(in: hostile))
      do {
        _ = try await malicious.request(Route("core"))
        throw ClientError.invalidContract
      } catch ClientError.http(302, _) { /* credentials must not follow redirect */  }
      malicious.cancel()
      try await stop(control)
      print(
        "PASS: explicit launch, private discovery, authenticated bootstrap, durable registration, SSE, restart, app disconnect preserves Core, redirect rejected"
      )
    } catch {
      try? await stop(control)
      throw error
    }
  }
  static func stop(_ transport: HTTPTransport) async throws {
    let body = Data("{\"request_id\":\"\(UUID().uuidString.lowercased())\"}".utf8)
    _ = try await transport.request(Route("core/stop"), body: body)
    transport.cancel()
  }
}
