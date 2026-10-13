import SecretaryKit
import SwiftUI

struct AttentionListView: View {
  @ObservedObject var model: ManagementModel
  var body: some View {
    HStack {
      NavigateButton(model: model, title: "审批", path: "authorizations")
      NavigateButton(model: model, title: "工作决定", path: "decisions")
      NavigateButton(model: model, title: "未知结果", path: "operations")
      NavigateButton(model: model, title: "通知", path: "notifications")
    }
    if model.location.path == "authorizations", let page = model.decode(MAuthorizationPage.self) {
      if page.items.isEmpty { Text("暂无审批") }
      ForEach(page.items, id: \.id) { value in
        NavigateButton(
          model: model, title: value.state + " · " + value.id, path: "authorizations/" + value.id)
      }
      PageControls(model: model, cursor: page.next_cursor)
    } else if model.location.path == "decisions", let page = model.decode(MDecisionPage.self) {
      if page.items.isEmpty { Text("暂无工作决定") }
      ForEach(page.items, id: \.id) { value in
        NavigateButton(
          model: model, title: value.state + " · " + value.question, path: "decisions/" + value.id)
      }
      PageControls(model: model, cursor: page.next_cursor)
    } else if let page = model.decode(MOperationPage.self) {
      if page.items.isEmpty { Text("暂无操作记录") }
      ForEach(page.items, id: \.id) { value in
        NavigateButton(
          model: model,
          title: value.state + " · " + value.action.action + " · " + value.action.resource,
          path: "operations/" + value.id)
      }
      PageControls(model: model, cursor: page.next_cursor)
    }
  }
}
struct ApprovalDetailView: View {
  @ObservedObject var model: ManagementModel
  let value: MAuthorization
  var body: some View {
    DetailText("状态／版本", value.state + " · " + value.revision.rawValue)
    DetailText("实际操作及完整参数", value.display?.text)
    DetailText("显示指纹", value.display_hash)
    DetailText("批准有效期", value.expires_at ?? "未设定")
    DetailText(
      "执行范围",
      [value.scope.session_id, value.scope.task_id, value.scope.execution_id].compactMap { $0 }
        .joined(separator: "\n"))
    HStack {
      CommandButton(
        model: model, title: "批准一次", capability: "authorizations", detail: review,
        enabled: value.state == "PENDING"
      ) { try .approval(value, choice: .approve) }
      CommandButton(
        model: model, title: "拒绝", capability: "authorizations", detail: review,
        enabled: value.state == "PENDING"
      ) { try .approval(value, choice: .reject) }
      CommandButton(
        model: model, title: "撤销本次授权", capability: "authorizations",
        detail: review + "\n已记住的规则需要另行禁用。", enabled: value.state == "APPROVED"
      ) { try .approval(value, choice: .revoke) }
    }
    if let context = value.remember_context {
      Divider()
      Text("批准并记住").font(.headline)
      DetailText("适用根目录", context.root)
      if context.action == "shell.run", let tokens = context.tokens, !tokens.isEmpty {
        Picker("命令前缀（服务端 token）", selection: model.field("prefixTokens", fallback: "1")) {
          ForEach(1...tokens.count, id: \.self) { count in
            Text(tokens.prefix(count).joined(separator: " · ")).tag(String(count))
          }
        }
      } else if context.action == "file.write" {
        Picker("目录前缀", selection: model.field("pathPrefix", fallback: ".")) {
          ForEach(ManagementCommand.directoryPrefixes(context), id: \.self) { Text($0).tag($0) }
        }
      }
      TextField("规则到期时间（RFC3339，留空长期有效）", text: model.field("expires"))
      Text("以后匹配此根目录与前缀的操作可以免去本次审批。请确认覆盖范围和时效。")
      CommandButton(
        model: model, title: "批准并记住", capability: "authorizations",
        detail: review + "\n根目录：" + context.root + "\n范围：" + rememberedRange(context) + "\n时效："
          + (model.fields["expires"].flatMap { $0.isEmpty ? nil : $0 } ?? "长期有效"),
        enabled: value.state == "PENDING"
      ) {
        try .approval(
          value, choice: .approve,
          prefixTokens: context.action == "shell.run"
            ? Int(model.fields["prefixTokens"] ?? "1") : nil,
          pathPrefix: context.action == "file.write" ? model.fields["pathPrefix"] ?? "." : nil,
          expires: model.fields["expires"].flatMap { $0.isEmpty ? nil : $0 })
      }
    } else {
      Text("此操作不支持记住规则。")
    }
    if let id = value.remembered_rule_id { DetailText("已记住规则", id) }
    NavigateButton(model: model, title: "查看／禁用授权规则", path: "authorization-rules")
  }
  private var review: String {
    "版本：\(value.revision.rawValue)\n有效期：\(value.expires_at ?? "未设定")\n\(value.display?.text ?? "缺少操作展示")"
  }
  private func rememberedRange(_ c: MAuthorizationRememberContext) -> String {
    c.action == "shell.run"
      ? (c.tokens ?? []).prefix(Int(model.fields["prefixTokens"] ?? "1") ?? 1).joined(
        separator: " · ") : model.fields["pathPrefix"] ?? "."
  }
}
struct DecisionDetailView: View {
  @ObservedObject var model: ManagementModel
  let value: MDecision
  var body: some View {
    DetailText("问题", value.question)
    DetailText("状态", value.state)
    DetailText("影响", value.impact)
    DetailText("截止", value.deadline)
    ForEach(value.options, id: \.self) { option in Button(option) { model.set("answer", option) } }
    TextField("回答", text: model.field("answer"), axis: .vertical)
    DetailText("已记录回答", value.answer?.text)
    CommandButton(
      model: model, title: "提交工作决定", capability: "decisions",
      detail: value.question + "\n" + (model.fields["answer"] ?? ""), enabled: value.state == "OPEN"
    ) { try .answer(value.id, answer: model.fields["answer"] ?? "") }
  }
}
struct OperationDetailView: View {
  @ObservedObject var model: ManagementModel
  let value: MOperation
  var body: some View {
    DetailText("操作", value.action.action + " · " + value.action.resource)
    DetailText("状态／进程", value.state + " · " + (value.process_state ?? "无进程信息"))
    Picker("裁定结果", selection: model.field("outcome", fallback: "UNVERIFIED")) {
      Text("已产生作用 APPLIED").tag("APPLIED")
      Text("未产生作用 NOT_APPLIED").tag("NOT_APPLIED")
      Text("部分产生作用 PARTIAL").tag("PARTIAL")
      Text("仍无法确认 UNVERIFIED").tag("UNVERIFIED")
    }
    TextField("裁定备注（必填）", text: model.field("note"), axis: .vertical)
    CommandButton(
      model: model, title: "裁定未知结果…", capability: "tasks",
      detail:
        "\(value.action.action) · \(value.action.resource)\n裁定：\(model.fields["outcome"] ?? "UNVERIFIED")\n\(model.fields["note"] ?? "")\n受理后可能仍须等待进程停止或其他未知项。",
      enabled: ["RESULT_UNKNOWN", "UNKNOWN"].contains(value.state)
    ) {
      try .resolve(
        value,
        outcome: OperationOutcome(rawValue: model.fields["outcome"] ?? "UNVERIFIED") ?? .unverified,
        note: model.fields["note"] ?? "")
    }
    CommandButton(
      model: model, title: "验证文件写入", capability: "tasks", detail: value.action.resource,
      enabled: value.action.action == "file.write" && value.state == "RESULT_UNKNOWN"
    ) { try .simple(.verifyWrite(value.id)) }
    Divider()
    if let display = value.display {
      DetailText(
        "原始输出已截断", display.source_truncated.map { $0 ? "是：即使所有片段读完也不代表原输出完整" : "否" } ?? "未知")
      part("parameters", "参数", display.parameters)
      part("stdout", "已有输出", display.stdout)
      part("stderr", "错误输出", display.stderr)
      part("reason", "原因／裁定说明", display.reason)
    }
    if let resolution = value.resolution {
      DetailText("当前裁定", resolution.outcome + "\n" + resolution.note)
    }

  }
  @ViewBuilder private func part(_ key: String, _ title: String, _ initial: MOperationText)
    -> some View
  {
    let part = model.fragments[key] ?? initial
    DetailText(title, part.state == "available" ? part.text : part.unavailable_reason)
    if part.next_cursor != nil {
      Button("继续读取" + title) {
        Task { await model.moreOperation(key, initial: initial, id: value.id) }
      }
    }
    if part.truncated { Text("当前为分段内容，尚未读完").font(.caption) }
  }
}
