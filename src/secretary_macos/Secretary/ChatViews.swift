import AppKit
import SecretaryKit
import SwiftUI

struct ChatShell: View {
  @ObservedObject var connection: ConnectionModel
  @ObservedObject var chat: ChatModel
  @State private var page = "connection"
  @State private var locator = ""
  @State private var locateEvent = false
  @AppStorage("chat.sidebar") private var sidebar = true
  @AppStorage("chat.sidebarWidth") private var sidebarWidth = 200.0
  @AppStorage("chat.fontSize") private var fontSize = 13.0
  var body: some View {
    GeometryReader { geometry in
      VStack(spacing: 0) {
        HStack {
          Button(chat.name) { page = "chat" }
            .font(.system(size: 16)).buttonStyle(.plain).lineLimit(1)
            .accessibilityIdentifier("assistantHome")
          Spacer(minLength: 12)
          if geometry.size.width > 900 {
            unavailableNavigation
          } else {
            Menu("更多") { unavailableNavigation }.fixedSize()
          }
          Menu("设置") {
            Button("连接配置") { page = "connection" }
            Button("本地显示") { page = "preferences" }
            Button("业务设置（后续阶段提供）") {}.disabled(true)
          }.fixedSize()
        }.font(.system(size: 12)).padding(.horizontal, 16).padding(.vertical, 10)
        HStack {
          Text(connection.connected ? "已连接" : connection.status)
          Spacer()
          if !chat.attention.isEmpty {
            Text(chat.attention + " · 处理入口将在下一阶段提供")
              .accessibilityIdentifier("attentionSummary")
          }
        }.font(.system(size: 11)).foregroundStyle(.secondary).padding(.horizontal, 16)
        Divider().padding(.top, 8)
        if page == "connection" {
          ConnectionView(model: connection)
        } else if page == "preferences" {
          Form {
            Toggle(
              "显示流式预览",
              isOn: Binding(
                get: { chat.preferences.streaming },
                set: {
                  chat.setPreferences(streaming: $0, thinking: chat.preferences.thinking)
                }))
            Toggle(
              "显示服务端提供的可见思考",
              isOn: Binding(
                get: { chat.preferences.thinking },
                set: {
                  chat.setPreferences(streaming: chat.preferences.streaming, thinking: $0)
                }))
            Toggle("显示关联旁栏", isOn: $sidebar)
            Slider(value: $sidebarWidth, in: 180...220) { Text("旁栏宽度") }
            Slider(value: $fontSize, in: 13...20, step: 1) { Text("正文字号") }
            Text("窄窗优先保留对话；设备已冻结，管理页面尚未实现。后续再做美学设计。")
          }.padding(24)
          Spacer()
        } else {
          HStack(spacing: 0) {
            conversation
            if sidebar && geometry.size.width - sidebarWidth >= 800 {
              Divider()
              relatedSidebar.frame(width: sidebarWidth)
            }
          }
        }
      }
      .font(.system(size: fontSize))
      .onChange(of: connection.connected) { _, connected in if connected { page = "chat" } }
    }
  }
  @ViewBuilder private var unavailableNavigation: some View {
    ForEach(["任务", "记忆", "设备", "产物"], id: \.self) { title in
      Button(title) {}.disabled(true)
        .help(title == "设备" ? "设备能力已冻结" : "此页面将在下一阶段提供")
        .accessibilityLabel(title + (title == "设备" ? "，已冻结" : "，尚未实现"))
    }
  }
  private var conversation: some View {
    VStack(spacing: 8) {
      HStack {
        Button("较早记录") {
          Task { await chat.load(nil, direction: "before", cursor: chat.window.before) }
        }
        .disabled(chat.window.before == nil || chat.busy || !chat.online)
        Button("较新记录") {
          Task { await chat.load(nil, direction: "after", cursor: chat.window.after) }
        }
        .disabled(chat.window.after == nil || chat.busy || !chat.online)
        Spacer()
        Button(chat.hasUpdates ? "有更新 · 回到最新" : "回到最新") {
          Task { await chat.load(nil, goToLatest: true) }
        }.disabled(!chat.online || chat.busy)
      }.font(.system(size: 12))
      HStack {
        TextField("记录 ID", text: $locator).accessibilityLabel("定位记录 ID")
        Toggle("事件", isOn: $locateEvent).toggleStyle(.checkbox)
        Button("定位") {
          let target = locator.trimmingCharacters(in: .whitespacesAndNewlines)
          Task { await chat.load((locateEvent ? "event_id" : "message_id", target)) }
        }.disabled(locator.isEmpty || !chat.online || chat.busy)
      }.font(.system(size: 12))
      HStack {
        Text(chat.status).accessibilityIdentifier("chatStatus")
        if chat.busy { ProgressView().controlSize(.small) }
        Spacer()
        if let date = chat.confirmedAt {
          Text("确认 \(date.formatted(date: .omitted, time: .standard))")
        }
      }.font(.system(size: 11)).foregroundStyle(.secondary)
      TranscriptView(chat: chat, fontSize: fontSize).frame(
        maxWidth: .infinity, maxHeight: .infinity)
      if !chat.commands.isEmpty {
        DisclosureGroup("发送记录（最近 \(chat.commands.count) 条）") {
          ScrollView {
            VStack(alignment: .leading, spacing: 5) {
              ForEach(chat.commands, id: \.id) { command in
                Text("\(receiptLabel(command.state)) · \(command.id)").textSelection(.enabled)
              }
            }.frame(maxWidth: .infinity, alignment: .leading)
          }.frame(maxHeight: 100)
        }.font(.system(size: 11))
      }
      ComposerView(
        text: chat.draft, enabled: !chat.sending, fontSize: fontSize, edit: chat.edit,
        send: chat.send
      )
      .frame(height: 95)
      .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(nsColor: .separatorColor)))
      HStack {
        Text("Return 换行 · ⌘Return 发送").font(.system(size: 11)).foregroundStyle(.secondary)
        Spacer()
        Button("发送") { chat.send() }.disabled(!chat.sendEnabled).accessibilityIdentifier(
          "sendMessage")
      }
    }.padding(14)
  }
  private func receiptLabel(_ state: String) -> String {
    switch state {
    case "PENDING": return "待确认"
    case "UNKNOWN", "RECEIPT:UNKNOWN": return "结果未知，等待对账"
    case "RECEIPT:ACCEPTED", "RECEIPT:QUEUED", "RECEIPT:RUNNING", "RECEIPT:COMPLETED":
      return "已受理（回复以时间线为准）"
    case "RECEIPT:FAILED", "RECEIPT:REJECTED": return "未受理或失败（保留原请求）"
    default: return "回执：" + state
    }
  }
  private var relatedSidebar: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("关联").font(.system(size: 12, weight: .medium))
      Text(chat.relatedStatus).font(.system(size: 11)).foregroundStyle(.secondary)
      Button("当前对话范围") { Task { await chat.selectRelated(nil) } }
      ForEach(["task", "artifact", "device"], id: \.self) { kind in
        Text(["task": "任务", "artifact": "产物", "device": "设备"][kind]!).font(.system(size: 12))
        if kind == "device" {
          Text("已冻结").foregroundStyle(.secondary)
        } else {
          let items = chat.related.filter { $0.type == kind }
          if items.isEmpty { Text("暂无明确关联").foregroundStyle(.secondary) }
          ForEach(items) { item in
            Text(item.id).textSelection(.enabled).lineLimit(3).help(item.basis)
          }
        }
      }
      if chat.relatedMore != nil {
        Button("继续查找关联") { Task { await chat.selectRelated(nil, more: true) } }
          .disabled(!chat.online)
      }
      Text("每类最多 5 项；详情入口将在后续阶段提供。后台刷新不计作访问。")
        .foregroundStyle(.secondary)
      Spacer()
    }.font(.system(size: 11)).padding(12)
  }
}

