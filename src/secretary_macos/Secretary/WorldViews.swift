import SecretaryKit
import SwiftUI

struct WorldManagementView: View {
  @ObservedObject var model: ManagementModel
  var body: some View {
    if let reason = model.unavailable("world") { Text(reason) }
    HStack {
      NavigateButton(
        model: model, title: "实体目录", path: "world/catalog", query: ["kind": "entities"])
      NavigateButton(
        model: model, title: "谓词目录", path: "world/catalog", query: ["kind": "predicates"])
      NavigateButton(model: model, title: "来源目录", path: "world/catalog", query: ["kind": "sources"])
      NavigateButton(model: model, title: "当前事实", path: "world/facts")
      NavigateButton(model: model, title: "历史事实", path: "world/facts", query: ["history": "true"])
      NavigateButton(model: model, title: "草稿编辑", path: "settings")
    }
    TextField("Subject ID（精确查询）", text: model.field("subject"))
    TextField("Predicate key", text: model.field("predicate"))
    TextField("Scope key", text: model.field("scopeKey"))
    Button("查询精确 Slot") {
      Task {
        await model.navigate(
          .init(
            path: "world/slot",
            query: [
              "subject": model.fields["subject"] ?? "",
              "predicate": model.fields["predicate"] ?? "", "scope": model.fields["scopeKey"] ?? "",
            ], title: "World Slot"))
      }
    }.disabled(!model.allowed("world"))
    Button("筛选事实") {
      var query = model.location.query.filter { ["history"].contains($0.key) }
      if let subject = model.fields["subject"], !subject.isEmpty { query["subject"] = subject }
      if let predicate = model.fields["predicate"], !predicate.isEmpty {
        query["predicate"] = predicate
      }
      Task { await model.navigate(.init(path: "world/facts", query: query, title: "World 事实")) }
    }.disabled(!model.allowed("world"))
    if let page = model.decode(MWorldPage.self) {
      DetailText("World 版本", page.world_version.rawValue)
      if page.items.isEmpty { Text("暂无记录") }
      ForEach(Array(page.items.enumerated()), id: \.offset) { _, item in
        DetailText("记录", item.text)
        Divider()
      }
      PageControls(model: model, cursor: page.next_cursor)
    } else if let page = model.decode(MWorldSlot.self) {
      if let slot = page.slot {
        DetailText("Slot", slot.slot_id)
        DetailText("版本", slot.revision)
        DetailText("键", slot.subject_id + " / " + slot.predicate_key + " / " + slot.scope_key)
      } else {
        Text("Slot 不存在；新增时 expected_revision 为 0")
      }
    }
  }
}
struct WorldEditForm: View {
  @ObservedObject var model: ManagementModel
  let available: Bool
  var body: some View {
    DisclosureGroup("添加 World 修改到本地草稿") {
      VStack(alignment: .leading, spacing: 8) {
        if !available { Text("WORLD_NOT_CONFIGURED · 可继续编辑说明") }
        Picker("类型", selection: model.field("worldKind", fallback: "FACT")) {
          Text("事实").tag("FACT")
          Text("实体").tag("ENTITY")
        }
        TextField("预期版本（新增 0）", text: model.field("worldRevision", fallback: "0"))
        if model.fields["worldKind"] == "ENTITY" {
          TextField("实体 ID（留空生成新 ID）", text: model.field("entityID"))
          Picker("实体类型", selection: model.field("entityKind", fallback: "PERSON")) {
            ForEach(
              ["PERSON", "ORGANIZATION", "PROJECT", "DEVICE", "SERVICE", "RESOURCE", "GOAL"],
              id: \.self
            ) { Text($0).tag($0) }
          }
          TextField("显示名称", text: model.field("entityName"))
          TextField("别名（每行一项）", text: model.field("aliases"), axis: .vertical)
          TextField("外部键（可选）", text: model.field("externalKey"))
          Toggle(
            "退役实体",
            isOn: Binding(
              get: { model.fields["retire"] == "true" }, set: { model.set("retire", String($0)) }))
        } else {
          Picker("方式", selection: model.field("worldMode", fallback: "ASSERT")) {
            Text("新增 ASSERT").tag("ASSERT")
            Text("更正 CORRECT").tag("CORRECT")
            Text("撤回 RETRACT").tag("RETRACT")
          }
          TextField("Subject ID", text: model.field("subjectID"))
          TextField("Predicate key", text: model.field("predicateKey"))
          TextField("Scope key", text: model.field("scopeKey"))
          TextField("Assertion ID（更正／撤回目标）", text: model.field("assertionID"))
          Picker("值类型", selection: model.field("valueKind", fallback: "text")) {
            Text("文字").tag("text")
            Text("数值").tag("number")
            Text("布尔").tag("boolean")
            Text("实体引用").tag("entity")
          }
          TextField("值（布尔填 true/false；实体填 ID）", text: model.field("worldValue"), axis: .vertical)
          TextField("生效时间（RFC3339 UTC，可选）", text: model.field("validFrom"))
          TextField("失效时间（可选）", text: model.field("validTo"))
          TextField("新鲜度截至（可选）", text: model.field("freshUntil"))
          TextField("解决冲突 ID（可选）", text: model.field("conflictID"))
          TextField("处理说明", text: model.field("resolutionNote"))
        }
        Button("加入本地草稿") { append() }.disabled(!available || model.hasUnresolvedCommand)
      }.padding(.vertical, 8)
    }
  }
  private func append() {
    do {
      let f = model.fields
      let revision = try DecimalString(f["worldRevision"] ?? "0")
      var edit: [String: JSONValue] = [
        "kind": .string(f["worldKind"] ?? "FACT"), "expected_revision": .string(revision.rawValue),
      ]
      if f["worldKind"] == "ENTITY" {
        guard !(f["entityName"] ?? "").isEmpty else { throw ClientError.invalidContract }
        edit.merge([
          "entity_id": .string(
            f["entityID"].flatMap { $0.isEmpty ? nil : $0 } ?? UUID().uuidString.lowercased()),
          "entity_kind": .string(f["entityKind"] ?? "PERSON"),
          "display_name": .string(f["entityName"] ?? ""), "aliases": .strings(lines(f["aliases"])),
          "retire": .bool(f["retire"] == "true"),
        ]) { _, new in new }
        if let key = f["externalKey"], !key.isEmpty { edit["external_key"] = .string(key) }
      } else {
        guard UUID(uuidString: f["subjectID"] ?? "") != nil, !(f["predicateKey"] ?? "").isEmpty
        else { throw ClientError.invalidContract }
        edit.merge([
          "mode": .string(f["worldMode"] ?? "ASSERT"), "subject_id": .string(f["subjectID"] ?? ""),
          "predicate_key": .string(f["predicateKey"] ?? ""),
          "scope_key": .string(f["scopeKey"] ?? ""),
        ]) { _, new in new }
        let value = f["worldValue"] ?? ""
        switch f["valueKind"] ?? "text" {
        case "number":
          guard
            value.range(
              of: #"^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$"#, options: .regularExpression)
              != nil,
            let number = Decimal(string: value, locale: Locale(identifier: "en_US_POSIX")),
            !number.isNaN
          else { throw ClientError.invalidContract }
          edit["value"] = .number(number)
        case "boolean":
          guard ["true", "false"].contains(value) else { throw ClientError.invalidContract }
          edit["value"] = .bool(value == "true")
        case "entity":
          guard UUID(uuidString: value) != nil else { throw ClientError.invalidContract }
          edit["object_entity_id"] = .string(value)
        default: edit["value"] = .string(value)
        }
        for (field, key) in [
          ("assertionID", "assertion_id"), ("validFrom", "valid_from"), ("validTo", "valid_to"),
          ("freshUntil", "fresh_until"), ("conflictID", "resolve_conflict_id"),
          ("resolutionNote", "resolution_note"),
        ] {
          if let value = f[field], !value.isEmpty { edit[key] = .string(value) }
        }
      }
      var payload = model.payload.object
      var edits = model.payload["edits"].array
      guard edits.count < 100 else { throw ClientError.responseTooLarge }
      edits.append(.object(edit))
      payload["edits"] = .array(edits)
      payload["command_ids"] = .array([])
      model.payload = .object(payload)
      model.persist()
      model.commandStatus = "World 修改已加入本地草稿，尚未保存或应用"
    } catch { model.commandStatus = "World 参数不完整，修改尚未加入" }
  }
}
