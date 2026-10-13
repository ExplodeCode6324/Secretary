import SecretaryKit
import SwiftUI

struct TaskListView: View {
  @ObservedObject var model: ManagementModel
  var body: some View {
    HStack {
      NavigateButton(model: model, title: "创建任务", path: "new-task")
      Picker(
        "Scope 筛选",
        selection: Binding(
          get: { model.location.query["scope_id"] ?? "all" },
          set: { scope in
            Task {
              await model.navigate(
                .init(path: "tasks", query: scope == "all" ? [:] : ["scope_id": scope], title: "任务")
              )
            }
          })
      ) {
        Text("全部").tag("all")
        Text("未关联").tag("none")
        ForEach(model.scopes, id: \.id) { Text($0.name).tag($0.id) }
        if let selected = model.location.query["scope_id"], selected != "none",
          !model.scopes.contains(where: { $0.id == selected })
        {
          Text("已选 Scope " + selected).tag(selected)
        }
      }.frame(maxWidth: 400)
    }
    ScopeOptionsControls(model: model)
    if let page = model.decode(MTaskPage.self) {
      if page.items.isEmpty { Text("暂无任务") }
      ForEach(page.items, id: \.id) { task in
        VStack(alignment: .leading) {
          NavigateButton(model: model, title: task.goal, path: "tasks/" + task.id)
          Text(task.state + " · Scope " + (task.scope_id ?? "未关联")).font(.caption)
        }
        Divider()
      }
      PageControls(model: model, cursor: page.next_cursor)
    }
  }
}
struct TaskEditor: View {
  @ObservedObject var model: ManagementModel
  let task: MTaskDetail?
  var body: some View {
    Text(task == nil ? "创建任务" : "接续／补充任务").font(.headline)
    TextField("本轮目标", text: model.field("goal"), axis: .vertical).accessibilityIdentifier(
      "taskGoal")
    if task == nil {
      Picker("Scope", selection: model.field("scope")) {
        Text("不关联 Scope").tag("")
        ForEach(model.scopes.filter { $0.state == "ACTIVE" }, id: \.id) { Text($0.name).tag($0.id) }
        if let selected = model.fields["scope"], !selected.isEmpty,
          !model.scopes.contains(where: { $0.id == selected && $0.state == "ACTIVE" })
        {
          Text("已选 Scope " + selected).tag(selected)
        }
      }.pickerStyle(.menu).accessibilityIdentifier("taskScope").frame(maxWidth: 500)
      ScopeOptionsControls(model: model)
    } else {
      DetailText("任务 Scope", task?.scope_id ?? "未关联")
    }
    TextField("材料（每行一项）", text: model.field("materials"), axis: .vertical)
    TextField("约束（每行一项）", text: model.field("constraints"), axis: .vertical)
    TextField("验收条件（每行一项）", text: model.field("acceptance"), axis: .vertical)
    if task == nil {
      DisclosureGroup("时间条件") {
        TextField("执行时间（RFC3339，留空立即）", text: model.field("at"))
        TextField("截止时间（RFC3339，可选）", text: model.field("deadline"))
        TextField("重复间隔（秒，可选）", text: model.field("interval"))
      }
    }
    if let task {
      DetailText("接续许可", task.continuation.allowed ? "允许" : task.continuation.reason ?? "不可接续")
    }
    CommandButton(
      model: model, title: task == nil ? "提交任务" : "提交接续／补充", capability: "tasks",
      detail:
        "目标：\(model.fields["goal"] ?? "")\nScope：\(task?.scope_id ?? model.fields["scope"] ?? "未关联")\n约束：\(model.fields["constraints"] ?? "")\n验收：\(model.fields["acceptance"] ?? "")",
      enabled: task?.continuation.allowed ?? true
    ) {
      let intervalText = model.fields["interval"] ?? ""
      guard intervalText.isEmpty || Int(intervalText) != nil else {
        throw ClientError.invalidContract
      }
      return try .task(
        goal: model.fields["goal"] ?? "", scope: task == nil ? model.fields["scope"] ?? "" : nil,
        reuse: task?.id, parent: task?.latest_execution_id,
        materials: lines(model.fields["materials"]),
        constraints: lines(model.fields["constraints"]),
        acceptance: lines(model.fields["acceptance"]), at: model.fields["at"],
        deadline: model.fields["deadline"], interval: Int(model.fields["interval"] ?? ""))
    }
  }
}
struct ScopeOptionsControls: View {
  @ObservedObject var model: ManagementModel
  var body: some View {
    HStack {
      if model.scopePageCursor != nil {
        Button("返回首批 Scope") { Task { await model.scopePage(nil) } }
      }
      if let cursor = model.scopeNextCursor {
        Button("更多 Scope") { Task { await model.scopePage(cursor) } }.accessibilityIdentifier(
          "moreScopes")
      }
    }.disabled(model.busy || !model.online)
  }
}
struct TaskDetailView: View {
  @ObservedObject var model: ManagementModel
  let value: MTaskDetail
  var body: some View {
    DetailText("目标", value.goal)
    DetailText("状态", value.state)
    DetailText("本轮目标", value.effective_proposal?.goal ?? value.baseline.goal)
    DetailText(
      "约束", (value.effective_proposal ?? value.baseline).constraints.joined(separator: "\n"))
    DetailText(
      "验收", (value.effective_proposal ?? value.baseline).acceptance_criteria.joined(separator: "\n")
    )
    NavigateButton(model: model, title: "执行记录", path: "tasks/\(value.id)/executions")
    NavigateButton(
      model: model, title: "待执行请求（\(value.pending_request_count)）",
      path: "tasks/\(value.id)/requests")
    NavigateButton(model: model, title: "任务产物", path: "artifacts", query: ["task_id": value.id])
    if let result = value.result { ResultView(model: model, value: result) }
    Divider()
    TaskEditor(model: model, task: value)
  }
}
struct ExecutionListView: View {
  @ObservedObject var model: ManagementModel
  var body: some View {
    if let page = model.decode(MExecutionPage.self) {
      if page.items.isEmpty { Text("暂无执行") }
      ForEach(page.items, id: \.id) { value in
        NavigateButton(
          model: model, title: value.state + " · " + value.id, path: "executions/" + value.id,
          viewed: true)
      }
      PageControls(model: model, cursor: page.next_cursor)
    }
  }
}
struct RequestListView: View {
  @ObservedObject var model: ManagementModel
  var body: some View {
    if let page = model.decode(MPendingRequestPage.self) {
      if page.items.isEmpty { Text("暂无待执行请求") }
      ForEach(page.items, id: \.request_id) { value in
        NavigateButton(
          model: model, title: value.goal + " · " + value.due_at,
          path: "task-requests/" + value.request_id)
      }
      PageControls(model: model, cursor: page.next_cursor)
    }
  }
}
struct ExecutionDetailView: View {
  @ObservedObject var model: ManagementModel
  let value: MExecution
  var body: some View {
    DetailText("执行", value.id)
    DetailText("状态", value.state)
    DetailText("留存", value.retention_state)
    DetailText("最近活动", value.last_activity_at)
    DetailText("取消已请求", value.cancel_requested ? "是" : "否")
    ForEach(value.condition_results, id: \.condition_id) { condition in
      DetailText(
        "条件 " + condition.condition_id, condition.status + " · " + (condition.reason ?? ""))
    }
    NavigateButton(model: model, title: "所属任务", path: "tasks/" + value.task_id)
    if !value.waiting_request_ids.isEmpty {
      DetailText("等待请求", value.waiting_request_ids.joined(separator: "\n"))
    }
    NavigateButton(model: model, title: "待审批", path: "authorizations")
    NavigateButton(model: model, title: "待回答", path: "decisions")
    ForEach(value.unknown_operation_ids, id: \.self) { id in
      NavigateButton(model: model, title: "未知操作 " + id, path: "operations/" + id)
    }
    if let result = value.result { ResultView(model: model, value: result) }
    CommandButton(
      model: model, title: "取消执行", capability: "tasks", detail: value.id,
      enabled: [
        "CREATED", "WAIT_PRECONDITION", "READY", "DISPATCHING", "RUNNING", "WAIT_DECISION",
        "WAIT_AUTH",
      ].contains(value.state)
    ) { try .simple(.cancelExecution(value.id)) }
  }
}
struct ResultView: View {
  @ObservedObject var model: ManagementModel
  let value: MResult
  var body: some View {
    DetailText("结果", value.outcome + " · " + value.summary)
    DetailText("局限", value.limitations.joined(separator: "\n"))
    DetailText("验证", value.verified_by + " · " + value.observed_at)
    DetailText("仍需处理", value.needs_action ? "是" : "否")
    ForEach(value.artifact_ids, id: \.self) { id in
      NavigateButton(model: model, title: "产物 " + id, path: "artifacts/" + id)
    }
  }
}
