import AppKit
import XCTest

final class SecretaryUITests: XCTestCase {
  @MainActor
  private func application() -> XCUIApplication {
    let app = XCUIApplication()
    if let directory = ProcessInfo.processInfo.environment["SECRETARY_UI_FIXTURE_DIR"] {
      app.launchEnvironment["SECRETARY_NATIVE_TEST_DATA_DIR"] = directory + "/client"
    }
    return app
  }
  @MainActor
  func testConnectionWindowStartsWithoutImplicitCoreLaunch() throws {
    let app = application()
    // A launch test must not inherit the previous interactive window layout.
    app.launchArguments += ["-ApplePersistenceIgnoreState", "YES"]
    app.launch()
    app.activate()
    XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
    guard app.windows.firstMatch.exists else { return }
    XCTAssertTrue(app.staticTexts["connectionStatus"].exists)
    XCTAssertTrue(app.buttons["附着已有 Core"].exists)
    XCTAssertFalse(app.buttons["附着已有 Core"].isEnabled)
    XCTAssertTrue(app.textFields["数据目录"].exists)
    XCTAssertTrue(app.buttons["允许系统通知"].exists)
    app.terminate()
  }

  @MainActor
  func testSingleConnectionWindowClosesAndColdLaunches() throws {
    let app = application()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launch()
    app.activate()
    XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
    XCTAssertEqual(app.windows.count, 1)
    app.typeKey("w", modifierFlags: .command)
    XCTAssertTrue(app.wait(for: .notRunning, timeout: 5))

    // Keep both cold launches independent of the host's saved window state.
    app.launch()
    app.activate()
    XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
    XCTAssertEqual(app.windows.count, 1)
    XCTAssertTrue(app.staticTexts["connectionStatus"].exists)
    app.terminate()
  }

