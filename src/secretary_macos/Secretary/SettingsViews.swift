import SecretaryKit
import SwiftUI

struct SettingsManagementView: View {
  @ObservedObject var model: ManagementModel
  var body: some View {
    HStack {
      NavigateButton(model: model, title: "World", path: "world/catalog")
      NavigateButton(model: model, title: "Scope", path: "scopes")
      NavigateButton(model: model, title: "授权规则", path: "authorization-rules")
      NavigateButton(model: model, title: "名称", path: "assistant")
    }
    if let value = model.decode(MSettings.self) {
      DisclosureGroup("有效说明 · 版本 " + value.effective_instructions.revision) {
        DetailText("当前生效", value.effective_instructions.content)
      }
      DisclosureGroup("Core 共享草稿 · 版本 " + value.draft.revision.rawValue) {
        DetailText("已保存内容", value.draft.payload.text)
      }
      DetailText("应用条件", value.blocked ? "被阻塞，请查看应用状态" : "未阻塞")
      if model.fields["revision"] != value.draft.revision.rawValue {
        Text("共享草稿版本已变化，本地编辑保留。请对照后明确选择版本。")
        Button("采用最新版本号（保留本地编辑）") { model.adoptRevision() }
      }
      Text("本地说明编辑").font(.headline)
      TextEditor(text: model.field("instructions")).frame(minHeight: 150).accessibilityIdentifier(
        "instructionsEditor")
      Text("本地 World 待保存编辑：\(model.payload["edits"].array.count) 项")
      ForEach(Array(model.payload["edits"].array.enumerated()), id: \.offset) { index, edit in
        DetailText("编辑 \(index + 1)", edit.text)
        Button("移除此项") {
          var p = model.payload.object
          var edits = model.payload["edits"].array
          edits.remove(at: index)
          p["edits"] = .array(edits)
          model.payload = .object(p)
          model.persist()
        }
      }
      WorldEditForm(model: model, available: value.world_available)
      CommandButton(
        model: model, title: "保存共享草稿", capability: "settings",
        detail: "说明：\n" + (model.fields["instructions"] ?? "") + "\nWorld 修改：\n"
          + model.payload["edits"].text + "\n保存后尚未应用。"
      ) {
        let instructionRevision = try DecimalString(model.fields["instructionsRevision"] ?? "")
        let instructions: JSONValue = .object([
          "content": .string(model.fields["instructions"] ?? ""),
          "expected_revision": .string(instructionRevision.rawValue),
        ])
        return try .saveSettings(
          revision: DecimalString(model.fields["revision"] ?? ""),
          payload: .object([
            "instructions": instructions, "edits": model.payload["edits"],
            "command_ids": .array([]),
          ]))
      }
      CommandButton(
        model: model, title: "应用 Core 已保存草稿", capability: "settings",
        detail: "应用共享版本 \(value.draft.revision.rawValue)\n" + value.draft.payload.text,
        enabled: !value.blocked
      ) { try .revision(.apply, value.draft.revision) }
      Text("应用记录").font(.headline)
      ForEach(value.applications, id: \.id) { application in
        DetailText(application.state + " · " + application.id, application.error ?? "无错误说明")
        HStack {
          CommandButton(
            model: model, title: "重试应用", capability: "settings", detail: application.id,
            enabled: ["FAILED", "BLOCKED"].contains(application.state)
          ) { try .simple(.retryApplication(application.id)) }
          CommandButton(
            model: model, title: "恢复为共享草稿", capability: "settings",
            detail: "将应用内容恢复到共享草稿。当前版本：\(value.draft.revision.rawValue)\n本地编辑会保留。",
            enabled: application.state == "FAILED"
          ) { try .revision(.restore(application.id), value.draft.revision) }
        }
      }
    }
  }
}
struct ScopeListView: View {
  @ObservedObject var model: ManagementModel
  var body: some View {
    NavigateButton(model: model, title: "创建 Scope", path: "new-scope")
    if let page = model.decode(MScopePage.self) {
      if page.items.isEmpty { Text("暂无 Scope") }
      ForEach(page.items, id: \.id) { scope in
        NavigateButton(
          model: model, title: scope.name + " · " + scope.state, path: "scopes/" + scope.id)
        DetailText("根／默认写策略", (scope.root_path ?? "无目录") + " · " + (scope.default_write ?? "未知"))
      }
      PageControls(model: model, cursor: page.next_cursor)
    }
  }
}
struct ScopeEditor: View {
  @ObservedObject var model: ManagementModel
  let scope: MScope?
  var body: some View {
    if let scope { DetailText("状态／版本", scope.state + " · " + scope.revision.rawValue) }
    TextField("Scope 名称", text: model.field("name")).accessibilityIdentifier("scopeName")
    TextField("说明", text: model.field("description"), axis: .vertical)
    HStack {
      TextField("根目录（空白表示无目录）", text: model.field("root"))
      Button("选择根目录…") { model.chooseFolder("root") }
    }
    TextField("笔记路径（可选）", text: model.field("notes"))
    Picker("默认写策略", selection: model.field("write", fallback: "ask")) {
      Text("询问 ask").tag("ask")
      Text("允许 allow").tag("allow")
    }
    if let scope, model.fields["revision"] != scope.revision.rawValue {
      Text("版本冲突：本地输入保留。")
      Button("采用最新版本号（保留本地编辑）") { model.adoptRevision() }
    }
    CommandButton(
      model: model, title: scope == nil ? "创建 Scope" : "保存 Scope", capability: "scopes",
      detail:
        "\(model.fields["name"] ?? "")\n根：\(model.fields["root"] ?? "无目录")\n默认写策略：\(model.fields["write"] ?? "ask")",
      enabled: scope == nil || scope?.state == "ACTIVE"
    ) {
      try .scope(
        id: scope?.id, revision: scope == nil ? nil : DecimalString(model.fields["revision"] ?? ""),
        name: model.fields["name"] ?? "", description: model.fields["description"] ?? "",
        root: model.fields["root"].flatMap { $0.isEmpty ? nil : $0 },
        notes: model.fields["notes"].flatMap { $0.isEmpty ? nil : $0 },
        defaultWrite: model.fields["write"] ?? "ask")
    }
    if let scope {
      CommandButton(
        model: model, title: "归档 Scope", capability: "scopes", detail: scope.name,
        enabled: scope.state == "ACTIVE"
      ) { try .revision(.archiveScope(scope.id), scope.revision) }
    }
  }
}
struct RulesManagementView: View {
  @ObservedObject var model: ManagementModel
  var body: some View {
    Text("规则只通过审批中的“批准并记住”创建；禁用规则不会撤销已执行的作用。")
    if let page = model.decode(MRulePage.self) {
      ForEach(page.builtin_policies, id: \.id) { policy in
        DetailText("内建策略 " + policy.id, policy.description)
        DetailText("匹配", String(policy.match_count) + " 次 · " + (policy.last_matched_at ?? "尚未匹配"))
      }
      if page.items.isEmpty { Text("暂无用户授权规则；内建策略仍由 Core 执行。") }
      ForEach(page.items, id: \.id) { rule in
        DetailText(rule.state + " · " + rule.id, rule.actions.joined(separator: ", "))
        DetailText("资源范围", rule.resource_prefixes.joined(separator: "\n"))
        DetailText("匹配约束", rule.constraints.text)
        DetailText("时效", rule.valid_from + " → " + (rule.expires_at ?? "长期有效"))
        DetailText("匹配", String(rule.match_count) + " 次 · " + (rule.last_matched_at ?? "尚未匹配"))
        CommandButton(
          model: model, title: "禁用规则", capability: "administration",
          detail: rule.resource_prefixes.joined(separator: "\n") + "\n" + rule.constraints.text,
          enabled: rule.state == "ACTIVE"
        ) { try .revision(.disableRule(rule.id), rule.revision) }
        Divider()
      }
      PageControls(model: model, cursor: page.next_cursor)
    }
  }
}
struct ProfileManagementView: View {
  @ObservedObject var model: ManagementModel
  var body: some View {
    Text("名称独立保存，不触发说明或记忆重建；空白显示 secretary。")
    if let profile = model.decode(MProfile.self) {
      DetailText("Core 当前名称", profile.name)
      TextField("助手名称", text: model.field("name"))
      if model.fields["revision"] != profile.revision.rawValue {
        Button("采用最新版本号（保留本地编辑）") { model.adoptRevision() }
      }
      CommandButton(
        model: model, title: "保存名称", capability: "assistant_profile",
        detail: model.fields["name"] ?? "secretary"
      ) {
        try .profile(
          name: model.fields["name"] ?? "", revision: DecimalString(model.fields["revision"] ?? ""))
      }
    }
  }
}
