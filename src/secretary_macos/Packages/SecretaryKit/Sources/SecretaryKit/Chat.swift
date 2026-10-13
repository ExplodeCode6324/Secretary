import Foundation
import Markdown

public struct AssistantProfile: Decodable, Sendable {
  public let name: String
  public var displayName: String {
    let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return value.isEmpty ? "secretary" : value
  }
}

public struct ChatActivity: Codable, Sendable, Equatable {
  public let id: String
  public let phase: String?
  public let status: String?
  public let execution_id: String?
  public let actions: [String]?
  public let started_at: String?
  public let ended_at: String?
  public let last_progress_at: String?
  private func date(_ value: String?) -> Date? {
    guard let value else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
  }
  public func elapsedSeconds(at: Date = Date()) -> Int? {
    guard let start = date(started_at) else { return nil }
    let live = status == "running" || status == "waiting"
    guard let end = date(ended_at) ?? (live ? at : date(last_progress_at)) else { return nil }
    return max(0, Int(end.timeIntervalSince(start)))
  }
  /// Connection loss never implies that a running operation finished or kept progressing.
  public func presentation(at: Date, online: Bool, confirmedAt: Date?) -> (
    status: String, elapsed: Int?
  ) {
    let unconfirmed = !online && ended_at == nil && (status == "running" || status == "waiting")
    let clock = online ? at : (confirmedAt ?? date(last_progress_at) ?? date(ended_at))
    return (
      unconfirmed ? "未确认 · 连接中断，活动状态暂不可确认" : (status ?? "未知状态"),
      clock.flatMap { elapsedSeconds(at: $0) })
  }
}

public struct ChatItem: Codable, Sendable, Identifiable, Equatable {
  public let id: String
  public let kind: String
  public let revision: DecimalString
  public let role: String?
  public let at: String?
  public var text: String?
  public var thinking: String?
  public let call_id: String?
  public let incomplete: Bool?
  public var next_cursor: String?
  public let activity: ChatActivity?
  public var bytes: Int { (text?.utf8.count ?? 0) + (thinking?.utf8.count ?? 0) }
  public var logicalID: String { call_id.map { "message:" + $0 } ?? id }
  public mutating func append(_ fragment: ChatItem, cursor: String) throws {
    guard kind == "message", fragment.id == id, fragment.revision == revision,
      next_cursor == cursor, fragment.next_cursor != cursor,
      bytes + fragment.bytes <= 4 * 1024 * 1024
    else { throw ClientError.invalidContract }
    text = (text ?? "") + (fragment.text ?? "")
    thinking = (thinking ?? "") + (fragment.thinking ?? "")
    next_cursor = fragment.next_cursor
  }
}

public struct ChatPage: Codable, Sendable {
  public let items: [ChatItem]
  public let version: String
  public let generation: String
  public let before: String?
  public let after: String?
}

public struct ChatPreferences: Equatable, Sendable {
  public var streaming: Bool
  public var thinking: Bool
  public init(streaming: Bool = true, thinking: Bool = false) {
    self.streaming = streaming
    self.thinking = thinking
  }
  public var query: [String: String] {
    ["streaming": String(streaming), "thinking": String(thinking)]
  }
  public var route: Route { try! Route("timeline", query: query.merging(["limit": "30"]) { $1 }) }
}

/// A bounded visible window, never a copy of the entire conversation.
public struct ChatWindow: Sendable {
  public private(set) var items: [ChatItem] = []
  public private(set) var before: String?
  public private(set) var after: String?
  public private(set) var generation: String?
  public init() {}
  public mutating func replace(_ page: ChatPage) throws {
    let items = Self.unique(page.items)
    try Self.validate(items)
    self.items = items
    before = page.before
    after = page.after
    generation = page.generation
  }
  // Navigating loads a bounded page; the previous page remains recoverable via server cursors.
  public mutating func updateLatest(_ page: ChatPage) throws {
    var page = page
    let expanded = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
    let kept = page.items.map { item in
      if generation == page.generation, let old = expanded[item.id],
        old.revision > item.revision || (old.revision == item.revision && old.bytes > item.bytes)
      {
        return old
      }
      return item
    }
    page = ChatPage(
      items: kept, version: page.version, generation: page.generation,
      before: page.before, after: page.after)
    try replace(page)
  }
  public mutating func appendContent(_ fragment: ChatItem, cursor: String) throws {
    guard let index = items.firstIndex(where: { $0.id == fragment.id }) else {
      throw ClientError.staleConnection
    }
    var next = items
    try next[index].append(fragment, cursor: cursor)
    try Self.validate(next)
    items = next
  }
  public mutating func clear() { self = ChatWindow() }
  private static func unique(_ items: [ChatItem]) -> [ChatItem] {
    var result: [ChatItem] = []
    for item in items {
      if let i = result.firstIndex(where: { $0.logicalID == item.logicalID }) {
        if result[i].revision <= item.revision { result[i] = item }
      } else {
        result.append(item)
      }
    }
    return result
  }
  private static func validate(_ items: [ChatItem]) throws {
    guard items.count <= 200, items.reduce(0, { $0 + $1.bytes }) <= 16 * 1024 * 1024 else {
      throw ClientError.responseTooLarge
    }
  }
}

