import { randomUUID } from "node:crypto";
import type {
  Authorization,
  Decision,
  MasterAttentionItem,
  RequestStatus,
} from "../api/contracts.ts";
import type { CoreClient } from "../core-client.ts";
import type { Page } from "./input.ts";
import { attentionLabel } from "./attention.ts";
import { visibleMatterText } from "./view.ts";

type Client = Pick<CoreClient, "query" | "command">;
export type Matter = {
  id: string;
  kind: "authorization" | "decision" | "exception";
  origin: Page;
  route: string;
  version: string;
  data: Record<string, unknown>;
  title: string;
  text: string;
  options: string[];
  expires: string | null;
};
type Pending = {
  id: string;
  item: string;
  route: string;
  body: { request_id: string; [key: string]: unknown };
  kind: "authorization" | "decision";
  detailRoute: string;
  domain: string;
};
const invalid =
  /NOT_FOUND|NOT_OPEN|EXPIRED|STALE|APPROVAL_CONFLICT|INVALID_TRANSITION/;
const code = (e: unknown) => (e instanceof Error ? e.message : String(e));
const printable = (x: unknown) => JSON.stringify(x, null, 2) ?? "";
/** Directed business actions never use Main delivery or the ordinary command parser. */
export class MatterController {
  current?: Matter;
  loading = false;
  busy = false;
  pending?: Pending;
  hint = "";
  onChange = () => {};
  onExit = (
    origin: Page,
    result: "success" | "invalid" | "escape",
    message: string,
  ) => {};
  private client?: Client;
  private domain = "";
  private origin?: Page;
  private opening?: { id: string; origin: Page; row?: MasterAttentionItem };
  private generation = 0;
  private checking?: Promise<void>;
  private expiry?: ReturnType<typeof setTimeout>;
  connect(client: Client, domain: string) {
    if (this.domain && this.domain !== domain)
      throw Error("TUI_DOMAIN_MISMATCH");
    this.domain = domain;
    this.client = client;
    this.generation++;
    if (this.loading && this.opening) {
      const { id, origin, row } = this.opening;
      void this.open(id, origin, row);
    }
  }
  get text() {
    return this.current?.text ?? "读取事项…";
  }
  async open(id: string, origin: Page, row?: MasterAttentionItem) {
    const client = this.client;
    if (!client) return;
    this.origin = origin;
    this.opening = { id, origin, row };
    const gen = ++this.generation;
    this.loading = true;
    this.hint = "";
    this.current = undefined;
    this.onChange();
    try {
      let route = row?.detail_route ?? `authorizations/${id}`;
      let data: Record<string, unknown>;
      try {
        data = await client.query(route);
      } catch (e) {
        if (row || code(e) !== "NOT_FOUND") throw e;
        route = `decisions/${id}`;
        data = await client.query(route);
      }
      if (gen !== this.generation || client !== this.client) return;
      if (data.id !== id) throw Error("MATTER_ID_MISMATCH");
      const kind = route.startsWith("authorizations/")
        ? "authorization"
        : route.startsWith("decisions/")
          ? "decision"
          : "exception";
      const expires = (
        kind === "authorization"
          ? data.expires_at
          : kind === "decision"
            ? data.deadline
            : null
      ) as string | null;
      if (
        (expires && Date.parse(expires) <= Date.now()) ||
        (kind === "authorization" && data.state !== "PENDING") ||
        (kind === "decision" && data.state !== "OPEN")
      )
        throw Error("MATTER_NOT_OPEN");
      let ownerText = "";
      const scope = data.scope as Authorization["scope"] | undefined;
      const executionID =
        kind === "decision" ? String(data.execution_id) : scope?.execution_id;
      if (executionID) {
        const e = await client.query<Record<string, unknown>>(
          `executions/${executionID}`,
        );
        if (gen !== this.generation || client !== this.client) return;
        if (kind === "decision" && e.state !== "WAIT_DECISION")
          throw Error("DECISION_STALE");
        ownerText = `Task ${e.task_id}\nExecution ${executionID} · ${e.state} · ${e.retention_state}\n`;
        if (
          kind === "authorization" &&
          ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(
            String(e.state),
          )
        )
          ownerText += "注意：所属执行已结束；批准不能恢复此执行。\n";
      }
      const title = `${row ? attentionLabel(row) : kind === "authorization" ? "授权" : "问题"} · ${id}`;
      const version =
        String(data.revision) + ":" + String(data.display_hash ?? "");
      const text =
        kind === "authorization"
          ? `${title}\n${ownerText}版本 ${data.revision} · display_hash ${data.display_hash}\n有效期 ${expires ?? "无"}\n\n${printable(data.display)}\n\nTab 选择批准/拒绝，Shift+Enter 确认；Esc 返回。`
          : kind === "decision"
            ? `${title}\n${ownerText}${String(data.question)}\n\n影响：${String(data.impact)}\n选项：${printable(data.options)}\n资料引用（内容未接入）：${printable(data.materials ?? [])}\n\nEnter 换行 · Shift+Enter 字面回答 · Tab 详情/选项 · Esc 返回`
            : `${title}\n${row?.warning ?? ""}\n${row?.preview ?? ""}\n${printable(data)}\n\n只读；精确处置与移除由 #93 实现。Esc 返回。`;
      this.current = {
        id,
        kind,
        origin,
        route,
        version,
        data,
        title,
        text: visibleMatterText(text),
        options: kind === "decision" ? (data.options as string[]) : [],
        expires,
      };
      clearTimeout(this.expiry);
      if (expires)
        this.expiry = setTimeout(
          () => void this.refresh(),
          Math.min(
            2147483647,
            Math.max(1, Date.parse(expires) - Date.now() + 1),
          ),
        );
    } catch (e) {
      if (gen === this.generation) {
        this.hint = code(e);
        this.onExit(
          origin,
          invalid.test(code(e)) ? "invalid" : "escape",
          "事项无法打开：" + code(e),
        );
      }
    } finally {
      if (gen === this.generation) {
        this.loading = false;
        this.opening = undefined;
        this.onChange();
      }
    }
  }
  exit(result: "escape" | "invalid" | "success" = "escape", message = "") {
    const origin = this.current?.origin ?? this.origin;
    this.origin = undefined;
    this.opening = undefined;
    this.generation++;
    this.current = undefined;
    this.loading = false;
    clearTimeout(this.expiry);
    if (origin)
      this.onExit(
        origin,
        result,
        message || (this.pending ? "操作结果待核对；退出不会撤销提交" : ""),
      );
    this.onChange();
  }
  async refresh() {
    await this.reconcile();
    const current = this.current,
      client = this.client,
      gen = this.generation;
    if (
      !current ||
      !client ||
      current.kind === "exception" ||
      this.busy ||
      this.pending?.item === current.id
    )
      return;
    try {
      const data = await client.query<Record<string, unknown>>(current.route);
      if (gen !== this.generation || client !== this.client) return;
      const expiry = (
        current.kind === "authorization" ? data.expires_at : data.deadline
      ) as string | null;
      if (
        (expiry && Date.parse(expiry) <= Date.now()) ||
        data.state !== (current.kind === "authorization" ? "PENDING" : "OPEN")
      )
        throw Error("MATTER_NOT_OPEN");
      if (
        current.kind === "authorization" &&
        `${data.revision}:${data.display_hash}` !== current.version
      )
        throw Error("APPROVAL_CONFLICT");
      if (current.kind === "decision") {
        const e = await client.query<Record<string, unknown>>(
          `executions/${data.execution_id}`,
        );
        if (gen !== this.generation || client !== this.client) return;
        if (e.state !== "WAIT_DECISION") throw Error("DECISION_STALE");
      }
    } catch (e) {
      if (gen !== this.generation) return;
      if (invalid.test(code(e))) this.exit("invalid", "事项已失效：" + code(e));
      else {
        this.hint = "核对失败，保留输入：" + code(e);
        this.onChange();
      }
    }
  }
  async submit(value: string, decision?: "APPROVE" | "REJECT") {
    const current = this.current,
      client = this.client;
    if (!current || !client || current.kind === "exception" || this.busy)
      return;
    if (current.kind === "authorization" && !decision) {
      this.hint = "请明确选择批准或拒绝";
      this.onChange();
      return;
    }
    if (current.kind === "decision" && !value.trim()) {
      this.hint = "回答不能为空";
      this.onChange();
      return;
    }
    if (this.pending && this.pending.item !== current.id) {
      this.hint = "另一事项结果尚未确认；先核对原操作";
      this.onChange();
      return;
    }
    const payload =
      current.kind === "authorization"
        ? {
            expected_revision: current.data.revision,
            display_hash: current.data.display_hash,
            decision,
          }
        : { answer: value };
    if (this.pending) {
      const { request_id, ...old } = this.pending.body;
      if (JSON.stringify(old) !== JSON.stringify(payload)) {
        this.hint = "结果未确认，不能修改原提交；请原内容同 ID 重发";
        this.onChange();
        return;
      }
    } else {
      const id = randomUUID();
      this.pending = {
        id,
        item: current.id,
        kind: current.kind,
        route:
          current.route +
          (current.kind === "authorization" ? "/decision" : "/answer"),
        body: { request_id: id, ...payload },
        detailRoute: current.route,
        domain: this.domain,
      };
    }
    const p = this.pending;
    this.busy = true;
    this.hint = "已提交，正在核对实际状态";
    this.onChange();
    try {
      const receipt = await client.command(p.route, p.body);
      if (this.pending !== p) return;
      if (receipt.request_id !== p.id || receipt.acceptance !== "ACCEPTED")
        throw Error("INVALID_RECEIPT");
    } catch (e) {
      if (this.pending !== p) return;
      const error = code(e);
      if (invalid.test(error)) {
        // A lost earlier response may already have committed. Reconcile before invalidating.
        await this.reconcile();
        if (this.pending === p) {
          this.pending = undefined;
          if (this.current?.id === p.item) this.exit("invalid", error);
          else this.hint = error;
        }
      } else if (
        ["INVALID_REQUEST", "INVALID_REVISION", "EMPTY_DECISION"].includes(
          error,
        )
      ) {
        await this.reconcile();
        if (this.pending === p) {
          try {
            await client.query<RequestStatus>(`requests/${p.id}`);
            this.hint = "已有请求记录，继续核对原提交：" + error;
          } catch (statusError) {
            if (code(statusError) === "NOT_FOUND") {
              this.pending = undefined;
              this.hint = "提交未被接收，输入保留：" + error;
            } else this.hint = "结果尚未确认，保留原提交：" + error;
          }
        }
      } else this.hint = "结果未确认；保留输入，同 ID 明确重试：" + error;
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
        const data = await client.query<Record<string, unknown>>(p.detailRoute);
        if (this.pending !== p || this.client !== client) return;
        const matching =
          p.kind === "authorization"
            ? data.decision_id === p.id
            : data.answer_request_id === p.id;
        const expected =
          p.kind === "authorization"
            ? p.body.decision === "APPROVE"
              ? ["APPROVED", "CONSUMED"]
              : ["REJECTED"]
            : ["ANSWERED"];
        const answerOK =
          p.kind === "authorization" ||
          (data.answered_by === "MASTER" &&
            JSON.stringify(data.answer) ===
              JSON.stringify({ value: p.body.answer }));
        if (matching && expected.includes(String(data.state)) && answerOK) {
          this.pending = undefined;
          this.hint = "事项操作已确认完成";
          if (this.current?.id === p.item) this.exit("success", this.hint);
          else this.onChange();
          return;
        }
        const actionable =
          data.state === (p.kind === "authorization" ? "PENDING" : "OPEN");
        if (!actionable) {
          this.pending = undefined;
          const msg = matching
            ? "事项已发生后续状态变化；当前状态 " + data.state
            : "事项已由其他入口处理：" + data.state;
          if (this.current?.id === p.item) this.exit("invalid", msg);
          else {
            this.hint = msg;
            this.onChange();
          }
          return;
        }
        const status = await client.query<RequestStatus>(`requests/${p.id}`);
        if (this.pending !== p || this.client !== client) return;
        this.hint = `请求 ${status.receipt.state}；尚未确认事项完成，保留输入`;
      } catch (e) {
        if (this.pending !== p || this.client !== client) return;
        this.hint = "送达尚未确认；原输入可同 ID 重试：" + code(e);
      }
    })().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }
  stop() {
    this.generation++;
    clearTimeout(this.expiry);
    this.client = undefined;
  }
}
