import AppKit
import Foundation
import SecretaryKit

@MainActor
final class ChatModel: ObservableObject {
  @Published var window = ChatWindow()
  @Published var name = "secretary"
  @Published var draft = ""
  @Published var status = "附着 Core 后读取对话"
  @Published var online = false
  @Published var busy = false
  @Published var sending = false
  @Published var hasUpdates = false
  @Published var activitiesConfirmed = false
  @Published var confirmedAt: Date?
  @Published var commands: [PendingCommand] = []
  @Published var related: [RelatedPage.Item] = []
  @Published var relatedMore: String?
  @Published var relatedStatus = "当前对话范围"
  @Published var attention = ""
  @Published var previewStates: [String: String] = [:]
  @Published var anchor: ReadingAnchor?
  @Published var scrollRequest: ReadingAnchor?
  @Published var scrollRevision = 0
  @Published var scrollToBottom = false
  @Published var expandedThinking: Set<String> = []
  @Published var messageCapability: Capability?
  @Published var preferences = ChatPreferences(
    streaming: UserDefaults.standard.object(forKey: "chat.streaming") as? Bool ?? true,
    thinking: UserDefaults.standard.bool(forKey: "chat.thinking"))
  private var engine: ClientEngine?
  private var local: ChatLocalState?
  private var identity: Identity?
  private var epoch = 0
  private var ticket = 0
  private var relationTicket = 0
  private var relationQuery: [String: String] = [:]
  private var latest = true
  private var lastTransient = Date.distantPast
  private var generation: UInt64 = 0

