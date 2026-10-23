import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { hash, id, revise } from "../../../src/pi_secretary/src/store.ts";
import {
  validateImage,
  imageFormat,
  ATTACHMENT_DEFAULTS,
} from "../../../src/pi_secretary/src/attachments.ts";
import type {
  Attachment,
  AttachmentImport,
} from "../../../src/pi_secretary/src/contracts.ts";
const image = (format: "png" | "jpeg" = "png") =>
  sharp({ create: { width: 16, height: 12, channels: 3, background: "red" } })
    [format]()
    .toBuffer();
async function fixture(
  run: (app: App, service: ApplicationService, dir: string) => Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue81-import-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  const service = new ApplicationService(app);
  try {
    await run(app, service, dir);
  } finally {
    await service.close();
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function args(file: string, bytes: Buffer) {
  return {
    request_id: id(),
    source_path: file,
    expected_sha256: hash(bytes),
    expected_bytes: String(bytes.length),
    name: "图 像;$(echo pwn).png",
  };
}
test("import commits reservation before async READY; immutable identity, duplicate content, source deletion and redacted metadata", () =>
  fixture(async (app, s, dir) => {
    const bytes = await image(),
      file = path.join(dir, "图 像;$(touch pwn).png");
    fs.writeFileSync(file, bytes);
    const body = args(file, bytes),
      receipt = s.command(s.principal, "attachments/import", body);
    assert.equal(receipt.state, "QUEUED");
    const frame = app.store.projectionFrames.at(-1)!;
    assert.deepEqual(frame.mutations.map((m) => m.object_type).sort(), [
      "ApiCommand",
      "AttachmentImport",
    ]);
    assert.throws(
      () =>
        s.command(s.principal, "attachments/import", {
          ...body,
          name: "other",
        }),
      /REQUEST_CONFLICT/,
    );
    await s.attachmentImports.settle();
    assert.equal(s.receipt(body.request_id).state, "COMPLETED");
    const entry = app.store.get<AttachmentImport>(
        "AttachmentImport",
        body.request_id,
      ),
      attachment = app.store.get<Attachment>("Attachment", entry.attachment_id);
    assert.deepEqual(app.store.bytes(attachment.content), bytes);
    assert.throws(
      () => app.store.commit([revise(attachment, { name: "forged" })]),
      /IMMUTABLE_RECORD/,
    );
    const second = { ...body, request_id: id() };
    s.command(s.principal, "attachments/import", second);
    await s.attachmentImports.settle();
    assert.equal(s.attachmentImports.usage().reserved_bytes, bytes.length * 2);
    assert.notEqual(
      app.store.get<AttachmentImport>("AttachmentImport", second.request_id)
        .attachment_id,
      entry.attachment_id,
    );
    fs.unlinkSync(file);
    assert.equal(
      s.command(s.principal, "attachments/import", body).state,
      "COMPLETED",
    );
    assert.equal(fs.existsSync(path.join(dir, "pwn")), false);
  }));
test("definite invalid source fails durably and releases only bytes, with stable same-ID result", () =>
  fixture(async (app, s, dir) => {
    const bytes = await image();
    for (const kind of ["missing", "changed", "directory", "symlink"]) {
      const file = path.join(dir, kind);
      if (kind === "changed") fs.writeFileSync(file, "changed");
      if (kind === "directory") fs.mkdirSync(file);
      if (kind === "symlink") {
        fs.writeFileSync(file + "-target", bytes);
        fs.symlinkSync(file + "-target", file);
      }
      const body = args(file, bytes);
      s.command(s.principal, "attachments/import", body);
      await s.attachmentImports.settle();
      assert.equal(s.receipt(body.request_id).state, "FAILED");
      assert.equal(
        app.store.get<AttachmentImport>("AttachmentImport", body.request_id)
          .reserved_bytes,
        0,
      );
      assert.equal(
        s.command(s.principal, "attachments/import", body).state,
        "FAILED",
      );
    }
    assert.deepEqual(s.attachmentImports.usage(), {
      import_count: 4,
      reserved_bytes: 0,
    });
  }));
test("actual PNG/JPEG full decoding, malformed/truncated/animated/trailing and configured limits", async () => {
  for (const format of ["png", "jpeg"] as const) {
    const bytes = await image(format),
      meta = await validateImage(bytes);
    assert.equal(meta.media_type, `image/${format}`);
    assert.equal(meta.width, 16);
    assert.equal(meta.height, 12);
    await assert.rejects(
      validateImage(bytes.subarray(0, bytes.length - 3)),
      /ATTACHMENT_INVALID_IMAGE/,
    );
    await assert.rejects(
      validateImage(Buffer.concat([bytes, Buffer.from([0])])),
      /ATTACHMENT_INVALID_IMAGE/,
    );
    await assert.rejects(
      validateImage(bytes, { ...ATTACHMENT_DEFAULTS, side: 8 }),
      /ATTACHMENT_TOO_LARGE/,
    );
  }
  const png = await image();
  const apng = Buffer.concat([
    png.subarray(0, 33),
    Buffer.from([0, 0, 0, 0, 97, 99, 84, 76, 0, 0, 0, 0]),
    png.subarray(33),
  ]);
  assert.throws(() => imageFormat(apng), /ATTACHMENT_TYPE_UNSUPPORTED/);
  const jpeg = await image("jpeg"),
    mpo = Buffer.concat([
      jpeg.subarray(0, 2),
      Buffer.from([255, 226, 0, 6, 77, 80, 70, 0]),
      jpeg.subarray(2),
    ]);
  assert.throws(() => imageFormat(mpo), /ATTACHMENT_TYPE_UNSUPPORTED/);
  await assert.rejects(
    validateImage(Buffer.from("<svg/>")),
    /ATTACHMENT_TYPE_UNSUPPORTED/,
  );
});
test("quota reserves pending copies, counts duplicate identities, survives lowered limits and keeps failed IDs", () =>
  fixture(async (app, s, dir) => {
    const bytes = await image(),
      file = path.join(dir, "quota.png");
    fs.writeFileSync(file, bytes);
    const oldBytes = process.env.SECRETARY_ATTACHMENT_RESERVED_BYTES,
      oldCount = process.env.SECRETARY_ATTACHMENT_IMPORT_COUNT;
    try {
      process.env.SECRETARY_ATTACHMENT_RESERVED_BYTES = String(bytes.length);
      process.env.SECRETARY_ATTACHMENT_IMPORT_COUNT = "1";
      const body = args(file, bytes);
      s.command(s.principal, "attachments/import", body);
      assert.throws(
        () => s.command(s.principal, "attachments/import", args(file, bytes)),
        /ATTACHMENT_CAPACITY_FULL/,
      );
      process.env.SECRETARY_ATTACHMENT_RESERVED_BYTES = "1";
      await s.attachmentImports.settle();
      assert.equal(s.receipt(body.request_id).state, "COMPLETED");
      const entry = app.store.get<AttachmentImport>(
        "AttachmentImport",
        body.request_id,
      );
      assert.deepEqual(
        app.store.bytes(
          app.store.get<Attachment>("Attachment", entry.attachment_id).content,
        ),
        bytes,
      );
      assert.equal(
        s.command(s.principal, "attachments/import", body).state,
        "COMPLETED",
      );
    } finally {
      for (const [key, old] of [
        ["SECRETARY_ATTACHMENT_RESERVED_BYTES", oldBytes],
        ["SECRETARY_ATTACHMENT_IMPORT_COUNT", oldCount],
      ] as const) {
        if (old === undefined) delete process.env[key];
        else process.env[key] = old;
      }
    }
  }));
test("ancestor symlink is supported; oversized, zero-byte, forged name/path and internal ID collision reject before admission", () =>
  fixture(async (app, s, dir) => {
    const bytes = await image(),
      folder = path.join(dir, "real");
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "image.png"), bytes);
    fs.symlinkSync(folder, path.join(dir, "ancestor"));
    const body = args(path.join(dir, "ancestor", "image.png"), bytes);
    s.command(s.principal, "attachments/import", body);
    await s.attachmentImports.settle();
    assert.equal(s.receipt(body.request_id).state, "COMPLETED");
    assert.throws(
      () => app.host.accept("collision", body.request_id),
      /REQUEST_CONFLICT/,
    );
    for (const patch of [
      { source_path: "relative" },
      { expected_bytes: "0" },
      { expected_bytes: "5242881" },
      { name: "../bad" },
      { source_path: "/" + "图".repeat(1500) },
    ]) {
      const before = app.store.sequence;
      assert.throws(() =>
        s.command(s.principal, "attachments/import", {
          ...body,
          request_id: id(),
          ...patch,
        }),
      );
      assert.equal(app.store.sequence, before);
    }
  }));
