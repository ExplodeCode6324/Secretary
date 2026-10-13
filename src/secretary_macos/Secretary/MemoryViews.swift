import SecretaryKit
import SwiftUI

struct MemoryManagementView: View {
  @ObservedObject var model: ManagementModel
  let source: (String) -> Void
  var body: some View {
    HStack {
      NavigateButton(model: model, title: "维护状态", path: "memory")
      NavigateButton(model: model, title: "记忆摘要", path: "memory/summary")
      NavigateButton(model: model, title: "承诺", path: "memory/commitments")
    }
    if model.location.path == "memory", let value = model.decode(MMemoryStatus.self) {
      DetailText("状态", value.state)
      DetailText("维护模式", value.maintenance_mode)
      DetailText("最后成功", value.last_success_at)
      DetailText("下一次自动尝试", value.next_attempt_at ?? "未安排")
      DetailText("诊断", value.errors.joined(separator: "\n"))
      DetailText("待处理来源字节", value.pending_source_bytes.rawValue)
      ForEach(value.extraction ?? [], id: \.id) { job in
        DetailText(
          "提取 " + job.id,
          job.state + " · 第 \(job.round) 轮 · " + (job.next_attempt_at ?? "无下次时间") + "\n"
            + (job.error ?? ""))
      }
      CommandButton(
        model: model, title: "压缩会话记忆", capability: "memory", detail: "由 Core 处理当前会话的记忆维护。"
      ) { try .simple(.compact) }
      CommandButton(
        model: model, title: "重试已停止的提取", capability: "memory",
        detail: "由 Core 判断可重试的提取；不会恢复旧 binding。"
      ) { try .simple(.retryExtraction) }
      CommandButton(
        model: model, title: "恢复会话", capability: "memory", detail: "请求 Core 恢复当前停止的会话。仍受后端恢复条件限制。"
      ) { try .simple(.resume) }
    } else if model.location.path == "memory/summary", let page = model.decode(MMemoryPage.self) {
      if page.items.isEmpty { Text("暂无记忆摘要") }
      ForEach(page.items, id: \.item_id) { item in
        DetailText(item.tier, item.summary)
        DetailText("目标", item.goals.joined(separator: "\n"))
        DetailText("约束", item.constraints.joined(separator: "\n"))
        DetailText("决定", item.decisions.joined(separator: "\n"))
        DetailText("未决问题", item.open_questions.joined(separator: "\n"))
        sources(item.sources)
        ForEach(item.task_ids, id: \.self) { id in
          NavigateButton(model: model, title: "关联任务 " + id, path: "tasks/" + id)
        }
        Divider()
      }
      PageControls(model: model, cursor: page.next_cursor)
    } else if let page = model.decode(MCommitmentPage.self) {
      if page.items.isEmpty { Text("暂无承诺") }
      ForEach(page.items, id: \.id) { item in
        DetailText(item.state, item.text)
        sources(item.sources)
        ForEach(item.task_ids, id: \.self) { id in
          NavigateButton(model: model, title: "关联任务 " + id, path: "tasks/" + id)
        }
        ForEach(
          item.source_event_ids.filter { id in !item.sources.flatMap(\.event_ids).contains(id) },
          id: \.self
        ) { id in Button("返回来源 " + id) { source(id) } }
        TextField("人工处理备注", text: model.field("note-" + item.id), axis: .vertical)
        HStack {
          CommandButton(
            model: model, title: "标记完成", capability: "memory", detail: item.text,
            enabled: item.state == "OPEN"
          ) {
            try .commitment(item.id, completed: true, note: model.fields["note-" + item.id] ?? "")
          }
          CommandButton(
            model: model, title: "取消承诺", capability: "memory", detail: item.text,
            enabled: item.state == "OPEN"
          ) {
            try .commitment(item.id, completed: false, note: model.fields["note-" + item.id] ?? "")
          }
        }
        Divider()
      }
      PageControls(model: model, cursor: page.next_cursor)
    }
  }
  @ViewBuilder private func sources(_ values: [MSource]) -> some View {
    ForEach(Array(values.enumerated()), id: \.offset) { _, value in
      if value.event_ids.isEmpty { Text("来源定位不可用 · " + value.locator_state).font(.caption) }
      ForEach(value.event_ids, id: \.self) { id in
        Button("返回来源 " + id) { source(id) }.buttonStyle(.link)
      }
    }
  }
}
