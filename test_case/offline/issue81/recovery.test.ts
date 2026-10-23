import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { hash, id, Store } from "../../../src/pi_secretary/src/store.ts";
import type {
  AttachmentImport,
  Attachment,
  ApiCommand,
} from "../../../src/pi_secretary/src/contracts.ts";
for (const phase of ["reservation", "cas", "ready"])
  test(`SIGKILL import at ${phase} preserves identity and completes once`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue81-crash-")),
      source = path.join(dir, "源 文件.png"),
      argsFile = path.join(dir, "args.json"),
      data = path.join(dir, "data");
    const bytes = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    fs.writeFileSync(source, bytes);
    const args = {
      request_id: id(),
      source_path: source,
      expected_sha256: hash(bytes),
      expected_bytes: String(bytes.length),
      name: "原始.png",
    };
    fs.writeFileSync(argsFile, JSON.stringify(args));
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "test_case/offline/issue81/helpers/import-crash.ts",
        data,
        phase,
        argsFile,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    const exit = await new Promise<{
      code: number | null;
      signal: string | null;
    }>((r) => child.on("exit", (code, signal) => r({ code, signal })));
    assert.equal(exit.signal, "SIGKILL", output);
    if (phase !== "reservation") fs.unlinkSync(source);
    const app = await App.open(data, {
        model: fixtureModel,
        stream: fixtureStream,
      }),
      s = new ApplicationService(app);
    try {
      await s.attachmentImports.settle();
      const entry = app.store.get<AttachmentImport>(
        "AttachmentImport",
        args.request_id,
      );
      assert.equal(entry.state, "READY");
      assert.equal(
        s.command(s.principal, "attachments/import", args).state,
        "COMPLETED",
      );
      assert.equal(app.store.all("Attachment").length, 1);
      assert.deepEqual(
        app.store.bytes(
          app.store.get<Attachment>("Attachment", entry.attachment_id).content,
        ),
        bytes,
      );
      assert.ok(
        app.store
          .all<ApiCommand>("ApiCommand")
          .every(
            (c) => c.command !== "attachments/import" || c.state !== "UNKNOWN",
          ),
      );
    } finally {
      await s.close();
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
test("missing/truncated referenced attachment fails Store.open; same-length corruption fails at read", async () => {
  for (const mode of ["missing", "truncated", "same-length"]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue81-corrupt-")),
      app = await App.open(dir, { model: fixtureModel, stream: fixtureStream }),
      s = new ApplicationService(app);
    const bytes = await sharp({
        create: { width: 12, height: 12, channels: 3, background: "red" },
      })
        .png()
        .toBuffer(),
      source = path.join(dir, "image.png"),
      request = id();
    fs.writeFileSync(source, bytes);
    s.command(s.principal, "attachments/import", {
      request_id: request,
      source_path: source,
      expected_sha256: hash(bytes),
      expected_bytes: String(bytes.length),
      name: "i.png",
    });
    await s.attachmentImports.settle();
    const a = app.store.all<Attachment>("Attachment")[0];
    await s.close();
    await app.close();
    if (mode === "missing") fs.unlinkSync(path.join(dir, a.content.path));
    else
      fs.writeFileSync(
        path.join(dir, a.content.path),
        mode === "truncated" ? Buffer.alloc(1) : Buffer.alloc(bytes.length),
      );
    if (mode === "same-length") {
      const store = await Store.open(dir);
      try {
        assert.throws(() => store.bytes(a.content), /CORRUPT_OBJECT/);
      } finally {
        await store.close();
      }
    } else await assert.rejects(Store.open(dir));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
for (const phase of ["before", "after"])
  test(`SIGKILL ${phase} withdrawal frame leaves exactly one complete state on same-ID retry`, async () => {
    const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "issue81-withdraw-crash-"),
      ),
      data = path.join(dir, "data"),
      info = path.join(dir, "info.json");
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "test_case/offline/issue81/helpers/withdraw-crash.ts",
        data,
        phase,
        info,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    const signal = await new Promise<string | null>((r) =>
      child.on("exit", (_, signal) => r(signal)),
    );
    assert.equal(signal, "SIGKILL", output);
    const frozen = JSON.parse(fs.readFileSync(info, "utf8")),
      app = await App.open(data, {
        model: { ...fixtureModel, contextWindow: 128000 },
        stream: fixtureStream,
      }),
      s = new ApplicationService(app);
    try {
      assert.equal(
        app.store.find("ApiCommand", frozen.body.request_id) !== undefined,
        phase === "after",
      );
      s.command(s.principal, frozen.route, frozen.body);
      const frames = app.store.projectionFrames.filter((f) =>
        f.mutations.some(
          (m) =>
            m.object_type === "ApiCommand" &&
            m.object_id === frozen.body.request_id,
        ),
      );
      assert.equal(frames.length, 1);
      assert.ok(
        ["Context", "Session", "Input", "ApiCommand"].every((t) =>
          frames[0].mutations.some((m) => m.object_type === t),
        ),
      );
      assert.equal(
        app.store.get<
          import("../../../src/pi_secretary/src/contracts.ts").Input
        >("Input", frozen.inputID).state,
        "WITHDRAWN",
      );
      app.host.accept("continue text");
      await app.host.drain();
      assert.equal(
        app.host.session.state,
        "IDLE",
        app.host.session.recovery_error ?? "",
      );
    } finally {
      await s.close();
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
for (const phase of ["input", "checkpoint", "request"])
  test(`SIGKILL image ${phase} replays original bytes and repairs exactly one input message`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue81-input-crash-")),
      data = path.join(dir, "data"),
      info = path.join(dir, "info.json"),
      prior = process.env.SECRETARY_VISION_BUDGET_PROFILES;
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "test_case/offline/issue81/helpers/input-crash.ts",
        data,
        phase,
        info,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    const signal = await new Promise<string | null>((r) =>
      child.on("exit", (_, signal) => r(signal)),
    );
    assert.equal(signal, "SIGKILL", output);
    const frozen = JSON.parse(fs.readFileSync(info, "utf8")),
      model = {
        ...fixtureModel,
        input: ["text", "image"] as ("text" | "image")[],
        contextWindow: 128000,
      };
    process.env.SECRETARY_VISION_BUDGET_PROFILES = JSON.stringify([
      {
        version: 1,
        provider: model.provider,
        api: model.api,
        model: model.id,
        baseUrl: model.baseUrl,
        tokens_per_image: 8192,
        max_side: 4096,
        max_pixels: 4194304,
        source: "Synthetic crash fixture",
      },
    ]);
    const app = await App.open(data, { model, stream: fixtureStream }),
      s = new ApplicationService(app);
    try {
      const receipt = s.command(s.principal, "messages", frozen.body);
      const inputID = receipt.resource_ids.find((r) => r.type === "Input")!.id;
      await app.host.drain();
      assert.equal(
        app.host.session.state,
        "IDLE",
        app.host.session.recovery_error ?? "",
      );
      const input = app.store.get<
        import("../../../src/pi_secretary/src/contracts.ts").Input
      >("Input", inputID);
      assert.equal(input.state, "HANDLED");
      assert.equal(input.attachments![0].content.sha256, frozen.sha256);
      const events = app.store
        .events("main.message")
        .filter(
          (e) =>
            app.store.read<any>(e.payload).secretary_input?.input_id ===
            inputID,
        );
      assert.equal(events.length, 1);
      const { imageLeaves } =
        await import("../../../src/pi_secretary/src/vision.ts");
      assert.equal(
        imageLeaves(app.store.read(events[0].payload))[0].sha256,
        frozen.sha256,
      );
    } finally {
      await s.close();
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
      if (prior === undefined)
        delete process.env.SECRETARY_VISION_BUDGET_PROFILES;
      else process.env.SECRETARY_VISION_BUDGET_PROFILES = prior;
    }
  });
