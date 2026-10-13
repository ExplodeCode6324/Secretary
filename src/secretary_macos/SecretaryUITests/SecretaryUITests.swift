import XCTest

final class SecretaryUITests: XCTestCase {
  @MainActor
  func testConnectionWindowStartsWithoutImplicitCoreLaunch() throws {
    let app = XCUIApplication()
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
    let app = XCUIApplication()
    app.launchArguments = ["-ApplePersistenceIgnoreState", "YES"]
    app.launch()
    XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
    XCTAssertEqual(app.windows.count, 1)
    app.typeKey("w", modifierFlags: .command)
    XCTAssertTrue(app.wait(for: .notRunning, timeout: 5))

    // Keep both cold launches independent of the host's saved window state.
    app.launch()
    XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
    XCTAssertEqual(app.windows.count, 1)
    XCTAssertTrue(app.staticTexts["connectionStatus"].exists)
    app.terminate()
  }
}
