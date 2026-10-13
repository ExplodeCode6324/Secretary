import AppKit
import SecretaryKit
import SwiftUI

struct ManagementLocation: Equatable {
  var path: String
  var query: [String: String] = [:]
  var title: String
  var editorKey: String {
    // The same URL encoding as transport prevents ambiguous query-value separators.
    (try? Route(path, query: query.filter { $0.key != "cursor" }).key) ?? path
  }
}

@MainActor final class ManagementModel: ObservableObject {
  @Published var location = ManagementLocation(path: "tasks", title: "任务")
  @Published var data: Data?
  @Published var scopes: [MScope] = []
  @Published var scopeNextCursor: String?
  @Published var scopePageCursor: String?
  @Published var fields: [String: String] = [:]
  @Published var payload: JSONValue = .null
  @Published var status = "尚未加载"
  @Published var commandStatus = ""
  @Published var confirmedAt: Date?
  @Published var stale = true
  @Published var busy = false
  @Published var online = false
  @Published var capabilities: [String: Capability] = [:]
  @Published var confirmation: Confirmation?
  @Published var fragments: [String: MOperationText] = [:]
  @Published var downloadStatus = ""
  @Published var downloadProgress = 0.0
  @Published var downloaded: URL?
  @Published private(set) var downloading = false
  private var engine: ClientEngine?
  private var local: ManagementLocalState?
  private var identity: Identity?
  private var epoch = 0
  private var ticket = 0
  private var navigationEpoch = 0
  private var watched: Route?
  private var active = false
  private var pendingChange = false
  private var unsaved: [Identity: [String: Editor]] = [:]
  private var cache: ArtifactCache?
  private var downloadTask: Task<Void, Never>?
  private var downloadGeneration = 0
  struct Confirmation: Identifiable {
    let id = UUID()
    let title: String
    let detail: String
    let command: ManagementCommand
    let key: String
    let epoch: Int
  }
  struct Editor: Codable {
    var fields: [String: String]
    var payload: JSONValue
  }
  func configure(engine: ClientEngine, database: URL) throws {
    self.engine = engine
    local = try ManagementLocalState(url: database)
    cache = try ArtifactCache(
      root: database.deletingLastPathComponent().appendingPathComponent("Artifacts"))
  }
  func attach(_ core: Core) async throws {
    cancelDownload()
    epoch += 1
    // Opaque page cursors belong to a Core instance; reconnect starts from the first page.
    location.query.removeValue(forKey: "cursor")
    scopePageCursor = nil
    scopeNextCursor = nil
    let next = Identity(owner: core.owner_id, domain: core.data_domain_id, session: core.session_id)
    if next != identity {
      if identity != nil { location = .init(path: "tasks", title: "任务") }
      data = nil
      fields = [:]
      payload = .null
      fragments = [:]
      confirmedAt = nil
      commandStatus = ""
      scopes = []
      scopeNextCursor = nil
      scopePageCursor = nil
      downloaded = nil
      confirmation = nil
    }
    identity = next
    capabilities = core.capabilities
    online = true
    if active { await navigate(location) }
  }
  func disconnect() {
    epoch += 1
    ticket += 1
    navigationEpoch += 1
    online = false
    stale = true
    busy = false
    pendingChange = false
    confirmation = nil
    cancelDownload()
    downloaded = nil
    status = "离线缓存 · 保留最后确认内容与本地编辑"
  }
  func hide() {
    active = false
    navigationEpoch += 1
    pendingChange = false
    confirmation = nil
    cancelDownload()
  }
  func decode<T: Decodable>(_ type: T.Type) -> T? {
    data.flatMap { try? Contract.decode(type, from: $0) }
  }
  func allowed(_ capability: String) -> Bool { online && capabilities[capability]?.allowed == true }
  func unavailable(_ capability: String) -> String? {
    guard online else { return "离线，操作不可用；本地草稿保留" }
    guard let c = capabilities[capability] else { return "Core 未提供此能力" }
    return c.allowed ? nil : c.state + " · " + (c.reason ?? "未提供原因")
  }
  private func check(_ e: Int, _ t: Int) throws {
    guard e == epoch, t == ticket, online else { throw ClientError.staleConnection }
    try Task.checkCancellation()
  }
  func navigate(_ value: ManagementLocation, viewed: Bool = false) async {
    active = true
    ticket += 1
    navigationEpoch += 1
    let e = epoch
    let t = ticket
    let changed = location != value
    location = value
    confirmation = nil
    if changed {
      scopeNextCursor = nil
      scopePageCursor = nil
      commandStatus = ""
      data = nil
      fragments = [:]
      confirmedAt = nil
      downloaded = nil
      cancelDownload()
      downloadStatus = ""
    }
    do {
      if let identity, let local {
        if let editor = unsaved[identity]?[value.editorKey] {
          fields = editor.fields
          payload = editor.payload
          commandStatus = "仍有未落盘编辑，请保留应用并检查存储"
        } else if let saved = try local.load(key: value.editorKey, identity: identity) {
          let editor = try JSONDecoder().decode(Editor.self, from: saved)
          fields = editor.fields
          payload = editor.payload
        } else {
          fields = [:]
          payload = .null
        }
      }
      if let old = watched {
        try await engine?.unwatch(old)
        try check(e, t)
        watched = nil
      }
      await refresh()
      guard e == epoch, location == value, online else { return }
      if viewed, value.path.hasPrefix("executions/"), let execution = decode(MExecution.self) {
        // Only the user's explicit detail navigation reaches this branch.
        let command = try ManagementCommand.simple(.viewed(execution.id))
        guard let identity, let engine else { return }
        try await engine.enqueue(
          id: command.id, route: command.route, body: command.body, destination: identity)
        try await engine.drainOutbox()
      }
    } catch { if e == epoch && t == ticket { status = ConnectionModel.explanation(error) } }
  }
  func refresh() async {
    guard online, let engine, let identity else { return }
    ticket += 1
    let e = epoch
    let t = ticket
    busy = true
    stale = true
    defer {
      if e == epoch && t == ticket {
        busy = false
        if pendingChange && active {
          pendingChange = false
          Task { if e == self.epoch && self.active { await self.refresh() } }
        }
      }
    }
    do {
      let route = try Route(
        location.path == "new-task"
          ? "tasks" : location.path == "new-scope" ? "scopes" : location.path, query: location.query
      )
      let result: Data
      if location.query["cursor"] == nil {
        result = try await engine.refresh(route).data
        try check(e, t)
        watched = route
      } else {
        result = try await engine.query(route, destination: identity)
      }
      try check(e, t)
      try validateProjection(result)
      data = result
      stale = false
      confirmedAt = Date()
      status = "已确认 · 后台刷新不计作访问"
      if ["tasks", "new-task", "scopes", "new-scope"].contains(location.path)
        || location.path.hasPrefix("tasks/")
      {
        var scopeQuery = ["limit": "30"]
        if let cursor = scopePageCursor { scopeQuery["cursor"] = cursor }
        let page = try Contract.decode(
          MScopePage.self,
          from: await engine.query(
            Route("scopes", query: scopeQuery),
            destination: identity))
        try check(e, t)
        scopes = page.items
        scopeNextCursor = page.next_cursor
      }
      if fields.isEmpty { initializeEditor() }
      try await reconcile(e, t)
    } catch {
      if e == epoch && t == ticket {
        stale = true
        status = "读取失败 · " + ConnectionModel.explanation(error)
      }
    }
  }
  private func validateProjection(_ result: Data) throws {
    func read<T: Decodable>(_ type: T.Type) throws { _ = try Contract.decode(type, from: result) }
    let p = location.path
    switch p {
    case "tasks", "new-task": try read(MTaskPage.self)
    case "scopes", "new-scope": try read(MScopePage.self)
    case "authorizations": try read(MAuthorizationPage.self)
    case "decisions": try read(MDecisionPage.self)
    case "operations": try read(MOperationPage.self)
    case "memory": try read(MMemoryStatus.self)
    case "memory/summary": try read(MMemoryPage.self)
    case "memory/commitments": try read(MCommitmentPage.self)
    case "settings": try read(MSettings.self)
    case "assistant": try read(MProfile.self)
    case "authorization-rules": try read(MRulePage.self)
    case "artifacts": try read(MArtifactPage.self)
    case "notifications": try read(NotificationPage.self)
    case "world/slot": try read(MWorldSlot.self)
    case "world/catalog", "world/facts": try read(MWorldPage.self)
    default:
      if p.hasPrefix("tasks/") {
        if p.hasSuffix("/executions") {
          try read(MExecutionPage.self)
        } else if p.hasSuffix("/requests") {
          try read(MPendingRequestPage.self)
        } else {
          try read(MTaskDetail.self)
        }
      } else if p.hasPrefix("executions/") {
        try read(MExecution.self)
      } else if p.hasPrefix("task-requests/") {
        try read(MTaskRequestStatus.self)
      } else if p.hasPrefix("authorizations/") {
        try read(MAuthorization.self)
      } else if p.hasPrefix("decisions/") {
        try read(MDecision.self)
      } else if p.hasPrefix("scopes/") {
        try read(MScope.self)
      } else if p.hasPrefix("artifacts/") {
        let next = try Contract.decode(MArtifact.self, from: result)
        let previous = decode(MArtifact.self)
        if previous?.id != next.id || previous?.content_version != next.content_version
          || previous?.bytes != next.bytes
        {
          // A refresh can change the selected content without changing the page.
          navigationEpoch += 1
          cancelDownload()
          downloaded = nil
          downloadProgress = 0
          downloadStatus = previous == nil ? "" : "产物版本已变化，请重新下载并校验"
        }
      } else if p.hasPrefix("operations/") {
        let operation = try Contract.decode(MOperation.self, from: result)
        if let display = operation.display {
          let initial = [
            "parameters": display.parameters, "stdout": display.stdout, "stderr": display.stderr,
            "reason": display.reason,
          ]
          fragments = fragments.filter {
            initial[$0.key]?.content_version == $0.value.content_version
          }
        }
      }
    }
  }
  func changed() async {
    guard active, online else { return }
    guard !busy else {
      pendingChange = true
      return
    }
    // Re-query the current page, including aggregate invalidations and paginated views.
    await refresh()
  }
  func field(_ key: String, fallback: String = "") -> Binding<String> {
    Binding(
      get: { self.fields[key] ?? fallback },
      set: {
        self.fields[key] = $0
        self.persist()
      })
  }
  func set(_ key: String, _ value: String) {
    fields[key] = value
    persist()
  }
  func persist() {
    guard let identity, let local else { return }
    let editor = Editor(fields: fields, payload: payload)
    do {
      try local.save(JSONEncoder().encode(editor), key: location.editorKey, identity: identity)
      unsaved[identity]?.removeValue(forKey: location.editorKey)
    } catch {
      unsaved[identity, default: [:]][location.editorKey] = editor
      commandStatus = "本地编辑尚未保存，请保留应用 · " + ConnectionModel.explanation(error)
    }
  }
  func initializeEditor() {
    fields = ["_initialized": "1"]
    if let s = decode(MSettings.self) {
      fields["revision"] = s.draft.revision.rawValue
      fields["instructionsRevision"] = s.effective_instructions.revision
      fields["instructions"] =
        s.draft.payload["instructions"]["content"].string ?? s.effective_instructions.content
      payload = s.draft.payload
    } else if let s = decode(MScope.self) {
      fields.merge([
        "revision": s.revision.rawValue, "name": s.name, "description": s.description,
        "root": s.root_path ?? "", "notes": s.notes_path ?? "", "write": s.default_write ?? "ask",
      ]) { _, new in new }
    } else if location.path == "assistant", let a = decode(MProfile.self) {
      fields["name"] = a.name
      fields["revision"] = a.revision.rawValue
    }
    persist()
  }
  func adoptRevision() {
    guard !hasUnresolvedCommand else {
      commandStatus = "请先完成原请求对账，再开始新意图"
      return
    }
    // Explicit conflict recovery preserves the user's text and edits.
    if let s = decode(MSettings.self) {
      fields["revision"] = s.draft.revision.rawValue
      fields["instructionsRevision"] = s.effective_instructions.revision
    } else if let s = decode(MScope.self) {
      fields["revision"] = s.revision.rawValue
    } else if let s = decode(MProfile.self) {
      fields["revision"] = s.revision.rawValue
    }
    commandStatus = "已保留本地输入；请对照最新内容再提交"
    persist()
  }
  var hasUnresolvedCommand: Bool { fields["_request"] != nil }
  func prepare(_ title: String, detail: String, make: () throws -> ManagementCommand) {
    NSApp.keyWindow?.makeFirstResponder(nil)
    guard online, !hasUnresolvedCommand else { return }
    do {
      confirmation = Confirmation(
        title: title, detail: detail, command: try make(), key: location.editorKey, epoch: epoch)
    } catch { commandStatus = "参数不完整或状态不支持 · " + ConnectionModel.explanation(error) }
  }
  func submit(_ c: Confirmation) {
    guard online, c.epoch == epoch, c.key == location.editorKey, let local, let identity, let engine
    else { return }
    do {
      var saved = fields
      saved["_request"] = c.command.id
      try local.enqueue(
        c.command, identity: identity, key: c.key,
        editor: JSONEncoder().encode(Editor(fields: saved, payload: payload)))
      fields = saved
      commandStatus = "已持久入队，正在对账；受理不代表业务完成"
    } catch {
      commandStatus = "入队失败，输入保留 · " + ConnectionModel.explanation(error)
      return
    }
    let e = epoch
    let t = ticket
    Task {
      do {
        try await engine.drainOutbox()
        try check(e, t)
        await refresh()
      } catch { if e == epoch && t == ticket { commandStatus = "结果待确认，保留原请求；请对账，不要重新创建作用" } }
    }
  }
  func reconcile(_ e: Int, _ t: Int) async throws {
    guard let id = fields["_request"], let identity, let engine else { return }
    if let saved = try await engine.command(id: id, destination: identity),
      saved.state.hasPrefix("REJECTED:")
    {
      try check(e, t)
      commandStatus = saved.state + " · 未受理；本地输入保留，请核对最新版本后开始新意图"
      return
    }
    do {
      let receipt = try Contract.decode(
        RequestStatus.self, from: await engine.query(Route("requests/" + id), destination: identity)
      ).receipt
      try check(e, t)
      commandStatus =
        receipt.acceptance + " · " + receipt.state + " · " + (receipt.error_code ?? "业务结果请查看资源状态")
      fields["_receiptState"] = receipt.state
      persist()
    } catch ClientError.http(404, "NOT_FOUND") {
      try check(e, t)
      commandStatus = "原请求尚未确认；使用原 ID 对账"
    }
  }
  var canStartNewIntent: Bool {
    commandStatus.hasPrefix("REJECTED:")
      || ["ACCEPTED", "COMPLETED"].contains(fields["_receiptState"] ?? "")
  }
  func newIntent() {
    guard
      commandStatus.hasPrefix("REJECTED:")
        || ["ACCEPTED", "COMPLETED"].contains(fields["_receiptState"] ?? "")
    else { return }
    fields.removeValue(forKey: "_request")
    fields.removeValue(forKey: "_receiptState")
    commandStatus = "新意图：保留编辑，提交前请核对版本"
    persist()
  }
  func retry() async {
    let e = epoch
    let t = ticket
    do {
      try await engine?.drainOutbox()
      try check(e, t)
      try await reconcile(e, t)
      await refresh()
    } catch { if e == epoch && t == ticket { commandStatus = ConnectionModel.explanation(error) } }
  }
  func next(_ cursor: String?) async {
    guard let cursor else { return }
    var target = location
    target.query["cursor"] = cursor
    await navigate(target)
  }
  func scopePage(_ cursor: String?) async {
    scopePageCursor = cursor
    await refresh()
  }
  func moreOperation(_ part: String, initial: MOperationText, id: String) async {
    let current = fragments[part] ?? initial
    guard let cursor = current.next_cursor, let engine, let identity else { return }
    let e = epoch
    let t = ticket
    do {
      let next = try Contract.decode(
        MOperationText.self,
        from: await engine.query(
          Route("operations/\(id)/content", query: ["part": part, "cursor": cursor]),
          destination: identity))
      try check(e, t)
      guard current.content_version == next.content_version, current.bytes == next.bytes,
        current.text.utf8.count + next.text.utf8.count <= 4 * 1024 * 1024,
        next.next_cursor != cursor
      else { throw ClientError.responseTooLarge }
      var joined = next
      joined.text = current.text + next.text
      fragments[part] = joined
    } catch {
      if e == epoch && t == ticket { status = "续读未完成 · " + ConnectionModel.explanation(error) }
    }
  }
  func chooseFolder(_ key: String) {
    let panel = NSOpenPanel()
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    if panel.runModal() == .OK, let url = panel.url { set(key, url.path) }
  }
  func download(_ artifact: MArtifact) {
    // Keep this guard as well as the disabled button: alternate callers must not cancel a transfer.
    guard !downloading else { return }
    guard let engine, let identity, let cache else { return }
    downloading = true
    downloadGeneration += 1
    let d = downloadGeneration
    downloaded = nil
    downloadProgress = 0
    let e = epoch
    let n = navigationEpoch
    downloadTask = Task {
      defer {
        downloading = false
        downloadTask = nil
      }
      do {
        downloadStatus = "正在下载并校验内容"
        let url = try await engine.download(artifact, destination: identity, cache: cache) {
          progress in
          await MainActor.run {
            if e == self.epoch && n == self.navigationEpoch && d == self.downloadGeneration {
              self.downloadProgress = max(self.downloadProgress, progress)
            }
          }
        }
        try Task.checkCancellation()
        guard e == epoch, n == navigationEpoch, online else { return }
        downloaded = url
        downloadStatus = "长度与 SHA-256 已校验，可打开本地缓存"
      } catch {
        if e == epoch && n == navigationEpoch {
          downloadStatus =
            error is CancellationError || Task.isCancelled
            ? "下载已取消，可重试"
            : (error as? URLError)?.code == .timedOut
              ? "下载等待数据超时，可重试"
              : "下载失败，可重试 · " + ConnectionModel.explanation(error)
        }
      }
    }
  }
  var presentationContext: String { "\(epoch):\(navigationEpoch):\(online)" }
  func presentedInWindow(_ id: String, context: String) async -> Bool {
    guard context == presentationContext, online, active, location.path == "notifications",
      let engine
    else { return false }
    let e = epoch
    let t = ticket
    do {
      let generation = await engine.connectionGeneration()
      try check(e, t)
      guard context == presentationContext else { return false }
      try await engine.recordPresentation(id, proof: .visibleInActiveWindow, generation: generation)
      // A network failure leaves the durable original receipt queued for normal reconciliation.
      try? await engine.drainOutbox()
      return true
    } catch {
      if !Task.isCancelled { commandStatus = ConnectionModel.explanation(error) }
      return false
    }
  }
  func markRead(_ id: String) async {
    guard online, let engine else { return }
    let e = epoch
    let t = ticket
    do {
      let generation = await engine.connectionGeneration()
      try check(e, t)
      try await engine.recordPresentation(
        id, proof: .userOpened, generation: generation, markRead: true)
      try await engine.drainOutbox()
      try check(e, t)
      await refresh()
    } catch { commandStatus = ConnectionModel.explanation(error) }
  }
  func cancelDownload() {
    // Lifecycle changes advance the epochs, so the cancelled task cannot publish its status.
    if downloading { downloadStatus = "下载已取消，可重试" }
    downloadTask?.cancel()
  }
}
