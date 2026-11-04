import { randomUUID } from "node:crypto";
import type { CoreClient } from "../core-client.ts";
import type { RequestStatus, Session } from "../api/contracts.ts";
type Client = Pick<CoreClient, "query" | "command">;

/** Explicit recovery only. Reconnect reconciles; it never creates another intent. */
export class ResumeController {
  pending?: {
    id: string;
    session: string;
    body: { request_id: string; expected_revision: string };
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
  async submit() {
    if (!this.client || this.busy) return;
    this.busy = true;
    const client = this.client;
    try {
      if (this.pending) {
        await this.reconcile();
        // A confirmed command is still running. A terminal command requires a new gesture.
        if (!this.pending || this.pending.accepted) return;
      }
      const session = await client.query<Session>("session");
      if (client !== this.client) return;
      if (!this.pending) {
        if (session.state !== "RECOVERY_BLOCKED") {
          this.hint =
            session.recovery_message || "Main 当前无需恢复；命令和草稿已保留";
          return;
        }
        const request = randomUUID();
        this.pending = {
          id: request,
          session: session.id,
          body: { request_id: request, expected_revision: session.revision },
          accepted: false,
        };
      }
      const p = this.pending;
      if (session.id !== p.session) throw Error("TUI_SESSION_MISMATCH");
      this.hint = "正在提交恢复；将继续原批次与排队输入";
      this.onChange();
      try {
        const receipt = await client.command("session/resume", p.body);
        if (receipt.request_id !== p.id || receipt.acceptance !== "ACCEPTED")
          throw Error("INVALID_RECEIPT");
        p.accepted = true;
      } catch (error) {
        this.hint =
          "恢复送达未确认；再次明确提交时使用原请求：" + String(error);
        if (
          error instanceof Error &&
          ["SESSION_CHANGED", "INVALID_REQUEST"].includes(error.message)
        ) {
          try {
            await client.query(`requests/${p.id}`);
          } catch (lookup) {
            if (lookup instanceof Error && lookup.message === "NOT_FOUND") {
              this.pending = undefined;
              this.hint =
                "会话状态已变化，本次恢复未接收；请查看 Main 状态后重新决定";
            }
          }
        }
      }
      await this.reconcile();
    } catch (error) {
      this.hint = "恢复状态未确认，草稿保留：" + String(error);
    } finally {
      this.busy = false;
      this.onChange();
    }
  }
  async reconcile(): Promise<void> {
    if (this.checking) return this.checking;
    const client = this.client,
      p = this.pending;
    if (!client || !p) return;
    this.checking = (async () => {
      try {
        const [status, session] = await Promise.all([
          client.query<RequestStatus>(`requests/${p.id}`),
          client.query<Session>("session"),
        ]);
        if (client !== this.client || p !== this.pending) return;
        if (session.id !== p.session) throw Error("TUI_SESSION_MISMATCH");
        p.accepted = true;
        const state = status.receipt.state;
        const result = status.result as {
          applied?: boolean;
          code?: string;
        } | null;
        const outcome =
          state === "UNKNOWN"
            ? "中断后结果未知，不自动重派"
            : result?.applied === false
              ? result.code === "MAIN_ACTIVE"
                ? "Main 正在执行或收尾维护，请稍后重新决定"
                : "会话已变化，未执行恢复"
              : state === "COMPLETED"
                ? "恢复命令完成；不代表业务已完成"
                : "恢复已接收，正在处理";
        this.hint = `${outcome}；Main 当前 ${session.state}。${session.recovery_message}`;
        if (["UNKNOWN", "COMPLETED"].includes(state)) this.pending = undefined;
      } catch {
        if (p === this.pending)
          this.hint = "恢复状态未确认；保留原请求，重连核对或明确同 ID 重试";
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
