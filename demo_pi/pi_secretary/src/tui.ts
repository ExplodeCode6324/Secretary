import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline";
import { stripVTControlCharacters } from "node:util";
import { App } from "./app.ts";
import { id } from "./store.ts";
import type {
  AuthorizationRequest,
  TaskPlan,
  TaskProposal,
  Execution,
  DecisionRequest,
  ProgramRegistration,
  Operation,
} from "./contracts.ts";

// Model/tool text is display data, never terminal commands or control sequences.
export function terminalText(value: string) {
  return stripVTControlCharacters(value).replace(
    /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
    "",
  );
}
function display(value: unknown) {
  return JSON.stringify(
    value,
    (key, item) => {
      if (["thinkingSignature", "textSignature", "thinking"].includes(key))
        return undefined;
      if (key === "content" && Array.isArray(item))
        return item.filter((c) => c?.type !== "thinking");
      return item;
    },
    2,
  );
}
const HELP = `直接输入消息与主会话交谈；命令只由 Master 的终端输入执行。
/menu                      功能入口总览
/history                   最近会话消息
/status                    会话与模型状态
/programs                  已登记程序列表
/operations                操作与未知结果列表
/rules                     已保存授权规则
/task-json <JSON>          定时／周期任务、材料与完整约束
/world-read [subject-id]    按实体查询 World Model
/tasks                     任务列表（不刷新详情保留期）
/show <execution-id>        查询任务详情
/task <目标>               直接创建 Agent 任务
/program <program-id> <目标>  创建已登记程序任务
/auth 或 /approvals         授权入口：展示完整请求与可执行命令
/approval <id>             阅读完整授权内容，固定本次展示版本
/approve <id>              批准已读请求；不会把聊天中的同意当授权
/reject <id>  /revoke <id>  拒绝／撤销已读请求
/decisions                 等待普通工作决定
/answer <id> <回答>         回答普通工作决定
/cancel <execution-id>      取消执行
/verify <operation-id>      只读核验未知文件写入
/register-example          人工登记示例程序
/register <JSON>           登记程序，字段 entrypoint、name
/rule <JSON>               添加授权规则，字段 action、resource、parameters
/world [JSON]              查询 World Model，或提交变更提案
/compact  /resume          整理工作记忆／重试已中断模型调用
/help  /quit               帮助／停止并退出
Ctrl+C 退出；支持终端历史、方向键编辑与滚动回看。`;