struct ComposerView: NSViewRepresentable {
  var text: String
  var enabled: Bool
  var fontSize: Double
  var edit: (String) -> Void
  var send: () -> Void
  func makeCoordinator() -> Coordinator { Coordinator(self) }
  func makeNSView(context: Context) -> NSScrollView {
    let scroll = NSScrollView()
    let editor = MessageTextView(frame: NSRect(x: 0, y: 0, width: 400, height: 95))
    editor.isRichText = false
    editor.font = .systemFont(ofSize: 13)
    editor.textContainerInset = NSSize(width: 8, height: 8)
    editor.isVerticallyResizable = true
    editor.isHorizontallyResizable = false
    editor.minSize = NSSize(width: 0, height: 95)
    editor.maxSize = NSSize(
      width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
    editor.autoresizingMask = [.width]
    editor.textContainer?.widthTracksTextView = true
    editor.delegate = context.coordinator
    editor.setAccessibilityLabel("消息输入")
    scroll.documentView = editor
    scroll.hasVerticalScroller = true
    return scroll
  }
  func updateNSView(_ scroll: NSScrollView, context: Context) {
    context.coordinator.parent = self
    guard let editor = scroll.documentView as? MessageTextView else { return }
    editor.onSend = send
    editor.font = .systemFont(ofSize: fontSize)
    editor.isEditable = enabled
    if editor.string != text && !editor.hasMarkedText() {
      let selection = editor.selectedRange()
      editor.string = text
      editor.setSelectedRange(
        NSRange(location: min(selection.location, (text as NSString).length), length: 0))
    }
  }
  final class Coordinator: NSObject, NSTextViewDelegate {
    var parent: ComposerView
    init(_ parent: ComposerView) { self.parent = parent }
    func textDidChange(_ notification: Notification) {
      guard let editor = notification.object as? NSTextView, !editor.hasMarkedText() else { return }
      parent.edit(editor.string)
    }
  }
}
struct MessageBody: View {
  let blocks: [MarkdownBlock]
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in blockView(block) }
    }.frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
      .environment(
        \.openURL,
        OpenURLAction { url in
          ["https", "http"].contains(url.scheme?.lowercased() ?? "") ? .systemAction : .discarded
        })
  }
  @ViewBuilder private func blockView(_ block: MarkdownBlock) -> some View {
    switch block {
    case .text(let text):
      Text(
        (try? AttributedString(
          markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
          ?? AttributedString(text))
    case .heading(let text, _): Text(text).bold()
    case .code(let text, let language):
      VStack(alignment: .leading, spacing: 3) {
        HStack {
          Text(language ?? "代码").font(.caption).foregroundStyle(.secondary)
          Spacer()
          Button("复制代码") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
          }
        }
        ScrollView(.horizontal) { Text(text).font(.system(.body, design: .monospaced)).fixedSize() }
      }.padding(8).background(Color(nsColor: .controlBackgroundColor))
    case .quote(let contents):
      HStack {
        Rectangle().fill(.secondary).frame(width: 2)
        MessageBody(blocks: contents)
      }.padding(.leading, 8)
    case .list(let items, let ordered):
      VStack(alignment: .leading, spacing: 4) {
        ForEach(Array(items.enumerated()), id: \.offset) { index, contents in
          HStack(alignment: .top) {
            Text(ordered ? "\(index + 1)." : "•")
            MessageBody(blocks: contents)
          }
        }
      }
    case .table(let rows):
      ScrollView(.horizontal) {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 5) {
          ForEach(Array(rows.enumerated()), id: \.offset) { index, cells in
            GridRow {
              ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in
                Text(cell).fontWeight(index == 0 ? .semibold : .regular).fixedSize()
              }
            }
          }
        }.padding(6)
      }
    case .rule: Divider()
    }
  }
}

