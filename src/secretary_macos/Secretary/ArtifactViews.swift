import AppKit
import SecretaryKit
import SwiftUI

struct ArtifactsManagementView: View {
  @ObservedObject var model: ManagementModel
  var body: some View {
    if model.location.path == "artifacts" {
      HStack {
        TextField("按任务 ID 筛选（留空全部）", text: model.field("taskFilter"))
        Button("筛选") {
          let id = model.fields["taskFilter"] ?? ""
          Task {
            await model.navigate(
              .init(path: "artifacts", query: id.isEmpty ? [:] : ["task_id": id], title: "产物"))
          }
        }
      }
      if let page = model.decode(MArtifactPage.self) {
        if page.items.isEmpty { Text("暂无产物") }
        ForEach(page.items, id: \.id) { artifact in
          NavigateButton(
            model: model, title: artifact.name + " · " + artifact.state,
            path: "artifacts/" + artifact.id)
          DetailText(
            "相对位置",
            artifact.relative_path.map { artifact.path_base + "/" + $0 }
              ?? artifact.path_unavailable_reason)
          DetailText("标识／版本", artifact.id + " · " + artifact.content_version)
          Divider()
        }
        PageControls(model: model, cursor: page.next_cursor)
      }
    } else if let artifact = model.decode(MArtifact.self) {
      Button("下载／重试") { model.download(artifact) }
        .disabled(model.downloading || !model.allowed("artifacts"))
      if model.downloading { Text("已有下载进行中，请等待完成或取消后重试。") }
      if let reason = model.unavailable("artifacts") { Text(reason) }
      ProgressView(value: model.downloadProgress)
      Button("取消下载") { model.cancelDownload() }.disabled(!model.downloading)
      Text(model.downloadStatus)
      if let url = model.downloaded {
        Button("用系统打开已验证文件") {
          if !NSWorkspace.shared.open(url) { model.downloadStatus = "系统未能打开此文件，可重试或在 Finder 查看" }
        }
        Button("在 Finder 中显示") { NSWorkspace.shared.activateFileViewerSelecting([url]) }
      }
      Divider()
      DetailText("名称", artifact.name)
      DetailText("标识", artifact.id)
      DetailText("状态", artifact.state)
      DetailText("版本", artifact.content_version)
      DetailText("大小／类型", artifact.bytes.rawValue + " bytes · " + artifact.media_type)
      DetailText(
        "相对位置",
        artifact.relative_path.map { artifact.path_base + "/" + $0 }
          ?? artifact.path_unavailable_reason)
      NavigateButton(model: model, title: "所属任务", path: "tasks/" + artifact.task_id)
      NavigateButton(
        model: model, title: "所属执行", path: "executions/" + artifact.execution_id, viewed: true)

    }
  }
}
struct NotificationsManagementView: View {
  @ObservedObject var model: ManagementModel
  var body: some View {
    if let page = model.decode(NotificationPage.self) {
      if page.items.isEmpty { Text("暂无通知") }
      ForEach(page.items, id: \.id) { notice in
        DetailText(notice.read_at == nil ? "未读" : "已读", notice.content.text)
          .background(NoticePresentationView { Task { await model.presentedInWindow(notice.id) } })
        if notice.content.truncated { Text("正文已截断").font(.caption) }
        Button("标记已读") { Task { await model.markRead(notice.id) } }.disabled(
          !model.online || notice.read_at != nil)
        Divider()
      }
      PageControls(model: model, cursor: page.next_cursor)
    }
  }
}

// AppKit draw/visibleRect is evidence of a rendered row, unlike a fetched page or onAppear.
private struct NoticePresentationView: NSViewRepresentable {
  let presented: () -> Void
  func makeNSView(context: Context) -> NoticePresentationNSView { NoticePresentationNSView() }
  func updateNSView(_ view: NoticePresentationNSView, context: Context) {
    view.presented = presented
    view.needsDisplay = true
  }
}
private final class NoticePresentationNSView: NSView {
  var presented: (() -> Void)?
  private var recorded = false
  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    NotificationCenter.default.removeObserver(self)
    NotificationCenter.default.addObserver(
      self, selector: #selector(activated), name: NSApplication.didBecomeActiveNotification,
      object: nil)
  }
  @objc private func activated() { needsDisplay = true }
  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    guard !recorded, window?.isVisible == true, NSApp.isActive, !visibleRect.isEmpty else { return }
    recorded = true
    DispatchQueue.main.async { [weak self] in
      guard let self, self.window?.isVisible == true, NSApp.isActive, !self.visibleRect.isEmpty
      else {
        self?.recorded = false
        return
      }
      self.presented?()
    }
  }
  deinit { NotificationCenter.default.removeObserver(self) }
}
