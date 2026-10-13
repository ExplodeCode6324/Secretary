import AppKit
import Foundation
import Testing

@testable import SecretaryKit

private func item(
  _ text: String, revision: String = "1", cursor: String? = nil,
  id: String = "message:call", call: String? = "call"
) throws -> ChatItem {
  var object: [String: Any] = [
    "id": id, "kind": "message", "revision": revision,
    "role": "assistant", "text": text, "incomplete": false,
  ]
  object["call_id"] = call ?? NSNull() as Any
  object["next_cursor"] = cursor ?? NSNull() as Any
  return try JSONDecoder().decode(
    ChatItem.self, from: JSONSerialization.data(withJSONObject: object))
}
private func page(_ items: [ChatItem]) -> ChatPage {
  ChatPage(items: items, version: "1", generation: "instance", before: "opaque-before", after: nil)
}

@Test func chatContentUsesOpaqueCursorAndPreservesUnicode() throws {
  var value = try item("中文👩🏽‍💻e", cursor: "opaque-a")
  try value.append(item("\u{301}\n后续", cursor: "opaque-b"), cursor: "opaque-a")
  #expect(value.text == "中文👩🏽‍💻e\u{301}\n后续")
  #expect(value.next_cursor == "opaque-b")
  #expect(throws: ClientError.invalidContract) {
    try value.append(item("wrong revision", revision: "2"), cursor: "opaque-b")
  }
  #expect(throws: ClientError.invalidContract) {
    try value.append(item("duplicate", cursor: "opaque-b"), cursor: "opaque-b")
  }
  #expect(value.text == "中文👩🏽‍💻e\u{301}\n后续")
}

@Test func chatWindowMergesCallIdentityAndBoundsTheVisiblePage() throws {
  var window = ChatWindow()
  try window.replace(page([item("preview", id: "preview:call"), item("final", revision: "2")]))
  #expect(window.items.count == 1)
  #expect(window.items[0].text == "final")
  try window.replace(page([item("head", cursor: "a")]))
  try window.appendContent(item("tail"), cursor: "a")
  try window.updateLatest(page([item("head", cursor: "a")]))
  #expect(window.items[0].text == "headtail")
  try window.updateLatest(page([item("new final", revision: "2")]))
  #expect(window.items[0].text == "new final")
  #expect(throws: ClientError.responseTooLarge) {
    try window.replace(page((0..<201).map { try item("x", id: "\($0)", call: nil) }))
  }
  #expect(window.items[0].text == "new final")
}

@Test @MainActor func editingPersistsBeforeQuitAndSendingClearsOnlyAfterCommit() throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(
    "secretary-chat-test-" + UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: root) }
  let url = root.appendingPathComponent("client.sqlite")
  let identity = Identity(owner: "owner", domain: "domain", session: "one")
  let state = try ChatLocalState(url: url)
  try state.saveDraft("draft\n👩🏽‍💻", for: identity)
  let reopened = try ChatLocalState(url: url)
  #expect(try reopened.draft(identity) == "draft\n👩🏽‍💻")
  let anchor = ReadingAnchor(id: "message:source", offset: 83.5)
  try state.saveAnchor(anchor, for: identity)
  #expect(try reopened.anchor(identity) == anchor)
  #expect(try reopened.draft(Identity(owner: "owner", domain: "other", session: "one")) == "")
  let id = try state.enqueue("draft\n👩🏽‍💻", for: identity)
  #expect(try reopened.draft(identity) == "")
  let pending = try reopened.commands(identity)
  #expect(pending.count == 1 && pending[0].id == id && pending[0].state == "PENDING")
  try state.saveDraft("must survive failure", for: identity)
  #expect(throws: (any Error).self) {
    try state.enqueue(String(repeating: "x", count: 1_100_000), for: identity)
  }
  #expect(try reopened.draft(identity) == "must survive failure")
  #expect(try reopened.commands(Identity(owner: "owner", domain: "domain", session: "two")).isEmpty)
}

@Test func markdownKeepsCodeTablesAndHTMLInert() {
  let blocks = ChatMarkdown.parse(
    "# Title\n\n```swift\nprint(1)\n```\n\n| A | B |\n| - | - |\n| 中 | 👩🏽‍💻 |\n\n<script>bad()</script>\n"
  )
  #expect(blocks.contains(.heading("Title", 1)))
  #expect(blocks.contains(.code("print(1)\n", "swift")))
  #expect(blocks.contains(.table([["A", "B"], ["中", "👩🏽‍💻"]])))
  #expect(
    blocks.contains {
      if case .text(let text) = $0 { return text.contains("<script>") }
      return false
    })
}

@Test func transientHasNoDurableCursorAndRequiresCompleteFrame() throws {
  var decoder = SSEDecoder()
  let payload = "event: transient\ndata: {\"previews\":[]}\n"
  for byte in payload.utf8 {
    #expect(try decoder.append(byte) == nil)
    #expect(decoder.transientData == nil)
  }
  #expect(try decoder.append(10) == nil)
  #expect(decoder.transientData == Data("{\"previews\":[]}".utf8))
  var invalid = SSEDecoder()
  #expect(throws: ClientError.streamMalformed) {
    for byte in "event: transient\nid: forbidden\ndata: {}\n\n".utf8 {
      _ = try invalid.append(byte)
    }
  }
}

@Test @MainActor func nativeComposerDoesNotSubmitMarkedText() throws {
  let editor = MessageTextView(frame: NSRect(x: 0, y: 0, width: 300, height: 100))
  var submissions = 0
  editor.onSend = { submissions += 1 }
  let event = try #require(
    NSEvent.keyEvent(
      with: .keyDown, location: .zero, modifierFlags: .command,
      timestamp: 0, windowNumber: 0, context: nil, characters: "\r",
      charactersIgnoringModifiers: "\r",
      isARepeat: false, keyCode: 36))
  editor.setMarkedText(
    "中文", selectedRange: NSRange(location: 2, length: 0),
    replacementRange: NSRange(location: NSNotFound, length: 0))
  #expect(editor.hasMarkedText())
  editor.keyDown(with: event)
  #expect(submissions == 0)
  editor.unmarkText()
  editor.keyDown(with: event)
  #expect(submissions == 1)
  editor.insertNewline(nil)
  #expect(editor.string.contains("\n"))
  #expect(submissions == 1)
}
