import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
  type AgentMessage,
} from "../../../src/pi_secretary/src/model.ts";
import { hash, id } from "../../../src/pi_secretary/src/store.ts";
import {
  attachmentForm,
  attachmentMessage,
  typedMessageText,
} from "../../../src/pi_secretary/src/attachment-form.ts";
import { inputMessage } from "../../../src/pi_secretary/src/input-projection.ts";
import { settingsSource } from "../../../src/pi_secretary/src/settings-memory.ts";
import { imageLeaves } from "../../../src/pi_secretary/src/vision.ts";
import type {
  Input,
  Context,
  AttachmentImport,
} from "../../../src/pi_secretary/src/contracts.ts";
import { searchDocument } from "../../../src/pi_secretary/src/memory-search.ts";
import {
  enqueueExtractions,
  mergeExtraction,
} from "../../../src/pi_secretary/src/memory-extraction.ts";
import { revise } from "../../../src/pi_secretary/src/store.ts";
import { projectContext } from "../../../src/pi_secretary/src/context-projection.ts";
import { putEvidence } from "../../../src/pi_secretary/src/evidence.ts";
import {
  authenticatedIdentityHash,
  assertActiveSourceEvents,
} from "../../../src/pi_secretary/src/attachment-form.ts";
async function fixture(
  run: (app: App, s: ApplicationService, attachmentID: string) => Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue81-input-"));
  const model = {
    ...fixtureModel,
    input: ["text", "image"] as ("text" | "image")[],
    contextWindow: 128000,
  };
  const prior = process.env.SECRETARY_VISION_BUDGET_PROFILES;
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
      source: "Synthetic fixture, not a production bound",
    },
  ]);
  const app = await App.open(dir, { model, stream: fixtureStream }),
    s = new ApplicationService(app);
  try {
    const bytes = await sharp({
        create: { width: 1920, height: 1080, channels: 3, background: "blue" },
      })
        .png()
        .toBuffer(),
      file = path.join(dir, "image.png"),
      request = id();
    fs.writeFileSync(file, bytes);
    s.command(s.principal, "attachments/import", {
      request_id: request,
      source_path: file,
      expected_sha256: hash(bytes),
      expected_bytes: String(bytes.length),
      name: "image.png",
    });
    await s.attachmentImports.settle();
    fs.unlinkSync(file);
    const a = app.store.get<AttachmentImport>("AttachmentImport", request);
    assert.equal(a.state, "READY");
    await run(app, s, a.attachment_id);
  } finally {
    await s.close();
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (prior === undefined)
      delete process.env.SECRETARY_VISION_BUDGET_PROFILES;
    else process.env.SECRETARY_VISION_BUDGET_PROFILES = prior;
  }
}
test("image input identity, active loop pixels, next-loop K=0, settings metadata and frozen full evidence", () =>
  fixture(async (app, s, a) => {
    const i = app.host.accept("describe", id(), "MASTER", [a]);
    const full = inputMessage(app.store, i);
    assert.equal(imageLeaves(full).length, 1);
    assert.equal(attachmentForm(app.store, full)?.typedText, "describe");
    const forged = structuredClone(full);
    (forged as any).content[1].data = Buffer.from("no").toString("base64");
    assert.throws(
      () => attachmentForm(app.store, forged),
      /ATTACHMENT_CONTENT_MISMATCH/,
    );
    assert.throws(
      () =>
        attachmentMessage(app.store, i, "stub") &&
        attachmentForm(app.store, attachmentMessage(app.store, i, "stub")),
      /ATTACHMENT_STUB_BEFORE_HANDLED/,
    );
    await app.host.drain();
    assert.equal(
      app.host.session.state,
      "IDLE",
      app.host.session.recovery_error ?? "",
    );
    assert.equal(app.store.get<Input>("Input", i.id).state, "HANDLED");
    const saved = app.store.get<Context>(
        "Context",
        app.host.session.last_context_id!,
      ),
      frozen = app.store.read<AgentMessage[]>(saved.raw_context);
    assert.equal(imageLeaves(frozen).length, 1);
    app.host.accept("follow up");
    await app.host.drain();
    assert.equal(
      app.host.session.state,
      "IDLE",
      app.host.session.recovery_error ?? "",
    );
    const next = app.store.read<AgentMessage[]>(
      app.store.get<Context>("Context", app.host.session.last_context_id!)
        .raw_context,
    );
    assert.equal(imageLeaves(next).length, 0);
    const stub = next.find(
      (m) => attachmentForm(app.store, m)?.input.id === i.id,
    )!;
    assert.equal(typedMessageText(app.store, stub), "describe");
    assert.equal(imageLeaves(app.store.read(saved.raw_context)).length, 1);
    const source = settingsSource(app.host, { world: [], instructions: null });
    assert.ok(source.chunks.every((c) => !c.includes('"data":')));
    assert.ok(source.extraction_messages.some((m) => m.text === "describe"));
    assert.ok(
      source.extraction_messages.every(
        (m) => !m.text.includes("contains no pixels"),
      ),
    );
  }));
