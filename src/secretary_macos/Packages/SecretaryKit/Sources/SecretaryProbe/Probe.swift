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
      print("probe: chat")
      let identity = Identity(
        owner: core.owner_id, domain: core.data_domain_id, session: core.session_id)
      let editor = try await ChatLocalState(url: database)
      let message = "Native integration\n中文 👩🏽‍💻 e\u{301}"
      try await editor.saveDraft(message, for: identity)
      let messageID = try await editor.enqueue(message, for: identity)
      guard try await editor.draft(identity).isEmpty else { throw ClientError.storage }
      try await engine.drainOutbox()
      let chatCommands = try await editor.commands(identity)
      guard chatCommands.contains(where: { $0.id == messageID && $0.state.hasPrefix("RECEIPT:") })
      else {
        throw ClientError.invalidContract
      }
      let timeline = try Contract.decode(
        ChatPage.self,
        from: await engine.query(ChatPreferences().route, destination: identity))
      guard let sent = timeline.items.first(where: { $0.text == message }) else {
        throw ClientError.invalidContract
      }
      let around = try Contract.decode(
        ChatPage.self,
        from: await engine.query(
          Route("timeline/around", query: ["message_id": sent.id]), destination: identity))
      guard around.items.contains(where: { $0.id == sent.id }) else {
        throw ClientError.invalidContract
      }
      print(
        "PASS: durable chat send, receipt reconciliation, Unicode timeline and direct message location"
      )
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