private struct RowFrames: PreferenceKey {
  static let defaultValue: [String: CGRect] = [:]
  static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
    value.merge(nextValue()) { $1 }
  }
}
private struct TranscriptRows: View {
  let items: [ChatItem]
  let previewStates: [String: String]
  let fontSize: Double
  let frames: ([String: CGRect]) -> Void
  let more: (ChatItem) -> Void
  let select: (ChatItem) -> Void
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      ForEach(items) { item in
        VStack(alignment: .leading, spacing: 5) {
          HStack {
            Text(item.role ?? "活动").fontWeight(.medium)
            Text(item.at ?? "").foregroundStyle(.secondary).lineLimit(1)
            Spacer()
            if item.kind == "message" {
              Button("关联") { select(item) }.help("明确切换关联范围，不改变留存时间")
            }
          }.font(.system(size: 11))
          if item.kind == "message" {
            if let call = item.call_id, let state = previewStates[call], state != "saved" {
              Text(
                state == "running" ? "流式预览" : (state == "unconfirmed" ? "预览状态未确认" : "预览中断：" + state)
              )
              .font(.caption).foregroundStyle(.secondary)
            }
            MessageBody(blocks: ChatMarkdown.parse(item.text ?? ""))
            if let thinking = item.thinking, !thinking.isEmpty {
              DisclosureGroup("可见思考") { MessageBody(blocks: ChatMarkdown.parse(thinking)) }
            }
            if item.incomplete == true { Text("未完整完成").foregroundStyle(.secondary) }
            if item.next_cursor != nil { Button("继续读取正文") { more(item) } }
          } else if let activity = item.activity {
            Text((activity.phase ?? activity.id) + " · " + (activity.status ?? "未知状态"))
              .textSelection(.enabled)
          } else {
            Text("未知记录类型：" + item.kind)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
          GeometryReader { geometry in
            Color.clear.preference(
              key: RowFrames.self, value: [item.id: geometry.frame(in: .named("transcript"))])
          })
      }
    }
    .font(.system(size: fontSize)).padding(10).coordinateSpace(name: "transcript")
    .onPreferenceChange(RowFrames.self, perform: frames)
  }
}

