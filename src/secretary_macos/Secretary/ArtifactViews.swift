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
      Button("下载／重试") { model.download(artifact) }.disabled(!model.allowed("artifacts"))
      if let reason = model.unavailable("artifacts") { Text(reason) }
      ProgressView(value: model.downloadProgress)
      Button("取消下载") { model.cancelDownload() }
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
        if notice.content.truncated { Text("正文已截断").font(.caption) }
        Button("标记已读") { Task { await model.markRead(notice.id) } }.disabled(
          !model.online || notice.read_at != nil)
        Divider()
      }
      PageControls(model: model, cursor: page.next_cursor)
    }
  }
}
