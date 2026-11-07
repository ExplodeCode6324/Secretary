import { replyStream } from "../../../src/pi_secretary/src/model.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../issue9/helpers.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import { guidanceFor } from "../../../src/pi_secretary/src/guidance.ts";
import type {
  Execution,
  Guidance,
  Input,
} from "../../../src/pi_secretary/src/contracts.ts";
import { TaskBrowserWindow } from "../../../src/pi_secretary/src/tui/task-browser.ts";
test("receipt pages refresh old revisions, preserve chronological SENT body and show MAIN without extra Main inputs", () =>
  fixture(async (f) => {
    const p = f.app.scheduler.propose(
      "bounded receipts",
      id(),
      f.app.host.sessionID,
      {
        preconditions: [
          {
            condition_id: id(),
            kind: "RESOURCE_PRESENT",
            target: "gate",
            required_revision: null,
          },
        ],
      },
    );
    f.app.scheduler.tick();
    await f.app.scheduler.idle();
    const e = f.app.store
      .all<Execution>("Execution")
      .find((e) => e.task_id === p.id)!;
    let calls = 0;
    Object.assign(f.app.host, {
      stream: () =>
        ++calls === 1
          ? replyStream([
              {
                type: "toolCall",
                id: "main-guide",
                name: "task_control",
                arguments: {
                  action: "guide",
                  id: e.id,
                  task_id: p.id,
                  text: "Main inspect only",
                },
              },
            ])
          : replyStream([{ type: "text", text: "Guidance sent." }]),
    });
    f.app.host.accept("Give this task guidance");
    await f.app.host.drain();
    const main = guidanceFor(f.app.store)
      .list(e.id)
      .find((g) => g.source === "MAIN")!;
    assert(main);
    assert.equal(
      f.app.store.all<Input>("Input").filter((i) => i.guidance_id === main.id)
        .length,
      0,
    );
    for (let n = 0; n < 43; n++)
      await f.client.command(`executions/${e.id}/guidance`, {
        request_id: id(),
        task_id: p.id,
        text: `body-${n} 中文`,
      });
    const window = new TaskBrowserWindow(f.client, () => false);
    try {
      await window.open(p.id);
      assert.equal(window.guidance.get(e.id)?.length, 44);
      const g = guidanceFor(f.app.store).list(e.id)[0];
      f.app.store.commit([
        revise(g, {
          received_at: new Date().toISOString(),
          guided_at: new Date().toISOString(),
          disposition: "CONFLICT",
          closed_reason: "Later requirement conflicts with prior adoption",
        }),
      ]);
      const before = f.app.store.all<Input>("Input").length;
      await window.refresh();
      assert.equal(window.guidance.get(e.id)?.[0].disposition, "CONFLICT");
      assert.equal(f.app.store.all<Input>("Input").length, before);
      const rows = window.entries().filter((x) => x.id === "guidance:" + g.id);
      assert.equal(rows.length, 1);
      const rendered = rows[0].component.render(100).join("\n");
      assert.match(rendered, /GUIDED/);
      assert.match(rendered, /CONFLICT/);
      assert(!rendered.includes("body-0"));
      await window.refresh();
      assert(
        window
          .entries()
          .find((x) => x.id === "guidance:" + main.id)
          ?.component.render(100)
          .join("\n")
          .includes("MAIN"),
      );
      assert.equal(f.app.store.all<Guidance>("Guidance").length, 44);
      const originalQuery = f.client.query.bind(f.client);
      let messageReads = 0;
      f.client.query = async (route, options) => {
        if (route.includes("/guidance?")) throw Error("RECEIPTS_OFFLINE");
        if (route.includes("/messages?")) messageReads++;
        return originalQuery(route, options);
      };
      await window.refresh();
      assert(messageReads > 0);
      assert.match(window.notice, /RECEIPTS_OFFLINE/);
      assert.equal(window.guidance.get(e.id)?.length, 44);
      f.client.query = originalQuery;
    } finally {
      window.stop();
    }
  }));
