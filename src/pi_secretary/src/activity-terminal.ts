import * as readline from "node:readline";
import { stripVTControlCharacters } from "node:util";
import type { ActivitySnapshot, Activity } from "./activity.ts";
const clean = (s: string) =>
  stripVTControlCharacters(s).replace(
    /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
    "",
  );
export function activityLine(a: Activity, at = Date.now()) {
  const owner =
    a.scope === "background"
      ? `任务 ${(a.execution_id ?? a.id.slice(5)).slice(0, 8)}`
      : a.scope === "maintenance"
        ? a.kind === "settings"
          ? "设置"
          : "记忆"
        : "主会话";
  const p = a.progress;
  const end =
    a.ended_at ??
    (a.status === "running" || a.status === "waiting"
      ? null
      : a.last_progress_at);
  const seconds = Math.max(
    0,
    Math.floor(
      ((end ? Date.parse(end) : at) - Date.parse(a.started_at)) / 1000,
    ),
  );
  return clean(
    `${owner}：${a.phase}${p?.total != null ? ` · ${p.current ? `第 ${p.current}/${p.total} 段，` : ""}已完成 ${p.completed ?? 0}/${p.total} 段` : ""}${p?.attempt ? ` · 尝试 ${p.attempt}/${p.max_attempts}` : ""} · 已用 ${seconds} 秒${a.actions.length ? ` · ${a.actions.map((x) => ({ settings: "/web", authorization: "/auth", decisions: "/decisions", tasks: "/tasks", status: "/status" })[x]).join(" ")}` : ""}`,
  );
}
export function activityLines(s: ActivitySnapshot) {
  const lines = s.activities.map((a) => activityLine(a));
  if (s.queue.accepted)
    lines.push(
      `待处理消息 ${s.queue.accepted} 条${s.queue.blocked ? " · 等待阻塞解除" : "（可能批量处理）"}`,
    );
  if (s.truncated) lines.push(`显示 ${s.activities.length}/${s.total} 项活动`);
  return lines;
}
// Readline owns prompt wrapping and cursor restoration, including wide characters.
export class ActivityTerminal {
  private snapshot?: ActivitySnapshot;
  private seen = 0;
  private signature = "";
  private base = "Master › ";
  private closed = false;
  private timer: ReturnType<typeof setInterval>;
  constructor(
    private rl: readline.Interface,
    private output: NodeJS.WriteStream = process.stdout,
  ) {
    this.timer = setInterval(() => this.render(), 1000);
    output.on("resize", this.resize);
  }
  private resize = () => this.render(true);
  setPrompt(prompt: string) {
    this.base = prompt;
    if (!this.output.isTTY) {
      this.rl.setPrompt(prompt);
      this.rl.prompt(true);
    } else this.render(true);
  }
  accept(snapshot: ActivitySnapshot) {
    if (
      this.snapshot?.server_instance_id === snapshot.server_instance_id &&
      snapshot.activity_revision < this.snapshot.activity_revision
    )
      return;
    this.snapshot = snapshot;
    this.seen = Date.now();
    this.render();
  }
  disconnect() {
    this.seen = 0;
    this.render();
  }
  private render(force = false) {
    if (this.closed) return;
    let lines = this.snapshot ? activityLines(this.snapshot) : [];
    if (this.snapshot && (!this.seen || Date.now() - this.seen > 15000))
      lines = ["连接中断，活动状态暂不可确认"];
    const tty = !!this.output.isTTY;
    if (!tty) {
      const signature = JSON.stringify([
        this.snapshot?.server_instance_id,
        this.snapshot?.activity_revision,
        !!this.seen,
      ]);
      if (signature !== this.signature) {
        this.signature = signature;
        for (const line of lines) this.output.write(`活动 · ${line}\n`);
        if (this.snapshot && !lines.length)
          this.output.write("活动 · 当前无活动\n");
      }
      return;
    }
    const max = Math.max(
      1,
      Math.min(6, Math.floor((this.output.rows || 24) / 3)),
    );
    if (lines.length > max)
      lines = [
        ...lines.slice(0, max - 1),
        `另有 ${lines.length - max + 1} 项 · /activity 查看全部`,
      ];
    // Keep each activity prompt line within terminal width; readline handles the input line.
    const width = Math.max(10, (this.output.columns || 80) - 2);
    lines = lines.map((line) => {
      let n = 0,
        text = "";
      for (const c of line) {
        n += c.codePointAt(0)! > 255 ? 2 : 1;
        if (n > width - 1) return text + "…";
        text += c;
      }
      return text;
    });
    const prompt = (lines.length ? lines.join("\n") + "\n" : "") + this.base;
    if (force || prompt !== this.signature) {
      this.signature = prompt;
      this.rl.setPrompt(prompt);
      this.rl.prompt(true);
    }
  }
  clear() {
    if (!this.output.isTTY) return;
    const position = this.rl.getCursorPos();
    readline.cursorTo(this.output, 0);
    if (position.rows) readline.moveCursor(this.output, 0, -position.rows);
    readline.clearScreenDown(this.output);
  }
  redraw() {
    this.render(true);
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.output.off("resize", this.resize);
  }
}