  func configure(engine: ClientEngine, database: URL) throws {
    self.engine = engine
    local = try ChatLocalState(url: database)
  }
  private func check(_ version: Int) throws {
    guard version == epoch, online else { throw ClientError.staleConnection }
    try Task.checkCancellation()
  }
  func attach(_ core: Core) async throws {
    guard let engine, let local else { throw ClientError.storage }
    epoch += 1
    let version = epoch
    let newIdentity = Identity(
      owner: core.owner_id, domain: core.data_domain_id, session: core.session_id)
    if identity != newIdentity {
      window.clear()
      confirmedAt = nil
      related = []
      commands = []
      attention = ""
      previewStates = [:]
      expandedThinking = []
      identity = newIdentity
      draft = try local.draft(newIdentity)
      anchor = try local.anchor(newIdentity)
      latest = anchor == nil
    }
    activitiesConfirmed = false
    online = true
    generation = await engine.connectionGeneration()
    try check(version)
    // The server remains the authority; unknown capabilities never authorize a write.
    messageCapability = core.capabilities["messages"]
    try await refreshSummary()
    try check(version)
    await load(anchor.map { ("message_id", $0.id) })
    try check(version)
    await selectRelated(nil)
  }
  func disconnected() {
    epoch += 1
    ticket += 1
    relationTicket += 1
    online = false
    activitiesConfirmed = false
    busy = false
    previewStates = previewStates.mapValues { $0 == "running" ? "unconfirmed" : $0 }
    status = "离线缓存 · 保留最后确认内容"
  }
  var sendEnabled: Bool {
    online && messageCapability?.allowed == true && !sending
      && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }
  var sendUnavailableReason: String? {
    guard online else { return "尚未连接，草稿保留在本机" }
    guard let capability = messageCapability else { return "消息能力未知：Core 未提供 messages 状态" }
    guard !capability.allowed else { return nil }
    return "暂不可发送 · " + capability.state + " · " + (capability.reason ?? "Core 未提供原因")
  }
  func setThinkingExpanded(_ id: String, expanded: Bool) {
    if expanded {
      expandedThinking.insert(id)
      latest = false
    } else {
      expandedThinking.remove(id)
    }
  }
  private func followBottom() {
    scrollRequest = nil
    scrollToBottom = true
    scrollRevision += 1
    hasUpdates = false
  }
  func edit(_ text: String) {
    guard let identity, let local else { return }
    // Keep the visible input even if durable storage fails; do not hide the failure.
    draft = text
    do { try local.saveDraft(text, for: identity) } catch {
      status = "草稿尚未保存，请保留窗口并检查本地存储：" + ConnectionModel.explanation(error)
    }
  }
  func send() {
    guard sendEnabled, let identity, let local, let engine else { return }
    sending = true
    do {
      _ = try local.enqueue(draft, for: identity)
      draft = ""  // The SQLite outbox + draft deletion has committed synchronously.
      commands = try local.commands(identity)
      status = "已保存在本机，正在对账；受理不代表回复完成"
    } catch {
      status = "未能入队，输入已保留：" + ConnectionModel.explanation(error)
      sending = false
      return
    }
    sending = false
    let version = epoch
    Task {
      do {
        try await engine.drainOutbox()
        try check(version)
        commands = try local.commands(identity)
        await load(nil, goToLatest: true)
      } catch {
        guard version == epoch else { return }
        status = "发送结果待确认，保留原请求；恢复连接后继续对账"
        commands = (try? local.commands(identity)) ?? commands
      }
    }
  }
  func saveReading(_ value: ReadingAnchor, freeze: Bool = true) {
    guard let local, let identity else { return }
    anchor = value
    if freeze { latest = false }  // Programmatic restore persists without freezing live updates.
    do { try local.saveAnchor(value, for: identity) } catch {
      status = "阅读位置尚未保存：" + ConnectionModel.explanation(error)
    }
  }
  private var selectionActive: Bool {
    (NSApp.keyWindow?.firstResponder as? NSTextView)?.selectedRange().length ?? 0 > 0
  }
  func changed(transient: Data? = nil) async {
    guard online, let engine, let identity else { return }
    let version = epoch
    let current = ticket
    if let transient {
      guard preferences.streaming || preferences.thinking else { return }
      var stateChanged = false
      if let snapshot = try? JSONDecoder().decode(ChatTransient.self, from: transient) {
        let states = Dictionary(
          snapshot.previews.filter { $0.session == identity.session }.map { ($0.id, $0.status) },
          uniquingKeysWith: { _, new in new })
        stateChanged = states != previewStates
        previewStates = states
      }
      guard stateChanged || Date().timeIntervalSince(lastTransient) >= 0.4 else { return }
      lastTransient = Date()
    }
    do {
      if transient == nil { try await refreshSummary() }
      try check(version)
      commands = try local?.commands(identity) ?? []
      guard latest && !selectionActive && expandedThinking.isEmpty && !busy else {
        hasUpdates = true
        return
      }
      let route = preferences.route
      let projection =
        transient != nil ? try await engine.refresh(route) : try await engine.cached(route)
      try check(version)
      try await engine.requireGeneration(generation)
      // Reading can begin while the network/actor was suspended. Recheck before replacing it.
      guard current == ticket, latest, !selectionActive, expandedThinking.isEmpty, !busy else {
        hasUpdates = true
        return
      }
      if let projection {
        let page = try Contract.decode(ChatPage.self, from: projection.data)
        try window.updateLatest(page)
        followBottom()
        activitiesConfirmed = !projection.stale
        confirmedAt = projection.confirmedAt
        status = projection.stale ? "缓存陈旧，等待重新确认" : "已同步"
      }
    } catch {
      if version == epoch { status = "内容刷新未完成 · " + ConnectionModel.explanation(error) }
    }
  }
  private func refreshSummary() async throws {
    guard let engine else { return }
    let version = epoch
    if let data = try await engine.cached(Route("assistant")) {
      try check(version)
      name = try Contract.decode(AssistantProfile.self, from: data.data).displayName
    }
    if let data = try await engine.cached(Route("attention")) {
      try check(version)
      let counts = try Contract.decode(AttentionPage.self, from: data.data).counts
      attention = "待审批 \(counts.authorizations) · 待回答 \(counts.decisions)"
    }
    if let identity { commands = try local?.commands(identity) ?? [] }
  }
  func load(
    _ locator: (String, String)?, direction: String? = nil, cursor: String? = nil,
    goToLatest: Bool = false
  ) async {
    guard let engine, let identity, online else { return }
    ticket += 1
    let current = ticket
    let version = epoch
    busy = true
    defer { if ticket == current { busy = false } }
    do {
      var query = preferences.query
      query["limit"] = "30"
      if let locator { query[locator.0] = locator.1 }
      if let direction { query["direction"] = direction }
      if let cursor { query["cursor"] = cursor }
      let route = try Route(locator == nil ? "timeline" : "timeline/around", query: query)
      let data: Data
      if locator == nil && cursor == nil {
        data = try await engine.refresh(route).data
      } else {
        data = try await engine.query(route, destination: identity)
      }
      try check(version)
      guard current == ticket else { return }
      try await engine.requireGeneration(generation)
      let page = try Contract.decode(ChatPage.self, from: data)
      try window.replace(page)
      latest = locator == nil && cursor == nil
      hasUpdates = false
      activitiesConfirmed = true
      confirmedAt = Date()
      status = page.items.isEmpty ? "暂无对话" : "已同步"
      scrollToBottom = false
      if latest {
        expandedThinking = []
        followBottom()
      } else if let locator {
        scrollRequest = anchor?.id == locator.1 ? anchor : ReadingAnchor(id: locator.1, offset: 0)
        scrollRevision += 1
      } else if cursor != nil, let first = window.items.first {
        scrollRequest = ReadingAnchor(id: first.id, offset: 0)
        scrollRevision += 1
      }
    } catch {
      guard version == epoch, current == ticket else { return }
      status = "读取未完成 · " + ConnectionModel.explanation(error)
      // Explicit recovery keeps the old visible page; never silently jumps to newest.
    }
  }
  func setPreferences(streaming: Bool, thinking: Bool) {
    let old = preferences.route
    epoch += 1
    ticket += 1
    busy = false
    preferences = ChatPreferences(streaming: streaming, thinking: thinking)
    UserDefaults.standard.set(streaming, forKey: "chat.streaming")
    UserDefaults.standard.set(thinking, forKey: "chat.thinking")
    window.clear()
    previewStates = [:]
    hasUpdates = false
    let version = epoch
    Task {
      do {
        try await engine?.unwatch(old)
        try check(version)
        _ = try await engine?.refresh(preferences.route)
        try check(version)
        await load(anchor.map { ("message_id", $0.id) })
      } catch { if version == epoch { status = ConnectionModel.explanation(error) } }
    }
  }
  func moreContent(_ item: ChatItem) async {
    guard let cursor = item.next_cursor, let engine, let identity else { return }
    latest = false  // Explicitly expanding a body is reading, not following the live tail.
    let version = epoch
    let current = ticket
    do {
      let query = preferences.query.merging(["cursor": cursor]) { $1 }
      let data = try await engine.query(
        Route("messages/\(item.id)/content", query: query), destination: identity)
      try check(version)
      guard current == ticket else { return }
      let fragment = try Contract.decode(ChatItem.self, from: data)
      try window.appendContent(fragment, cursor: cursor)
    } catch {
      if version == epoch { status = "正文续读失败，可重新定位此记录后再试 · " + ConnectionModel.explanation(error) }
    }
  }
  func selectRelated(_ item: ChatItem?, more: Bool = false) async {
    guard let engine, let identity, online else { return }
    relationTicket += 1
    let current = relationTicket
    let version = epoch
    if !more {
      relationQuery = [
        "scope_type": item == nil ? "session" : (item?.kind == "message" ? "message" : "event"),
        "scope_id": item?.id ?? identity.session, "limit": "30",
      ]
      related = []
      relatedMore = nil
      relatedStatus = item == nil ? "当前对话范围" : "所选记录的明确关联"
    }
    var query = relationQuery
    if more {
      guard let cursor = relatedMore else { return }
      query["cursor"] = cursor
    }
    do {
      let data = try await engine.query(Route("related", query: query), destination: identity)
      try check(version)
      guard current == relationTicket else { return }
      let page = try Contract.decode(RelatedPage.self, from: data)
      for item in page.items
      where !related.contains(where: { $0.type == item.type && $0.id == item.id }) {
        if related.filter({ $0.type == item.type }).count < 5 { related.append(item) }
      }
      relatedMore = page.next_cursor
    } catch {
      if version == epoch { relatedStatus = "关联读取失败 · " + ConnectionModel.explanation(error) }
    }
  }
}
