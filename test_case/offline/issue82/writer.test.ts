import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import {
  StateWriter,
  blobOf,
  writerPath,
} from "../../../src/pi_secretary/src/tui/writer.ts";

const evidence = path.resolve(".demo-data/issue82-tui/implementation");
fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
const run = fs.mkdtempSync(path.join(evidence, "writer-tests-"));
const root = () =>
  path.join(fs.mkdtempSync(path.join(run, "state-")), "tui-v1");
const close = async (writer: StateWriter) => {
  const exit =
    writer.child.exitCode === null && writer.child.signalCode === null
      ? once(writer.child, "exit")
      : Promise.resolve();
  await writer.close();
  await exit;
};
const source = fs.readFileSync(writerPath, "utf8");

test("single writer, immutable blobs, durable ACK and explicit cleanup tickets survive reopening", async () => {
  const directory = root();
  let writer = new StateWriter(directory);
  await writer.ready;
  const blob = blobOf("exact\t中文\0\u009b\n");
  await writer.commit({ draft: blob.ref }, [blob]);
  assert.equal(await writer.read(blob.ref), "exact\t中文\0\u009b\n");
  const contender = new StateWriter(directory);
  await assert.rejects(contender.ready, /TUI_ALREADY_RUNNING/);
  await close(writer);
  writer = new StateWriter(directory);
  await writer.ready;
  assert.deepEqual(writer.data, { draft: blob.ref });
  await writer.commit({ draft: null }); // No deletion authorization: preserve orphan.
  assert.ok(fs.existsSync(path.join(directory, "blob-" + blob.ref.blob)));
  await writer.commit({ draft: blob.ref });
  const next = blobOf("new");
  await writer.commit({ draft: next.ref }, [next], {
    [blob.ref.blob]: "superseded",
  });
  assert.equal(
    fs.existsSync(path.join(directory, "blob-" + blob.ref.blob)),
    false,
  );
  assert.equal(await writer.read(next.ref), "new");
  await close(writer);
});

for (const phase of ["before-manifest", "after-manifest"] as const) {
  test(`helper death ${phase} preserves old or new complete state and releases kernel lock`, async () => {
    const directory = root();
    let writer = new StateWriter(directory);
    await writer.ready;
    const old = blobOf("old durable");
    await writer.commit({ draft: old.ref }, [old]);
    await close(writer);
    const helper = path.join(path.dirname(directory), "injected.py");
    const marker = '                atomic("manifest.json", body, seq)';
    const die = "                os.kill(os.getpid(), 9)";
    fs.writeFileSync(
      helper,
      source.replace(
        marker,
        phase === "before-manifest" ? die + "\n" + marker : marker + "\n" + die,
      ),
      { mode: 0o600 },
    );
    writer = new StateWriter(directory, undefined, { helperPath: helper });
    await writer.ready;
    const next = blobOf("new durable");
    await assert.rejects(
      writer.commit({ draft: next.ref }, [next], {
        [old.ref.blob]: "superseded",
      }),
      /WRITER_EXIT/,
    );
    const recovered = new StateWriter(directory);
    await recovered.ready;
    const expected = phase === "before-manifest" ? old.ref : next.ref;
    assert.deepEqual(recovered.data, { draft: expected });
    assert.equal(
      await recovered.read(expected),
      phase === "before-manifest" ? "old durable" : "new durable",
    );
    await close(recovered);
  });
}

test("quota and unsafe-file failures cannot replace a committed manifest", async () => {
  const directory = root();
  let writer = new StateWriter(directory, 8 * 1024 * 1024);
  await writer.ready;
  const first = blobOf("a".repeat(3 * 1024 * 1024));
  await writer.commit({ first: first.ref }, [first]);
  const second = blobOf("b".repeat(3 * 1024 * 1024));
  await assert.rejects(
    writer.commit({ first: first.ref, second: second.ref }, [second]),
    /STAGING_QUOTA/,
  );
  await close(writer);
  writer = new StateWriter(directory, 8 * 1024 * 1024);
  await writer.ready;
  assert.deepEqual(writer.data, { first: first.ref });
  await close(writer);
  fs.symlinkSync("/dev/null", path.join(directory, "not-owned"));
  const unsafe = new StateWriter(directory);
  await assert.rejects(unsafe.ready, /UNSAFE_STATE_FILE/);
});

test("cache work is coalesced and input commits keep sequence across queued operations", async () => {
  const directory = root();
  const writer = new StateWriter(directory);
  await writer.ready;
  const tasks = [
    writer.commit({ n: 1 }),
    writer.commit({ n: 2 }),
    writer.commit({ n: 3 }),
  ];
  await Promise.all(tasks);
  assert.equal(writer.sequence, 3);
  assert.deepEqual(writer.data, { n: 3 });
  await writer.checkpoint(
    { cursor: "c", dirty: ["timeline"] },
    { items: ["cache only"] },
  );
  const checkpoint = await writer.loadCheckpoint();
  assert.equal((checkpoint.value as { cursor: string }).cursor, "c");
  assert.deepEqual(checkpoint.snapshot, { items: ["cache only"] });
  await assert.rejects(
    writer.checkpoint({ x: "x".repeat(65536) }, {}),
    /CHECKPOINT_TOO_LARGE/,
  );
  assert.equal(writer.healthy, true);
  await writer.commit({ n: 4 });
  await close(writer);
});

