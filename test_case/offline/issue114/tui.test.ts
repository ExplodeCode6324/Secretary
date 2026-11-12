import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../issue9/helpers.ts";
import { TaskBrowserWindow } from "../../../src/pi_secretary/src/tui/task-browser.ts";
import { safeText } from "../../../src/pi_secretary/src/tui/view.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";

test("terminal detail renders Core-host path and planned/verified status from the API", () =>
  fixture(async (f) => {
    const p = f.app.scheduler.propose(
      "shared terminal",
      id(),
      f.app.host.sessionID,
    );
    const browser = new TaskBrowserWindow(f.client, () => false);
    try {
      await browser.open(p.id);
      const text = () =>
        safeText(
          browser
            .entries()
            .find((e) => e.id === "task-workspace")!
            .component.render(180)
            .join("\n"),
        );
      assert.match(text(), /Core 主机工作目录/);
      assert.match(text(), /SHARED.*planned/);
      assert(text().includes(f.app.scheduler.workspace));
      f.app.scheduler.tick();
      await f.app.scheduler.idle();
      await browser.open(p.id);
      assert.match(text(), /SHARED.*verified/);
    } finally {
      browser.stop();
    }
  }));
