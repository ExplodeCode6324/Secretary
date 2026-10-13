import AppKit
import SecretaryKit
import SwiftUI
import UserNotifications

@main
struct SecretaryApp: App {
  @StateObject private var model = ConnectionModel()
  var body: some Scene {
    Window("secretary", id: "main") {
      ConnectionView(model: model)
        .frame(minWidth: 720, minHeight: 520)
        .onDisappear { model.disconnect() }
        .onReceive(
          NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)
        ) { _ in model.confirmNotifications() }
        .onReceive(
          NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.didWakeNotification)
        ) { _ in model.reconnect() }
        .onReceive(NotificationCenter.default.publisher(for: .secretaryNotificationResponse)) {
          note in
          guard let identifier = note.userInfo?["identifier"] as? String,
            let opened = note.userInfo?["opened"] as? Bool
          else { return }
          model.notificationResponse(identifier: identifier, opened: opened)
        }
    }
    .defaultSize(width: 960, height: 640)
  }
}

@MainActor
final class ConnectionModel: ObservableObject {
  @Published var directory = ""
  @Published var node = ""
  @Published var repository = ""
  @Published var mode = "fixture"
  @Published var status = "尚未连接"
  @Published var detail = "选择 Core 的数据目录后附着；首次启动须明确配置 Node 和 Core 仓库。"
  @Published var connected = false
  @Published var busy = false
  @Published var confirmedAt: Date?
  @Published var permission = "通知权限尚未请求"
  private var engine: ClientEngine?
  private var connectionTask: Task<Void, Never>?
  private var notificationTask: Task<Void, Never>?
  private let delivery = SystemNotifications()
  private var lastNoticeProjection: Data?
  private var noticesGeneration: UInt64 = 0
  private var selectedConfiguration: (directory: String, mode: String)?