test("FIFO, device, permission denial and mutation during read fail without hanging or accepting", () =>
  fixture(async (app, s, dir) => {
    const bytes = await image(),
      fifo = path.join(dir, "pipe"),
      denied = path.join(dir, "denied.png");
    execFileSync("mkfifo", [fifo]);
    fs.writeFileSync(denied, bytes, { mode: 0 });
    for (const file of [
      fifo,
      "/dev/null",
      ...(process.getuid?.() === 0 ? [] : [denied]),
    ]) {
      const body = args(file, bytes);
      s.command(s.principal, "attachments/import", body);
      await s.attachmentImports.settle();
      assert.equal(s.receipt(body.request_id).state, "FAILED");
      assert.equal(
        s.receipt(body.request_id).error_code,
        "ATTACHMENT_SOURCE_UNREADABLE",
      );
    }
    const file = path.join(dir, "changing.png");
    fs.writeFileSync(file, bytes);
    const original = fs.readSync;
    let changed = false;
    fs.readSync = ((...values: any[]) => {
      const n = (original as any)(...values);
      if (!changed) {
        changed = true;
        fs.writeFileSync(file, Buffer.alloc(bytes.length));
      }
      return n;
    }) as typeof fs.readSync;
    try {
      const body = args(file, bytes);
      s.command(s.principal, "attachments/import", body);
      await s.attachmentImports.settle();
      assert.equal(s.receipt(body.request_id).state, "FAILED");
      assert.equal(
        s.receipt(body.request_id).error_code,
        "ATTACHMENT_SOURCE_CHANGED",
      );
    } finally {
      fs.readSync = original;
      fs.chmodSync(denied, 0o600);
    }
  }));
