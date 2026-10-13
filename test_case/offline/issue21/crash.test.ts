import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { testPostgres } from "../helpers/postgres.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import type { WorldCommand } from "../../../src/pi_secretary/src/contracts.ts";

const worker = fileURLToPath(new URL("./workers/crash.ts", import.meta.url));
testPostgres(
  "S4: actual SIGKILL before/after SQL COMMIT replays a whole projection batch",
  async (dsn) => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "secretary-project-crash-"),
    );
    let app = await App.open(
      dir,
      { model: fixtureModel, stream: fixtureStream },
      dsn,
    );
    try {
      await app.world!.migrate();
      for (const mode of ["project-before", "project-after"]) {
        app.host.accept("杭州 " + mode);
        await app.close();
        const child = spawnSync(
          process.execPath,
          ["--import", "tsx", worker, dir, mode],
          {
            env: { ...process.env, SECRETARY_TEST_DATABASE_URL: dsn },
            encoding: "utf8",
            timeout: 15000,
          },
        );
        assert.equal(child.signal, "SIGKILL", child.stderr);
        app = await App.open(
          dir,
          { model: fixtureModel, stream: fixtureStream },
          dsn,
        );
        await app.world!.memorySearch.catchUp();
        const result = await app.world!.memorySearch.search({ query: mode });
        assert.equal(result.hits.length, 1);
        const counts = (
          await app.world!.pool.query(
            "SELECT (SELECT count(*) FROM mem.document) AS documents,(SELECT count(*) FROM mem.chunk) AS chunks",
          )
        ).rows[0];
        const expected = mode === "project-before" ? "1" : "2";
        assert.equal(counts.documents, expected);
        assert.equal(counts.chunks, expected);
      }
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
testPostgres(
  "D3/W3: actual SIGKILL after World proposal fsync reuses the command and saved model response",
  async (dsn) => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "secretary-world-crash-"),
    );
    const stream: StreamFn = (model, context, options) =>
      context.messages.at(-1)?.role === "user"
        ? replyStream(
            [
              {
                type: "toolCall",
                id: "durable-world-proposal",
                name: "memory_propose_change",
                arguments: {
                  intent: "ASSERT",
                  subject: "Crash subject",
                  predicate: "person.height",
                  value: 170,
                },
              },
            ],
            model,
          )
        : fixtureStream(model, context, options);
    let app = await App.open(dir, { model: fixtureModel, stream }, dsn);
    try {
      await app.world!.migrate();
      app.settings.save(
        {
          ...emptySettings(),
          edits: [
            {
              kind: "ENTITY",
              entity_id: id(),
              entity_kind: "PERSON",
              display_name: "Crash subject",
              expected_revision: 0,
            },
          ],
        },
        app.settings.draft().revision,
      );
      app.settings.request(app.settings.draft().revision, id());
      await app.settings.tick();
      app.host.accept("The synthetic height is 170");
      await app.close();
      const child = spawnSync(
        process.execPath,
        ["--import", "tsx", worker, dir, "world"],
        {
          env: { ...process.env, SECRETARY_TEST_DATABASE_URL: dsn },
          encoding: "utf8",
          timeout: 15000,
        },
      );
      assert.equal(child.signal, "SIGKILL", child.stderr);
      app = await App.open(dir, { model: fixtureModel, stream }, dsn);
      await app.host.drain();
      assert.equal(
        app.host.session.state,
        "IDLE",
        app.host.session.recovery_error ?? "",
      );
      assert.equal(app.store.all<WorldCommand>("WorldCommand").length, 1);
      assert.equal(
        (await app.world!.pool.query("SELECT count(*) FROM wm.assertion"))
          .rows[0].count,
        "0",
        "recovery does not approve the proposal",
      );
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
