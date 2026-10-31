import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, until } from "../issue9/helpers.ts";
import { id, base, revise } from "../../../src/pi_secretary/src/store.ts";
import { TaskBrowserWindow } from "../../../src/pi_secretary/src/tui/task-browser.ts";
import { TerminalApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import type {
  TaskPlan,
  Execution,
} from "../../../src/pi_secretary/src/contracts.ts";
import type { TaskBrowserPage } from "../../../src/pi_secretary/src/api/contracts.ts";
import { HISTORY_BYTES } from "../../../src/pi_secretary/src/tui/history.ts";
import { bodyBytes } from "../../../src/pi_secretary/src/tui/body.ts";

const anchor = (item_id: string) => ({
  item_id,
  measured_width: 80,
  region: "body" as const,
  block_start_utf16: 0,
  row_in_block: 0,
});
test("bounded list cursor recovery and historical lookup survive a real Core restart", () =>
  fixture(async (f) => {
    for (let i = 0; i < 260; i++)
      f.app.scheduler.propose("queued " + i, id(), f.app.host.sessionID, {
        at: "2099-01-01T00:00:00.000Z",
      });
    const browser = new TaskBrowserWindow(f.client, () => false);
    try {
      await browser.refresh();
      assert.equal(browser.root?.counts.shared_tasks, 260);
      let pages = 0;
      while (browser.hasAfter) {
        await browser.page("after");
        assert(browser.root!.items.length <= 200);
        assert(++pages < 12);
      }
      const target = browser.root!.items.find((r) => r.kind === "task")!.id;
      browser.viewport([anchor(target)]);
      const previous = browser.root!.before;
      assert(previous);
      await f.restart();
      const renewed = new TaskBrowserWindow(f.client, () => false);
      renewed.inherit(browser);
      await renewed.refresh();
      assert(
        renewed.root!.items.some((r) => r.id === target),
        "restore by task ID, not old cursor",
      );
      await assert.rejects(
        f.client.query("task-browser?cursor=" + encodeURIComponent(previous)),
        /CURSOR_EXPIRED/,
      );
      await renewed.page("before");
      assert(!renewed.error);
      renewed.stop();
    } finally {
      browser.stop();
    }
  }));
test("recent-three conversation window pages, rehydrates, shares CoT and removes archived bytes", () =>
  fixture(async (f) => {
    const scope = f.app.scheduler.scopes.save({
      name: "Current",
      kind: "NONE",
    });
    const p = f.app.scheduler.propose(
      "Agent history",
      id(),
      f.app.host.sessionID,
      { scopeID: scope.id },
    );
    f.app.scheduler.tick();
    await f.app.scheduler.idle();
    const e = f.app.store.all<Execution>("Execution")[0];
    // Synthetic journal events exercise pagination; these are not live-provider evidence.
    const events = Array.from({ length: 230 }, (_, i) =>
      f.app.store.event(
        "agent.message",
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `MARKER-${i}\n\n` + "paragraph 😀 ".repeat(1200),
            },
            { type: "thinking", thinking: "visible thoughts " + i },
            { type: "thinking", thinking: "REDACTED", redacted: true },
          ],
        },
        { session_id: null, task_id: p.id, execution_id: e.id },
        "EXECUTOR",
      ),
    );
    f.app.store.commit([], events);
    let thinking = false;
    const b = new TaskBrowserWindow(f.client, () => thinking);
    try {
      await b.refresh();
      await b.open(p.id);
      assert(
        b.groups.get(e.id)!.items.length > 0 &&
          b.groups.get(e.id)!.items.length <= 50,
      );
      const first = events[0].event_id,
        firstKey = e.id + ":" + first;
      await b.loadBody(firstKey);
      assert.match(b.bodies.get(firstKey)!.body.text, /MARKER-0/);
      assert(!b.bodies.get(firstKey)!.thinking.text);
      let previous = 0;
      while (b.groups.get(e.id)!.after) {
        await b.page("after", "page:" + e.id + ":after");
        assert(b.groups.get(e.id)!.items.length <= 200);
        assert(++previous < 8);
      }
      assert(b.groups.get(e.id)!.before);
      const oldFirst = b.groups.get(e.id)!.items[0].id;
      await b.page("before", "page:" + e.id + ":before");
      assert.notEqual(
        b.groups.get(e.id)!.items[0].id,
        oldFirst,
        "backward paging must retain newly loaded messages under eviction pressure",
      );
      const message = b.groups
        .get(e.id)!
        .items.find((m) => m.thinking_preview)!;
      assert(message);
      b.viewport([anchor(e.id + ":" + message.id)]);
      thinking = true;
      await b.setThinking();
      const m = b.groups.get(e.id)!.items.find((m) => m.id === message.id)!;
      assert(m, "CoT mode change must retain the selected event");
      await b.loadBody(e.id + ":" + m.id);
      assert(b.bodies.get(e.id + ":" + m.id)!.thinking.text);
      assert(
        !b.bodies.get(e.id + ":" + m.id)!.thinking.text.includes("REDACTED"),
      );
      assert(
        [...b.bodies.values()].reduce((n, v) => n + bodyBytes(v), 0) <=
          HISTORY_BYTES,
      );
      const sequence = f.app.store.sequence;
      await b.refresh();
      assert.equal(f.app.store.sequence, sequence);
      f.app.scheduler.scopes.archive(scope.id, scope.revision);
      await b.refresh();
      assert.equal(b.selected, undefined);
      assert.equal(b.groups.size, 0);
      assert.equal(b.bodies.size, 0);
      assert.match(b.notice, /归档|不可用/);
      await assert.rejects(
        f.client.query(
          `task-browser/${p.id}/executions/${e.id}/messages/${first}/content`,
        ),
        /TASK_NOT_BROWSABLE/,
      );
    } finally {
      b.stop();
    }
  }));
