import { randomUUID } from "node:crypto";
import type { CoreClient } from "../core-client.ts";
import type { RequestStatus, TaskRequestStatus } from "../api/contracts.ts";
type Client = Pick<CoreClient, "query" | "command">;
/** In-memory exact envelope: restart never silently replays a cancellation. */
export class CancelController {
  pending?: {
    id: string;
    target: string;
    kind: "request" | "execution";
    accepted: boolean;
  };
  hint = "";
  busy = false;
  onChange = () => {};
  private client?: Client;
  private domain = "";
  private checking?: Promise<void>;
  connect(client: Client, domain: string) {
    if (this.domain && this.domain !== domain)
      throw Error("TUI_DOMAIN_MISMATCH");
    this.client = client;
    this.domain = domain;
    void this.reconcile();
  }
  async submit(kind: "request" | "execution", target: string) {
    if (!this.client || this.busy) return;
    if (
      this.pending &&
      (this.pending.kind !== kind || this.pending.target !== target) &&
      !this.pending.accepted
    ) {
      this.hint = "原取消请求尚未确认；请用原目标同 ID 重试";
      this.onChange();
      return;
    }
    const fresh =
      !this.pending ||
      this.pending.kind !== kind ||
      this.pending.target !== target;
    if (fresh)
      this.pending = { id: randomUUID(), target, kind, accepted: false };
    const p = this.pending!,
      client = this.client;
    this.busy = true;
    this.hint = "正在提交精确目标取消";
    this.onChange();
    try {
      if (fresh)
        await client.query(
          `${kind === "request" ? "task-requests" : "executions"}/${target}`,
        );
      const r = await client.command(
        `${kind === "request" ? "task-requests" : "executions"}/${target}/cancel`,
        { request_id: p.id },
      );
      if (r.request_id !== p.id || r.acceptance !== "ACCEPTED")
        throw Error("INVALID_RECEIPT");
      p.accepted = true;
    } catch (e) {
      this.hint = "送达未确认；原目标同 ID 重试：" + String(e);
      if (
        ["NOT_FOUND", "INVALID_REQUEST", "INVALID_TARGET"].includes(
          e instanceof Error ? e.message : String(e),
        )
      ) {
        try {
          const status = await client.query<RequestStatus>(`requests/${p.id}`);
          p.accepted = status.receipt.acceptance === "ACCEPTED";
        } catch (statusError) {
          if (
            statusError instanceof Error &&
            statusError.message === "NOT_FOUND" &&
            this.pending === p
          ) {
            this.pending = undefined;
            this.hint = "取消未被接收，目标/参数无效；命令保留：" + String(e);
          }
        }
      }
    } finally {
      this.busy = false;
      await this.reconcile();
      this.onChange();
    }
  }
  async reconcile(): Promise<void> {
    if (this.checking) return this.checking;
    const p = this.pending,
      client = this.client;
    if (!p || !client) return;
    this.checking = (async () => {
      try {
        if (!p.accepted) {
          const receipt = await client.query<RequestStatus>(`requests/${p.id}`);
          p.accepted = receipt.receipt.acceptance === "ACCEPTED";
        }
        let reason: unknown = null;
        let state: string,
          execution: string | null = p.kind === "execution" ? p.target : null;
        if (p.kind === "request") {
          const r = await client.query<TaskRequestStatus>(
            `task-requests/${p.target}`,
          );
          state = r.state;
          reason = r.reason;
          execution = r.execution_id;
        } else state = "";
        if (execution)
          state = (
            await client.query<{ state: string }>(`executions/${execution}`)
          ).state;
        if (this.pending !== p || client !== this.client) return;
        this.hint =
          `取消请求 ${p.id}：${p.accepted ? "已接收" : "未确认"}；目标当前 ${state}。${reason == null ? "" : " 原因：" + JSON.stringify(reason) + "。"}` +
          (["CANCEL_REQUESTED", "RESULT_UNKNOWN"].includes(state)
            ? " 尚未证明取消完成。"
            : " 当前状态不证明由本次取消造成。") +
          " 周期任务的未来调度不变。";
      } catch (e) {
        if (this.pending === p)
          this.hint = `取消请求 ${p.id}：${p.accepted ? "已接收；目标状态待核对" : "送达未确认；同 ID 重试"}：${String(e)}`;
      }
      this.onChange();
    })().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }
  stop() {
    this.client = undefined;
  }
}
