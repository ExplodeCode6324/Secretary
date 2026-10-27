import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TuiApp } from "../../../src/pi_secretary/src/tui/app.ts";
import {
  TerminalInput,
  ACTIONS,
} from "../../../src/pi_secretary/src/tui/terminal-input.ts";
import { Clipboard } from "../../../src/pi_secretary/src/tui/clipboard.ts";
import { flatten } from "../../../src/pi_secretary/src/tui/editor.ts";
async function harness(clipboard = new Clipboard("linux")) {
  const app = new TuiApp({
    data: fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "terminal-input-"),
    ),
    mode: "fixture",
    quota: 256 * 1024 * 1024,
    maxOutbox: 1000,
    aliases: {},
  });
  await app.store.open();
  let paint: NodeJS.Immediate | undefined;
  const input = new TerminalInput(
    app,
    () => {
      paint ??= setImmediate(() => {
        paint = undefined;
        input.afterPaint();
      });
    },
    clipboard,
  );
  app.presentation = {
    publish: () => input.afterPaint(),
    notify: (v) => input.notify(v),
    close: () => {
      clearImmediate(paint);
      input.close();
    },
  };
  input.connect();
  const key = (text: string) => input.receive({ kind: "key", text });
  const text = (text: string) => input.receive({ kind: "text", text });
  const paste = (text: string) => input.receive({ kind: "paste", text });
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setImmediate(r));
      await input.idle();
    }
  };
  const action = async (name: (typeof ACTIONS)[number]) => {
    key("\x14");
    await settle();
    for (let i = 0; i < ACTIONS.indexOf(name); i++) {
      key("\t");
      await settle();
    }
    key("\r");
    await settle();
  };
  return {
    app,
    input,
    key,
    text,
    paste,
    settle,
    action,
    value: () => flatten(app.editor().draft.nodes),
    close: () => app.close(),
  };
}
test("terminal typed and paste input keep provenance, explicit submission and Task isolation", async () => {
  const h = await harness();
  try {
    h.text("中文");
    h.key("\r");
    h.paste("/quit\r\n😀\t");
    await h.settle();
    assert.equal(h.value(), "中文\n/quit\n😀\t");
    assert.equal(h.app.store.state.outbox.length, 0);
    assert.equal(h.app.editor().draft.nodes.at(-1)?.kind, "paste");
    await h.action("Undo");
    await h.action("Redo");
    assert.equal(h.value(), "中文\n/quit\n😀\t");
    h.key("\x07");
    h.text("/T");
    h.key("\x13");
    await h.settle();
    h.text("Task独立");
    h.key("\x13");
    await h.settle();
    assert.equal(h.app.store.state.view, "Task");
    assert.equal(h.value(), "Task独立");
    assert.equal(h.app.store.state.outbox.length, 0);
    h.key("\x07");
    h.text("/M");
    h.key("\x13");
    await h.settle();
    assert.equal(h.value(), "中文\n/quit\n😀\t");
  } finally {
    await h.close();
  }
});
test("large-edit confirmation retains earlier benign input, refuses later input and never replays Submit", async () => {
  for (const accept of [true, false]) {
    const h = await harness();
    try {
      const large = "p".repeat(600 * 1024);
      h.paste(large);
      h.text("a");
      h.key("\x13");
      await h.settle();
      assert.equal(h.value(), "");
      assert.equal(h.app.snapshot().largeConfirmation, true);
      h.text("refused");
      h.key("\x13");
      await h.settle();
      assert.match(h.input.refusal, /Apply or Cancel/);
      await h.action(accept ? "Apply large edit" : "Cancel large edit");
      assert.equal(h.value(), (accept ? large : "") + "a");
      assert.equal(h.app.store.state.outbox.length, 0);
      h.text("z");
      await h.settle();
      assert.equal(h.value(), (accept ? large : "") + "az");
    } finally {
      await h.close();
    }
  }
});
test("undersize preserves confirmation, permits inspection and requires Resume after restoring size", async () => {
  const h = await harness();
  try {
    h.paste("p".repeat(600 * 1024));
    await h.settle();
    h.input.resize(30, 8);
    assert.equal(h.app.snapshot().largeConfirmation, true);
    assert.equal(h.app.outbox.needsResume, true);
    await h.action("Apply large edit");
    assert.equal(h.value(), "");
    assert.match(h.input.refusal, /TOO_SMALL/);
    await h.action("Cancel large edit");
    assert.equal(h.app.snapshot().largeConfirmation, false);
    h.key("\x07");
    h.text("/outbox");
    h.key("\x13");
    await h.settle();
    assert.match(h.app.snapshot().panel, /Outbox page empty/);
    h.key("\x1b");
    h.key("\x15");
    await h.settle();
    h.input.resize(100, 24);
    assert.equal(h.app.outbox.needsResume, true);
    await h.action("Resume");
    assert.equal(h.app.outbox.needsResume, false);
  } finally {
    await h.close();
  }
});
test("action-bar paste is editor data and mark is a reachable selection route", async () => {
  const h = await harness();
  try {
    h.key("\x14");
    await h.settle();
    h.paste("/quit");
    await h.settle();
    assert.equal(h.value(), "/quit");
    assert.equal(h.input.bar, false);
    h.key("\x01");
    await h.settle();
    await h.action("Set mark / Clear mark");
    h.key("\x06");
    h.key("\x06");
    await h.settle();
    assert.equal(h.app.editor().selectedText(), "/q");
    await h.action("Cut");
    await h.settle();
    assert.equal(h.value(), "/quit");
    assert.match(h.app.notice, /Clipboard write failed/);
  } finally {
    await h.close();
  }
});
test("empty paste keeps selected draft; quarantine refusal survives repaint and needs explicit recovery", async () => {
  const h = await harness();
  try {
    h.text("retained");
    await h.settle();
    h.app.editor().select({ anchor: 0, head: 8 });
    h.paste("");
    await h.settle();
    assert.equal(h.value(), "retained");
    h.input.fail("synthetic invalid bytes");
    h.app.presentation.publish?.();
    await h.settle();
    assert.match(h.input.refusal, /synthetic invalid/);
    h.key("\x13");
    await h.settle();
    assert.match(h.input.refusal, /QUARANTINED/);
    assert.equal(h.value(), "retained");
    await h.action("Resume");
    assert.equal(h.input.quarantined, false);
  } finally {
    await h.close();
  }
});
test("over-capacity paste never opens confirmation or replays queued intentions", async () => {
  const h = await harness();
  try {
    h.paste("x".repeat(4 * 1024 * 1024 + 1));
    h.key("\x13");
    await h.settle();
    assert.equal(h.value(), "");
    assert.equal(h.app.snapshot().largeConfirmation, false);
    assert.equal(h.app.store.state.outbox.length, 0);
  } finally {
    await h.close();
  }
});
test("clipboard import stays asynchronous and a changed selection refuses its stale completion", async () => {
  let release!: (text: string) => void;
  class Delayed extends Clipboard {
    override read() {
      return new Promise<string>((r) => {
        release = r;
      });
    }
  }
  const h = await harness(new Delayed());
  try {
    h.text("before");
    await h.settle();
    await h.action("Import clipboard text");
    h.text("after");
    await h.settle();
    assert.equal(h.value(), "beforeafter");
    release("/quit\x13");
    await h.settle();
    assert.equal(h.value(), "beforeafter");
    assert.match(h.input.refusal, /STALE_CLIPBOARD_IMPORT/);
    assert.equal(h.app.store.state.outbox.length, 0);
  } finally {
    await h.close();
  }
});
test("delayed successful clipboard write cannot cut across a lease rotation", async () => {
  let release!: () => void;
  class Delayed extends Clipboard {
    override write(_text: string) {
      return new Promise<void>((r) => {
        release = r;
      });
    }
  }
  const h = await harness(new Delayed());
  try {
    h.text("retain original");
    await h.settle();
    h.app.editor().select({ anchor: 0, head: 6 });
    await h.action("Cut");
    h.input.resize(30, 8);
    release();
    await h.settle();
    assert.equal(h.value(), "retain original");
    assert.match(h.input.refusal, /STALE/);
  } finally {
    await h.close();
  }
});
test("batched action-bar navigation preserves key order while a decision is pending", async () => {
  const h = await harness();
  try {
    h.paste("p".repeat(600 * 1024));
    await h.settle();
    h.key("\x14");
    await h.settle();
    for (let i = 0; i < 11; i++) h.key("\t");
    h.key("\r");
    await h.settle();
    assert.equal(h.app.snapshot().largeConfirmation, false);
    assert.equal(h.value(), "");
    assert.equal(h.app.store.state.outbox.length, 0);
  } finally {
    await h.close();
  }
});
test("pre-decision action-bar Enter cannot replay Submit after Cancel", async () => {
  const h = await harness();
  let submits = 0;
  const event = h.app.event.bind(h.app);
  h.app.event = async (value, generation) => {
    const v = value as Record<string, unknown>;
    if (v.type === "action" && v.action === "submit") submits++;
    return event(value, generation);
  };
  try {
    h.text("original");
    await h.settle();
    h.paste("p".repeat(600 * 1024));
    h.key("\x14");
    h.key("\r");
    await h.settle();
    await h.action("Cancel large edit");
    assert.equal(submits, 0);
    assert.equal(h.value(), "original");
    assert.match(h.input.refusal, /across a decision/);
  } finally {
    await h.close();
  }
});
test("delayed Cut cannot consume or cross a large-edit decision", async () => {
  for (const cancelFirst of [false, true]) {
    let release!: () => void;
    class Delayed extends Clipboard {
      override write(_text: string) {
        return new Promise<void>((r) => {
          release = r;
        });
      }
    }
    const h = await harness(new Delayed());
    try {
      h.text("selected");
      await h.settle();
      h.app.editor().select({ anchor: 0, head: 8 });
      await h.action("Cut");
      h.paste("p".repeat(600 * 1024));
      await h.settle();
      assert.equal(h.app.snapshot().largeConfirmation, true);
      if (cancelFirst) await h.action("Cancel large edit");
      release();
      await h.settle();
      assert.equal(h.value(), "selected");
      assert.equal(h.app.snapshot().largeConfirmation, !cancelFirst);
      assert.match(h.input.refusal, /STALE_CUT/);
    } finally {
      await h.close();
    }
  }
});
test("replacement requires a new Submit after its first paint", async () => {
  const h = await harness();
  try {
    h.text("original");
    await h.settle();
    h.key("\x07");
    h.text("/send replacement");
    h.key("\x13");
    h.key("\x13");
    await h.settle();
    assert.equal(h.app.snapshot().replacement, true);
    assert.match(h.input.refusal, /across a decision/);
    assert.equal(h.app.store.state.outbox.length, 0);
    assert.equal(flatten(h.app.store.editors.Main.draft.nodes), "original");
    h.key("\x13");
    await h.settle();
    assert.match(h.input.refusal, /CORE_NOT_ATTACHED/);
  } finally {
    await h.close();
  }
});
test("clipboard import completion waits for the controller queue and checks its final state", async () => {
  let releaseRead!: (text: string) => void;
  class Delayed extends Clipboard {
    override read() {
      return new Promise<string>((r) => {
        releaseRead = r;
      });
    }
  }
  const h = await harness(new Delayed());
  let releaseEvent!: () => void;
  const event = h.app.event.bind(h.app);
  let blocked = false;
  h.app.event = async (value, generation) => {
    const v = value as Record<string, unknown>;
    if (v.type === "insert" && v.text === "later") {
      blocked = true;
      await new Promise<void>((r) => {
        releaseEvent = r;
      });
    }
    return event(value, generation);
  };
  try {
    h.text("original");
    await h.settle();
    await h.action("Import clipboard text");
    h.text("later");
    while (!blocked) await new Promise((r) => setImmediate(r));
    releaseRead("imported");
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.equal(h.value(), "original");
    releaseEvent();
    await h.settle();
    assert.equal(h.value(), "originallater");
    assert.match(h.input.refusal, /STALE_CLIPBOARD_IMPORT/);
  } finally {
    releaseEvent?.();
    await h.close();
  }
});
test("coalesced consecutive pastes survive framing and trailing-control quarantine preserves completed data", async () => {
  const { TerminalStream } =
    await import("../../../src/pi_secretary/src/tui/terminal-stream.ts");
  for (const tail of ["", "\x13"]) {
    const h = await harness();
    const stream = new TerminalStream((frame) => h.input.receive(frame));
    try {
      stream.feed(
        Buffer.from("\x1b[200~first\x1b[201~\x1b[200~第二\x1b[201~" + tail),
      );
      await h.settle();
      assert.equal(h.value(), "first第二");
      assert.equal(h.input.quarantined, !!tail);
      assert.equal(h.app.store.state.outbox.length, 0);
    } finally {
      stream.reset();
      await h.close();
    }
  }
});
test("exit retains benign text queued behind an asynchronous controller action", async () => {
  const h = await harness();
  let release!: () => void,
    began = false;
  let finish!: (saved: boolean) => void;
  const exited = new Promise<boolean>((r) => {
    finish = r;
  });
  h.app.onExit = finish;
  const event = h.app.event.bind(h.app);
  h.app.event = async (value, generation) => {
    const v = value as Record<string, unknown>;
    if (v.type === "action" && v.action === "submit") {
      began = true;
      await new Promise<void>((r) => {
        release = r;
      });
      return;
    }
    return event(value, generation);
  };
  h.key("\x13");
  while (!began) await new Promise((r) => setImmediate(r));
  h.text("queued 中文");
  h.key("\x13");
  h.key("\x03");
  release();
  assert.equal(await exited, true);
  assert.equal(h.value(), "queued 中文");
  assert.equal(h.app.store.state.outbox.length, 0);
});
test("terminal adapter keeps 4 MiB draft key handling below the existing 500 ms budget without full snapshots", async () => {
  const h = await harness();
  try {
    h.app.editor().insert("p".repeat(4 * 1024 * 1024), "paste", true);
    let snapshots = 0;
    const snapshot = h.app.snapshot.bind(h.app);
    h.app.snapshot = () => {
      snapshots++;
      return snapshot();
    };
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      h.key(i % 2 ? "\x06" : "\x02");
      await h.settle();
      assert.ok(
        performance.now() - start < 500,
        "adapter key ACK exceeded 500 ms",
      );
    }
    assert.equal(snapshots, 0);
  } finally {
    await h.close();
  }
});
test("authority captured behind a visible Cancel cannot execute after the decision resolves", async () => {
  const h = await harness();
  let submits = 0;
  const event = h.app.event.bind(h.app);
  h.app.event = async (v, g) => {
    if ((v as any).action === "submit") submits++;
    return event(v, g);
  };
  try {
    h.paste("p".repeat(600 * 1024));
    await h.settle();
    h.key("\x14");
    await h.settle();
    for (let i = 0; i < 11; i++) h.key("\t");
    h.key("\r");
    h.key("\x14");
    h.key("\r");
    await h.settle();
    assert.equal(h.app.decisionState.large, false);
    assert.equal(submits, 0);
    assert.match(h.input.refusal, /across a decision/);
  } finally {
    await h.close();
  }
});
