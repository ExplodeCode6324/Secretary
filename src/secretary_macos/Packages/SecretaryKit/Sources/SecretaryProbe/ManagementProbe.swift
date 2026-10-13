import Foundation
import SecretaryKit

extension Probe {
  @MainActor static func management(_ directory: String) async throws {
    let root = URL(fileURLWithPath: directory)
    let manifest = try JSONDecoder().decode(
      JSONValue.self, from: Data(contentsOf: root.appendingPathComponent("manifest.json")))
    let endpoint = try Endpoint.discover(in: root.appendingPathComponent("core"))
    let transport = try HTTPTransport(endpoint: endpoint)
    let db = root.appendingPathComponent("client/client.sqlite")
    let engine = try ClientEngine(databaseURL: db)
    let core = try await engine.connect(endpoint: endpoint, expectedMode: "fixture")
    let identity = Identity(
      owner: core.owner_id, domain: core.data_domain_id, session: core.session_id)
    let local = try ManagementLocalState(url: db)
    func get<T: Decodable>(_ type: T.Type, _ path: String, _ query: [String: String] = [:])
      async throws -> T
    {
      try Contract.decode(
        type, from: await engine.query(Route(path, query: query), destination: identity))
    }
    func send(_ command: ManagementCommand) async throws -> Receipt {
      try local.enqueue(command, identity: identity, key: "probe", editor: Data(command.id.utf8))
      try await engine.drainOutbox()
      if let saved = try await engine.command(id: command.id, destination: identity),
        saved.state.hasPrefix("REJECTED:")
      {
        print("rejected:", command.route.path, saved.state)
        throw ClientError.invalidContract
      }
      return try await get(RequestStatus.self, "requests/" + command.id).receipt
    }
    func settledSettings() async throws -> MSettings {
      for _ in 0..<100 {
        let value = try await get(MSettings.self, "settings")
        if value.applications.allSatisfy({ ["APPLIED", "FAILED", "BLOCKED"].contains($0.state) }) {
          return value
        }
        try await Task.sleep(for: .milliseconds(50))
      }
      throw ClientError.unavailable
    }
    func require(_ condition: Bool, _ message: String) throws {
      if !condition {
        print("FAIL:", message)
        throw ClientError.invalidContract
      }
    }
    print("management: queries")
    _ = try await get(MMemoryStatus.self, "memory")
    _ = try await get(MMemoryPage.self, "memory/summary")
    _ = try await get(MCommitmentPage.self, "memory/commitments")
    _ = try await get(MRulePage.self, "authorization-rules")
    let scopeReceipt = try await send(
      .scope(
        name: "Synthetic Scope", description: "probe", root: nil, notes: nil, defaultWrite: "ask"))
    let scopeID = try await get(MScopePage.self, "scopes").items.first {
      $0.name == "Synthetic Scope"
    }!.id
    try require(!scopeReceipt.resource_ids.isEmpty, "scope receipt resources")
    // A second client changes a shared Scope; the first client's watched projection converges via SSE.
    _ = try await engine.refresh(Route("scopes"))
    let scope = try await get(MScope.self, "scopes/" + scopeID)
    let update = try ManagementCommand.scope(id:scopeID,revision:scope.revision,name:"Updated synthetic Scope",description:"second client",root:nil,notes:nil,defaultWrite:"ask")
    _ = try await transport.request(update.route,body:update.body)
    do {
      try await withThrowingTaskGroup(of: Void.self) { group in
        group.addTask {
          try await engine.runStream {
            if let projection = try await engine.cached(Route("scopes")),
              try Contract.decode(MScopePage.self,from:projection.data).items.contains(where: { $0.id == scopeID && $0.name == "Updated synthetic Scope" }) {
              throw ProbeSignal.observed
            }
          }
        }
        group.addTask { try await Task.sleep(for:.seconds(10)); throw ClientError.unavailable }
        defer { group.cancelAll() }
        _ = try await group.next()
      }
    } catch ProbeSignal.observed {}
    let taskCommand = try ManagementCommand.task(goal: "Native scoped task", scope: scopeID)
    _ = try await send(taskCommand)
    let tasks = try await get(MTaskPage.self, "tasks", ["scope_id": scopeID])
    try require(tasks.items.count == 1 && tasks.items[0].scope_id == scopeID, "scope filter")
    let taskID = tasks.items[0].id
    _ = try await get(MTaskDetail.self, "tasks/" + taskID)
    let pending = try await get(MPendingRequestPage.self, "tasks/\(taskID)/requests")
    try require(pending.items.count == 1, "pending request")
    _ = try await send(.simple(.cancelRequest(pending.items[0].request_id)))
    let executionID = manifest["execution"].string!
    let before = try await get(MExecution.self, "executions/" + executionID)
    let again = try await get(MExecution.self, "executions/" + executionID)
    try require(
      before.last_activity_at == again.last_activity_at, "queries must not renew retention")
    _ = try await send(.simple(.viewed(executionID)))
    _ = try await send(.simple(.cancelExecution(executionID)))
    print("management: approvals and conflict")
    let approvals = manifest["approvals"].array.compactMap(\.string)
    let first = try await get(MAuthorization.self, "authorizations/" + approvals[0])
    let approvalCommand = try ManagementCommand.approval(first, choice: .approve)
    _ = try await send(approvalCommand)
    // A second client with the original snapshot must be rejected; neither changes the intent.
    let stale = try ManagementCommand.approval(first, choice: .reject)
    do {
      _ = try await transport.request(stale.route, body: stale.body)
      throw ClientError.invalidContract
    } catch ClientError.http(409, _) {}
    let remembered = try await get(MAuthorization.self, "authorizations/" + approvals[1])
    _ = try await send(.approval(remembered, choice: .approve, prefixTokens: 2))
    let rules = try await get(MRulePage.self, "authorization-rules")
    let rule = rules.items.first!
    _ = try await send(.revision(.disableRule(rule.id), rule.revision))
    let disabled = try await get(MRulePage.self, "authorization-rules")
    try require(disabled.items.first(where: { $0.id == rule.id })?.state == "DISABLED", "shared rule disabled")
    let rejected = try await get(MAuthorization.self, "authorizations/" + approvals[2])
    _ = try await send(.approval(rejected, choice: .reject))
    let grant = try await get(MAuthorization.self, "authorizations/" + approvals[0])
    _ = try await send(.approval(grant, choice: .revoke))
    _ = try await send(.answer(manifest["decision"].string!, answer: "A"))
    print("management: unknown results and opaque content")
    for (index, outcome) in OperationOutcome.allCases.enumerated() {
      let id = manifest["operations"].array[index].string!
      let op = try await get(MOperation.self, "operations/" + id)
      var text = op.display!.stdout.text
      var cursor = op.display!.stdout.next_cursor
      while let next = cursor {
        let fragment = try await get(
          MOperationText.self, "operations/\(id)/content", ["part": "stdout", "cursor": next])
        text += fragment.text
        cursor = fragment.next_cursor
      }
      try require(
        text == String(repeating: "中文😀", count: 12000), "complete Unicode operation output")
      _ = try await send(.resolve(op, outcome: outcome, note: "Synthetic operator evidence"))
      let resolved = try await get(MOperation.self, "operations/" + id)
      try require(resolved.resolution?.outcome == outcome.rawValue, "resolution outcome")
    }
    print("management: shared settings conflicts")
    let settings = try await get(MSettings.self, "settings")
    let payload: JSONValue = .object([
      "instructions": .object([
        "content": .string("Synthetic instructions"),
        "expected_revision": .string(settings.effective_instructions.revision),
      ]), "edits": .array([]), "command_ids": .array([]),
    ])
    let save = try ManagementCommand.saveSettings(
      revision: settings.draft.revision, payload: payload)
    _ = try await send(save)
    let conflict = try ManagementCommand.saveSettings(
      revision: settings.draft.revision, payload: payload)
    // Exercise persistent rejection and ensure subsequent commands are not blocked.
    try local.enqueue(
      conflict, identity: identity, key: "conflict",
      editor: Data("preserved local instructions".utf8))
    try await engine.drainOutbox()
    try require(
      try await engine.command(id: conflict.id, destination: identity)?.state.hasPrefix("REJECTED:")
        == true, "conflict persisted")
    try require(
      try local.load(key: "conflict", identity: identity)
        == Data("preserved local instructions".utf8), "conflict input survives")
    let profile = try await get(MProfile.self, "assistant")
    _ = try await send(.profile(name: "Native management", revision: profile.revision))
    let current = try await get(MSettings.self, "settings")
    _ = try await send(.revision(.apply, current.draft.revision))
    let applied = try await settledSettings()
    try require(
      applied.effective_instructions.content == "Synthetic instructions",
      "instructions actually applied")
    if manifest["world"] == .bool(true) {
      print("management: World draft/apply/slot/correct/retract/recovery")
      let entity = UUID().uuidString.lowercased()
      func edit(_ values: [String: JSONValue]) async throws -> MSettings {
        let current = try await get(MSettings.self, "settings")
        _ = try await send(
          .saveSettings(
            revision: current.draft.revision,
            payload: .object([
              "instructions": .null, "edits": .array([.object(values)]), "command_ids": .array([]),
            ])))
        let saved = try await get(MSettings.self, "settings")
        _ = try await send(.revision(.apply, saved.draft.revision))
        return try await settledSettings()
      }
      _ = try await edit([
        "kind": .string("ENTITY"), "entity_id": .string(entity), "entity_kind": .string("PERSON"),
        "display_name": .string("Native synthetic subject"), "expected_revision": .string("0"),
      ])
      let catalog = try await get(MWorldPage.self, "world/catalog")
      try require(
        catalog.items.contains { $0["entity_id"].string == entity }, "World entity applied")
      let keys = ["subject": entity, "predicate": "person.display_name", "scope": ""]
      var fact: [String: JSONValue] = [
        "kind": .string("FACT"), "subject_id": .string(entity),
        "predicate_key": .string("person.display_name"), "scope_key": .string(""),
        "mode": .string("ASSERT"), "value": .string("First synthetic value"),
        "expected_revision": .string("0"),
      ]
      _ = try await edit(fact)
      let slot = try await get(MWorldSlot.self, "world/slot", keys)
      try require(slot.slot?.revision == "1", "exact slot revision")
      let facts = try await get(MWorldPage.self, "world/facts", ["subject": entity])
      let assertion = facts.items.first!["assertion_id"].string!
      fact["mode"] = .string("CORRECT")
      fact["assertion_id"] = .string(assertion)
      fact["expected_revision"] = .string("1")
      fact["value"] = .string("Corrected synthetic value")
      _ = try await edit(fact)
      let corrected = try await get(MWorldPage.self, "world/facts", ["subject": entity])
      let currentSlot = try await get(MWorldSlot.self, "world/slot", keys)
      fact["mode"] = .string("RETRACT")
      fact["assertion_id"] = corrected.items.first!["assertion_id"]
      fact["expected_revision"] = .string(currentSlot.slot!.revision)
      _ = try await edit(fact)
      let history = try await get(
        MWorldPage.self, "world/facts", ["subject": entity, "history": "true"])
      try require(history.items.count >= 2, "historical assertions remain queryable")
      // Valid public payload with a deliberately stale World CAS creates a real failed application.
      fact["mode"] = .string("ASSERT")
      fact.removeValue(forKey: "assertion_id")
      fact["expected_revision"] = .string("0")
      let failed = try await edit(fact)
      let failure = failed.applications.last!
      try require(failure.state == "FAILED", "World CAS failure retained")
      _ = try await send(.simple(.retryApplication(failure.id)))
      _ = try await settledSettings()
      let beforeRestore = try await get(MSettings.self, "settings")
      _ = try await send(.revision(.restore(failure.id), beforeRestore.draft.revision))
      let restored = try await get(MSettings.self, "settings")
      try require(
        restored.draft.payload["edits"].array.count == 1,
        "failed application restored to editable draft")
      print(
        "PASS: real isolated World entity/assert/correct/retract, historical facts, exact slot, CAS failure, retry and restore"
      )
    }
    _ = try await send(.simple(.retryExtraction))
    _ = try await send(.simple(.compact))
    _ = try await send(.simple(.resume))
    print("management: authenticated artifact cache")
    let page = try await get(
      MArtifactPage.self, "artifacts", ["limit": "1", "task_id": manifest["task"].string!])
    try require(page.next_cursor != nil, "artifact pagination")
    let next = try await get(
      MArtifactPage.self, "artifacts",
      ["limit": "1", "task_id": manifest["task"].string!, "cursor": page.next_cursor!])
    try require(
      page.items[0].id != next.items[0].id && page.items[0].name == next.items[0].name,
      "duplicate names keep separate IDs")
    let artifact = try await get(MArtifact.self, "artifacts/" + manifest["artifact"].string!)
    let cache = try ArtifactCache(root: root.appendingPathComponent("cache"))
    let file = try await engine.download(
      artifact, destination: identity, cache: cache, progress: { _ in })
    try require(
      try String(contentsOf: file, encoding: .utf8) == "native artifact 中文", "artifact bytes")
    await engine.disconnect()
    let reopened = try ClientEngine(databaseURL: db)
    _ = try await reopened.connect(endpoint: endpoint, expectedMode: "fixture")
    let saved = try await reopened.command(id: save.id, destination: identity)
    try require(saved?.body == save.body, "restart preserves original command")
    await reopened.disconnect()
    transport.cancel()
    print(
      "PASS: native management public HTTP, scope task and cancellation/viewed, approval once/remember/reject/revoke/rule disable, two-client conflicts, decision, four unknown outcomes, Unicode continuation, settings/apply, isolated drafts, artifact pagination/download and restart"
    )
  }
}
