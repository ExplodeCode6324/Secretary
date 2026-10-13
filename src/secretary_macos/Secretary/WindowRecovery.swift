import AppKit
import SwiftUI

struct MainWindowCommands: Commands {
  @Environment(\.openWindow) private var openWindow
  var body: some Commands {
    CommandGroup(after: .windowArrangement) {
      Button("打开主窗口") {
        openWindow(id: "main")
        DispatchQueue.main.async {
          NSApp.activate(ignoringOtherApps: true)
          if let window = NSApp.windows.first(where: { $0.identifier?.rawValue == "main" }) {
            window.deminiaturize(nil)
            window.makeKeyAndOrderFront(nil)
          }
        }
      }
      .keyboardShortcut("0", modifiers: .command)
    }
  }
}

/// Lives for the application lifetime, including launches with no restored window.
@MainActor
final class SecretaryAppDelegate: NSObject, NSApplicationDelegate {
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    sender.keyWindow?.makeFirstResponder(nil)
    return .terminateNow
  }
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool
  {
    reopenMainWindow()
    return false
  }
  @objc func reopenMainWindow() {
    if let window = NSApp.windows.first(where: { $0.identifier?.rawValue == "main" }) {
      window.deminiaturize(nil)
      window.makeKeyAndOrderFront(nil)
    } else if let menu = NSApp.mainMenu {
      // The SwiftUI command exists before any window content. Invoke its openWindow action;
      // never create an independent AppKit window with a second connection model.
      _ = invokeOpen(in: menu)
    }
    NSApp.activate(ignoringOtherApps: true)
  }
  private func invokeOpen(in menu: NSMenu) -> Bool {
    for (index, item) in menu.items.enumerated() {
      if item.title == "打开主窗口" {
        menu.performActionForItem(at: index)
        return true
      }
      if let submenu = item.submenu, invokeOpen(in: submenu) { return true }
    }
    return false
  }
}