  init() {
    UNUserNotificationCenter.current().delegate = delivery
    do {
      let root = try FileManager.default.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      engine = try ClientEngine(databaseURL: root.appendingPathComponent("Secretary/client.sqlite"))
    } catch {
      status = "本地存储不可用"
      detail = "未创建可写的私有数据库，暂不允许提交。请检查磁盘空间和目录权限。"
    }
  }
  func chooseDirectory(_ target: String) {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = target != "node"
    panel.canChooseFiles = target == "node"
    panel.allowsMultipleSelection = false
    if panel.runModal() == .OK, let path = panel.url?.path {
      switch target {
      case "node": node = path
      case "repository": repository = path
      default: directory = path
      }
    }
  }
  func connect(start: Bool = false) {
    guard let engine, directory.hasPrefix("/"), !busy else { return }
    connectionTask?.cancel()
    notificationTask?.cancel()
    let dataPath = directory
    let expectedMode = mode
    let nodePath = node
    let repoPath = repository
    selectedConfiguration = (dataPath, expectedMode)
    busy = true
    connected = false
    lastNoticeProjection = nil
    confirmedAt = nil
    connectionTask = Task { [weak self] in
      guard let self else { return }
      await engine.disconnect()
      do {
        if start {
          status = "正在启动本机 Core"
          try await LocalCoreLauncher.start(
            node: URL(fileURLWithPath: nodePath), repository: URL(fileURLWithPath: repoPath),
            directory: URL(fileURLWithPath: dataPath), mode: expectedMode)
        }
        var retry = 1
        while !Task.isCancelled {
          do {
            status = "正在连接"
            let endpoint = try Endpoint.discover(in: URL(fileURLWithPath: dataPath))
            let core = try await engine.connect(
              endpoint: endpoint, expectedMode: expectedMode,
              routes: [Route("assistant"), Route("session"), Route("notifications")])
            try Task.checkCancellation()
            status = "已连接"
            detail = "Core · \(core.mode) · \(core.state)"
            connected = true
            busy = false
            confirmedAt = Date()
            retry = 1
            try await engine.drainOutbox()
            try await updateNotifications()
            try await engine.runStream { [weak self] in
              guard let self else { throw CancellationError() }
              try await self.updateNotifications()
            }
          } catch {
            if Task.isCancelled { break }
            connected = false
            busy = false
            let retryable = Self.retryable(error)
            status = retryable ? "连接中断，正在重连" : "连接未完成"
            detail = Self.explanation(error)
            if !retryable { break }
            try await Task.sleep(for: .seconds(retry))
            retry = min(retry * 2, 30)
          }
        }
      } catch {
        if !Task.isCancelled {
          status = "启动未完成"
          detail = Self.explanation(error)
          busy = false
        }
      }
    }
  }
  func reconnect() {
    guard let configuration = selectedConfiguration else { return }
    directory = configuration.directory
    mode = configuration.mode
    busy = false
    connect()
  }
  func disconnect() {
    connectionTask?.cancel()
    notificationTask?.cancel()
    selectedConfiguration = nil
    Task { await engine?.disconnect() }
    connected = false
    busy = false
    status = "已断开"
    detail = "本机 Core 继续独立运行。"
  }
  func requestNotificationPermission() {
    Task {
      do {
        permission =
          try await UNUserNotificationCenter.current().requestAuthorization(options: [
            .alert, .sound,
          ]) ? "系统通知已允许" : "系统通知未允许；提醒仍保留在 Core"
      } catch { permission = "无法请求系统通知权限" }
      lastNoticeProjection = nil
      try? await updateNotifications()
    }
  }
  private func updateNotifications() async throws {
    guard let engine else { return }
    let generation = await engine.connectionGeneration()
    if let projection = try await engine.cached(Route("notifications")) {
      try await engine.requireGeneration(generation)
      guard projection.data != lastNoticeProjection || noticesGeneration != generation else {
        return
      }
      noticesGeneration = generation
      let adapter = NotificationAdapter(engine: engine, delivery: delivery)
      try await engine.visitNotifications(generation: generation) { page in
        try await adapter.update(page, generation: generation)
      }
      try await engine.requireGeneration(generation)
      lastNoticeProjection = projection.data
      confirmedAt = projection.confirmedAt
      try await engine.drainOutbox()
      // One delayed OS delivery confirmation per observed projection, not a polling loop.
      notificationTask?.cancel()
      notificationTask = Task { [weak self] in
        do {
          try await Task.sleep(for: .seconds(2))
          try Task.checkCancellation()
          self?.confirmNotifications()
        } catch {}
      }
    }
  }
  func confirmNotifications() {
    guard let engine, connected else { return }
    let generation = noticesGeneration
    Task {
      do {
        try await NotificationAdapter(engine: engine, delivery: delivery).confirmDelivered(
          generation: generation)
        try await engine.drainOutbox()
      } catch { if !Task.isCancelled { detail = "通知确认尚未完成；将于恢复连接时对账。" } }
    }
  }
  func notificationResponse(identifier: String, opened: Bool) {
    guard let engine else { return }
    Task {
      do {
        // Persist even during cold start/offline; only the matching domain's registration replays it.
        try await engine.captureNotificationResponse(identifier: identifier, opened: opened)
        if connected { try await engine.drainOutbox() }
        if opened { detail = "通知响应已保留，附着对应 Core 后确认。完整通知列表将在后续业务界面提供。" }
      } catch { detail = "通知响应未能持久保存，请检查本地存储后重新打开内容。" }
    }
  }
  static func retryable(_ error: any Error) -> Bool {
    if error is URLError { return true }
    guard let error = error as? ClientError else { return false }
    switch error {
    case .unavailable, .sessionChanged, .staleConnection: return true
    case .http(let status, let code): return status >= 500 || code == "RESYNC_REQUIRED"
    default: return false
    }
  }
  static func explanation(_ error: any Error) -> String {
    guard let error = error as? ClientError else { return "连接暂不可用。保留最后确认的数据，恢复后按原请求 ID 对账。" }
    switch error {
    case .unsafeDiscovery: return "发现文件不存在或未通过私有权限、本机地址及格式校验。请确认所选数据目录。"
    case .identityMismatch: return "Core 模式或实例身份与发现文件不一致，请核对目录和模式。"
    case .storage, .storageVersion: return "本地数据库不可写或版本不受支持。请检查空间与权限；原草稿和待确认命令保留。"
    case .http(let status, let code): return "Core 返回 \(status) · \(code)。请检查服务状态后重连。"
    case .responseTooLarge: return "响应超出客户端预算，已停止读取；恢复后从已提交水位继续。"
    default: return "连接或协议校验未完成。保留最后确认的数据，恢复后重新对账。"
    }
  }
}