export class TerminalController {
  private viewed = new Map<string, { revision: number; hash: string }>();
  private aliases = new Map<string, string>();
  private eventIndex = 0;
  private pendingSignature = JSON.stringify([[], []]);
  constructor(
    readonly app: App,
    private emit: (text: string) => void,
  ) {}
  private print(value: unknown) {
    this.emit(terminalText(typeof value === "string" ? value : display(value)));
  }
  help() {
    this.print(HELP);
  }
  status() {
    this.print(
      `Secretary · ${process.env.SECRETARY_MODE === "live" ? "LIVE_MODEL" : "OFFLINE_FIXTURE"}\n主会话 ${this.app.host.model.id} · 执行 ${this.app.scheduler.model.id}\n状态 ${this.app.host.session.state}${this.app.host.session.recovery_error ? " · " + this.app.host.session.recovery_error : ""}`,
    );
  }
  private alias(prefix: string, id: string) {
    const old = [...this.aliases].find(
      ([key, value]) => key.startsWith(prefix) && value === id,
    );
    if (old) return old[0];
    const key =
      prefix +
      ([...this.aliases.keys()].filter((k) => k.startsWith(prefix)).length + 1);
    this.aliases.set(key, id);
    return key;
  }
  prompt() {
    const n = this.app.store
      .all<AuthorizationRequest>("AuthorizationRequest")
      .filter((a) => a.state === "PENDING").length;
    const d = this.app.store
      .all<DecisionRequest>("DecisionRequest")
      .filter((a) => a.state === "OPEN").length;
    return n || d
      ? `Master [待授权 ${n} · 待决定 ${d} · /menu] › `
      : "Master › ";
  }
  menu() {
    this.print(
      "══ Secretary 功能入口 ══\n授权 → /auth    工作决定 → /decisions\n任务 → /tasks    程序 → /programs    未知操作 → /operations\n新任务 → /task <目标>    程序登记 → /register-example\n记忆 → /world    规则 → /rules    全部操作 → /help\n直接输入文字聊天；授权卡上的命令只由你输入后执行。",
    );
    this.approvals();
    this.decisions();
  }
  private approvalCard(a: AuthorizationRequest) {
    const label = this.alias("A", a.id);
    const plan = a.scope.task_id
      ? this.app.store.get<TaskPlan>("TaskPlan", a.scope.task_id)
      : null;
    const goal = plan
      ? this.app.store.read<TaskProposal>(plan.proposal_ref).goal
      : "主会话操作";
    this.print(
      `══ ${a.state === "PENDING" ? "等待授权" : "授权详情"} ${label} ══\n任务：${goal}\n动作：${a.action.action}\n资源：${a.action.resource}\n状态：${a.state} · 版本 ${a.revision}\n请求 ID：${a.id}\n完整请求与参数：`,
    );
    // Authorization parameters must be displayed verbatim, not filtered like model messages.
    this.print(JSON.stringify(this.app.store.read(a.display_ref), null, 2));
    this.viewed.set(a.id, { revision: a.revision, hash: a.display_hash });
    this.print(
      a.state === "PENDING"
        ? `批准此次操作 → /approve ${label}    拒绝 → /reject ${label}\n稍后处理：继续聊天即可；重新查看 → /approval ${label}`
        : a.state === "APPROVED"
          ? `撤销批准 → /revoke ${label}`
          : "此请求已结束，不能再次批准。",
    );
  }
  private approvals() {
    const list = this.app.store
      .all<AuthorizationRequest>("AuthorizationRequest")
      .filter((a) => ["PENDING", "APPROVED"].includes(a.state));
    if (!list.length) this.print("授权入口：暂无待处理授权。");
    for (const a of list) this.approvalCard(a);
  }
  private decisions() {
    const list = this.app.store
      .all<DecisionRequest>("DecisionRequest")
      .filter((d) => d.state === "OPEN");
    if (!list.length) this.print("工作决定：暂无待回答事项。");
    for (const d of list) {
      const label = this.alias("D", d.id);
      this.print(
        `══ 等待工作决定 ${label} ══\n${d.question}\n影响：${d.impact}\n选项：${display(d.options)}\n回答 → /answer ${label} <你的回答>（不是授权）`,
      );
    }
  }
  private resolve<T extends { id: string }>(records: T[], key: string): T {
    key = this.aliases.get(key.toUpperCase()) ?? key;
    const matches = records.filter((r) => r.id === key || r.id.startsWith(key));
    if (!key || matches.length !== 1)
      throw Error("请输入唯一 ID（可使用不歧义的前缀）。");
    return matches[0];
  }
  refresh() {
    for (const event of this.app.store.logs.slice(this.eventIndex)) {
      if (event.event_type === "main.message") {
        const m = this.app.store.read<{ role: string; content: unknown }>(
          event.payload,
        );
        if (m.role === "assistant" && Array.isArray(m.content)) {
          const text = m.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n");
          if (text) this.print("Secretary › " + text);
        }
      }
      if (event.event_type === "notification.result") {
        const n = this.app.store.read<{
          message: Parameters<App["store"]["bytes"]>[0];
        }>(event.payload);
        this.print("通知 › " + this.app.store.bytes(n.message).toString());
      }
    }
    this.eventIndex = this.app.store.logs.length;
    const approvals = this.app.store
      .all<AuthorizationRequest>("AuthorizationRequest")
      .filter((a) => ["PENDING", "APPROVED"].includes(a.state));
    const decisions = this.app.store
      .all<DecisionRequest>("DecisionRequest")
      .filter((d) => d.state === "OPEN");
    const signature = JSON.stringify([
      approvals.map((a) => [a.id, a.revision]),
      decisions.map((d) => d.id),
    ]);
    if (signature !== this.pendingSignature) {
      this.pendingSignature = signature;
      for (const a of approvals)
        if (this.viewed.get(a.id)?.revision !== a.revision)
          this.approvalCard(a);
      this.decisions();
      this.print(
        `待授权 ${approvals.filter((a) => a.state === "PENDING").length} · 待决定 ${decisions.length} · /menu 返回功能入口`,
      );
    }
  }
  async command(line: string): Promise<boolean> {
    const input = line.trim();
    if (!input) return true;
    if (!input.startsWith("/")) {
      this.app.host.accept(input);
      this.print("消息已保存。");
      return true;
    }
    const space = input.indexOf(" "),
      command = space < 0 ? input : input.slice(0, space),
      rest = space < 0 ? "" : input.slice(space + 1).trim();
    const split = rest.indexOf(" "),
      key = split < 0 ? rest : rest.slice(0, split),
      text = split < 0 ? "" : rest.slice(split + 1).trim();
    const store = this.app.store;
    switch (command) {
      case "/menu":
        this.menu();
        break;
      case "/programs":
        this.print(
          store.all<ProgramRegistration>("ProgramRegistration").map((p) => ({
            选择: this.alias("P", p.id),
            名称: p.name,
            状态: p.state,
            命令: `/program ${this.alias("P", p.id)} <目标>`,
          })),
        );
        break;
      case "/rules":
        this.print(store.all("AuthorizationRule"));
        break;
      case "/operations":
        this.print(
          store
            .all("Operation")
            .map((o) => ({ ...o, 核验命令: `/verify ${o.id}` })),
        );
        break;
      case "/task-json": {
        const a = JSON.parse(rest);
        this.print(
          this.app.scheduler.propose(a.goal, id(), this.app.host.sessionID, {
            programID: a.program_id,
            at: a.at,
            interval: a.interval_seconds,
            parent: a.parent_execution_id,
            constraints: a.constraints,
            acceptance: a.acceptance_criteria,
            deadline: a.deadline,
            materials: a.materials,
            preconditions: a.preconditions,
          }),
        );
        break;
      }
      case "/world-read":
        if (!this.app.world) throw Error("World Model 未配置。");
        this.print(await this.app.world.read(rest || null));
        break;
      case "/history": {
        const messages = store.logs
          .filter((l) => l.event_type === "main.message")
          .map((l) => store.read<{ role: string; content: unknown }>(l.payload))
          .filter((m) => ["user", "assistant"].includes(m.role))
          .slice(-20);
        this.print(messages.length ? messages : "暂无会话历史。");
        break;
      }
      case "/help":
        this.help();
        break;
      case "/status":
        this.status();
        break;
      case "/tasks":
        this.print(
          store.all<TaskPlan>("TaskPlan").map((p) => ({
            id: p.id,
            goal: store.read<TaskProposal>(p.proposal_ref).goal,
            state: p.state,
            executions: store
              .all<Execution>("Execution")
              .filter((e) => e.task_id === p.id)
              .map((e) => ({
                选择: this.alias("E", e.id),
                id: e.id,
                state: e.state,
                详情: `/show ${this.alias("E", e.id)}`,
                取消: `/cancel ${this.alias("E", e.id)}`,
              })),
          })),
        );
        break;
      case "/show":
        this.print(
          this.app.scheduler.detail(
            this.resolve(store.all<Execution>("Execution"), rest).id,
          ),
        );
        break;
      case "/task":
        this.print(
          this.app.scheduler.propose(rest, id(), this.app.host.sessionID),
        );
        break;
      case "/program":
        this.print(
          this.app.scheduler.propose(text, id(), this.app.host.sessionID, {
            programID: this.resolve(
              store.all<ProgramRegistration>("ProgramRegistration"),
              key,
            ).id,
          }),
        );
        break;
      case "/auth":
      case "/approvals":
        this.approvals();
        break;
      case "/approval": {
        this.approvalCard(
          this.resolve(
            store.all<AuthorizationRequest>("AuthorizationRequest"),
            rest,
          ),
        );
        break;
      }
      case "/approve":
      case "/reject":
      case "/revoke": {
        const a = this.resolve(
            store.all<AuthorizationRequest>("AuthorizationRequest"),
            rest,
          ),
          view = this.viewed.get(a.id);
        if (!view) throw Error("先使用 /approval <id> 阅读完整请求。");
        this.print(
          this.app.authorization.decide({
            record_type: "ApprovalCommand",
            schema_version: 1,
            request_id: id(),
            authorization_id: a.id,
            expected_revision: view.revision,
            display_hash: view.hash,
            decision:
              command === "/approve"
                ? "APPROVE"
                : command === "/reject"
                  ? "REJECT"
                  : "REVOKE",
          }),
        );
        this.viewed.delete(a.id);
        break;
      }
      case "/decisions":
        this.decisions();
        break;
      case "/answer":
        if (!text) throw Error("请输入回答。");
        this.app.scheduler.answer(
          this.resolve(store.all<DecisionRequest>("DecisionRequest"), key).id,
          text,
          id(),
          "MASTER",
        );
        this.print("决定已保存。");
        break;
      case "/cancel":
        this.app.scheduler.cancel(
          this.resolve(store.all<Execution>("Execution"), rest).id,
        );
        this.print("已请求取消。");
        break;
      case "/verify":
        this.print(
          this.app.scheduler.verifyWrite(
            this.resolve(store.all<Operation>("Operation"), rest).id,
          ),
        );
        break;
      case "/register-example":
        this.print(
          this.app.scheduler.registerProgram(
            fileURLToPath(new URL("../examples/report.mjs", import.meta.url)),
            "Demo report generator",
          ),
        );
        break;
      case "/register": {
        const args = JSON.parse(rest);
        this.print(
          this.app.scheduler.registerProgram(args.entrypoint, args.name),
        );
        break;
      }
      case "/rule": {
        const args = JSON.parse(rest);
        this.print(
          this.app.authorization.rule(
            args.action,
            args.resource,
            args.parameters,
          ),
        );
        break;
      }
      case "/world":
        if (!this.app.world) throw Error("World Model 未配置。");
        this.print(
          rest
            ? this.app.world.propose(JSON.parse(rest), {
                session_id: this.app.host.sessionID,
                task_id: null,
                execution_id: null,
              })
            : await this.app.world.read(null),
        );
        break;
      case "/compact":
        void this.app.host.compact().catch((e) => this.print(String(e)));
        this.print("已请求整理。");
        break;
      case "/resume":
        void this.app.host.resume().catch((e) => this.print(String(e)));
        this.print("已请求恢复。");
        break;
      case "/quit":
        return false;
      default:
        throw Error("未知命令；/help 查看帮助。");
    }
    return true;
  }
}

