import AppKit
import SwiftUI

/// Shared by Commands and the app delegate; installed independently of any window content.
@MainActor
final class MainWindowRecovery {
  static let shared = MainWindowRecovery()
  private var openWindow: OpenWindowAction?
  func install(_ action: OpenWindowAction) { openWindow = action }
  func open() {
    // SwiftUI owns the singleton and may need to rehydrate a restored NSWindow shell.
    openWindow?(id: "main")
    if let window = NSApp.windows.first(where: { $0.identifier?.rawValue == "main" }) {
      window.deminiaturize(nil)
      window.makeKeyAndOrderFront(nil)
    }
    NSApp.activate(ignoringOtherApps: true)
  }
}

struct MainWindowCommands: Commands {
  @Environment(\.openWindow) private var openWindow
  var body: some Commands {
    // Plain action registration: no published state mutation, and no localized menu lookup.
    let _ = MainWindowRecovery.shared.install(openWindow)
    CommandGroup(after: .windowArrangement) {
      Button("打开主窗口") { MainWindowRecovery.shared.open() }
        .keyboardShortcut("0", modifiers: .command)
    }
  }
}

@MainActor
final class SecretaryAppDelegate: NSObject, NSApplicationDelegate {
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    sender.keyWindow?.makeFirstResponder(nil)
    #if DEBUG
      if ProcessInfo.processInfo.environment["SECRETARY_NATIVE_TEST_KEEP_RUNNING"] == "1" {
        // Test-only: closing the real singleton leaves the app alive, with no window, for recovery tests.
        return .terminateCancel
      }
    #endif
    return .terminateNow
  }
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool
  {
    MainWindowRecovery.shared.open()
    return false
  }
}
