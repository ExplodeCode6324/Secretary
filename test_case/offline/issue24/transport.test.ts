import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Store } from "../../../src/pi_secretary/src/store.ts";
import { JournalOwner } from "../../../src/pi_secretary/src/store-lock.ts";
const source = fs.readFileSync(
  new URL("../../../src/pi_secretary/src/lock.py", import.meta.url),
  "utf8",
);
const temporary = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "issue24-pipes-"));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ownerOf = (store: Store): any => (store as any).owner;

// Inject only through the internal constructor. The production helper has no
// environment variable, marker file, or test-dependent behavior.
function injected(t: any, dir: string, code: string) {
  const helperPath = path.join(dir, "helper.py");
  fs.writeFileSync(helperPath, code);
  const open = JournalOwner.open.bind(JournalOwner);
  t.mock.method(JournalOwner, "open", (directory: string) =>
    open(directory, { helperPath }),
  );
}
for (const [name, replacement] of [
  ["id", 'value["id"] = "wrong"'],
  ["sequence", 'value["sequence"] += 1'],
  ["digest", 'value["digest"] = "f" * 64'],
  [
    "invalid-json",
    'sys.stdout.write("invalid\\n"); sys.stdout.flush(); return',
  ],
  [
    "truncated-EOF",
    'sys.stdout.write("{\\\"id\\\":"); sys.stdout.flush(); os._exit(0)',
  ],
] as const) {
  test(`invalid ${name} ACK never installs, but reopen recovers fsynced transaction`, async (t) => {
    const dir = temporary();
    let store: Store | undefined;
    injected(
      t,
      dir,
      source.replace(
        "    sys.stdout.write(json.dumps(value)",
        `    if value["id"] != "open":\n        ${replacement}\n    sys.stdout.write(json.dumps(value)`,
      ),
    );
    try {
      store = await Store.open(dir);
      assert.throws(() => store!.commit([]), /STORE_NOT_OWNER/);
      assert.equal(store.sequence, 0);
      assert.equal(store.projectionFrames.length, 0);
      assert.throws(() => store!.commit([]), /STORE_NOT_OWNER/);
      await store.close();
      t.mock.restoreAll();
      store = await Store.open(dir);
      assert.equal(store.sequence, 1);
    } finally {
      await store?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
for (const phase of [
  "before-write",
  "partial-write",
  "after-fsync",
  "before-ACK",
] as const) {
  test(`helper death ${phase} preserves only complete durable prefix`, async (t) => {
    const dir = temporary();
    let store: Store | undefined;
    let code = source;
    const die = "os.kill(os.getpid(), 9)";
    if (phase === "before-write")
      code = code.replace(
        "                fd = os.open",
        `                ${die}\n                fd = os.open`,
      );
    if (phase === "partial-write")
      code = code.replace(
        "                    journal.write(frame)",
        `                    journal.write(frame[:17]); journal.flush(); os.fsync(journal.fileno()); ${die}\n                    journal.write(frame)`,
      );
    if (phase === "after-fsync")
      code = code.replace(
        "                sync_dir(directory)\n                sequence, digest",
        `                ${die}\n                sync_dir(directory)\n                sequence, digest`,
      );
    if (phase === "before-ACK")
      code = code.replace(
        '                reply(channel, {"id": request_id',
        `                ${die}\n                reply(channel, {"id": request_id`,
      );
    injected(t, dir, code);
    try {
      store = await Store.open(dir);
      assert.throws(() => store!.commit([]), /STORE_NOT_OWNER/);
      assert.equal(store.sequence, 0);
      assert.equal(store.projectionFrames.length, 0);
      await store.close();
      t.mock.restoreAll();
      store = await Store.open(dir);
      assert.equal(
        store.sequence,
        phase === "before-write" || phase === "partial-write" ? 0 : 1,
      );
      const tails = fs
        .readdirSync(dir)
        .filter((p) => p.startsWith("journal.jsonl.incomplete-"));
      assert.equal(tails.length, phase === "partial-write" ? 1 : 0);
      if (tails.length)
        assert.equal(fs.statSync(path.join(dir, tails[0])).size, 17);
      store.commit([]);
      await assert.rejects(Store.open(dir), /OWNER_BUSY/);
    } finally {
      await store?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("split ACK and a frame larger than pipe capacity complete without deadlock", async (t) => {
  const dir = temporary();
  let store: Store | undefined;
  injected(
    t,
    dir,
    source.replace(
      '    sys.stdout.write(json.dumps(value) + "\\n")',
      '    wire = json.dumps(value) + "\\n"\n    sys.stdout.write(wire[:5]); sys.stdout.flush()\n    import time; time.sleep(0.005)\n    sys.stdout.write(wire[5:])',
    ),
  );
  try {
    store = await Store.open(dir);
    store.commit(
      [],
      [store.event("large-pipe-frame-" + "x".repeat(4 * 1024 * 1024), {})],
    );
    assert.ok(
      fs.statSync(path.join(dir, "journal.jsonl")).size > 4 * 1024 * 1024,
    );
    await store.close();
    t.mock.restoreAll();
    store = await Store.open(dir);
    assert.equal(store.sequence, 1);
    assert.equal(store.logs.length, 1);
  } finally {
    await store?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const unsolicited of [false, true])
  test(`${unsolicited ? "unsolicited" : "duplicate"} ACK permanently invalidates owner`, async (t) => {
    const dir = temporary();
    let store: Store | undefined;
    injected(
      t,
      dir,
      source.replace(
        '                reply(channel, {"id": request_id, "sequence": sequence, "digest": digest})',
        `                reply(channel, {"id": request_id, "sequence": sequence, "digest": digest})\n                reply(channel, {"id": ${unsolicited ? '"unrequested"' : "request_id"}, "sequence": sequence, "digest": digest})`,
      ),
    );
    try {
      store = await Store.open(dir);
      // The valid durable ACK may arrive first; it cannot be rolled back. The
      // extra response must fail ownership before any subsequent append.
      try {
        store.commit([]);
      } catch (error) {
        assert.match(String(error), /STORE_NOT_OWNER/);
      }
      await delay(50);
      assert.throws(() => store!.commit([]), /STORE_NOT_OWNER/);
      await store.close();
      t.mock.restoreAll();
      store = await Store.open(dir);
      assert.equal(store.sequence, 1);
    } finally {
      await store?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

test("worker death rejects further commits and releases helper ownership", async () => {
  const dir = temporary();
  let store: Store | undefined;
  try {
    store = await Store.open(dir);
    store.commit([]);
    await ownerOf(store).worker.terminate();
    assert.throws(() => store!.commit([]), /STORE_NOT_OWNER/);
    await store.close();
    store = await Store.open(dir);
    assert.equal(store.sequence, 1);
  } finally {
    await store?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("spurious notifications keep the original bounded timeout", async (t) => {
  const dir = temporary();
  const { owner } = await JournalOwner.open(dir);
  try {
    (owner as any).timeoutMs = 100;
    process.kill((owner as any).childPID, "SIGSTOP");
    const wait = Atomics.wait;
    let calls = 0;
    t.mock.method(
      Atomics,
      "wait",
      (...args: Parameters<typeof Atomics.wait>) =>
        ++calls < 3 ? "ok" : wait(...args),
    );
    const start = performance.now();
    assert.throws(() => owner.append("{}\n", "x"), /STORE_NOT_OWNER/);
    assert.ok(calls >= 3);
    assert.ok(performance.now() - start < 1000);
  } finally {
    t.mock.restoreAll();
    await owner.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Core death closes helper pipes even while an inherited shell child survives", async () => {
  const dir = temporary();
  const moduleURL = new URL(
    "../../../src/pi_secretary/src/store.ts",
    import.meta.url,
  ).href;
  const script = path.join(dir, "parent.mts");
  fs.writeFileSync(
    script,
    `import {Store} from ${JSON.stringify(moduleURL)}; import {spawn} from 'node:child_process'; const s=await Store.open(process.argv[2]); s.commit([]); const child=spawn('/bin/sh',['-c','exec sleep 30'],{stdio:'ignore'}); console.log(JSON.stringify({pid:child.pid})); setInterval(()=>{},1000);`,
  );
  const parent = spawn(
    process.execPath,
    [
      "--import",
      fileURLToPath(
        new URL("../../../node_modules/tsx/dist/loader.mjs", import.meta.url),
      ),
      script,
      dir,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let shellPID: number | undefined, store: Store | undefined;
  try {
    const output = await Promise.race([
      once(parent.stdout!, "data"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Error("parent timeout")), 10000).unref(),
      ),
    ]);
    shellPID = JSON.parse(String(output[0])).pid;
    parent.kill("SIGKILL");
    await once(parent, "exit");
    process.kill(shellPID!, 0); // child still alive; no helper pipe inherited
    const deadline = Date.now() + 3000;
    for (;;) {
      try {
        store = await Store.open(dir);
        break;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await delay(20);
      }
    }
    assert.equal(store.sequence, 1);
    store.commit([]);
    assert.equal(store.sequence, 2);
  } finally {
    parent.kill("SIGKILL");
    if (shellPID)
      try {
        process.kill(shellPID, "SIGKILL");
      } catch {}
    await store?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const field of ["sequence", "digest"] as const)
  test(`startup ${field} must match the replayed journal`, async (t) => {
    const dir = temporary();
    injected(
      t,
      dir,
      source.replace(
        "    sys.stdout.write(json.dumps(value)",
        `    if value["id"] == "open":\n        value["${field}"] = ${field === "sequence" ? "1" : '"f" * 64'}\n    sys.stdout.write(json.dumps(value)`,
      ),
    );
    try {
      await assert.rejects(Store.open(dir), /CORRUPT_JOURNAL/);
      t.mock.restoreAll();
      const store = await Store.open(dir);
      assert.equal(store.sequence, 0);
      await store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

test("worker dies while synchronous append waits: timeout cannot install uncertain state", async (t) => {
  const dir = temporary();
  let store: Store | undefined;
  try {
    store = await Store.open(dir);
    const owner = ownerOf(store);
    owner.timeoutMs = 100;
    process.kill(owner.childPID, "SIGSTOP");
    const kill = process.kill.bind(process);
    let signalKills = 0;
    t.mock.method(
      process,
      "kill",
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === "SIGKILL") signalKills++;
        return kill(pid, signal);
      },
    );
    const send = owner.worker.postMessage.bind(owner.worker);
    t.mock.method(owner.worker, "postMessage", (message: unknown) => {
      send(message);
      void owner.worker.terminate();
    });
    const started = performance.now();
    assert.throws(() => store!.commit([]), /STORE_NOT_OWNER/);
    assert.ok(performance.now() - started < 2000);
    assert.equal(store.sequence, 0);
    assert.equal(store.projectionFrames.length, 0);
    owner.worker.postMessage = send;
    await store.close();
    assert.ok(signalKills <= 1);
    t.mock.restoreAll();
    store = await Store.open(dir);
    assert.equal(store.sequence, 0);
    store.commit([]);
  } finally {
    t.mock.restoreAll();
    await store?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const phase of [
  "before-write",
  "partial-write",
  "after-fsync",
  "before-ACK",
] as const)
  test(`Core SIGKILL during ${phase} keeps exclusive ownership until helper exits`, async () => {
    const dir = temporary(),
      helper = path.join(dir, "helper.py"),
      marker = path.join(dir, "paused");
    const pause =
      '(directory / "paused").write_text(str(os.getpid())); import signal; os.kill(os.getpid(), signal.SIGSTOP)';
    let code = source;
    if (phase === "before-write")
      code = code.replace(
        "                fd = os.open",
        `                ${pause}\n                fd = os.open`,
      );
    if (phase === "partial-write")
      code = code.replace(
        "                    journal.write(frame)",
        `                    journal.write(frame[:17]); journal.flush(); os.fsync(journal.fileno()); ${pause}; os._exit(0)\n                    journal.write(frame)`,
      );
    if (phase === "after-fsync")
      code = code.replace(
        "                sync_dir(directory)\n                sequence, digest",
        `                ${pause}\n                sync_dir(directory)\n                sequence, digest`,
      );
    if (phase === "before-ACK")
      code = code.replace(
        '                reply(channel, {"id": request_id',
        `                ${pause}\n                reply(channel, {"id": request_id`,
      );
    fs.writeFileSync(helper, code);
    const script = path.join(dir, "parent.mts");
    const storeURL = new URL(
      "../../../src/pi_secretary/src/store.ts",
      import.meta.url,
    ).href;
    const ownerURL = new URL(
      "../../../src/pi_secretary/src/store-lock.ts",
      import.meta.url,
    ).href;
    fs.writeFileSync(
      script,
      `import {Store} from ${JSON.stringify(storeURL)}; import {JournalOwner} from ${JSON.stringify(ownerURL)}; const open=JournalOwner.open.bind(JournalOwner); JournalOwner.open=dir=>open(dir,{helperPath:process.argv[3]}); const store=await Store.open(process.argv[2]); store.commit([]);`,
    );
    const parent = spawn(
      process.execPath,
      [
        "--import",
        fileURLToPath(
          new URL("../../../node_modules/tsx/dist/loader.mjs", import.meta.url),
        ),
        script,
        dir,
        helper,
      ],
      { stdio: "ignore" },
    );
    let helperPID: number | undefined, store: Store | undefined;
    try {
      const deadline = Date.now() + 10000;
      while (!fs.existsSync(marker)) {
        if (Date.now() > deadline) throw Error("pause timeout");
        await delay(10);
      }
      helperPID = Number(fs.readFileSync(marker, "utf8"));
      await assert.rejects(Store.open(dir), /OWNER_BUSY/);
      parent.kill("SIGKILL");
      await once(parent, "exit");
      await assert.rejects(Store.open(dir), /OWNER_BUSY/);
      process.kill(helperPID, "SIGCONT");
      const exitDeadline = Date.now() + 3000;
      for (;;) {
        try {
          store = await Store.open(dir);
          break;
        } catch (error) {
          if (Date.now() > exitDeadline) throw error;
          await delay(20);
        }
      }
      assert.equal(store.sequence, phase === "partial-write" ? 0 : 1);
      const tails = fs
        .readdirSync(dir)
        .filter((p) => p.startsWith("journal.jsonl.incomplete-"));
      assert.equal(tails.length, phase === "partial-write" ? 1 : 0);
      store.commit([]);
    } finally {
      parent.kill("SIGKILL");
      if (helperPID)
        try {
          process.kill(helperPID, "SIGKILL");
        } catch {}
      await store?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

test("a live worker owns helper termination; parent sends no bare PID signal", async (t) => {
  const dir = temporary();
  const { owner } = await JournalOwner.open(dir);
  try {
    (owner as any).timeoutMs = 100;
    process.kill((owner as any).childPID, "SIGSTOP");
    const kill = process.kill.bind(process);
    let signals = 0;
    t.mock.method(
      process,
      "kill",
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal && signal !== 0) signals++;
        return kill(pid, signal);
      },
    );
    assert.throws(() => owner.append("{}\n", "x"), /STORE_NOT_OWNER/);
    await owner.close();
    assert.equal(signals, 0);
  } finally {
    t.mock.restoreAll();
    await owner.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