test("capability change blocks whole input; safe atomic withdrawal and subsequent text continue", () =>
  fixture(async (app, s, a) => {
    const i = app.host.accept("withdraw this private prose", id(), "MASTER", [
      a,
    ]);
    app.host.model.input = ["text"];
    await app.host.drain();
    assert.equal(app.host.session.state, "RECOVERY_BLOCKED");
    const current = app.store.get<Input>("Input", i.id),
      request = id();
    const r = s.command(s.principal, `inputs/${i.id}/withdraw`, {
      request_id: request,
      expected_revision: String(current.revision),
    });
    assert.equal(r.state, "ACCEPTED");
    assert.equal(app.store.get<Input>("Input", i.id).state, "WITHDRAWN");
    const frame = app.store.projectionFrames.at(-1)!;
    assert.ok(
      ["Input", "Context", "Session", "ApiCommand"].every((t) =>
        frame.mutations.some((m) => m.object_type === t),
      ),
    );
    const accepted = app.store
      .events("input.accepted")
      .find((e) => app.store.read<Input>(e.payload).id === i.id)!;
    assert.equal(searchDocument(app.store, accepted), null);
    app.host.accept("safe next");
    await app.host.drain();
    assert.equal(
      app.host.session.state,
      "IDLE",
      app.host.session.recovery_error ?? "",
    );
    const messages = app.store.read<AgentMessage[]>(
      app.store.get<Context>("Context", app.host.session.last_context_id!)
        .raw_context,
    );
    assert.equal(imageLeaves(messages).length, 0);
    assert.ok(
      !JSON.stringify(messages).includes("withdraw this private prose"),
    );
    assert.equal(
      s.command(s.principal, `inputs/${i.id}/withdraw`, {
        request_id: request,
        expected_revision: String(current.revision),
      }).request_id,
      request,
    );
  }));
test("withdrawal is metadata-only under same-length image corruption and expires after one next loop", () =>
  fixture(async (app, s, a) => {
    const i = app.host.accept("private revoked text", id(), "MASTER", [a]);
    app.host.model.input = ["text"];
    await app.host.drain();
    const current = app.store.get<Input>("Input", i.id),
      binding = current.attachments![0];
    fs.writeFileSync(
      path.join(app.store.dir, binding.content.path),
      Buffer.alloc(binding.content.bytes),
    );
    s.command(s.principal, `inputs/${i.id}/withdraw`, {
      request_id: id(),
      expected_revision: String(current.revision),
    });
    for (let n = 0; n < 2; n++) {
      app.host.accept(`next ${n}`);
      await app.host.drain();
      assert.equal(
        app.host.session.state,
        "IDLE",
        app.host.session.recovery_error ?? "",
      );
      const messages = app.store.read<AgentMessage[]>(
        app.store.get<Context>("Context", app.host.session.last_context_id!)
          .raw_context,
      );
      assert.equal(
        messages.filter((m) => (m as any).secretary_input?.mode === "withdrawn")
          .length,
        n === 0 ? 1 : 0,
      );
    }
    const source = settingsSource(app.host, { world: [], instructions: null });
    assert.ok(!JSON.stringify(source.chunks).includes("private revoked text"));
    assert.ok(
      !source.extraction_messages.some((m) =>
        m.text.includes("private revoked text"),
      ),
    );
  }));