test("terminal detail/back/M/T preserves root anchor and one Task rich draft at 80 and 120 columns", () =>
  fixture(async (f) => {
    const p = f.app.scheduler.propose(
      "Task browser terminal integration ".repeat(60),
      id(),
      f.app.host.sessionID,
      { at: "2099-01-01T00:00:00.000Z" },
    );
    await fs.writeFile(
      path.join(f.dir, "core-endpoint.json"),
      JSON.stringify(f.server.endpoint),
      { mode: 0o600 },
    );
    const term = new VirtualTerminal(80, 24),
      app = new TerminalApp(f.dir, term, path.join(f.dir, "tui-state"));
    try {
      app.start();
      await until(
        () => !!app.remote?.taskBrowser.root && app.editors.Task.enabled,
        5000,
      );
      const command = (text: string) => {
        app.editors[app.page].setText("");
        term.sendInput(text);
        term.sendInput("\x1b[13;2u");
      };
      command("/T");
      command("/search_task " + p.id.slice(0, 8));
      await until(() => app.remote!.taskBrowser.root?.target === p.id);
      await term.flush();
      assert.equal(app.documents.Task.anchor?.item_id, p.id);
      command("/taskdetail " + p.id);
      await until(() => app.remote!.taskBrowser.selected === p.id);
      term.sendInput("\x1b[200~中文 Task\n保留草稿\x1b[201~");
      const draft = app.editors.Task.snapshot();
      const sequence = f.app.store.sequence;
      term.sendInput("\x1b[13;2u");
      assert.equal(f.app.store.sequence, sequence);
      assert.equal(app.editors.Task.getExpandedText(), "中文 Task\n保留草稿");
      app.remote!.taskBrowser.back();
      app.draw();
      await term.flush();
      assert.equal(app.editors.Task.getExpandedText(), "中文 Task\n保留草稿");
      assert.equal(app.documents.Task.anchor?.item_id, p.id);
      app.documents.Task.render(120);
      assert.equal(app.documents.Task.anchor?.item_id, p.id);
      // Navigation commands operate only on their current draft; no per-detail draft exists.
      app.editors.Task.restore(draft);
      assert.equal(Object.keys(app.editors).length, 2);
    } finally {
      await app.close();
    }
  }));