private struct ConnectionView: View {
  @ObservedObject var model: ConnectionModel
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      HStack {
        Text("secretary").font(.system(size: 16, weight: .medium))
        Spacer()
        Text("原生连接底座").foregroundStyle(.secondary)
      }
      Divider()
      Text("本机 Core").font(.headline)
      pathField("数据目录", value: $model.directory, target: "data")
      HStack {
        Text("运行模式").frame(width: 78, alignment: .leading)
        Picker("运行模式", selection: $model.mode) {
          Text("fixture").tag("fixture")
          Text("live").tag("live")
        }
        .labelsHidden().frame(width: 160)
        Spacer()
        Button("附着已有 Core") { model.connect() }.disabled(model.directory.isEmpty || model.busy)
          .keyboardShortcut(.return, modifiers: [.command])
      }
      DisclosureGroup("首次启动配置") {
        VStack(spacing: 10) {
          pathField("Node 程序", value: $model.node, target: "node")
          pathField("Core 仓库", value: $model.repository, target: "repository")
          HStack {
            Spacer()
            Button("启动本机 Core") { model.connect(start: true) }
              .disabled(
                model.busy || model.directory.isEmpty || !model.node.hasPrefix("/")
                  || !model.repository.hasPrefix("/"))
          }
        }.padding(.top, 8)
      }
      Divider()
      Text(model.status).font(.headline).accessibilityIdentifier("connectionStatus")
      Text(model.detail).foregroundStyle(.secondary).textSelection(.enabled)
      if let date = model.confirmedAt {
        Text("最后确认：\(date.formatted(date: .abbreviated, time: .standard))").font(.caption)
          .foregroundStyle(.secondary)
      }
      HStack {
        Button("断开客户端") { model.disconnect() }.disabled(!model.connected && !model.busy)
        Spacer()
        Text(model.permission).font(.caption).foregroundStyle(.secondary)
        Button("允许系统通知") { model.requestNotificationPermission() }
      }
      Spacer()
      Text("本阶段仅提供连接与可靠同步。对话和管理页面将在后续阶段加入；界面保持简洁，后续继续进行美学设计。")
        .font(.caption).foregroundStyle(.secondary)
    }
    .padding(24).font(.system(size: 13))
  }
  private func pathField(_ title: String, value: Binding<String>, target: String) -> some View {
    HStack {
      Text(title).frame(width: 78, alignment: .leading)
      TextField("请选择绝对路径", text: value).textFieldStyle(.roundedBorder).accessibilityLabel(title)
      Button("选择…") { model.chooseDirectory(target) }.accessibilityLabel("选择" + title)
    }
  }
}

extension Notification.Name {
  static let secretaryNotificationResponse = Notification.Name("SecretaryNotificationResponse")
}
final class SystemNotifications: NSObject, NotificationDelivery, UNUserNotificationCenterDelegate,
  Sendable
{
  func schedule(identifier: String, text: String) async throws -> Bool {
    let center = UNUserNotificationCenter.current()
    let settings = await center.notificationSettings()
    guard
      settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    else { return false }
    let content = UNMutableNotificationContent()
    content.title = "secretary"
    content.body = text
    try await center.add(
      UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    return true
  }
  func deliveredIdentifiers() async -> Set<String> {
    Set(
      await UNUserNotificationCenter.current().deliveredNotifications().map {
        $0.request.identifier
      })
  }
  func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    // This callback is not proof that a banner became visible.
    [.banner, .list]
  }
  func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    let identifier = response.notification.request.identifier
    let opened = response.actionIdentifier == UNNotificationDefaultActionIdentifier
    await MainActor.run {
      NotificationCenter.default.post(
        name: .secretaryNotificationResponse, object: nil,
        userInfo: ["identifier": identifier, "opened": opened])
    }
  }
}