test("withdrawal refuses stale IN_FLIGHT without mutating it", () =>
  fixture(async (app, s, a) => {
    const i = app.host.accept("blocked", id(), "MASTER", [a]);
    app.host.model.input = ["text"];
    await app.host.drain();
    const current = app.store.get<Input>("Input", i.id),
      context = app.store.get<Context>(
        "Context",
        app.host.session.last_context_id!,
      );
    const { base, now } =
      await import("../../../src/pi_secretary/src/store.ts");
    const call: import("../../../src/pi_secretary/src/contracts.ts").ModelCall =
      {
        ...base(),
        schema_version: 1,
        record_type: "ModelCall",
        state: "IN_FLIGHT",
        context_id: context.id,
        scope: { session_id: i.session_id, task_id: null, execution_id: null },
        transport_attempt: 1,
        request: app.store.put({ messages: [] }),
        response: null,
        started_at: now(),
        completed_at: null,
        error: null,
      };
    app.store.commit([call]);
    const before = app.store.sequence;
    assert.throws(
      () =>
        s.command(s.principal, `inputs/${i.id}/withdraw`, {
          request_id: id(),
          expected_revision: String(current.revision),
        }),
      /WITHDRAWAL_UNSAFE/,
    );
    assert.equal(app.store.sequence, before);
    assert.equal(
      app.store.get<
        import("../../../src/pi_secretary/src/contracts.ts").ModelCall
      >("ModelCall", call.id).state,
      "IN_FLIGHT",
    );
  }));
for (const kind of ["assistant", "tool"] as const)
  test(`withdrawal refuses durable ${kind} effects before changing any record`, () =>
    fixture(async (app, s, a) => {
      const input = app.host.accept("unsafe", id(), "MASTER", [a]);
      app.host.model.input = ["text"];
      await app.host.drain();
      const scope = {
        session_id: input.session_id,
        task_id: null,
        execution_id: null,
      };
      app.store.commit(
        [],
        [
          app.store.event(
            kind === "assistant" ? "main.message" : "main.tool.started",
            kind === "assistant"
              ? {
                  role: "assistant",
                  content: [{ type: "text", text: "already produced" }],
                  timestamp: 1,
                }
              : { tool_call_id: id() },
            scope,
          ),
        ],
      );
      const before = app.store.sequence;
      assert.throws(
        () =>
          s.command(s.principal, `inputs/${input.id}/withdraw`, {
            request_id: id(),
            expected_revision: String(
              app.store.get<Input>("Input", input.id).revision,
            ),
          }),
        /WITHDRAWAL_UNSAFE/,
      );
      assert.equal(app.store.sequence, before);
      assert.equal(app.store.get<Input>("Input", input.id).state, "CLAIMED");
    }));