test("calendar-year collection preserves active old blobs and corrupt/unknown provenance", async () => {
  const directory = root();
  const writer = new StateWriter(directory);
  await writer.ready;
  const old = new Date();
  old.setUTCFullYear(old.getUTCFullYear() - 4);
  const active = blobOf("protected", undefined, old.toISOString());
  const orphan = blobOf("unreferenced", undefined, old.toISOString());
  await writer.commit({ active: active.ref, orphan: orphan.ref }, [
    active,
    orphan,
  ]);
  await writer.commit({ active: active.ref });
  const result = await writer.collect();
  assert.equal(result.removed, 1);
  assert.equal(await writer.read(active.ref), "protected");
  assert.equal(
    fs.existsSync(path.join(directory, "blob-" + orphan.ref.blob)),
    false,
  );
  await close(writer);
});

test("receipt archive remains paged outside the recent manifest index", async () => {
  const directory = root(),
    writer = new StateWriter(directory);
  await writer.ready;
  const blobs = Array.from({ length: 57 }, (_, n) => {
    const blob = blobOf(JSON.stringify({ receipt: n, cleanup_complete: true }));
    blob.ref.kind = "receipt";
    return blob;
  });
  await writer.commit({ recent: blobs.slice(-2).map((b) => b.ref) }, blobs);
  const first = await writer.receipts();
  assert.equal(first.items.length, 50);
  assert.ok(first.next);
  const second = await writer.receipts(first.next!);
  assert.equal(second.items.length, 7);
  assert.equal(second.next, null);
  assert.equal(
    new Set([...first.items, ...second.items].map((x) => x.blob)).size,
    57,
  );
  assert.equal(
    JSON.parse(await writer.read(first.items[0])).cleanup_complete,
    true,
  );
  await close(writer);
});

test("calendar expiration clamps leap anniversary in Hong Kong and never uses 1095 days", async () => {
  const { spawnSync } = await import("node:child_process");
  const code = `import ast,datetime,pathlib\nsource=ast.parse(pathlib.Path(${JSON.stringify(writerPath)}).read_text())\nnode=next(n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='expired')\nexec(compile(ast.Module(body=[node],type_ignores=[]),'calendar-test','exec'))\ndef at(s): return datetime.datetime.fromisoformat(s.replace('Z','+00:00'))\nassert not expired('2024-02-29T04:00:00Z',at('2027-02-28T03:59:59Z'))\nassert expired('2024-02-29T04:00:00Z',at('2027-02-28T04:00:00Z'))\nassert not expired('2023-03-01T00:00:00Z',at('2026-02-28T00:00:00Z'))\n`;
  const result = spawnSync("/usr/bin/python3", ["-c", code], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("disk-full before manifest leaves prior durable body and preserves interrupted staging", async () => {
  const directory = root();
  let writer = new StateWriter(directory);
  await writer.ready;
  const old = blobOf("old durable"),
    next = blobOf("new refused");
  await writer.commit({ draft: old.ref }, [old]);
  await close(writer);
  const helper = path.join(path.dirname(directory), "disk-full.py");
  fs.writeFileSync(
    helper,
    source.replace(
      '                atomic("manifest.json", body, seq)',
      '                raise OSError(28, "injected disk full")\n                atomic("manifest.json", body, seq)',
    ),
    { mode: 0o600 },
  );
  writer = new StateWriter(directory, undefined, { helperPath: helper });
  await writer.ready;
  await assert.rejects(
    writer.commit({ draft: next.ref }, [next], {
      [old.ref.blob]: "superseded",
    }),
    /disk full/,
  );
  await close(writer);
  writer = new StateWriter(directory);
  await writer.ready;
  assert.deepEqual(writer.data, { draft: old.ref });
  assert.equal(await writer.read(old.ref), "old durable");
  assert.equal(await writer.read(next.ref), "new refused");
  await close(writer);
});

test(
  "parent SIGKILL during a delayed helper operation releases writer only after atomic completion",
  { timeout: 15000 },
  async () => {
    const { spawn } = await import("node:child_process");
    const directory = root();
    let writer = new StateWriter(directory);
    await writer.ready;
    const old = blobOf("before parent death"),
      next = blobOf("after parent death");
    await writer.commit({ draft: old.ref }, [old]);
    await close(writer);
    const helper = path.join(path.dirname(directory), "slow-parent.py");
    fs.writeFileSync(
      helper,
      source
        .replace("import sys", "import sys\nimport time")
        .replace(
          '                atomic("manifest.json", body, seq)',
          '                time.sleep(0.15)\n                atomic("manifest.json", body, seq)',
        ),
      { mode: 0o600 },
    );
    const script = path.join(path.dirname(directory), "parent.mjs");
    const writerModule = new URL(
      "../../../src/pi_secretary/src/tui/writer.ts",
      import.meta.url,
    ).href;
    fs.writeFileSync(
      script,
      `import {StateWriter} from ${JSON.stringify(writerModule)};const w=new StateWriter(${JSON.stringify(directory)},undefined,{helperPath:${JSON.stringify(helper)}});await w.ready;console.log('COMMITTING');await w.commit({draft:${JSON.stringify(next.ref)}},[${JSON.stringify(next)}],{${JSON.stringify(old.ref.blob)}:'superseded'});`,
      { mode: 0o600 },
    );
    const child = spawn(process.execPath, ["--import", "tsx", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        if (String(chunk).includes("COMMITTING")) resolve();
      });
      child.once("exit", (code) =>
        reject(Error(`premature ${code}: ${stderr}`)),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const death = once(child, "exit");
    child.kill("SIGKILL");
    await death;
    await new Promise((resolve) => setTimeout(resolve, 300));
    writer = new StateWriter(directory);
    await writer.ready;
    assert.deepEqual(writer.data, { draft: next.ref });
    assert.equal(await writer.read(next.ref), "after parent death");
    await close(writer);
  },
);