test("CAS and READY journal failures retain pending reservation and recover without a second identity", () =>
  fixture(async (app, s, dir) => {
    const bytes = await image(),
      file = path.join(dir, "fault.png");
    fs.writeFileSync(file, bytes);
    for (const phase of ["cas", "journal"] as const) {
      const body = args(file, bytes),
        put = app.store.put.bind(app.store),
        commit = app.store.commit.bind(app.store);
      s.command(s.principal, "attachments/import", body);
      if (phase === "cas")
        app.store.put = ((value: unknown, media?: string) => {
          if (Buffer.isBuffer(value) && media?.startsWith("image/"))
            throw Object.assign(Error("synthetic disk full"), {
              code: "ENOSPC",
            });
          return put(value, media);
        }) as typeof app.store.put;
      else
        app.store.commit = ((records: any[], ...rest: any[]) => {
          if (records.some((r) => r.record_type === "Attachment"))
            throw Error("synthetic journal fsync failure");
          return (commit as any)(records, ...rest);
        }) as typeof app.store.commit;
      try {
        await s.attachmentImports.settle();
      } finally {
        app.store.put = put;
        app.store.commit = commit;
      }
      const pending = app.store.get<AttachmentImport>(
        "AttachmentImport",
        body.request_id,
      );
      assert.equal(pending.state, "PENDING");
      assert.equal(pending.reserved_bytes, bytes.length);
      assert.equal(s.receipt(body.request_id).state, "QUEUED");
      assert.equal(
        s.receipt(body.request_id).error_code,
        "ATTACHMENT_IMPORT_RETRY_REQUIRED",
      );
      s.attachmentImports.schedule();
      await s.attachmentImports.settle();
      assert.equal(s.receipt(body.request_id).state, "COMPLETED");
      assert.equal(
        app.store.get<AttachmentImport>("AttachmentImport", body.request_id)
          .attachment_id,
        pending.attachment_id,
      );
    }
  }));
