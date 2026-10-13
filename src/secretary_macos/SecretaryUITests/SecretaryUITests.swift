import XCTest

final class SecretaryUITests: XCTestCase {
  @MainActor
  func testConnectionWindowStartsWithoutImplicitCoreLaunch() throws {
    let app = XCUIApplication()
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
}
