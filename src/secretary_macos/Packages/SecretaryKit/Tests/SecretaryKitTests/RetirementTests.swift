import Foundation
import Testing

@testable import SecretaryKit

@Test func retiredRendererUnsafeContentAndEveryStreamingPrefixAreInert() {
  let attack =
    "<script>bad()</script>\n<img src=x onerror=bad()>\n[bad](javascript:alert) ![tracking](https://evil.test/pixel)"
  let text =
    "# 流式\n\n**粗体**\n\n" + attack
    + "\n\n[安全](https://example.com)\n\n```js\n<script>literal</script>\n```"
  for end in text.indices {
    let prefix = String(text[..<end])
    let parsed = ChatMarkdown.parse(prefix)
    #expect(parsed == ChatMarkdown.parse(prefix))
    // Hostile links/images/HTML can only survive as verbatim plaintext or inert code.
    func check(_ blocks: [MarkdownBlock]) {
      for block in blocks {
        switch block {
        case .text(let source):
          #expect(
            !source.contains("javascript:") && !source.contains("![tracking]")
              && !source.contains("<img"))
        case .list(let items, _): items.forEach(check)
        case .quote(let items): check(items)
        default: break
        }
      }
    }
    check(parsed)
  }
  let literal = ChatMarkdown.parse(text).compactMap { block -> String? in
    if case .plain(let value) = block { return value }
    return nil
  }.joined()
  #expect(
    literal.contains("<script>bad()</script>")
      && literal.contains("![tracking](https://evil.test/pixel)"))
  for value in [
    "javascript:alert(1)", "data:text/html,x", "vbscript:msgbox", "file:///x", "//evil.test",
    "/api/shutdown", "https:\\evil.test", "https://user:password@example.com",
    "https://exa\nmple.com", "mailto:x@y.test?bcc=z@y.test", "https://example.com/%0d%0aheader",
    "%6aavascript:alert",
  ] {
    #expect(ChatMarkdown.safeLink(value) == nil)
  }
  for value in ["https://example.com/a?b=1&c=2", "http://example.com", "mailto:person@example.com"]
  {
    #expect(ChatMarkdown.safeLink(value)?.absoluteString == value)
  }
}

@Test func retiredRendererMalformedAndLargeContentRemainsReadableAndBounded() {
  let fence = ChatMarkdown.parse("```js\nconst x = '<img>';\n``")
  #expect(fence == [.code("const x = '<img>';\n``\n", "js")])
  let malformed = "| A | B |\n| --- | --- |\n| one | two | extra |\n[open](https://exam"
  #expect(ChatMarkdown.parse(malformed) == [.plain(malformed)])
  let deep = String(repeating: "> ", count: 10_000) + "deep"
  #expect(ChatMarkdown.parse(deep) == [.plain(deep)])
  for tail in [
    String(repeating: "[", count: 100_000), String(repeating: "`", count: 100_000),
    "**" + String(repeating: "a", count: 100_000), "__" + String(repeating: "a", count: 100_000),
  ] {
    let start = Date()
    let result = ChatMarkdown.parse("prefix " + tail)
    let rendered = result.map { block -> String in
      switch block {
      case .plain(let value): return value
      case .text(let value):
        return String(
          (try? AttributedString(
            markdown: value, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))?
            .characters ?? AttributedString(value).characters)
      default: return "UNEXPECTED_STRUCTURE"
      }
    }.joined()
    #expect(rendered == "prefix " + tail)
    #expect(Date().timeIntervalSince(start) < 2)
  }
  let structured = ChatMarkdown.parse(
    "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n\n- list\n  - child\n\n> quote\n\n---\n\n| A | B |\n| --- | --- |\n| 中 | 😀 |"
  )
  for level in 1...6 { #expect(structured.contains(.heading("H\(level)", level))) }
  #expect(structured.contains(.rule))
  #expect(structured.contains(.table([["A", "B"], ["中", "😀"]])))
}

@Test func nativeElapsedFreezesTerminalFallbackAndKeepsLiveClocks() throws {
  for state in ["failed", "succeeded", "interrupted", "cancelled", "running", "waiting"] {
    let raw =
      "{\"id\":\"synthetic\",\"status\":\"\(state)\",\"started_at\":\"2026-10-05T00:00:00.000Z\",\"last_progress_at\":\"2026-10-05T00:00:42.000Z\"}"
    let activity = try JSONDecoder().decode(ChatActivity.self, from: Data(raw.utf8))
    let end = ISO8601DateFormatter().date(from: "2026-10-05T00:00:42Z")!
    let live = state == "running" || state == "waiting"
    #expect(activity.elapsedSeconds(at: end.addingTimeInterval(1)) == (live ? 43 : 42))
    #expect(activity.elapsedSeconds(at: end.addingTimeInterval(2)) == (live ? 44 : 42))
  }
}

@Test @MainActor func nativePageReplacementBoundsMixedHistoryAndPreservesReadingAnchor() throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: root) }
  let state = try ChatLocalState(url: root.appendingPathComponent("state.sqlite"))
  let identity = Identity(owner: "owner", domain: "domain", session: "session")
  let anchor = ReadingAnchor(id: "0", offset: 12)
  try state.saveAnchor(anchor, for: identity)
  var window = ChatWindow()
  func page(_ start: Int, text: String = "中😀") throws -> ChatPage {
    let items = try (start..<(start + 200)).map { i -> ChatItem in
      let data = try JSONSerialization.data(withJSONObject: [
        "id": "\(i)", "kind": i % 2 == 0 ? "message" : "activity", "revision": "1", "text": text,
      ])
      return try JSONDecoder().decode(ChatItem.self, from: data)
    }
    return ChatPage(
      items: items, version: "1", generation: "one", before: "before-\(start)",
      after: "after-\(start)")
  }
  for start in stride(from: 0, to: 6000, by: 200) {
    try window.replace(page(start))
    #expect(window.items.count == 200)
  }
  for start in stride(from: 5800, through: 0, by: -200) { try window.replace(page(start)) }
  #expect(window.items.first?.id == "0")
  let stale = try JSONDecoder().decode(
    ChatItem.self,
    from: Data("{\"id\":\"0\",\"kind\":\"message\",\"revision\":\"0\",\"text\":\"stale\"}".utf8))
  try window.updateLatest(
    ChatPage(items: [stale], version: "1", generation: "one", before: nil, after: nil))
  #expect(window.items.first?.text == "中😀")
  #expect(try state.anchor(identity) == anchor)
  #expect(throws: ClientError.responseTooLarge) {
    try window.replace(page(6000, text: String(repeating: "中", count: 30_000)))
  }
  #expect(window.items.first?.id == "0")
  #expect(try state.anchor(identity) == anchor)
}