export async function runTerminal() {
  const app = await App.open(
    path.resolve(process.env.SECRETARY_DATA ?? ".demo-data"),
    undefined,
    process.env.SECRETARY_DATABASE_URL,
  );
  let rl: readline.Interface | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopping = false,
    pumping = false;
  try {
    if (process.argv.includes("--migrate")) {
      if (!app.world) throw Error("--migrate 需要 SECRETARY_DATABASE_URL");
      await app.world.migrate();
    }
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: !!process.stdin.isTTY && !!process.stdout.isTTY,
      prompt: "Master › ",
      historySize: 200,
    });
    const tty = !!process.stdout.isTTY;
    let renders = 0;
    let ui: TerminalController;
    const print = (text: string) => {
      renders++;
      if (tty) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
      }
      process.stdout.write(terminalText(text) + "\n");
      if (!stopping) {
        rl!.setPrompt(ui?.prompt() ?? "Master › ");
        rl!.prompt(true);
      }
    };
    ui = new TerminalController(app, print);
    ui.status();
    ui.menu();
    ui.refresh();
    let finish!: () => void;
    const closed = new Promise<void>((r) => {
      finish = r;
    });
    const stop = () => {
      if (stopping) return;
      stopping = true;
      rl!.close();
      finish();
    };
    let commands = Promise.resolve();
    rl.on("line", (line) => {
      commands = commands.then(async () => {
        if (stopping) return;
        const before = renders;
        try {
          if (!(await ui.command(line))) stop();
        } catch (error) {
          print("错误 › " + String(error));
        }
        if (!stopping && before === renders) rl!.prompt();
      });
    });
    rl.on("SIGINT", stop);
    // EOF must not discard lines already queued for durable acceptance.
    rl.on("close", finish);
    const sigterm = () => stop();
    process.once("SIGTERM", sigterm);
    timer = setInterval(() => {
      if (pumping || stopping) return;
      pumping = true;
      app
        .pump()
        .catch((error) => print("错误 › " + String(error)))
        .finally(() => {
          pumping = false;
          if (!stopping) ui.refresh();
        });
    }, 300);
    await closed;
    await commands;
    process.removeListener("SIGTERM", sigterm);
  } finally {
    stopping = true;
    if (timer) clearInterval(timer);
    rl?.close();
    await app.close();
    process.stdout.write("Secretary 已停止。\n");
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runTerminal().catch((error) => {
    console.error(terminalText(String(error)));
    process.exitCode = 1;
  });
}