  @MainActor
  private func launchWithoutRestoredWindow(_ app: XCUIApplication) async throws {
    app.launchArguments = ["-ApplePersistenceIgnoreState", "NO"]
    app.launchEnvironment["SECRETARY_NATIVE_TEST_KEEP_RUNNING"] = "1"
    app.launch()
    app.activate()
    app.typeKey("0", modifierFlags: .command)
    XCTAssertTrue(app.buttons["附着已有 Core"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.windows.count, 1)
    app.typeKey("w", modifierFlags: .command)
    let empty = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in app.windows.count == 0 }, object: nil)
    await fulfillment(of: [empty], timeout: 5)
    XCTAssertEqual(
      app.windows.count, 0, "Recovery must start with no windows, not activate an existing one")
    XCTAssertNotEqual(app.state, .notRunning)
    print(
      "WINDOW RECOVERY PRECONDITION: AX window count = \(app.windows.count); application remains running"
    )
  }

  @MainActor
  func testMenuRecoversWithoutIgnoringRestoration() async throws {
    let app = application()
    try await launchWithoutRestoredWindow(app)
    app.typeKey("0", modifierFlags: .command)  // Executes the persistent Window menu command.
    XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
    XCTAssertEqual(app.windows.count, 1)
    XCTAssertTrue(app.staticTexts["connectionStatus"].exists)
    print("WINDOW RECOVERY RESULT: window count = \(app.windows.count), connection controls exist")
    app.typeKey("0", modifierFlags: .command)
    XCTAssertEqual(app.windows.count, 1)
    app.terminate()
  }

  @MainActor
  func testDockReopensMainWindowWithoutIgnoringRestoration() async throws {
    let app = application()
    try await launchWithoutRestoredWindow(app)
    let dock = XCUIApplication(bundleIdentifier: "com.apple.dock")
    let item = dock.descendants(matching: .dockItem)["Secretary"]
    XCTAssertTrue(item.waitForExistence(timeout: 5))
    item.click()
    XCTAssertTrue(app.buttons["附着已有 Core"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["允许系统通知"].isHittable)
    XCTAssertEqual(app.windows.count, 1)
    print(
      "WINDOW RECOVERY RESULT: window count = \(app.windows.count), connection controls hittable")
    app.terminate()
  }

  @MainActor
  func testFixtureChatDraftAndSend() throws {
    guard let directory = ProcessInfo.processInfo.environment["SECRETARY_UI_FIXTURE_DIR"] else {
      throw XCTSkip("Run test_case/native/ui-fixture.mjs to provide an isolated fixture Core")
    }
    let app = application()
    let clipboard = NSPasteboard.general
    let saved = (clipboard.pasteboardItems ?? []).map { item in
      let copy = NSPasteboardItem()
      for type in item.types {
        if let data = item.data(forType: type) { copy.setData(data, forType: type) }
      }
      return copy
    }
    var lastClipboardChange: Int?
    defer {
      // Do not replace anything Master copied while the test was running.
      if clipboard.changeCount == lastClipboardChange {
        clipboard.clearContents()
        clipboard.writeObjects(saved)
      }
    }
    func paste(_ text: String, into field: XCUIElement) {
      clipboard.clearContents()
      clipboard.setString(text, forType: .string)
      lastClipboardChange = clipboard.changeCount
      field.click()
      field.typeKey("v", modifierFlags: .command)
    }
    app.launchArguments = [
      "-ApplePersistenceIgnoreState", "YES", "-chat.streaming", "YES", "-chat.thinking", "NO",
    ]
    XCTAssertTrue(FileManager.default.fileExists(atPath: directory + "/core/core-endpoint.json"))
    func attach() {
      app.typeKey("0", modifierFlags: .command)
      let field = app.textFields["数据目录"]
      XCTAssertTrue(field.waitForExistence(timeout: 10))
      XCTAssertTrue(field.isHittable)
      paste(directory + "/core", into: field)
      XCTAssertEqual(field.value as? String, directory + "/core")
      guard field.value as? String == directory + "/core" else { return }
      app.buttons["附着已有 Core"].click()
      XCTAssertTrue(app.textViews["消息输入"].waitForExistence(timeout: 15))
    }
    app.launch()
    app.activate()
    attach()
    let input = app.textViews["消息输入"]
    paste("Native draft persistence", into: input)
    input.typeKey(.return, modifierFlags: [])
    paste("Second line", into: input)
    XCTAssertEqual(input.value as? String, "Native draft persistence\nSecond line")
    app.terminate()
    app.launch()
    app.activate()
    attach()
    XCTAssertEqual(app.textViews["消息输入"].value as? String, "Native draft persistence\nSecond line")
    app.textViews["消息输入"].click()
    app.textViews["消息输入"].typeKey(.return, modifierFlags: .command)
    let empty = NSPredicate(format: "value == %@", "")
    expectation(for: empty, evaluatedWith: app.textViews["消息输入"])
    waitForExpectations(timeout: 10)
    XCTAssertTrue(
      app.staticTexts.matching(NSPredicate(format: "value CONTAINS %@", "Native draft persistence"))
        .firstMatch.waitForExistence(timeout: 15))
    app.terminate()
  }
  @MainActor
  private func pasteExact(_ text: String, into field: XCUIElement, replacing: Bool = false) {
    let board = NSPasteboard.general
    let saved = (board.pasteboardItems ?? []).map { item in
      let copy = NSPasteboardItem()
      for type in item.types {
        if let data = item.data(forType: type) { copy.setData(data, forType: type) }
      }
      return copy
    }
    board.clearContents()
    board.setString(text, forType: .string)
    let change = board.changeCount
    defer {
      if board.changeCount == change {
        board.clearContents()
        board.writeObjects(saved)
      }
    }
    field.click()
    if replacing { field.typeKey("a", modifierFlags: .command) }
    field.typeKey("v", modifierFlags: .command)
  }

  @MainActor
  private func fixtureDirectory() throws -> String {
    try XCTUnwrap(
      ProcessInfo.processInfo.environment["SECRETARY_UI_FIXTURE_DIR"],
      "Run ui-fixture.mjs; missing fixture is a failure for review acceptance")
  }

  @MainActor
  private func attachFixture(_ app: XCUIApplication, directory: String, source: String = "core") {
    app.launchArguments = [
      "-ApplePersistenceIgnoreState", "YES", "-chat.streaming", "YES", "-chat.thinking", "NO",
    ]
    app.launch()
    app.activate()
    app.typeKey("0", modifierFlags: .command)
    let field = app.textFields["数据目录"]
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    pasteExact(directory + "/" + source, into: field)
    XCTAssertEqual(field.value as? String, directory + "/" + source)
    app.buttons["附着已有 Core"].click()
    XCTAssertTrue(app.textViews["消息输入"].waitForExistence(timeout: 15))
    // Keep test controls away from unrelated floating desktop overlays.
    let window = app.windows.firstMatch
    let title = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.015))
    title.press(
      forDuration: 0.1,
      thenDragTo: title.withOffset(
        CGVector(dx: 20 - window.frame.minX, dy: 50 - window.frame.minY)))
    let client = app.launchEnvironment["SECRETARY_NATIVE_TEST_DATA_DIR"]!
    XCTAssertTrue(
      FileManager.default.fileExists(atPath: client + "/client.sqlite"),
      "Debug client DB must be isolated")
  }

  @MainActor
  private func fixtureAPI(_ directory: String, path: String, body: [String: String]? = nil)
    async throws -> [String: Any]
  {
    let data = try Data(contentsOf: URL(fileURLWithPath: directory + "/core/core-endpoint.json"))
    let endpoint = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let base = try XCTUnwrap(endpoint["url"] as? String)
    let token = try XCTUnwrap(endpoint["token"] as? String)
    var request = URLRequest(url: try XCTUnwrap(URL(string: base + "/api/v1/" + path)))
    request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    request.setValue("1", forHTTPHeaderField: "X-Secretary-API-Version")
    if let body {
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let (responseData, response) = try await URLSession.shared.data(for: request)
    let status = try XCTUnwrap(response as? HTTPURLResponse).statusCode
    XCTAssertTrue((200..<300).contains(status), "Isolated Core request must succeed")
    let envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: responseData) as? [String: Any])
    return try XCTUnwrap(envelope["data"] as? [String: Any])
  }

  @MainActor
  func testLatestFollowsReplyAndHistoryKeepsViewport() async throws {
    let directory = try fixtureDirectory()
    let app = application()
    defer { app.terminate() }
    // Use a separate client DB to keep this reading test independent of the draft test.
    app.launchEnvironment["SECRETARY_NATIVE_TEST_DATA_DIR"] = directory + "/reading-client"
    attachFixture(app, directory: directory)
    let text =
      "FOLLOW_BEGIN\n\n" + (1...40).map { "Synthetic paragraph \($0)" }.joined(separator: "\n\n")
      + "\n\nFOLLOW_END"
    _ = try await fixtureAPI(
      directory, path: "messages",
      body: ["request_id": UUID().uuidString.lowercased(), "text": text])
    let tails = app.staticTexts.matching(NSPredicate(format: "value CONTAINS %@", "FOLLOW_END"))
    let replyTail = tails.element(boundBy: 1)
    let visible = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true AND hittable == true"), object: replyTail)
    await fulfillment(of: [visible], timeout: 15)
    XCTAssertTrue(
      replyTail.isHittable, "New assistant reply must be visible without pressing Latest")
    let viewport = app.scrollViews["chatTranscript"].frame
    XCTAssertLessThanOrEqual(
      replyTail.frame.maxY, viewport.maxY + 1,
      "The END of the reply, not merely its first lines, must be inside the viewport")
    XCTAssertGreaterThan(replyTail.frame.maxY, viewport.minY)
    print("B1 LATEST: appended assistant tail isHittable = \(replyTail.isHittable)")

    let page = try await fixtureAPI(directory, path: "timeline?streaming=true&limit=30")
    let items = try XCTUnwrap(page["items"] as? [[String: Any]])
    let message = try XCTUnwrap(
      items.first {
        ($0["role"] as? String) == "master"
          && ($0["text"] as? String)?.hasPrefix("FOLLOW_BEGIN") == true
      })
    let id = try XCTUnwrap(message["id"] as? String)
    app.activate()  // Reacquire the app after the asynchronous fixture request.
    let locator = app.textFields["定位记录 ID"]
    pasteExact(id, into: locator)
    XCTAssertEqual(locator.value as? String, id)
    XCTAssertTrue(app.buttons["定位"].isEnabled)
    app.buttons["定位"].click()
    let beginning = app.staticTexts.matching(
      NSPredicate(format: "value CONTAINS %@", "FOLLOW_BEGIN")
    ).firstMatch
    let located = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true AND hittable == true"), object: beginning)
    await fulfillment(of: [located], timeout: 10)
    guard beginning.isHittable else {
      XCTFail("Historical target must be visible before testing freeze")
      return
    }
    let before = beginning.frame
    _ = try await fixtureAPI(
      directory, path: "messages",
      body: ["request_id": UUID().uuidString.lowercased(), "text": "HISTORY_APPEND_AFTER_FREEZE"])
    XCTAssertTrue(app.buttons["有更新 · 回到最新"].waitForExistence(timeout: 10))
    XCTAssertTrue(beginning.isHittable)
    XCTAssertEqual(beginning.frame.minY, before.minY, accuracy: 1)
    XCTAssertEqual(beginning.frame.minX, before.minX, accuracy: 1)
    let newText = app.staticTexts.matching(
      NSPredicate(format: "value CONTAINS %@", "HISTORY_APPEND_AFTER_FREEZE")
    ).firstMatch
    XCTAssertFalse(newText.isHittable)
    guard app.buttons["有更新 · 回到最新"].exists, beginning.isHittable,
      abs(beginning.frame.minY - before.minY) <= 1,
      abs(beginning.frame.minX - before.minX) <= 1, !newText.isHittable
    else { return }
    print(
      "B1 HISTORY: update badge visible; viewport Y before=\(before.minY), after=\(beginning.frame.minY)"
    )
  }

  @MainActor
  func testUnavailableMessagesExplainCapability() throws {
    let directory = try fixtureDirectory()
    let app = application()
    app.launchEnvironment["SECRETARY_NATIVE_TEST_DATA_DIR"] = directory + "/capability-client"
    attachFixture(app, directory: directory, source: "unavailable")
    let reason = app.staticTexts["sendUnavailableReason"]
    XCTAssertTrue(reason.waitForExistence(timeout: 10))
    XCTAssertTrue((reason.value as? String)?.contains("not_configured") == true)
    XCTAssertTrue((reason.value as? String)?.contains("FIXTURE_MESSAGES_DISABLED") == true)
    app.textViews["消息输入"].click()
    app.textViews["消息输入"].typeText("123")
    XCTAssertFalse(app.buttons["sendMessage"].isEnabled)
    print(
      "S2: messages not_configured / FIXTURE_MESSAGES_DISABLED visible; send disabled with nonempty input"
    )
    app.terminate()
  }

  @MainActor
  private func managementNavigate(_ app: XCUIApplication, path: String) {
    if path == "tasks" || path == "artifacts" {
      let label = path == "tasks" ? "任务" : "产物"
      if app.buttons[label].exists {
        app.buttons[label].click()
      } else {
        app.popUpButtons["更多"].click()
        app.menuItems[label].click()
      }
    } else {
      app.popUpButtons["设置"].click()
      app.menuItems[path == "scopes" ? "Scope" : "业务设置"].click()
    }
  }
  @MainActor
  private func confirmManagement(_ app: XCUIApplication) {
    let confirm = app.buttons["confirmManagementCommand"]
    XCTAssertTrue(confirm.waitForExistence(timeout: 5))
    confirm.click()
    let status = app.staticTexts["managementCommandStatus"]
    XCTAssertTrue(status.waitForExistence(timeout: 5))
    let receipt = NSPredicate(format: "value CONTAINS %@", "ACCEPTED")
    expectation(for: receipt, evaluatedWith: status)
    waitForExpectations(timeout: 10)
  }
  @MainActor
  func testManagementTaskScopeAndDraft() throws {
    continueAfterFailure = false
    let directory = try fixtureDirectory()
    let app = application()
    app.launchEnvironment["SECRETARY_NATIVE_TEST_DATA_DIR"] = directory + "/management-task-client"
    defer { app.terminate() }
    attachFixture(app, directory: directory)
    managementNavigate(app, path: "scopes")
    XCTAssertTrue(app.links["new-scope"].waitForExistence(timeout: 10))
    app.links["new-scope"].click()
    let name = app.textFields["scopeName"]
    XCTAssertTrue(name.waitForExistence(timeout: 10))
    pasteExact("GUI Synthetic Scope", into: name)
    app.buttons["创建 Scope"].click()
    confirmManagement(app)
    managementNavigate(app, path: "tasks")
    XCTAssertTrue(app.links["new-task"].waitForExistence(timeout: 10))
    app.links["new-task"].click()
    let goal = app.textFields["taskGoal"]
    XCTAssertTrue(goal.waitForExistence(timeout: 10))
    pasteExact("GUI scoped task", into: goal)
    let scope = app.popUpButtons["taskScope"]
    XCTAssertTrue(scope.exists)
    let more = app.buttons["moreScopes"]
    XCTAssertTrue(more.waitForExistence(timeout: 10), "Fixture has more than thirty scopes")
    more.click()
    XCTAssertTrue(app.buttons["返回首批 Scope"].waitForExistence(timeout: 10))
    app.buttons["返回首批 Scope"].click()
    for _ in 0..<3 {
      scope.click()
      if app.menuItems["GUI Synthetic Scope"].exists { break }
      app.typeKey(.escape, modifierFlags: [])
      XCTAssertTrue(more.exists)
      more.click()
    }
    XCTAssertTrue(app.menuItems["GUI Synthetic Scope"].exists)
    app.menuItems["GUI Synthetic Scope"].click()
    app.buttons["提交任务"].click()
    confirmManagement(app)
    managementNavigate(app, path: "settings")
    let editor = app.textViews["instructionsEditor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 10))
    pasteExact("GUI local instructions survive navigation", into: editor, replacing: true)
    app.buttons["assistantHome"].click()
    managementNavigate(app, path: "settings")
    XCTAssertTrue(editor.waitForExistence(timeout: 10))
    XCTAssertEqual(editor.value as? String, "GUI local instructions survive navigation")
    let window = app.windows.firstMatch
    let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1)).withOffset(
      CGVector(dx: -3, dy: -3))
    corner.press(
      forDuration: 0.1, thenDragTo: corner.withOffset(CGVector(dx: 720 - window.frame.width, dy: 0))
    )
    XCTAssertLessThanOrEqual(window.frame.width, 725)
    let attention = app.buttons["attentionSummary"]
    XCTAssertTrue(attention.isHittable)
    attention.click()
    XCTAssertTrue(app.links["decisions"].waitForExistence(timeout: 10))
  }
  @MainActor
  func testManagementApprovalAndUnknown() throws {
    continueAfterFailure = false
    let directory = try fixtureDirectory()
    let manifest = try XCTUnwrap(
      JSONSerialization.jsonObject(
        with: Data(contentsOf: URL(fileURLWithPath: directory + "/manifest.json")))
        as? [String: Any])
    let approval = try XCTUnwrap((manifest["approvals"] as? [String])?.last)
    let operation = try XCTUnwrap((manifest["operations"] as? [String])?.first)
    let app = application()
    app.launchEnvironment["SECRETARY_NATIVE_TEST_DATA_DIR"] =
      directory + "/management-approval-client"
    defer { app.terminate() }
    attachFixture(app, directory: directory)
    app.buttons["attentionSummary"].click()
    let detail = app.links["authorizations/" + approval]
    XCTAssertTrue(detail.waitForExistence(timeout: 10))
    detail.click()
    XCTAssertTrue(app.staticTexts["实际操作及完整参数"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["适用根目录"].exists)
    app.buttons["批准一次"].click()
    XCTAssertTrue(app.buttons["confirmManagementCommand"].waitForExistence(timeout: 5))
    app.buttons["取消"].click()
    XCTAssertTrue(app.buttons["批准一次"].isEnabled)
    app.buttons["批准一次"].click()
    confirmManagement(app)
    app.buttons["attentionSummary"].click()
    XCTAssertTrue(app.links["operations"].waitForExistence(timeout: 10))
    app.links["operations"].click()
    let unknown = app.links["operations/" + operation]
    XCTAssertTrue(unknown.waitForExistence(timeout: 10))
    unknown.click()
    XCTAssertTrue(app.staticTexts["原始输出已截断"].waitForExistence(timeout: 10))
    // Large output stays in a bounded native viewport; scroll the form to its explicit action.
    let note = app.textFields["裁定备注（必填）"]
    for _ in 0..<12 where !note.isHittable { app.scrollViews.firstMatch.swipeUp() }
    XCTAssertTrue(note.isHittable)
    pasteExact("GUI synthetic evidence", into: note)
    app.buttons["裁定未知结果…"].click()
    confirmManagement(app)
  }
  @MainActor
  func testManagementArtifactDownload() async throws {
    continueAfterFailure = false
    let directory = try fixtureDirectory()
    let manifest = try XCTUnwrap(
      JSONSerialization.jsonObject(
        with: Data(contentsOf: URL(fileURLWithPath: directory + "/manifest.json")))
        as? [String: Any])
    let artifact = try XCTUnwrap(manifest["artifact"] as? String)
    let revisedVersion = try XCTUnwrap(manifest["revisedVersion"] as? String)
    let app = application()
    app.launchEnvironment["SECRETARY_NATIVE_TEST_DATA_DIR"] =
      directory + "/management-artifact-client"
    defer { app.terminate() }
    attachFixture(app, directory: directory)
    managementNavigate(app, path: "artifacts")
    let detail = app.links["artifacts/" + artifact]
    XCTAssertTrue(detail.waitForExistence(timeout: 10))
    detail.click()
    XCTAssertTrue(app.buttons["下载／重试"].waitForExistence(timeout: 10))
    app.buttons["下载／重试"].click()
    let open = app.buttons["用系统打开已验证文件"]
    let download = app.buttons["下载／重试"]
    let cancel = app.buttons["取消下载"]
    XCTAssertFalse(download.isEnabled, "Repeated submission must not cancel the active transfer")
    XCTAssertTrue(cancel.isEnabled)
    XCTAssertFalse(open.exists, "Partial file must never be openable")
    cancel.click()
    let ready = expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: download)
    await fulfillment(of: [ready], timeout: 10)
    XCTAssertFalse(open.exists)
    XCTAssertFalse(cancel.isEnabled)
    download.click()
    XCTAssertTrue(open.waitForExistence(timeout: 10))
    XCTAssertTrue(download.isEnabled)
    XCTAssertFalse(cancel.isEnabled)
    let cache = directory + "/management-artifact-client/Artifacts"
    let files = try FileManager.default.contentsOfDirectory(atPath: cache)
    XCTAssertEqual(files.count, 1)
    XCTAssertEqual(
      try String(contentsOfFile: cache + "/" + files[0], encoding: .utf8), "native artifact 中文")
    for _ in 0..<8 where !open.isHittable { app.scrollViews.firstMatch.swipeUp() }
    XCTAssertTrue(open.isHittable)
    open.click()
    XCTAssertTrue(FileManager.default.fileExists(atPath: cache + "/" + files[0]))
    app.activate()
    let profile = try await fixtureAPI(directory, path: "assistant")
    _ = try await fixtureAPI(
      directory, path: "assistant/profile",
      body: [
        "request_id": UUID().uuidString.lowercased(),
        "expected_revision": try XCTUnwrap(profile["revision"] as? String),
        "name": "PR2c artifact refresh fixture",
      ])
    app.activate()
    XCTAssertTrue(app.staticTexts[revisedVersion].waitForExistence(timeout: 10))
    XCTAssertFalse(
      app.buttons["用系统打开已验证文件"].exists, "New metadata must invalidate the old verified URL")
    app.buttons["下载／重试"].click()
    XCTAssertTrue(app.buttons["用系统打开已验证文件"].waitForExistence(timeout: 10))
    let refreshedFiles = try FileManager.default.contentsOfDirectory(atPath: cache)
    XCTAssertTrue(
      try refreshedFiles.contains {
        try String(contentsOfFile: cache + "/" + $0, encoding: .utf8)
          == "native artifact revised 中文"
      })
  }

}
