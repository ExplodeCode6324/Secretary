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
  private func pasteExact(_ text: String, into field: XCUIElement) {
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

}