/// AppKit owns the scroll offset, so replacing SwiftUI content never implicitly scrolls to bottom.
struct TranscriptView: NSViewRepresentable {
  @ObservedObject var chat: ChatModel
  let fontSize: Double
  func makeCoordinator() -> Coordinator { Coordinator(chat: chat) }
  func makeNSView(context: Context) -> NSScrollView {
    let scroll = NSScrollView()
    scroll.hasVerticalScroller = true
    scroll.drawsBackground = false
    scroll.contentView.postsBoundsChangedNotifications = true
    context.coordinator.scroll = scroll
    NotificationCenter.default.addObserver(
      context.coordinator, selector: #selector(Coordinator.scrolled),
      name: NSView.boundsDidChangeNotification, object: scroll.contentView)
    return scroll
  }
  func updateNSView(_ scroll: NSScrollView, context: Context) {
    let coordinator = context.coordinator
    let current = coordinator.currentAnchor()
    if coordinator.revision != chat.scrollRevision {
      coordinator.restore = chat.scrollRequest
      coordinator.revision = chat.scrollRevision
    } else {
      coordinator.restore = current ?? chat.anchor
    }
    let width = max(200, scroll.contentSize.width)
    let root = TranscriptRows(
      items: chat.window.items, previewStates: chat.previewStates, fontSize: fontSize,
      frames: { frames in
        coordinator.frames = frames
        coordinator.restorePosition()
      }, more: { item in Task { await chat.moreContent(item) } },
      select: { item in
        Task { await chat.selectRelated(item) }
      }
    ).frame(width: width, alignment: .leading)
    if let host = coordinator.host {
      host.rootView = AnyView(root)
    } else {
      let host = NSHostingView(rootView: AnyView(root))
      coordinator.host = host
      scroll.documentView = host
    }
    coordinator.host?.setFrameSize(
      NSSize(width: width, height: coordinator.host?.fittingSize.height ?? 0))
  }
  @MainActor final class Coordinator: NSObject {
    let chat: ChatModel
    weak var scroll: NSScrollView?
    var host: NSHostingView<AnyView>?
    var frames: [String: CGRect] = [:]
    var restore: ReadingAnchor?
    var revision = -1
    var adjusting = false
    init(chat: ChatModel) { self.chat = chat }
    deinit { NotificationCenter.default.removeObserver(self) }
    func currentAnchor() -> ReadingAnchor? {
      let messageIDs = Set(chat.window.items.filter { $0.kind == "message" }.map(\.id))
      let messageFrames = frames.filter { messageIDs.contains($0.key) }
      guard let y = scroll?.contentView.bounds.minY,
        let row = messageFrames.filter({ $0.value.minY <= y + 1 }).max(by: {
          $0.value.minY < $1.value.minY
        })
          ?? messageFrames.min(by: { $0.value.minY < $1.value.minY })
      else { return nil }
      return ReadingAnchor(id: row.key, offset: max(0, y - row.value.minY))
    }
    func restorePosition() {
      guard let scroll, let anchor = restore, let frame = frames[anchor.id] else { return }
      adjusting = true
      let y = min(
        max(0, frame.minY + anchor.offset),
        max(0, (host?.frame.height ?? 0) - scroll.contentSize.height))
      scroll.contentView.scroll(to: NSPoint(x: 0, y: y))
      scroll.reflectScrolledClipView(scroll.contentView)
      restore = nil
      adjusting = false
      if let value = currentAnchor() {
        DispatchQueue.main.async { [weak self] in
          guard let self, self.chat.window.items.contains(where: { $0.id == value.id }) else {
            return
          }
          if self.chat.anchor != value { self.chat.saveReading(value, freeze: false) }
        }
      }
    }
    @objc func scrolled(_ notification: Notification) {
      guard !adjusting, let value = currentAnchor(), chat.anchor != value else { return }
      // Defer publishing outside AppKit layout; persist only actual user-originated scrolls.
      if let event = NSApp.currentEvent,
        [.scrollWheel, .leftMouseDragged, .leftMouseDown, .keyDown].contains(event.type)
      {
        DispatchQueue.main.async { [weak self] in
          guard let self, !self.adjusting else { return }
          self.chat.saveReading(value)
        }
      }
    }
  }
}
