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
  func testMenuRecoversWithoutIgnoringRestoration() throws {
    let app = application()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "NO"]
    app.launch()
    app.activate()
    app.menuBars.menuBarItems["Window"].click()
    app.menuItems["打开主窗口"].click()
    XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
    XCTAssertEqual(app.windows.count, 1)
    XCTAssertTrue(app.staticTexts["connectionStatus"].exists)
    app.typeKey("0", modifierFlags: .command)
    XCTAssertEqual(app.windows.count, 1)
    app.terminate()
  }

  @MainActor
  func testDockReopensMainWindowWithoutIgnoringRestoration() throws {
    let app = application()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "NO"]
    app.launch()
    app.activate()
    let dock = XCUIApplication(bundleIdentifier: "com.apple.dock")
    let item = dock.descendants(matching: .dockItem)["Secretary"]
    XCTAssertTrue(item.waitForExistence(timeout: 5))
    item.click()
    XCTAssertTrue(app.buttons["附着已有 Core"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["允许系统通知"].isHittable)
    XCTAssertEqual(app.windows.count, 1)
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
      field.click()
      field.typeText(directory + "/core")
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
}
