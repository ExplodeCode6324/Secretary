import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { testPostgres } from "../helpers/postgres.ts";
import { shortStream, apply } from "../issue28/helpers.ts";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  type AgentMessage,
} from "../../../src/pi_secretary/src/model.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import { hash, id } from "../../../src/pi_secretary/src/store.ts";
import { imageLeaves } from "../../../src/pi_secretary/src/vision.ts";
import { attachmentForm } from "../../../src/pi_secretary/src/attachment-form.ts";
import type {
  AttachmentImport,
  Context,
  Input,
} from "../../../src/pi_secretary/src/contracts.ts";
import { settingsSource } from "../../../src/pi_secretary/src/settings-memory.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import { proposeWorld } from "../../../src/pi_secretary/src/world-memory.ts";
import type {
  SettingsApplication,
  WorldCommand,
} from "../../../src/pi_secretary/src/contracts.ts";
testPostgres(
  "50 image turns remain bounded with searchable history, compaction and settings authenticated coverage",
  async (databaseURL) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue81-history-")),
      model = {
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
        source: "Synthetic fixture only",
      },
    ]);
    const app = await App.open(
        dir,
        { model, stream: shortStream },
        databaseURL,
      ),
      service = new ApplicationService(app);
    try {
      await app.world!.migrate();
      const bytes = await sharp({
          create: {
            width: 1920,
            height: 1080,
            channels: 3,
            background: "blue",
          },
        })
          .png()
          .toBuffer(),
        file = path.join(dir, "fixture.png"),
        request = id();
      fs.writeFileSync(file, bytes);
      service.command(service.principal, "attachments/import", {
        request_id: request,
        source_path: file,
        expected_sha256: hash(bytes),
        expected_bytes: String(bytes.length),
        name: "fixture.png",
      });
      await service.attachmentImports.settle();
      const attachment = app.store.get<AttachmentImport>(
        "AttachmentImport",
        request,
      ).attachment_id;
      fs.unlinkSync(file);
      for (let n = 0; n < 50; n++) {
        const input = app.host.accept(
          n % 2 ? "" : `synthetic image turn ${n}`,
          id(),
          "MASTER",
          [attachment],
        );
        await app.world!.memorySearch.catchUp();
        await app.host.drain();
        assert.equal(
          app.host.session.state,
          "IDLE",
          `turn ${n}: ${app.host.session.recovery_error}`,
        );
        assert.equal(app.store.get<Input>("Input", input.id).state, "HANDLED");
        const messages = app.store.read<AgentMessage[]>(
          app.store.get<Context>("Context", app.host.session.last_context_id!)
            .raw_context,
        );
        assert.ok(imageLeaves(messages).length <= 1);
      }
      await app.world!.memorySearch.catchUp();
      assert.equal(app.world!.memorySearch.state, "ready");
      assert.ok(
        (await app.world!.memorySearch.search({ query: "fixture.png" })).hits
          .length > 0,
      );
      await app.host.compact();
      assert.equal(
        app.host.session.state,
        "IDLE",
        app.host.session.recovery_error ?? "",
      );
      const source = settingsSource(app.host, {
        world: [],
        instructions: null,
      });
      assert.ok(!source.chunks.join("").includes(bytes.toString("base64")));
      await apply(app);
      app.host.accept("text after settings");
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
      for (const message of messages) attachmentForm(app.store, message);
      const subject = id();
      app.settings.save(
        {
          ...emptySettings(),
          edits: [
            {
              kind: "ENTITY",
              entity_id: subject,
              entity_kind: "PERSON",
              display_name: "Synthetic image subject",
              aliases: [],
              expected_revision: 0,
            },
          ],
        },
        app.settings.draft().revision,
      );
      const setting = app.settings.request(
        app.settings.draft().revision,
        id(),
      ) as SettingsApplication;
      await app.settings.tick();
      assert.equal(
        app.store.get<SettingsApplication>("SettingsApplication", setting.id)
          .state,
        "APPLIED",
      );
      const repeated = app.store.read<
        import("../../../src/pi_secretary/src/settings-memory.ts").SettingsSource
      >(
        app.store.get<SettingsApplication>("SettingsApplication", setting.id)
          .source_ref!,
      );
      assert.ok(repeated.anchors.some((a) => a.attachment_message));
      assert.ok(
        repeated.attachment_boundary,
        "covered attachment anchors still require a frozen boundary",
      );
      app.host.accept("text after second settings");
      await app.host.drain();
      await app.host.compact();
      assert.equal(
        app.host.session.state,
        "IDLE",
        app.host.session.recovery_error ?? "",
      );
      for (const text of ["withdrawal-search-unique-prose", ""]) {
        const input = app.host.accept(text, id(), "MASTER", [attachment]);
        const event = app.store
          .events("input.accepted")
          .find((e) => app.store.read<Input>(e.payload).id === input.id)!;
        const scope = {
          session_id: input.session_id,
          task_id: null,
          execution_id: null,
        };
        const args = {
          intent: "ASSERT" as const,
          subject,
          predicate: "person.height",
          value: 170,
          source_event_ids: [event.event_id],
        };
        const proposal = await proposeWorld(app.world!, scope, args, id(), []);
        assert.ok("command_id" in proposal);
        const change = app.store.get<WorldCommand>(
          "WorldCommand",
          proposal.command_id!,
        ).change;
        assert.equal(change.record_type, "WorldCatalogChange");
        if (change.record_type === "WorldCatalogChange")
          assert.equal(change.source_kind, "MODEL_INFERENCE");
        await app.world!.memorySearch.catchUp();
        assert.equal(
          (
            await app.world!.pool.query(
              "SELECT count(*) FROM mem.document WHERE event_id=$1",
              [event.event_id],
            )
          ).rows[0].count,
          "1",
        );
        service.command(service.principal, `inputs/${input.id}/withdraw`, {
          request_id: id(),
          expected_revision: String(input.revision),
        });
        // SQL intentionally lags the withdrawal: query-time authority must already suppress it.
        const hits = await app.world!.memorySearch.search({
          query: text || "fixture.png",
        });
        assert.ok(!hits.hits.some((h) => h.event_id === event.event_id));
        await assert.rejects(
          proposeWorld(app.world!, scope, args, id(), []),
          /ATTACHMENT_SOURCE_WITHDRAWN/,
        );
        await app.world!.memorySearch.catchUp();
        for (const table of ["document", "chunk"])
          assert.equal(
            (
              await app.world!.pool.query(
                `SELECT count(*) FROM mem.${table} WHERE event_id=$1`,
                [event.event_id],
              )
            ).rows[0].count,
            "0",
          );
      }
    } finally {
      await service.close();
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
      if (prior === undefined)
        delete process.env.SECRETARY_VISION_BUDGET_PROFILES;
      else process.env.SECRETARY_VISION_BUDGET_PROFILES = prior;
    }
  },
);
