// @ts-nocheck -- Tests the deliberately standalone JavaScript tools through their public boundary.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./fixtures.mjs";
import { readSnapshot } from "../../../scripts/agile-diagnostics/snapshot-reader.mjs";
import { privateJSON, sha } from "../../../scripts/agile-diagnostics/io.mjs";
import {
  copyTree,
  verifyFiles,
} from "../../../scripts/agile-diagnostics/capture-files.mjs";
const using = async (f) => {
  const x = fixture();
  try {
    await f(x);
  } finally {
    x.cleanup();
  }
};
test("static projection preserves first insertion order and reads latest revision without mutating files", () =>
  using(async (f) => {
    const a = f.make("UserInstructions", {
        content: "synthetic",
        updated_by: "DEFAULT",
      }),
      b = f.make("UserInstructions", {
        content: "synthetic two",
        updated_by: "DEFAULT",
      });
    f.commit([a, b]);
    f.commit([{ ...a, revision: 2, content: "new" }]);
    f.seal();
    const before = fs.readFileSync(path.join(f.core, "journal.jsonl"));
    const s = await readSnapshot(f.root);
    assert.deepEqual(
      s.all("UserInstructions").map((x) => x.id),
      [a.id, b.id],
    );
    assert.equal(s.get("UserInstructions", a.id).content, "new");
    assert.deepEqual(
      fs.readFileSync(path.join(f.core, "journal.jsonl")),
      before,
    );
    assert.equal(s.metrics().sequence, 2);
  }));
for (const kind of [
  "hash",
  "truncated",
  "missing",
  "revision",
  "path",
  "symlink",
  "schema",
])
  test("reader fails closed: " + kind, () =>
    using(async (f) => {
      const a = f.make("ModelCall", { response: null });
      if (kind === "path") a.request = { ...a.request, path: "../outside" };
      f.commit([a]);
      if (kind === "revision") f.commit([{ ...a, revision: 3 }]);
      f.seal();
      const journal = path.join(f.core, "journal.jsonl");
      if (kind === "hash")
        fs.writeFileSync(
          journal,
          fs.readFileSync(journal).toString().replace("sha256", "wrong"),
        );
      if (kind === "truncated") fs.appendFileSync(journal, "{");
      if (kind === "missing") fs.unlinkSync(path.join(f.core, a.request.path));
      if (kind === "symlink") {
        const p = path.join(f.core, a.request.path);
        fs.renameSync(p, p + ".saved");
        fs.symlinkSync(p + ".saved", p);
      }
      if (kind === "schema")
        fs.appendFileSync(path.join(f.root, "contracts.schema.json"), " ");
      await assert.rejects(readSnapshot(f.root));
    }),
  );
for (const [budget, n] of [
  ["journal", 1],
  ["record", 1],
  ["cas", 1],
  ["mutations", 1],
  ["milliseconds", 1],
])
  test("reader bounds " + budget, () =>
    using(async (f) => {
      f.commit([f.make("UserInstructions"), f.make("UserInstructions")]);
      f.seal();
      await assert.rejects(readSnapshot(f.root, { [budget]: n }));
    }),
  );
test("output exclusive, private, outside forbidden roots and symlink aliases", () =>
  using(async (f) => {
    const out = path.join(f.root, "report.json");
    privateJSON(out, { sample: true });
    assert.equal(fs.statSync(out).mode & 0o777, 0o600);
    assert.throws(() => privateJSON(out, {}));
    assert.throws(() =>
      privateJSON(
        path.join(f.root, "blocked.json"),
        {},
        { forbidden: [f.root] },
      ),
    );
    fs.symlinkSync(f.core, path.join(f.root, "alias"));
    assert.throws(() =>
      privateJSON(path.join(f.root, "alias/report.json"), {}),
    );
  }));
test("copy and hash verifier preserve bytes and reject later change", () =>
  using(async (f) => {
    f.commit([f.make("UserInstructions")]);
    const dest = path.join(f.root, "copy"),
      m = await copyTree(f.core, dest);
    await verifyFiles(dest, m.files);
    fs.appendFileSync(path.join(dest, "journal.jsonl"), "x");
    await assert.rejects(verifyFiles(dest, m.files), /COPY_HASH_OR_MODE/);
  }));
test("snapshot rejects its own production-root location", () =>
  using(async (f) => {
    f.seal({ source_root: f.root });
    await assert.rejects(readSnapshot(f.root), /NOT_OFFLINE_CAPTURE/);
  }));
test("message-list and image envelopes validate nested object references without hydration", () =>
  using(async (f) => {
    const image = f.put("synthetic image bytes"),
      envelope = f.put({
        encoding: "image-evidence-v1",
        exact_sha256: "1".repeat(64),
        value: { image: null },
        images: [{ path: ["image"], prefix: "", content: image }],
      });
    envelope.media_type = "application/vnd.secretary.image-evidence+json";
    const messages = f.put({
      encoding: "message-refs-v1",
      messages: [f.put({ synthetic: true })],
    });
    messages.media_type = "application/vnd.secretary.message-list+json";
    const c = f.make("Context", { raw_context: messages });
    const call = f.make("ModelCall", { context_id: c.id, request: envelope });
    f.commit([c, call]);
    f.seal();
    await readSnapshot(f.root);
    fs.unlinkSync(path.join(f.core, image.path));
    await assert.rejects(readSnapshot(f.root));
  }));
test("forbidden output refuses before creating directories", () =>
  using(async (f) => {
    const p = path.join(f.core, "new-directory/report.json");
    assert.throws(() => privateJSON(p, {}, { forbidden: [f.core] }));
    assert(!fs.existsSync(path.dirname(p)));
  }));
