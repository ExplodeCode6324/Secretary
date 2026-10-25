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
const run = fs.mkdtempSync(
  path.resolve(".demo-data/issue82-tui/implementation/barrier-tests-"),
);
const source = fs.readFileSync(writerPath, "utf8");
async function close(w: StateWriter) {
  const end =
    w.child.exitCode === null && w.child.signalCode === null
      ? once(w.child, "exit")
      : Promise.resolve();
  await w.close();
  await end;
}
function instrument(folder: string, stop = -1, mode = "kill") {
  const log = path.join(folder, "events.jsonl"),
    helper = path.join(folder, "audit.py");
  const code = `
_aopen, _afsync, _arename, _aunlink, _areply = os.open, os.fsync, os.rename, os.unlink, reply
_anames = {}
_ai = 0
def audit(event, name):
    global _ai
    _ai += 1
    row = {"i": _ai, "event": event, "name": name, "verified": sorted(verified)}
    fd = _aopen(${JSON.stringify(log)}, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.write(fd, (json.dumps(row) + "\\n").encode())
    os.close(fd)
    if _ai == ${stop}:
        if ${JSON.stringify(mode)} == "kill": os.kill(os.getpid(), 9)
        raise OSError("INJECTED_BARRIER_FAILURE")
def audit_open(name, *args, **kwargs):
    fd = _aopen(name, *args, **kwargs)
    _anames[fd] = re.sub(r"^\\.pending-\\d+-\\d+-", "", str(name))
    return fd
def audit_fsync(fd):
    name = "." if stat.S_ISDIR(os.fstat(fd).st_mode) else _anames.get(fd, "unknown")
    audit("before-fsync", name)
    value = _afsync(fd)
    audit("after-fsync", name)
    return value
def audit_rename(src, dst, *args, **kwargs):
    audit("before-rename", str(dst))
    value = _arename(src, dst, *args, **kwargs)
    audit("after-rename", str(dst))
    return value
def audit_unlink(name, *args, **kwargs):
    audit("before-unlink", str(name))
    value = _aunlink(name, *args, **kwargs)
    audit("after-unlink", str(name))
    return value
def audit_reply(value):
    if not value.get("ready"):
        audit("error" if value.get("error") else "ack", "reply")
    return _areply(value)
os.open, os.fsync, os.rename, os.unlink, reply = audit_open, audit_fsync, audit_rename, audit_unlink, audit_reply
`;
  const marker = 'if reply({"ready": True';
  assert.ok(source.includes(marker));
  fs.writeFileSync(helper, source.replace(marker, code + "\n" + marker));
  return { helper, log };
}
const events = (log: string): any[] =>
  fs
    .readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x));
test("two new blobs have all renames before one shared directory barrier and manifest publication", async () => {
  const folder = fs.mkdtempSync(path.join(run, "order-"));
  const { helper, log } = instrument(folder);
  const w = new StateWriter(path.join(folder, "tui-v1"), undefined, {
    helperPath: helper,
  });
  await w.ready;
  const a = blobOf("first"),
    b = blobOf("second");
  await w.commit({ a: a.ref, b: b.ref }, [a, b]);
  await close(w);
  const sequence = events(log)
    .filter((x) => ["after-fsync", "after-rename", "ack"].includes(x.event))
    .map((x) => [x.event, x.name]);
  assert.deepEqual(sequence, [
    ["after-fsync", "blob-" + a.ref.blob],
    ["after-rename", "blob-" + a.ref.blob],
    ["after-fsync", "blob-" + b.ref.blob],
    ["after-rename", "blob-" + b.ref.blob],
    ["after-fsync", "."],
    ["after-fsync", "manifest.json"],
    ["after-rename", "manifest.json"],
    ["after-fsync", "."],
    ["ack", "reply"],
  ]);
});
for (const count of [0, 1])
  test(`k=${count} retains the original fsync/rename sequence and immutable blobs`, async () => {
    const folder = fs.mkdtempSync(path.join(run, "baseline-")),
      root = path.join(folder, "tui-v1");
    let w = new StateWriter(root);
    await w.ready;
    const existing = blobOf("immutable");
    await w.commit({ existing: existing.ref }, [existing]);
    await close(w);
    const before = fs.readFileSync(
      path.join(root, "blob-" + existing.ref.blob),
    );
    const beforeStat = fs.statSync(
      path.join(root, "blob-" + existing.ref.blob),
    );
    const { helper, log } = instrument(folder);
    w = new StateWriter(root, undefined, { helperPath: helper });
    await w.ready;
    const fresh = count ? [blobOf("new")] : [];
    await w.commit({ existing: existing.ref, fresh: fresh.map((x) => x.ref) }, [
      existing,
      ...fresh,
    ]);
    await close(w);
    const expected = fresh.flatMap((x) => [
      ["after-fsync", "blob-" + x.ref.blob],
      ["after-rename", "blob-" + x.ref.blob],
      ["after-fsync", "."],
    ]);
    expected.push(
      ["after-fsync", "manifest.json"],
      ["after-rename", "manifest.json"],
      ["after-fsync", "."],
      ["ack", "reply"],
    );
    assert.deepEqual(
      events(log)
        .filter((x) => ["after-fsync", "after-rename", "ack"].includes(x.event))
        .map((x) => [x.event, x.name]),
      expected,
    );
    assert.deepEqual(
      fs.readFileSync(path.join(root, "blob-" + existing.ref.blob)),
      before,
    );
    assert.equal(
      fs.statSync(path.join(root, "blob-" + existing.ref.blob)).ino,
      beforeStat.ino,
    );
    assert.equal(
      fs.statSync(path.join(root, "blob-" + existing.ref.blob)).mtimeMs,
      beforeStat.mtimeMs,
    );
  });