test("late detail and body reads cannot resurrect replaced or archived targets", () =>
  fixture(async (f) => {
    const scope = f.app.scheduler.scopes.save({
      name: "late-read",
      kind: "NONE",
    });
    const one = f.app.scheduler.propose("one", id(), f.app.host.sessionID, {
        scopeID: scope.id,
      }),
      two = f.app.scheduler.propose("two", id(), f.app.host.sessionID, {
        at: "2099-01-01T00:00:00.000Z",
      });
    f.app.scheduler.tick();
    await f.app.scheduler.idle();
    let release!: () => void,
      blocked = false,
      hold = "task-browser/" + one.id;
    const b = new TaskBrowserWindow(
      {
        query: async <T>(route: string) => {
          const data = await f.client.query<T>(route);
          if (route === hold) {
            blocked = true;
            await new Promise<void>((r) => (release = r));
          }
          return data;
        },
      },
      () => false,
    );
    try {
      await b.refresh();
      const old = b.open(one.id);
      await until(() => blocked);
      hold = "";
      await b.open(two.id);
      release();
      await old;
      assert.equal(b.selected, two.id);
      assert.equal(b.detail?.task.id, two.id);
      await b.open(one.id);
      const execution = b.detail!.executions[0].id,
        message = b.groups.get(execution)!.items[0];
      hold = `task-browser/${one.id}/executions/${execution}/messages/${message.id}/content?thinking=false`;
      blocked = false;
      const body = b.loadBody(execution + ":" + message.id);
      await until(() => blocked);
      f.app.scheduler.scopes.archive(scope.id, scope.revision);
      await b.refresh();
      assert.equal(b.selected, undefined);
      release();
      await body;
      assert.equal(b.bodies.size, 0);
      assert.equal(b.groups.size, 0);
    } finally {
      b.stop();
    }
  }));

test("search highlight is independent of viewport refresh and duplicate continued headers", () =>
  fixture(async (f) => {
    for (let i = 0; i < 4; i++)
      f.app.scheduler.propose("search row " + i, id(), f.app.host.sessionID, {
        at: "2099-01-01T00:00:00.000Z",
      });
    const b = new TaskBrowserWindow(f.client, () => false);
    try {
      await b.refresh();
      const tasks = b.root!.items.filter((r) => r.kind === "task"),
        first = tasks[0].id,
        hit = tasks[2].id;
      b.viewport([anchor(first)]);
      await b.refresh();
      assert(b.entries().every((e) => !e.version?.includes("▶ 已定位")));
      await b.search(hit);
      await b.page("before");
      const headers = b
        .entries()
        .filter(
          (e) => e.id === "shared:null" || e.id === "continued:shared:null",
        );
      assert.equal(headers.length, 1);
      b.viewport([anchor(first)]);
      await b.refresh();
      assert(
        b
          .entries()
          .find((e) => e.id === hit)!
          .version!.includes("▶ 已定位"),
      );
      assert(
        !b
          .entries()
          .find((e) => e.id === first)!
          .version!.includes("▶ 已定位"),
      );
      const restored = new TaskBrowserWindow(f.client, () => false);
      try {
        restored.inherit(b);
        await restored.refresh();
        assert(
          restored
            .entries()
            .find((e) => e.id === hit)!
            .version!.includes("▶ 已定位"),
        );
      } finally {
        restored.stop();
      }
    } finally {
      b.stop();
    }
  }));

test("task rows label creation/start, end and actual result observation timestamps", () =>
  fixture(async (f) => {
    const waiting = f.app.scheduler.propose(
      "awaiting resource",
      id(),
      f.app.host.sessionID,
      {
        preconditions: [
          {
            condition_id: id(),
            kind: "RESOURCE_PRESENT",
            target: "missing",
            required_revision: null,
          },
        ],
      },
    );
    const finished = f.app.scheduler.propose(
      "finished",
      id(),
      f.app.host.sessionID,
    );
    f.app.scheduler.tick();
    await f.app.scheduler.idle();
    const b = new TaskBrowserWindow(f.client, () => false);
    try {
      await b.refresh();
      const task = b.root!.items.find(
        (r) => r.kind === "task" && r.id === waiting.id,
      )!;
      assert(task.kind === "task");
      const active = task.task.active_executions[0];
      assert(active.invoked_at);
      const row = b.entries().find((e) => e.id === waiting.id)!.version!;
      assert(row.includes(active.invoked_at));
      assert(row.includes("创建（尚未开始）"));
      await b.open(finished.id);
      const latest = b.detail!.task.latest_execution!;
      assert(latest.started_at);
      assert(latest.ended_at);
      const resultRow = b.entries().find((e) => e.id === finished.id)!.version!;
      assert(resultRow.includes(latest.started_at));
      assert(resultRow.includes("结束: " + latest.ended_at));
      const e = f.app.store.get<Execution>("Execution", latest.id);
      assert(e.result_id);
      const result = f.app.store.get<any>("TaskResult", e.result_id);
      assert(resultRow.includes("结果观测: " + result.observed_at));
      assert.equal(
        b.detail!.task.latest_result_observed_at,
        result.observed_at,
      );
    } finally {
      b.stop();
    }
  }));
