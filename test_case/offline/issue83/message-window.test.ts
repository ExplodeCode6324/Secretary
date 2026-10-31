import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../issue9/helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import type { Execution } from "../../../src/pi_secretary/src/contracts.ts";
import type { TaskBrowserMessages } from "../../../src/pi_secretary/src/api/contracts.ts";
import { TaskBrowserWindow } from "../../../src/pi_secretary/src/tui/task-browser.ts";

test("expanded-CoT byte-capped Agent pages stay contiguous backwards by anchor, cursor and TUI", () =>
  fixture(async (f) => {
    const p = f.app.scheduler.propose(
      "large message windows",
      id(),
      f.app.host.sessionID,
    );
    f.app.scheduler.tick();
    await f.app.scheduler.idle();
    const e = f.app.store
      .all<Execution>("Execution")
      .find((e) => e.task_id === p.id)!;
    // SEEDED messages exercise transport boundaries, not live-provider acceptance.
    const events = Array.from({ length: 120 }, (_, i) =>
      f.app.store.event(
        "agent.message",
        {
          role: "assistant",
          content: [
            { type: "text", text: `message-${i}:` + "界".repeat(5000) },
            { type: "thinking", thinking: "思".repeat(5000) },
          ],
        },
        { session_id: null, task_id: p.id, execution_id: e.id },
        "EXECUTOR",
      ),
    );
    f.app.store.commit([], events);
    const ids = f.app.store
      .executionEvents(e.id)
      .filter((event) => event.event_type === "agent.message")
      .map((event) => event.event_id);
    const positions = new Map(ids.map((id, i) => [id, i])),
      last = ids.at(-1)!;
    const route = `task-browser/${p.id}/executions/${e.id}/messages`;
    const around = (id: string) =>
      route + `?thinking=true&direction=before&limit=50&message_id=${id}`;
    const contiguous = (items: { id: string }[]) => {
      assert(items.length > 0);
      for (let i = 1; i < items.length; i++)
        assert.equal(
          positions.get(items[i].id),
          positions.get(items[i - 1].id)! + 1,
          "silent gap between adjacent messages",
        );
    };
    const response = await f.raw(around(last));
    assert.equal(response.status, 200);
    assert(Buffer.byteLength(await response.text()) <= 256 * 1024);
    const firstPage = await f.client.query<TaskBrowserMessages>(around(last));
    assert(firstPage.items.length < 50, "fixture must trigger the byte cap");
    assert(firstPage.items.some((m) => (m.thinking?.length ?? 0) >= 4000));
    assert.equal(
      firstPage.items.at(-1)!.id,
      last,
      "backward trimming must retain its anchor",
    );
    for (const cursorMode of [false, true]) {
      let page = firstPage,
        seen = new Set<string>(),
        rounds = 0;
      for (;;) {
        contiguous(page.items);
        for (const m of page.items) seen.add(m.id);
        assert(++rounds < 40);
        if (!page.before) break;
        const previousFirst = positions.get(page.items[0].id)!;
        const next = await f.client.query<TaskBrowserMessages>(
          cursorMode
            ? route +
                "?thinking=true&direction=before&limit=50&cursor=" +
                encodeURIComponent(page.before)
            : around(page.items[0].id),
        );
        assert.equal(
          positions.get(next.items.at(-1)!.id),
          previousFirst - (cursorMode ? 1 : 0),
        );
        assert(
          positions.get(next.items[0].id)! < previousFirst,
          "backward paging must advance",
        );
        page = next;
      }
      assert.deepEqual(seen, new Set(ids));
    }
    let corrupt = false;
    const b = new TaskBrowserWindow(
      {
        query: async <T>(resource: string): Promise<T> => {
          const value = await f.client.query<T>(resource);
          if (corrupt && resource.includes("direction=before")) {
            const anchor = new URLSearchParams(
              resource.slice(resource.indexOf("?") + 1),
            ).get("message_id");
            const page = value as TaskBrowserMessages;
            return {
              ...page,
              items: page.items.filter((m) => m.id !== anchor),
            } as T;
          }
          return value;
        },
      },
      () => true,
    );
    try {
      await b.open(p.id);
      for (let n = 0; b.groups.get(e.id)!.after; n++) {
        assert(n < 40);
        await b.page("after", `page:${e.id}:after`);
        contiguous(b.groups.get(e.id)!.items);
      }
      b.viewport([
        {
          item_id: e.id + ":" + last,
          measured_width: 80,
          region: "body",
          block_start_utf16: 0,
          row_in_block: 0,
        },
      ]);
      await b.refresh();
      assert.equal(b.groups.get(e.id)!.items.at(-1)!.id, last);
      const retained = b.groups.get(e.id)!.items.map((m) => m.id);
      corrupt = true;
      await b.page("before", `page:${e.id}:before`);
      assert.match(b.error, /TASK_MESSAGE_WINDOW_GAP/);
      assert.deepEqual(
        b.groups.get(e.id)!.items.map((m) => m.id),
        retained,
      );
      assert(b.groups.get(e.id)!.before);
      corrupt = false;
      b.clearError();
      for (let n = 0; b.groups.get(e.id)!.before; n++) {
        assert(n < 40);
        await b.page("before", `page:${e.id}:before`);
        contiguous(b.groups.get(e.id)!.items);
      }
      assert.deepEqual(
        b.groups.get(e.id)!.items.map((m) => m.id),
        ids,
      );
    } finally {
      b.stop();
    }
  }));