public struct ReadingAnchor: Codable, Equatable, Sendable {
  public var id: String
  public var offset: Double
  public init(id: String, offset: Double) {
    self.id = id
    self.offset = offset
  }
}

public struct RelatedPage: Decodable, Sendable {
  public struct Item: Decodable, Identifiable, Sendable {
    public let id: String
    public let type: String
    public let basis: String
  }
  public let items: [Item]
  public let next_cursor: String?
}
public struct AttentionPage: Decodable, Sendable {
  public struct Counts: Decodable, Sendable {
    public let authorizations: Int
    public let decisions: Int
  }
  public let counts: Counts
}

public struct ChatTransient: Decodable, Sendable {
  public struct Preview: Decodable, Sendable {
    public let id: String
    public let session: String
    public let status: String
  }
  public let previews: [Preview]
}

/// Render only safe text structures. Raw HTML is text, never executed or fetched.
public indirect enum MarkdownBlock: Equatable, Sendable {
  case text(String)
  case plain(String)
  case heading(String, Int)
  case code(String, String?)
  case quote([MarkdownBlock])
  case list([[MarkdownBlock]], ordered: Bool)
  case table([[String]])
  case rule
}
public enum ChatMarkdown {
  public static func parse(_ text: String) -> [MarkdownBlock] {
    // Long documents stay readable without building an unbounded AST.
    guard text.utf8.count <= 256 * 1024 else { return [.plain(text)] }
    // Avoid entering cmark on pathological nesting; its parser can exhaust the stack.
    let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
    for line in lines {
      let prefix = line.prefix { "> -+*0123456789.\t".contains($0) }
      if prefix.filter({ $0 == ">" }).count > 64 || prefix.count > 256 { return [.plain(text)] }
    }
    let document = Document(parsing: text)
    // Bound recursive native view construction, including hostile quote/list nesting.
    var pending: [(any Markup, Int)] = [(document, 0)]
    while let (node, depth) = pending.popLast() {
      if depth > 64 { return [.plain(text)] }
      if node is InlineHTML || node is Image { return [.plain(text)] }
      if let link = node as? Link, safeLink(link.destination ?? "") == nil { return [.plain(text)] }
      if let table = node as? Table, let range = table.range {
        // CommonMark tables discard surplus cells. Preserve malformed source verbatim.
        for line in lines.dropFirst(range.lowerBound.line - 1).prefix(
          range.upperBound.line - range.lowerBound.line + 1)
        {
          let cells = line.replacingOccurrences(of: "\\|", with: "").trimmingCharacters(
            in: .whitespaces
          )
          .trimmingCharacters(in: CharacterSet(charactersIn: "|")).split(
            separator: "|", omittingEmptySubsequences: false)
          if cells.count > table.head.childCount { return [.plain(text)] }
        }
      }
      for child in node.children { pending.append((child, depth + 1)) }
    }
    return document.children.map(block)
  }
  public static func safeLink(_ value: String) -> URL? {
    guard !value.contains("\\"),
      !value.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }),
      !value.lowercased().contains("%0d"), !value.lowercased().contains("%0a"),
      let url = URL(string: value), let scheme = url.scheme?.lowercased(),
      url.user == nil, url.password == nil
    else { return nil }
    if ["https", "http"].contains(scheme), let host = url.host, !host.isEmpty { return url }
    if scheme == "mailto", !value.contains("?"), !value.contains("#"),
      value.dropFirst(7).contains("@")
    {
      return url
    }
    return nil
  }
  private static func block(_ node: any Markup) -> MarkdownBlock {
    switch node {
    case let value as CodeBlock: return .code(value.code, value.language)
    case let value as Heading: return .heading(value.plainText, value.level)
    case let value as BlockQuote: return .quote(value.children.map(block))
    case let value as UnorderedList:
      return .list(value.listItems.map { $0.children.map(block) }, ordered: false)
    case let value as OrderedList:
      return .list(value.listItems.map { $0.children.map(block) }, ordered: true)
    case let value as Table:
      return .table(
        [value.head.cells.map(\.plainText)] + value.body.rows.map { $0.cells.map(\.plainText) })
    case is ThematicBreak: return .rule
    case let value as HTMLBlock: return .plain(value.rawHTML)
    default:
      let source = node.format()
      return source.contains("<") ? .plain(source) : .text(source)
    }
  }
}