test("every partial-write boundary reopens complete old/new state; shared barrier gates verified and ACK", async () => {
  const old = blobOf("old draft"),
    unknown = blobOf('{"request_id":"fixture","text":"exact\\nUNKNOWN中文"}'),
    protectedBlob = blobOf("protected orphan"),
    fresh = [blobOf("next one"), blobOf("next two")];
  const oldData = {
    draft: [old.ref],
    outbox: [{ state: "UNKNOWN", body: unknown.ref }],
  };
  const newData = { draft: fresh.map((x) => x.ref), outbox: oldData.outbox };
  async function seed(folder: string) {
    const root = path.join(folder, "tui-v1");
    const w = new StateWriter(root);
    await w.ready;
    await w.commit(oldData, [old, unknown, protectedBlob]);
    await close(w);
    return root;
  }
  const baseline = fs.mkdtempSync(path.join(run, "complete-"));
  const baselineRoot = await seed(baseline);
  const a = instrument(baseline);
  let w = new StateWriter(baselineRoot, undefined, { helperPath: a.helper });
  await w.ready;
  await w.commit(newData, fresh, { [old.ref.blob]: "superseded" });
  await close(w);
  const trace = events(a.log);
  const shared = trace.findIndex(
    (x) => x.event === "after-fsync" && x.name === ".",
  );
  assert.ok(shared > 0);
  for (const e of trace.slice(0, shared + 1))
    for (const b of fresh)
      assert.ok(!e.verified.includes(b.ref.blob), JSON.stringify(e));
  for (const b of fresh)
    assert.ok(
      trace
        .find((x) => x.name === "manifest.json" && x.event === "before-fsync")
        .verified.includes(b.ref.blob),
    );
  const beforeManifest = trace.find(
    (x) => x.event === "before-rename" && x.name === "manifest.json",
  ).i;
  const cases = [
    ...trace
      .filter((x) => x.event !== "ack")
      .map((x) => ({ point: x, mode: "kill" })),
    ...trace
      .filter(
        (x) =>
          x.event === "before-fsync" ||
          x.event === "before-rename" ||
          x.event === "before-unlink",
      )
      .map((x) => ({ point: x, mode: "error" })),
  ];
  const results = [];
  for (const item of cases) {
    const folder = fs.mkdtempSync(path.join(run, item.mode + "-")),
      root = await seed(folder),
      i = instrument(folder, item.point.i, item.mode);
    w = new StateWriter(root, undefined, { helperPath: i.helper });
    await w.ready;
    await assert.rejects(
      w.commit(newData, fresh, { [old.ref.blob]: "superseded" }),
      /WRITER_EXIT|INJECTED_BARRIER_FAILURE/,
    );
    await close(w);
    const partial = events(i.log);
    assert.ok(!partial.some((x) => x.event === "ack"));
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
    );
    const isOld = raw.sequence === 1;
    assert.deepEqual(raw.data, isOld ? oldData : newData);
    if (item.point.i <= beforeManifest) assert.equal(isOld, true);
    const active = new Set([
      unknown.ref.blob,
      ...(isOld ? [old] : fresh).map((x) => x.ref.blob),
    ]);
    const leftovers = fs
      .readdirSync(root)
      .filter(
        (name) =>
          name.startsWith(".pending-") ||
          (name.startsWith("blob-") &&
            !active.has(name.slice(5)) &&
            name !== "blob-" + old.ref.blob),
      );
    const protectedBytes = fs.readFileSync(
      path.join(root, "blob-" + protectedBlob.ref.blob),
    );
    w = new StateWriter(root);
    await w.ready;
    assert.deepEqual(w.data, isOld ? oldData : newData);
    assert.equal(
      await w.read(unknown.ref),
      Buffer.from(unknown.base64, "base64").toString(),
    );
    for (const b of isOld ? [old] : fresh)
      assert.equal(
        await w.read(b.ref),
        Buffer.from(b.base64, "base64").toString(),
      );
    for (const name of leftovers)
      assert.ok(fs.existsSync(path.join(root, name)), name);
    assert.deepEqual(
      fs.readFileSync(path.join(root, "blob-" + protectedBlob.ref.blob)),
      protectedBytes,
    );
    const physical = fs
      .readdirSync(root)
      .reduce((n, name) => n + fs.statSync(path.join(root, name)).size, 0);
    assert.equal(w.usage, physical);
    await close(w);
    results.push({
      mode: item.mode,
      point: item.point.i,
      event: item.point.event,
      name: item.point.name,
      old: isOld,
      leftovers: leftovers.length,
      quotaCounted: physical,
    });
  }
  fs.writeFileSync(
    path.join(run, "recovery-cases.json"),
    JSON.stringify(results, null, 2),
  );
  assert.ok(results.some((x) => x.leftovers > 1));
});
