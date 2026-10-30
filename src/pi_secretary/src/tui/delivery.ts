import { randomUUID } from "node:crypto";
import type { CoreClient } from "../core-client.ts";
import type { Receipt, RequestStatus } from "../api/contracts.ts";
import type { Page } from "./input.ts";
import type { LocalState, StatePersistence, Pending } from "./state.ts";

export type DeliveryClient = Pick<
  CoreClient,
  "endpoint" | "core" | "query" | "command" | "syncCursor" | "changes"
>;
export type DeliveryEvent = { type: string; at: number; id?: string };
/** No network/persistence await in edit or render. Only sends have a single-flight guard. */
export class Delivery {
  client?: DeliveryClient;
  hint = "";
  busy = false;
  failedSave = false;
  private statusJob?: Promise<void>;
  private restoreRequested?: string;
  private restoredId?: string;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private settlement: Promise<void> = Promise.resolve();
  onChange = () => {};
  onEvent = (event: DeliveryEvent) => {};
  constructor(
    readonly state: LocalState,
    readonly files: StatePersistence,
  ) {}
  private event(type: string, id?: string) {
    this.onEvent({ type, at: performance.now(), id });
  }
  edit(page: Page, raw: string) {
    const d = this.state.drafts[page];
    if (d.raw === raw) return;
    this.state.drafts[page] = { raw, generation: d.generation + 1 };
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 300);
    this.event("edit");
  }
  async flush() {
    clearTimeout(this.saveTimer);
    try {
      await this.files.save(this.state);
      this.failedSave = false;
    } catch (e) {
      this.failedSave = true;
      this.hint = "草稿保存失败，保留原文：" + String(e);
      this.onChange();
      throw e;
    }
  }
  async connect(client: DeliveryClient) {
    const core = await client.core();
    if (
      core.data_domain_id !== this.state.domain ||
      core.mode !== this.state.mode ||
      core.instance_id !== client.endpoint.instance_id
    )
      throw Error("TUI_DOMAIN_MISMATCH");
    this.client = client;
  }
  async reconcile(restore = false): Promise<void> {
    if (restore && this.state.pending)
      this.restoreRequested = this.state.pending.id;
    if (this.statusJob)
      return this.statusJob.then(() => {
        // A reconnect can change clients while the coalesced read is in flight.
        if (restore && this.restoreRequested && !this.busy && !this.closed)
          return this.reconcile(true);
      });
    const client = this.client,
      p = this.state.pending;
    if (!client || !p || this.closed) return;
    if (p.status === "CONFLICT") {
      this.hint = "请求身份冲突；保留原记录，不自动换 ID";
      this.onChange();
      return;
    }
    if (p.status === "ACCEPTED") return this.accept(p);
    this.statusJob = this.check(client, p).finally(() => {
      this.statusJob = undefined;
    });
    return this.statusJob;
  }
  private async check(client: DeliveryClient, p: Pending) {
    this.event("reconcile-start", p.id);
    try {
      const receipt = await client.query<RequestStatus>(`requests/${p.id}`, {
        timeoutMs: 2000,
      });
      if (this.client !== client || this.state.pending !== p || this.closed)
        return;
      if (
        receipt.receipt.request_id !== p.id ||
        receipt.receipt.acceptance !== "ACCEPTED"
      )
        throw Error("INVALID_RECEIPT");
      await this.accept(p);
    } catch (e) {
      if (this.client !== client || this.state.pending !== p || this.closed)
        return;
      // A negative read is not a timeout/cancellation barrier.
      if (
        String(e) === "Error: NOT_FOUND" &&
        !p.attempts.includes(client.endpoint.instance_id) &&
        p.cursor &&
        !this.busy &&
        p.status !== "CONFLICT"
      ) {
        try {
          await client.changes(p.cursor, 1);
          if (this.client === client && this.state.pending === p && !this.busy)
            await this.release(p, "已确认旧实例未接收，可修改或重新发送");
        } catch {
          this.hint = "存储连续性未确认，保留原请求";
        }
      } else
        this.hint =
          p.status === "CONFLICT"
            ? "请求身份冲突；保留原记录，不自动换 ID"
            : "送达未确认；原文明确提交可同 ID 重试，其他消息暂缓";
    } finally {
      if (
        this.restoreRequested === p.id &&
        !this.busy &&
        this.client === client &&
        this.state.pending === p &&
        !this.closed &&
        p.status === "UNKNOWN"
      ) {
        this.restoreRequested = undefined;
        if (this.restoredId !== p.id) {
          this.restoredId = p.id;
          if (!this.state.drafts.Main.raw) {
            this.state.drafts.Main = {
              raw: p.raw,
              generation: this.state.drafts.Main.generation + 1,
              binding: p.id,
            };
            await this.flush();
          }
        }
      }
      this.event("reconcile-end", p.id);
      this.onChange();
    }
  }
  async submit(raw: string, text: string) {
    if (this.busy || this.closed) {
      this.hint = "正在发送/保存；仍可编辑和切页";
      this.onChange();
      return;
    }
    const client = this.client;
    if (!client) {
      this.hint = "Core 未连接，草稿保留";
      this.onChange();
      return;
    }
    this.busy = true;
    this.event("submit");
    const submittedGeneration = this.state.drafts.Main.generation;
    try {
      let p = this.state.pending;
      if (p) {
        // A bounded read-only check cannot hold the editor/navigation path.
        await this.reconcile();
        if (this.state.pending !== p) {
          this.hint = "原请求已对账；请确认当前草稿后再次明确提交";
          return;
        }
        if (p.status === "CONFLICT" || text !== p.body.text) {
          this.hint = "原请求未解决；新草稿已保留，不会重发旧正文";
          return;
        }
      } else {
        const body = { request_id: randomUUID(), text };
        if (
          !text.trim() ||
          text.length > 1048576 ||
          Buffer.byteLength(text) > 1048576 ||
          Buffer.byteLength(JSON.stringify(body)) > 1048576
        )
          throw Error("REQUEST_TOO_LARGE_OR_EMPTY");
        p = {
          id: body.request_id,
          raw,
          body,
          created_at: new Date().toISOString(),
          attempts: [],
          status: "UNKNOWN",
        };
        this.state.pending = p;
      }
      if (this.client !== client) throw Error("CORE_CONNECTION_CHANGED");
      // Capture attempt identity before dispatch. Each retry changes proof eligibility.
      if (!p.attempts.includes(client.endpoint.instance_id))
        p.attempts.push(client.endpoint.instance_id);
      p.cursor = undefined;
      await this.flush();
      this.event("durable", p.id);
      const d = this.state.drafts.Main;
      if (
        d.raw === raw &&
        d.generation === submittedGeneration &&
        d.binding !== p.id
      ) {
        this.state.drafts.Main = { raw: "", generation: d.generation + 1 };
        await this.flush();
      }
      this.hint = "已提交本地记录，等待 Core 接收；可继续编辑/切页";
      this.onChange();
      this.event("post-start", p.id);
      try {
        const attempt = client.command("messages", p.body);
        // Start after POST dispatch; cursor acquisition never holds submission.
        void client
          .syncCursor()
          .then(async (c) => {
            if (
              this.client === client &&
              this.state.pending === p &&
              !this.closed
            ) {
              p.cursor = c.cursor;
              await this.flush();
            }
          })
          .catch(() => {});
        const receipt: Receipt = await attempt;
        this.event("receipt", p.id);
        if (this.client !== client || this.state.pending !== p || this.closed)
          return;
        if (receipt.acceptance !== "ACCEPTED" || receipt.request_id !== p.id)
          throw Error("INVALID_RECEIPT");
        await this.accept(p);
      } catch (e) {
        if (this.state.pending !== p || this.closed) return;
        const code = e instanceof Error ? e.message : String(e);
        if (
          [
            "INVALID_REQUEST",
            "INVALID_INPUT",
            "INVALID_JSON",
            "REQUEST_TOO_LARGE",
          ].includes(code)
        )
          await this.release(p, "Core 拒绝输入；原文已保留");
        else {
          p.status = code === "REQUEST_CONFLICT" ? "CONFLICT" : "UNKNOWN";
          this.hint = `${code}；原请求保留，稍后对账`;
          await this.flush();
        }
      }
    } catch (e) {
      this.hint = "发送未完成，原文保留：" + String(e);
    } finally {
      this.busy = false;
      if (this.state.pending?.status === "UNKNOWN")
        void this.reconcile(true).catch((e) => {
          this.hint = "原文恢复保存失败：" + String(e);
          this.onChange();
        });
      this.event("submit-end");
      this.onChange();
    }
  }
  private accept(p: Pending) {
    const job = this.settlement
      .catch(() => {})
      .then(() => this.acceptCheckpoint(p));
    this.settlement = job;
    return job;
  }
  private async acceptCheckpoint(p: Pending) {
    if (this.state.pending !== p) return;
    p.status = "ACCEPTED";
    delete this.state.recovery;
    const d = this.state.drafts.Main;
    if (d.binding === p.id && d.raw === p.raw)
      this.state.drafts.Main = { raw: "", generation: d.generation + 1 };
    // First checkpoint retains the body and acceptance fact for disk-error recovery.
    await this.flush();
    delete this.state.pending;
    try {
      await this.flush();
    } catch (e) {
      this.state.pending = p;
      throw e;
    }
    this.hint = "Core 已可靠接收；业务是否完成以会话结果为准";
  }
  private async release(p: Pending, message: string) {
    const file = await this.files.recover(p);
    if (this.state.pending !== p) return;
    this.state.recovery = { id: p.id, file };
    if (!this.state.drafts.Main.raw)
      this.state.drafts.Main = {
        raw: p.raw,
        generation: this.state.drafts.Main.generation + 1,
      };
    delete this.state.pending;
    try {
      await this.flush();
    } catch (e) {
      this.state.pending = p;
      throw e;
    }
    this.hint = message + "；恢复文件 " + file;
  }
  async close() {
    await this.flush();
    this.closed = true;
  }
}
