import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, type Fixture } from "../issue9/helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import type {
  Execution,
  Guidance,
  Input,
} from "../../../src/pi_secretary/src/contracts.ts";
import { GuidanceDelivery } from "../../../src/pi_secretary/src/tui/guidance-delivery.ts";
import {
  LocalFiles,
  freshState,
  exportLegacyState,
} from "../../../src/pi_secretary/src/tui/state.ts";
import { DraftEditor } from "../../../src/pi_secretary/src/tui/input.ts";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import { parseGuide } from "../../../src/pi_secretary/src/tui/guide-command.ts";
import type { DeliveryClient } from "../../../src/pi_secretary/src/tui/delivery.ts";
async function setup(f: Fixture) {
  const p = f.app.scheduler.propose(
    "Read and report",
    id(),
    f.app.host.sessionID,
    {
      title_candidate: "精确 目标",
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
  const core = await f.client.core();
  const files = new LocalFiles(path.join(f.dir, "state"));
  const state = await files.open(core.data_domain_id, core.mode);
  const d = new GuidanceDelivery(state, files);
  await d.connect(f.client);
  const editor = new DraftEditor(
    new TuiAltScreen(new VirtualTerminal()),
    () => "Task",
  );
  editor.handleInput('/guide "精确 目标" 1 ');
  editor.handleInput("\x1b[200~  中文\n保留  \x1b[201~");
  const raw = editor.getExpandedText(),
    snapshot = editor.snapshot();
  state.drafts.Task = { raw, snapshot, generation: 1 };
  const send = () => d.submit(raw, snapshot, parseGuide(raw)!);
  const wrap = (changes: Partial<DeliveryClient>): DeliveryClient => ({
    endpoint: f.client.endpoint,
    core: f.client.core.bind(f.client),
    query: f.client.query.bind(f.client),
    command: f.client.command.bind(f.client),
    syncCursor: f.client.syncCursor.bind(f.client),
    changes: f.client.changes.bind(f.client),
    ...changes,
  });
  return { d, state, files, e, raw, snapshot, send, wrap };
}
test("actual HTTP acceptance binds bytes and IDs, persists before send, clears only Task; replay is read-only", () =>
  fixture(async (f) => {
    const x = await setup(f);
    try {
      x.state.drafts.Main.raw = "Main preserved";
      let posts = 0;
      await x.d.connect(
        x.wrap({
          command: async (route, body) => {
            posts++;
            const disk = JSON.parse(
              await fs.readFile(
                path.join(x.files.directory, "state.json"),
                "utf8",
              ),
            );
            assert.equal(disk.guidancePending.body.text, body.text);
            assert(
              disk.guidancePending.attempts.includes(
                f.client.endpoint.instance_id,
              ),
            );
            assert.equal(disk.drafts.Task.raw, x.raw);
            return f.client.command(route, body);
          },
        }),
      );
      await x.send();
      assert.equal(posts, 1);
      assert.equal(x.state.guidancePending, undefined);
      assert.equal(x.state.guidanceLast?.status, "ACCEPTED");
      assert.equal(x.state.drafts.Task.raw, "");
      assert.equal(x.state.drafts.Main.raw, "Main preserved");
      assert.equal(f.app.store.all<Guidance>("Guidance").length, 1);
      assert.equal(
        f.app.store.all<Input>("Input").filter((i) => i.guidance_id).length,
        1,
      );
      await x.d.reconcile();
      assert.equal(posts, 1);
      assert.throws(
        () => exportLegacyState(x.state),
        /LEGACY_EXPORT_HAS_GUIDANCE/,
      );
    } finally {
      x.d.close();
      await x.files.close();
    }
  }));
test("lost response accepted before target ends: receipt wins after restart, no second POST", () =>
  fixture(async (f) => {
    const x = await setup(f);
    let posts = 0;
    try {
      await x.d.connect(
        x.wrap({
          command: async (route, body) => {
            posts++;
            await f.client.command(route, body);
            throw Error("NETWORK_LOST");
          },
        }),
      );
      await x.send();
      assert.equal(x.state.guidancePending?.status, "UNKNOWN");
      f.app.scheduler.cancel(x.e.id);
      x.d.close();
      await x.files.close();
      const state = await x.files.open(x.state.domain, x.state.mode);
      const d = new GuidanceDelivery(state, x.files);
      await d.connect(
        x.wrap({
          command: async () => {
            throw Error("RECONNECT_POST_FORBIDDEN");
          },
        }),
      );
      await d.reconcile();
      assert.equal(state.guidanceLast?.status, "ACCEPTED");
      assert.equal(state.guidancePending, undefined);
      assert.equal(posts, 1);
      d.close();
    } finally {
      await x.files.close();
    }
  }));
test("never-arrived then terminal releases by ordered reads; live cancellation uncertainty stays pending", () =>
  fixture(async (f) => {
    const x = await setup(f);
    try {
      await x.d.connect(
        x.wrap({
          command: async () => {
            throw Error("TIMEOUT");
          },
        }),
      );
      await x.send();
      await x.d.reconcile();
      assert(x.state.guidancePending);
      f.app.scheduler.cancel(x.e.id);
      await x.d.reconcile();
      assert.equal(x.state.guidancePending, undefined);
      assert.equal(x.state.guidanceLast?.status, "NOT_ACCEPTED");
      assert.equal(x.state.drafts.Task.raw, x.raw);
      assert(x.state.guidanceRecovery);
      assert.equal(f.app.store.all<Guidance>("Guidance").length, 0);
    } finally {
      x.d.close();
      await x.files.close();
    }
  }));
test("accepted detail read failure never resends; newer Task draft and undo provenance survive settlement", () =>
  fixture(async (f) => {
    const x = await setup(f);
    let fail = true,
      posts = 0;
    try {
      await x.d.connect(
        x.wrap({
          command: async (route, body) => {
            posts++;
            return f.client.command(route, body);
          },
          query: async <T>(route: string, options?: { timeoutMs?: number }) => {
            if (fail && route.startsWith("guidance/")) throw Error("TRANSIENT");
            return f.client.query<T>(route, options);
          },
        }),
      );
      await x.send();
      assert.equal(
        x.state.guidancePending?.status,
        "ACCEPTED_VERIFICATION_PENDING",
      );
      await x.d.retry();
      assert.equal(posts, 1);
      x.state.drafts.Task = { raw: "new draft", generation: 2 };
      fail = false;
      await x.d.reconcile();
      assert.equal(x.state.guidancePending, undefined);
      assert.equal(x.state.drafts.Task.raw, "new draft");
      assert.equal(posts, 1);
    } finally {
      x.d.close();
      await x.files.close();
    }
  }));
test("pre-dispatch disk fault sends nothing and failed accepted checkpoint keeps outbox and original", () =>
  fixture(async (f) => {
    const x = await setup(f);
    let posts = 0,
      fail = true;
    const save = x.files.save.bind(x.files);
    x.files.save = async (s) => {
      if (fail) throw Error("DISK_FULL");
      await save(s);
    };
    try {
      await x.d.connect(
        x.wrap({
          command: async (route, body) => {
            posts++;
            return f.client.command(route, body);
          },
        }),
      );
      await x.send();
      assert.equal(posts, 0);
      assert.equal(x.state.drafts.Task.raw, x.raw);
      fail = false;
      await x.d.retry();
      assert.equal(posts, 1);
      assert.equal(x.state.guidanceLast?.status, "ACCEPTED");
    } finally {
      x.d.close();
      await x.files.close();
    }
  }));
test("integrity mismatch exports and frees slot but tombstones same original submission; conflict needs explicit export", () =>
  fixture(async (f) => {
    const x = await setup(f);
    let posts = 0;
    try {
      await x.d.connect(
        x.wrap({
          command: async (route, body) => {
            posts++;
            return f.client.command(route, body);
          },
          query: async <T>(route: string, options?: { timeoutMs?: number }) => {
            const r: any = await f.client.query(route, options);
            return route.startsWith("guidance/")
              ? { ...r, text: "tampered" }
              : r;
          },
        }),
      );
      await x.send();
      assert.equal(x.state.guidancePending, undefined);
      assert.equal(
        x.state.guidanceLast?.status,
        "ACCEPTED_WITH_INTEGRITY_ERROR",
      );
      assert(x.state.guidanceRecovery);
      await x.send();
      assert.equal(posts, 1);
      x.state.drafts.Task.generation++; // Explicit editing creates a new submission.
      await x.d.connect(
        x.wrap({
          command: async () => {
            posts++;
            throw Error("REQUEST_CONFLICT");
          },
        }),
      );
      await x.send();
      assert.equal(
        (x.state.guidancePending as { status: string } | undefined)?.status,
        "CONFLICT",
      );
      await x.d.reconcile();
      assert(x.state.guidancePending);
      await x.d.exportConflict();
      assert.equal(x.state.guidancePending, undefined);
      const evidence = JSON.parse(
        await fs.readFile(
          path.join(x.files.directory, x.state.guidanceRecovery!.file),
          "utf8",
        ),
      );
      assert.equal(evidence.status, "CONFLICT");
      assert.equal(evidence.raw, x.raw);
    } finally {
      x.d.close();
      await x.files.close();
    }
  }));
test("v3 migration, immutable queued snapshot, lock exclusion, corrupted envelope fails closed", () =>
  fixture(async (f) => {
    const x = await setup(f);
    try {
      await x.d.connect(
        x.wrap({
          command: async () => {
            throw Error("TIMEOUT");
          },
        }),
      );
      await x.send();
      await assert.rejects(
        new LocalFiles(x.files.directory).open(x.state.domain, x.state.mode),
        /OWNED/,
      );
      const saving = x.files.save(x.state);
      x.state.guidancePending!.body.text = "mutated";
      await saving;
      const saved = JSON.parse(
        await fs.readFile(path.join(x.files.directory, "state.json"), "utf8"),
      );
      assert.notEqual(saved.guidancePending.body.text, "mutated");
      x.d.close();
      await x.files.close();
      saved.guidancePending.sha256 = "bad";
      await fs.writeFile(
        path.join(x.files.directory, "state.json"),
        JSON.stringify(saved),
        { mode: 0o600 },
      );
      await assert.rejects(
        x.files.open(x.state.domain, x.state.mode),
        /INVALID_GUIDANCE/,
      );
      const legacy = freshState(x.state.domain, x.state.mode);
      legacy.version = 3;
      legacy.drafts.Task.raw = "old";
      await fs.writeFile(
        path.join(x.files.directory, "state.json"),
        JSON.stringify(legacy),
        { mode: 0o600 },
      );
      const upgraded = await x.files.open(x.state.domain, x.state.mode);
      assert.equal(upgraded.version, 4);
      assert.equal(upgraded.drafts.Task.raw, "old");
      assert(
        (await fs.readdir(x.files.directory)).some((n) =>
          n.startsWith("v3-before-upgrade"),
        ),
      );
    } finally {
      x.d.close();
      await x.files.close();
    }
  }));

test("accepted final-save failure cannot overwrite a new draft edited while fsync is pending", () =>
  fixture(async (f) => {
    const x = await setup(f);
    const save = x.files.save.bind(x.files);
    let fail = true;
    try {
      x.files.save = async (state) => {
        if (
          fail &&
          state.guidanceLast?.status === "ACCEPTED" &&
          !state.guidancePending
        ) {
          fail = false;
          state.drafts.Task = { raw: "edited during fsync", generation: 9 };
          throw Error("FINAL_FSYNC_FAILED");
        }
        return save(state);
      };
      await x.send();
      assert.equal(x.state.drafts.Task.raw, "edited during fsync");
      assert.equal(x.state.guidancePending?.status, "ACCEPTED");
      await x.d.reconcile();
      assert.equal(x.state.guidancePending, undefined);
      assert.equal(x.state.drafts.Task.raw, "edited during fsync");
      assert.equal(f.app.store.all<Guidance>("Guidance").length, 1);
    } finally {
      x.d.close();
      await x.files.close();
    }
  }));
test("captured title/body cannot retarget when editor changes during resolver await; cached monotone limits reject without POST", () =>
  fixture(async (f) => {
    const x = await setup(f);
    let posts = 0;
    try {
      await x.d.connect(
        x.wrap({
          query: async <T>(route: string, options?: { timeoutMs?: number }) => {
            const result = await f.client.query<T>(route, options);
            if (route.startsWith("task-browser/resolve"))
              x.state.drafts.Task = {
                raw: "/guide other 9 newer",
                generation: 2,
              };
            return result;
          },
          command: async (route, body) => {
            posts++;
            return f.client.command(route, body);
          },
        }),
      );
      await x.send();
      assert.equal(x.state.guidanceLast?.target.execution_id, x.e.id);
      assert.equal(x.state.drafts.Task.raw, "/guide other 9 newer");
      assert.equal(posts, 1);
      x.state.drafts.Task = { raw: x.raw, snapshot: x.snapshot, generation: 3 };
      x.d.knownGuidance = () =>
        Array.from({ length: 64 }, () => ({ text: "x" }) as any);
      await x.send();
      assert.equal(posts, 1);
      assert.match(x.d.hint, /GUIDANCE_LIMIT_REACHED/);
    } finally {
      x.d.close();
      await x.files.close();
    }
  }));
