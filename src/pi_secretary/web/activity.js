// Structured activity data is display-only, never chat-text inference.
export class ActivityView {
  constructor(root, action, changed = () => {}) {
    this.root = root;
    this.action = action;
    this.changed = changed;
    this.snapshot = null;
    this.lastSeen = 0;
    this.retired = new Set();
    this.rows = new Map();
    this.pages = [];
    this.head = [];
    this.live = [];
    this.queue = document.createElement("div");
    this.queue.className = "activity-queue";
    this.connection = document.createElement("div");
    this.connection.className = "activity-connection";
    this.jump = document.createElement("button");
    this.jump.type = "button";
    this.jump.className = "activity-jump";
    this.jump.onclick = () => {
      const row = this.live.find((a) => a.actions?.length) ?? this.live[0];
      const node = row && this.rows.get(row.id);
      node?.scrollIntoView({ block: "center", behavior: "smooth" });
      node?.querySelector("summary")?.focus({ preventScroll: true });
    };
    this.more = document.createElement("button");
    this.more.type = "button";
    this.more.className = "activity-load-more";
    this.more.textContent = "加载更早活动";
    this.more.onclick = () => void this.loadOlder();
    this.notice = document.createElement("div");
    this.notice.className = "activity-history-note";
    root.append(this.connection, this.queue, this.jump);
    this.timer = setInterval(() => this.render(), 1000);
  }
  seen() {
    this.lastSeen = Date.now();
    this.render();
  }
  disconnect() {
    this.lastSeen = 0;
    this.render();
  }
  accept(snapshot) {
    if (snapshot.unchanged) {
      this.seen();
      return;
    }
    const old = this.snapshot;
    const reconnecting = old && !this.lastSeen;
    if (this.retired.has(snapshot.server_instance_id)) return;
    if (
      old?.server_instance_id === snapshot.server_instance_id &&
      (snapshot.activity_revision < old.activity_revision ||
        snapshot.store_revision < old.store_revision)
    )
      return;
    if (old && old.server_instance_id !== snapshot.server_instance_id) {
      this.retired.add(old.server_instance_id);
      if (this.retired.size > 8)
        this.retired.delete(this.retired.values().next().value);
      this.pages = [];
      this.cursor = null;
      this.pageGeneration = (this.pageGeneration ?? 0) + 1;
    }
    this.snapshot = snapshot;
    this.lastSeen = Date.now();
    if (reconnecting && this.pages.length) void this.refreshLoaded();
    const timeline = snapshot.timeline;
    this.head = timeline?.items ?? snapshot.recent.filter((a) => a.ended_at);
    this.updates = timeline?.updates ?? [];
    this.live = timeline?.live ?? snapshot.activities;
    if (!this.pages.length) this.cursor = timeline?.next_cursor;
    this.notice.textContent =
      (timeline?.coverage ?? "当前服务器仅提供近期活动，完整历史暂不可用") +
      (this.trimmed ? " · 中间历史页已释放，可刷新后重新加载" : "");
    this.more.hidden = !this.cursor;
    this.changed();
    this.render();
  }
  async loadOlder() {
    if (!this.cursor || !this.fetchPage || this.loading) return;
    this.loading = true;
    this.more.disabled = true;
    const generation = this.pageGeneration ?? 0;
    try {
      const page = await this.fetchPage(this.cursor);
      if (generation !== (this.pageGeneration ?? 0)) return;
      this.pages = [...this.pages, page.items];
      this.cursor = page.next_cursor;
      if (this.pages.length > 4) {
        this.pages.shift();
        this.trimmed = true;
      }
      this.more.textContent = "加载更早活动";
      this.more.hidden = !this.cursor;
      this.changed();
    } catch {
      this.more.textContent = "活动历史加载失败，点击重试";
    } finally {
      this.loading = false;
      this.more.disabled = false;
    }
  }
  async refreshLoaded() {
    if (!this.fetchUpdates || this.refreshing) return;
    this.refreshing = true;
    const generation = this.pageGeneration ?? 0;
    try {
      const pages = this.pages;
      const refreshed = await Promise.all(
        pages.map((page) => this.fetchUpdates(page.map((a) => a.id))),
      );
      if (generation === (this.pageGeneration ?? 0) && this.pages === pages) {
        this.pages = refreshed.map((page) => page.items);
        this.changed();
      }
    } catch {
      this.notice.textContent = "部分历史状态未同步，重新连接后重试";
    } finally {
      this.refreshing = false;
    }
  }
  text(a, now) {
    const owner =
      a.scope === "background"
        ? `任务 ${(a.execution_id ?? a.id.slice(5)).slice(0, 8)}`
        : a.scope === "maintenance"
          ? a.kind === "settings"
            ? "设置"
            : "记忆"
          : "主会话";
    const p = a.progress;
    const progress =
      p?.total != null
        ? ` · ${p.current ? `第 ${p.current}/${p.total} 段，` : ""}已完成 ${p.completed ?? 0}/${p.total} 段`
        : "";
    const attempt = p?.attempt ? ` · 尝试 ${p.attempt}/${p.max_attempts}` : "";
    const end =
      a.ended_at ??
      (["running", "waiting"].includes(a.status) ? null : a.last_progress_at);
    const seconds = Math.max(
      0,
      Math.floor(
        ((end ? Date.parse(end) : now) - Date.parse(a.started_at)) / 1000,
      ),
    );
    const phase =
      a.status === "succeeded" ? a.phase.replace(/^正在/, "已") : a.phase;
    return `${owner}：${phase}${progress}${attempt}${a.timing_known === false ? " · 耗时未知" : ` · 已用 ${seconds} 秒`}`;
  }
  entries() {
    const merged = new Map();
    for (const a of [
      ...this.pages.flat(),
      ...this.head,
      ...(this.updates ?? []),
      ...this.live,
    ]) {
      const old = merged.get(a.id);
      merged.set(a.id, {
        ...old,
        ...a,
        order: a.order ?? old?.order ?? Date.parse(a.started_at),
      });
    }
    return [...merged.values()];
  }
  nodes() {
    const all = this.entries(),
      wanted = new Set(),
      nodes = [];
    const parents = new Set(
      all
        .filter(
          (a) =>
            a.kind === "task" ||
            a.kind === "settings" ||
            a.kind === "compaction",
        )
        .map((a) => a.id),
    );
    for (const a of all) {
      if (a.parent_id && parents.has(a.parent_id)) continue;
      wanted.add(a.id);
      let row = this.rows.get(a.id);
      if (!row) {
        row = document.createElement("details");
        row.className = "activity-row timeline-activity";
        row.dataset.activityId = a.id;
        const summary = document.createElement("summary"),
          label = document.createElement("span");
        summary.append(label);
        const details = document.createElement("div");
        details.className = "activity-steps";
        const actions = document.createElement("div");
        actions.className = "activity-actions";
        row.append(summary, actions, details);
        this.rows.set(a.id, row);
      }
      row.activity = a;
      const children = all
        .filter((child) => child.parent_id === a.id)
        .sort((x, y) => x.order - y.order);
      const signature = JSON.stringify([a.steps, a.actions, children]);
      if (row.dataset.signature !== signature) {
        row.dataset.signature = signature;
        row.children[1].replaceChildren();
        row.children[2].replaceChildren();
        for (const action of a.actions ?? []) {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = {
            settings: "查看设置",
            authorization: "查看授权",
            decisions: "查看决定",
            tasks: "查看任务",
            status: "查看状态",
          }[action];
          b.onclick = () => this.action(action, a);
          row.children[1].append(b);
        }
        for (const step of a.steps ?? []) {
          const line = document.createElement("p");
          line.textContent = `${step.phase} · ${new Date(step.at).toLocaleTimeString()}`;
          row.children[2].append(line);
        }
        for (const child of children) {
          const line = document.createElement("p");
          line.textContent = this.text(
            child,
            Date.parse(child.ended_at ?? child.last_progress_at),
          );
          row.children[2].append(line);
        }
        const time = document.createElement("p");
        time.textContent = `记录时间：${a.started_at}${a.ended_at ? `；结束/结果记录：${a.ended_at}` : ""}`;
        row.children[2].append(time);
      }
      nodes.push({
        key: "activity:" + a.id,
        node: row,
        order: a.order,
        call_id: a.call_id,
        activity: a,
      });
    }
    for (const [id, row] of this.rows)
      if (!wanted.has(id)) {
        row.remove();
        this.rows.delete(id);
      }
    this.render();
    return nodes;
  }
  render() {
    const s = this.snapshot,
      now = Date.now();
    const connected =
      navigator.onLine && !!this.lastSeen && now - this.lastSeen < 15000;
    this.root.dataset.connected = String(connected);
    this.connection.hidden = connected;
    this.connection.textContent = s
      ? "连接中断，活动状态暂不可确认"
      : "正在连接活动状态";
    for (const row of this.rows.values()) {
      const a = row.activity;
      row.dataset.status =
        !connected && a.source === "live" && !a.ended_at ? "unknown" : a.status;
      const text = this.text(
        a,
        connected ? now : Date.parse(s?.observed_at ?? a.last_progress_at),
      );
      const label = row.children[0].firstChild;
      if (label.textContent !== text) label.textContent = text;
    }
    if (!s) return;
    this.queue.textContent = [
      s.queue.accepted
        ? `待处理消息 ${s.queue.accepted} 条${s.queue.blocked ? " · 等待阻塞解除" : ""}`
        : "",
      s.queue.claimed ? `已领取 ${s.queue.claimed} 条` : "",
      s.truncated ? `当前显示 ${s.activities.length}/${s.total} 项活动` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    this.queue.hidden = !this.queue.textContent;
    this.jump.hidden = !this.live.length;
    this.jump.textContent = `${this.live.length} 项当前或待处理活动 · 跳转查看`;
  }
  close() {
    clearInterval(this.timer);
  }
}