test("withdrawal rejects frozen extraction publication and both accepted/message source evidence", () =>
  fixture(async (app, s, a) => {
    const input = app.host.accept(
      "I will send the synthetic report tomorrow.",
      id(),
      "MASTER",
      [a],
    );
    app.host.model.input = ["text"];
    await app.host.drain();
    const event = app.store
      .events("main.message")
      .find(
        (e) =>
          (app.store.read<AgentMessage>(e.payload) as any).secretary_input
            ?.input_id === input.id,
      )!;
    const [job] = enqueueExtractions({
      store: app.store,
      sessionID: input.session_id,
      source: null,
      completeMessages: [
        {
          id: event.event_id,
          role: "user",
          text: "I will send the synthetic report tomorrow.",
        },
      ],
    });
    const running = revise(job, { state: "RUNNING" });
    app.store.commit([running]);
    const candidate = revise(running, {
      state: "SUCCEEDED",
      quotes: ["I will send the synthetic report tomorrow."],
    });
    app.store.commit([candidate]);
    s.command(s.principal, `inputs/${input.id}/withdraw`, {
      request_id: id(),
      expected_revision: String(
        app.store.get<Input>("Input", input.id).revision,
      ),
    });
    mergeExtraction(app.store, candidate);
    const saved = app.store.get<typeof candidate>(
      "MemoryExtractionJob",
      candidate.id,
    );
    assert.equal(saved.state, "FAILED");
    assert.equal(saved.error, "ATTACHMENT_SOURCE_WITHDRAWN");
    assert.equal(saved.merged, false);
    const accepted = app.store
      .events("input.accepted")
      .find((e) => app.store.read<Input>(e.payload).id === input.id)!;
    for (const e of [event, accepted])
      assert.throws(
        () => assertActiveSourceEvents(app.store, [e.event_id]),
        /ATTACHMENT_SOURCE_WITHDRAWN/,
      );
  }));
test("canonical authentication rejects stale, v1, reordered and forged forms; mode keys preserve typed text", () =>
  fixture(async (app, s, a) => {
    const input = app.host.accept("typed quotation", id(), "MASTER", [a]);
    const full = inputMessage(app.store, input),
      key = authenticatedIdentityHash(app.store, full);
    await app.host.drain();
    const stub = attachmentMessage(
      app.store,
      app.store.get<Input>("Input", input.id),
      "stub",
    );
    assert.equal(authenticatedIdentityHash(app.store, stub), key);
    assert.equal(typedMessageText(app.store, stub), "typed quotation");
    for (const mutate of [
      (m: any) => {
        m.secretary_input.version = 1;
      },
      (m: any) => {
        m.secretary_input.journal_digest = "0".repeat(64);
      },
      (m: any) => {
        m.secretary_input.input_id = id();
      },
      (m: any) => {
        m.content.reverse();
      },
      (m: any) => {
        m.content.pop();
      },
      (m: any) => {
        m.content[0].text = "forged";
      },
    ]) {
      const forged = structuredClone(full);
      mutate(forged);
      assert.throws(() => authenticatedIdentityHash(app.store, forged));
    }
  }));
test("crop frozen before HANDLED retains the authenticated current stub without resurrecting pixels", () =>
  fixture(async (app, s, a) => {
    const input = app.host.accept("crop identity", id(), "MASTER", [a]);
    const full = inputMessage(app.store, input),
      tail: AgentMessage = {
        role: "user",
        content: "disposable fixture",
        timestamp: 2,
      };
    const mapping = {
      attachment_form_version: 1 as const,
      job_id: id(),
      source_ref: putEvidence(app.store, [full, tail]),
      messages_ref: putEvidence(app.store, [full]),
      source_end_sequence: app.store.eventSequence,
    };
    await app.host.drain();
    const stub = attachmentMessage(
      app.store,
      app.store.get<Input>("Input", input.id),
      "stub",
    );
    const cs = app.store.get<
      import("../../../src/pi_secretary/src/contracts.ts").Consciousness
    >("Consciousness", app.host.session.consciousness_id);
    const projected = projectContext({
      store: app.store,
      sessionID: input.session_id,
      consciousness: { ...cs, context_compaction: mapping },
      messages: [stub, tail],
    });
    assert.equal(projected.length, 1);
    assert.deepEqual(projected[0], stub);
    assert.equal(imageLeaves(projected).length, 0);
    assert.equal(imageLeaves(app.store.read(mapping.messages_ref)).length, 1);
    const forged = structuredClone(stub) as any;
    forged.content[0].text = "forged";
    assert.throws(
      () =>
        projectContext({
          store: app.store,
          sessionID: input.session_id,
          consciousness: { ...cs, context_compaction: mapping },
          messages: [forged, tail],
        }),
      /ATTACHMENT_CONTENT_MISMATCH/,
    );
  }));
