/** Explicit real-provider follow-up; uses the isolated bounded server from test-issue91-live.ts. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { TerminalApp } from "../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import { StdinBuffer } from "@earendil-works/pi-tui";
import { until } from "../offline/issue9/helpers.ts";
const root = path.resolve(process.argv[2]),
  terminal = new VirtualTerminal(100, 30),
  ui = new TerminalApp(
    path.join(root, "core"),
    terminal,
    path.join(root, "navigation-state"),
  );
const stdin = new StdinBuffer();
stdin.on("data", (data) => terminal.sendInput(data));
stdin.on("paste", (data) =>
  terminal.sendInput("\x1b[200~" + data + "\x1b[201~"),
);
const read = async (name: string) =>
  JSON.parse(
    await fs.readFile(path.join(root, name), "utf8").catch((e) => {
      if (e.code === "ENOENT")
        return name === "provider-ledger.json"
          ? '{"calls":[],"attempts":[],"posts":[]}'
          : "[]";
      throw e;
    }),
  );
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const anchor = () => {
  const a = ui.documents.Main.anchor;
  return a && [a.item_id, a.region, a.block_start_utf16, a.row_in_block];
};
const initialLedger = await read("provider-ledger.json");
const run = new Date().toISOString();
const snapshots: unknown[] = [],
  results: Record<string, unknown> = {
    driver:
      "TerminalApp + Pi VirtualTerminal/StdinBuffer + actual Core/provider",
    physical_clipboard: "NOT_TESTED",
    status: "RUNNING",
  };
let phase = "initial";
const timer = setInterval(
  () =>
    snapshots.push({
      at: new Date().toISOString(),
      phase,
      page: ui.page,
      anchor: anchor(),
      top: ui.scrolls.Main.scrollTop,
      atEnd: ui.scrolls.Main.atEnd,
      revisions: [...(ui.remote?.history.items.values() ?? [])].map((x) => [
        x.id,
        x.revision,
      ]),
    }),
  25,
);
const command = async (text: string) => {
  stdin.process(text);
  stdin.process("\x1b[13;2u");
  await pause(200);
};
async function quiet(expected: string) {
  const start = Date.now();
  while (Date.now() - start < 105000) {
    const ledger = await read("provider-ledger.json"),
      inputs = await read("core-inputs.json");
    if (
      inputs.some(
        (x: any) => x.payload.text === expected && x.state === "HANDLED",
      ) &&
      ledger.calls.every((x: any) => x.finished_at || x.error)
    ) {
      assert(ledger.calls.every((x: any) => !x.error));
      await pause(1200);
      return ledger;
    }
    await pause(100);
  }
  throw Error("MODEL_QUIESCENCE_TIMEOUT");
}
try {
  ui.start();
  await until(
    () =>
      !!ui.remote?.timelineReady &&
      ui.editors.Main.enabled &&
      !!ui.documents.Main.anchor,
    10000,
  );
  await terminal.flushAndGetViewport();
  for (let n = 0; n < 20; n++) {
    ui.scrolls.Main.scrollToEnd();
    ui.draw();
    await pause(200);
    if (ui.scrolls.Main.atEnd) break;
  }
  assert(ui.scrolls.Main.atEnd);
  const bottom = anchor();
  assert(bottom && bottom[0] !== "main-title");
  phase = "bottom";
  const prompt = `L2-BOTTOM-${run}: Produce 60 numbered lines about deterministic software testing, each at least 8 words. Do not use tools. Include the following two pasted tokens verbatim once: `;
  stdin.process(prompt);
  stdin.process("\x1b[200~SHORT_TOKEN\x1b[201~");
  stdin.process(" and ");
  stdin.process(
    "\x1b[200~LONG_TOKEN_abcdefghijklmnopqrstuvwxyz123456789\x1b[201~",
  );
  const expected = ui.editors.Main.getExpandedText();
  assert.equal(Object.keys(ui.editors.Main.snapshot().blocks).length, 1);
  stdin.process("\x1b[13;2u");
  const firstLedger = await quiet(expected);
  assert.deepEqual(anchor(), bottom);
  assert(!ui.scrolls.Main.atEnd);
  results.bottom = {
    status: "PASS",
    before: bottom,
    after: anchor(),
    attempts: firstLedger.attempts.length,
  };
  results.paste = {
    status: "PASS",
    exactCoreInput: true,
    expandedText: expected,
  };
  ui.scrolls.Main.scrollTo(
    Math.floor(ui.documents.Main.render(100).length / 2),
  );
  ui.draw();
  await pause(100);
  // Select an actual body row; this is an explicit scripted viewport operation.
  for (let i = 0; i < 20 && ui.documents.Main.anchor?.region !== "body"; i++)
    ui.scrolls.Main.scrollBy(1);
  const middle = anchor();
  assert.equal(middle?.[1], "body");
  phase = "middle-before-task";
  const second = `L2-TASK-AWAY-${run}: Produce 60 numbered lines about reversible UI state and scroll anchors, each at least 8 words. Do not use tools.`;
  stdin.process(second);
  stdin.process("\x1b[13;2u");
  await until(() => !ui.delivery?.busy && !ui.delivery?.state.pending, 10000);
  const start = Date.now();
  let streaming = false;
  while (Date.now() - start < 90000) {
    const ledger = await read("provider-ledger.json");
    if (
      ledger.calls.length > firstLedger.calls.length &&
      ledger.calls.some(
        (x: any) => x.first_event_at && !x.finished_at && !x.error,
      )
    ) {
      streaming = true;
      break;
    }
    await pause(50);
  }
  assert(streaming, "must leave while an actual provider call is streaming");
  await command("/T");
  assert.equal(ui.page, "Task");
  phase = "task-away";
  assert.deepEqual(anchor(), middle);
  const secondLedger = await quiet(second);
  assert.equal(ui.page, "Task");
  assert.deepEqual(anchor(), middle);
  await command("/M");
  assert.equal(ui.page, "Main");
  await pause(500);
  assert.deepEqual(anchor(), middle);
  results.taskAway = {
    status: "PASS",
    before: middle,
    after: anchor(),
    actualStreamingAtDeparture: true,
    attempts: secondLedger.attempts.length,
  };
  // Reposition onto the actual last assistant body before the read-only CoT toggles.
  ui.scrolls.Main.scrollToEnd();
  ui.draw();
  await pause(300);
  for (let i = 0; i < 30 && ui.documents.Main.anchor?.region !== "body"; i++)
    ui.scrolls.Main.scrollBy(-1);
  const cotAnchor = anchor();
  assert.equal(cotAnchor?.[1], "body");
  phase = "cot";
  const beforeCursor = await ui.delivery!.client!.syncCursor();
  await command("/CoTv");
  await until(() => !!ui.remote?.history.thinking, 10000);
  await pause(1200);
  assert.deepEqual(anchor(), cotAnchor);
  const expanded = [...ui.remote!.messages.values()].filter(
    (x) => x.kind === "message" && x.thinking,
  );
  assert(expanded.length > 0, "provider-exposed CoT is present");
  await command("/cotvisible");
  await until(() => !ui.remote?.history.thinking, 10000);
  await pause(1200);
  assert.deepEqual(anchor(), cotAnchor);
  const afterCursor = await ui.delivery!.client!.syncCursor(),
    finalLedger = await read("provider-ledger.json");
  assert.deepEqual(afterCursor, beforeCursor);
  assert.equal(finalLedger.attempts.length, secondLedger.attempts.length);
  assert.equal(finalLedger.posts.length, initialLedger.posts.length + 2);
  results.cot = {
    status: "PASS",
    before: cotAnchor,
    after: anchor(),
    providerExposedRegions: expanded.length,
    syncCursorUnchanged: true,
  };
  // Exact input equality is also checked at the real provider request boundary.
  const providerRequests = await Promise.all(
    finalLedger.attempts.map((x: any) =>
      read(`provider-request-${x.number}.json`),
    ),
  );
  assert(
    providerRequests.some((request: any) =>
      JSON.stringify(request.messages).includes(expected),
    ),
  );
  results.status = "PASS";
  results.http = finalLedger.attempts.map((x: any) => ({
    number: x.number,
    status: x.status,
  }));
} catch (error) {
  results.status = "FAIL";
  results.error = String(error);
  throw error;
} finally {
  clearInterval(timer);
  stdin.destroy();
  await ui.close();
  await fs.writeFile(
    path.join(root, "navigation-result.json"),
    JSON.stringify(results, null, 2),
    { mode: 0o600 },
  );
  await fs.writeFile(
    path.join(root, "navigation-snapshots.json"),
    JSON.stringify(snapshots, null, 2),
    { mode: 0o600 },
  );
}
