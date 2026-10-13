import AppKit
import SecretaryKit
import SwiftUI

struct ManagementView: View {
  @ObservedObject var model: ManagementModel
  let source: (String) -> Void
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(model.location.title).font(.headline)
        Spacer()
        Button("刷新") { Task { await model.refresh() } }.disabled(model.busy || !model.online)
      }
      Text(model.status).font(.caption).foregroundStyle(.secondary)
      if let date = model.confirmedAt {
        Text("最后确认：" + date.formatted() + (model.stale ? " · 缓存陈旧" : "")).font(.caption)
      }
      if model.busy { ProgressView().controlSize(.small) }
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          content
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
      }
      if !model.commandStatus.isEmpty {
        Text(model.commandStatus).textSelection(.enabled).accessibilityIdentifier(
          "managementCommandStatus")
      }
      if model.hasUnresolvedCommand {
        HStack {
          Button("原请求对账") { Task { await model.retry() } }
          Button("开始新意图（保留输入）") { model.newIntent() }.disabled(!model.canStartNewIntent)
        }
      }
    }.padding(16)
      .sheet(item: $model.confirmation) { confirmation in
        VStack(alignment: .leading, spacing: 16) {
          Text(confirmation.title).font(.headline)
          ScrollView {
            Text(confirmation.detail).textSelection(.enabled).frame(
              maxWidth: .infinity, alignment: .leading)
          }
          Text("确认将持久保存命令；受理后仍须查看业务状态。冲突或未知结果不会自动改参数重做。").font(.caption)
          HStack {
            Button("取消") { model.confirmation = nil }
            Spacer()
            Button("确认提交") {
              model.confirmation = nil
              model.submit(confirmation)
            }.accessibilityIdentifier("confirmManagementCommand")
          }
        }.padding(24).frame(width: 540, height: 380)
      }
  }
  @ViewBuilder private var content: some View {
    let path = model.location.path
    if path == "new-task" {
      TaskEditor(model: model, task: nil)
    } else if path == "new-scope" {
      ScopeEditor(model: model, scope: nil)
    } else if path == "tasks" {
      TaskListView(model: model)
    } else if path.hasPrefix("tasks/") && path.hasSuffix("/executions") {
      ExecutionListView(model: model)
    } else if path.hasPrefix("tasks/") && path.hasSuffix("/requests") {
      RequestListView(model: model)
    } else if path.hasPrefix("tasks/"), let value = model.decode(MTaskDetail.self) {
      TaskDetailView(model: model, value: value)
    } else if path.hasPrefix("executions/"), let value = model.decode(MExecution.self) {
      ExecutionDetailView(model: model, value: value)
    } else if path.hasPrefix("task-requests/"), let value = model.decode(MTaskRequestStatus.self) {
      DetailText("状态", value.state)
      DetailText("目标", value.goal)
      DetailText("原因", value.reason?.text)
      DetailText("约束", value.constraints.joined(separator: "\n"))
      DetailText("验收", value.acceptance_criteria.joined(separator: "\n"))
      CommandButton(model: model, title: "取消待执行请求", capability: "tasks", detail: value.goal) {
        try .simple(.cancelRequest(value.request_id))
      }
    } else if path == "authorizations" || path == "decisions" || path == "operations" {
      AttentionListView(model: model)
    } else if path.hasPrefix("authorizations/"), let value = model.decode(MAuthorization.self) {
      ApprovalDetailView(model: model, value: value)
    } else if path.hasPrefix("decisions/"), let value = model.decode(MDecision.self) {
      DecisionDetailView(model: model, value: value)
    } else if path.hasPrefix("operations/"), let value = model.decode(MOperation.self) {
      OperationDetailView(model: model, value: value)
    } else if path == "memory" || path.hasPrefix("memory/") {
      MemoryManagementView(model: model, source: source)
    } else if path == "settings" {
      SettingsManagementView(model: model)
    } else if path.hasPrefix("world/") {
      WorldManagementView(model: model)
    } else if path == "scopes" {
      ScopeListView(model: model)
    } else if path.hasPrefix("scopes/"), let value = model.decode(MScope.self) {
      ScopeEditor(model: model, scope: value)
    } else if path == "authorization-rules" {
      RulesManagementView(model: model)
    } else if path == "assistant" {
      ProfileManagementView(model: model)
    } else if path == "artifacts" || path.hasPrefix("artifacts/") {
      ArtifactsManagementView(model: model)
    } else if path == "notifications" {
      NotificationsManagementView(model: model)
    } else {
      Text("尚无可显示内容；可刷新重试。")
    }
  }
}

struct DetailText: View {
  let title: String
  let value: String?
  init(_ title: String, _ value: String?) {
    self.title = title
    self.value = value
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(title).font(.caption).foregroundStyle(.secondary)
      if let value, value.utf8.count > 8192 {
        ManagementLongText(text: value).frame(height: 180)
      } else {
        Text(value ?? "未提供").textSelection(.enabled)
      }
    }
  }
}
struct NavigateButton: View {
  @ObservedObject var model: ManagementModel
  let title: String
  let path: String
  var query: [String: String] = [:]
  var viewed = false
  var body: some View {
    Button(title) {
      Task { await model.navigate(.init(path: path, query: query, title: title), viewed: viewed) }
    }.buttonStyle(.link).accessibilityIdentifier(path)
  }
}
struct CommandButton: View {
  @ObservedObject var model: ManagementModel
  let title: String
  let capability: String
  var detail: String
  var enabled = true
  let command: () throws -> ManagementCommand
  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Button(title) { model.prepare(title, detail: detail, make: command) }.disabled(
        !enabled || !model.allowed(capability) || model.hasUnresolvedCommand)
      if let reason = model.unavailable(capability) {
        Text(reason).font(.caption).foregroundStyle(.secondary)
      }
    }
  }
}
struct PageControls: View {
  @ObservedObject var model: ManagementModel
  let cursor: String?
  var body: some View {
    HStack {
      if model.location.query["cursor"] != nil {
        Button("返回首页") {
          var location = model.location
          location.query.removeValue(forKey: "cursor")
          Task { await model.navigate(location) }
        }
      }
      if let cursor { Button("下一页") { Task { await model.next(cursor) } }.disabled(model.busy) }
    }
  }
}
func lines(_ text: String?) -> [String] {
  (text ?? "").split(separator: "\n").map(String.init).filter { !$0.isEmpty }
}

private struct ManagementLongText: NSViewRepresentable {
  let text: String
  func makeNSView(context: Context) -> PlainTextDocumentView { PlainTextDocumentView() }
  func updateNSView(_ view: PlainTextDocumentView, context: Context) { view.setText(text) }
}
