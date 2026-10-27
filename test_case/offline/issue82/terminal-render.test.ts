import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { TuiApp } from "../../../src/pi_secretary/src/tui/app.ts";
import {
  Palette,
  renderDraft,
  safeText,
} from "../../../src/pi_secretary/src/tui/terminal-render.ts";
import {
  LocalTerminal,
  RESTORE,
  filterOutput,
} from "../../../src/pi_secretary/src/tui/terminal-io.ts";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import ts from "typescript";
test("terminal renderer maps CJK, tabs, controls and canonical selection before inserting its own cursor", async () => {
  const app = new TuiApp({
    data: fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "terminal-render-"),
    ),
    mode: "fixture",
    quota: 256 * 1024 * 1024,
    maxOutbox: 1000,
    aliases: {},
  });
  await app.store.open();
  try {
    app.editor().insert("中\tA\x1b]52;c;bad\x07\n😀e\u0301", "typed");
    app.editor().select({ anchor: 1, head: 2 });
    const rendered = renderDraft(app.snapshot(), 80);
    assert.deepEqual(rendered.positions.get(1), { row: 0, column: 2 });
    assert.deepEqual(rendered.positions.get(2), { row: 0, column: 6 });
    assert.equal(rendered.lines.join("").split(CURSOR_MARKER).length - 1, 1);
    assert.ok(!rendered.lines.join("").includes("\x1b]52;"));
    assert.match(rendered.lines.join(""), /⟨001b⟩/);
    assert.equal(safeText("\t\x1b_Gx\x1b\\"), "    ⟨001b⟩_Gx⟨001b⟩\\");
    const narrow = renderDraft(app.snapshot(), 4);
    assert.ok(narrow.lines.length > 1);
  } finally {
    await app.close();
  }
});
test("Apple Terminal chooses 256 colours despite TERM/COLORTERM; explicit none never emits ANSI", () => {
  assert.equal(
    new Palette("auto", {
      TERM_PROGRAM: "Apple_Terminal",
      COLORTERM: "truecolor",
    }).mode,
    "256",
  );
  assert.equal(
    new Palette("truecolor", { TERM_PROGRAM: "Apple_Terminal" }).mode,
    "truecolor",
  );
  assert.equal(new Palette("none").line("hello", 20), "hello");
  assert.throws(() => filterOutput("\x1b]52;c;bad\x07"), /FORBIDDEN/);
  assert.equal(filterOutput("x\x1b]8;;\x1b\\"), "x");
});
test("local terminal restores synchronously once and permanently rejects late writes; no restore before mode entry", () => {
  const input = Object.assign(new EventEmitter(), {
    isTTY: true,
    isRaw: false,
    read: () => null,
    setRawMode(v: boolean) {
      this.isRaw = v;
    },
    resume() {},
    pause() {},
  });
  let writes = "";
  const output = Object.assign(new EventEmitter(), {
    isTTY: true,
    columns: 80,
    rows: 24,
    write: (s: string) => {
      writes += s;
    },
  });
  const terminal = new LocalTerminal(
    () => {},
    () => {},
    () => {},
    input as any,
    output as any,
  );
  terminal.write("\x1b[?1049h");
  terminal.start(
    () => {},
    () => {},
  );
  terminal.activate();
  assert.equal(input.isRaw, true);
  terminal.stop();
  assert.equal(input.isRaw, false);
  assert.ok(writes.endsWith(RESTORE));
  const before = writes;
  terminal.stop();
  terminal.write("\x1b[?1049h");
  assert.equal(writes, before);
  const unopened = new LocalTerminal(
    () => {},
    () => {},
    () => {},
    input as any,
    output as any,
  );
  unopened.stop();
  assert.equal(writes, before);
});
test("product runtime imports exclude the retired browser listener and ws (type-only edges ignored)", () => {
  const visited = new Set<string>();
  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        statement.importClause?.isTypeOnly
      )
        continue;
      const spec = (statement.moduleSpecifier as ts.StringLiteral).text;
      assert.ok(
        !["node:http", "node:https", "ws"].includes(spec),
        file + " imports " + spec,
      );
      assert.ok(!/\/server\.ts$|\/web\//.test(spec), file + " imports " + spec);
      if (spec.startsWith(".")) visit(path.resolve(path.dirname(file), spec));
    }
  }
  visit(path.resolve("src/pi_secretary/src/tui/entry.ts"));
  assert.ok(visited.has(path.resolve("src/pi_secretary/src/tui/outbox.ts")));
});
test("pre-ready bytes never dispatch; EPIPE restores raw state and latches all later writes", () => {
  const input = Object.assign(new EventEmitter(), {
    isTTY: true,
    isRaw: false,
    read: () => null,
    setRawMode(v: boolean) {
      this.isRaw = v;
    },
    resume() {},
    pause() {},
  });
  let writes = "";
  const output = Object.assign(new EventEmitter(), {
    isTTY: true,
    columns: 80,
    rows: 24,
    write: (s: string) => {
      writes += s;
    },
  });
  const frames: unknown[] = [];
  let losses = 0;
  const terminal = new LocalTerminal(
    (frame) => frames.push(frame),
    () => {
      losses++;
      terminal.stop();
    },
    () => {},
    input as any,
    output as any,
  );
  terminal.start(
    () => {},
    () => {},
  );
  input.emit("data", Buffer.from("\x13startup"));
  assert.equal(frames.length, 0);
  assert.equal(terminal.discarded, 8);
  terminal.activate();
  input.emit("data", Buffer.from("中文"));
  assert.deepEqual(frames, [{ kind: "text", text: "中文" }]);
  output.emit("error", Object.assign(Error("closed"), { code: "EPIPE" }));
  assert.equal(losses, 1);
  assert.equal(input.isRaw, false);
  const before = writes;
  terminal.write("late");
  output.emit("error", Error("again"));
  assert.equal(writes, before);
  assert.equal(losses, 1);
});
