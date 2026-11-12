import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import type {
  Input,
  Operation,
} from "../../../src/pi_secretary/src/contracts.ts";

test("Main tool → owner HTTP approval → isolated report → next Master delegation", async () => {
  const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "secretary-113-flow-")),
    ),
    directory = path.join(root, "project");
  fs.mkdirSync(directory);
  let app: App;
  const batches: string[][] = [];
  const stream: StreamFn = (model, context, options) => {
    const claimed = app.store
      .all<Input>("Input")
      .filter((i) => i.state === "CLAIMED");
    if (
      claimed.length &&
      !JSON.stringify(context.messages[0]).match(
        /CONSCIOUSNESS:|COMMITMENT_EXTRACTION:/,
      )
    ) {
      batches.push(claimed.map((i) => i.producer));
      if (
        claimed.some(
          (i) => app.store.bytes(i.payload).toString() === "Import the project",
        ) &&
        !app.store.all("Operation").length
      ) {
        const event = app.store
          .events("input.accepted")
          .find((e) => app.store.read<Input>(e.payload).id === claimed[0].id)!;
        assert.match(
          JSON.stringify(context.messages[0]),
          new RegExp(event.event_id),
        );
        return replyStream(
          [
            {
              type: "toolCall",
              id: id(),
              name: "scope_import",
              arguments: {
                name: "Project",
                kind: "DIRECTORY",
                root_path: directory,
                source_event_ids: [event.event_id],
              },
            },
          ],
          model,
        );
      }
    }
    return fixtureStream(model, context, options);
  };
  app = await App.open(path.join(root, "core"), {
    model: fixtureModel,
    stream,
  });
  const server = await serveCore(app, 0),
    client = new CoreClient(server.endpoint);
  try {
    app.host.accept("Import the project");
    await app.host.drain();
    assert.equal(app.store.all("Scope").length, 0);
    const op = app.store.all<Operation>("Operation")[0];
    assert.equal(op.action.action, "scope.import");
    const detail: any = await client.query(
      "authorizations/" + op.authorization_id,
    );
    assert.equal(detail.display.parameters.proposal.root_path, directory);
    assert.equal(detail.display.parameters.proposal.default_write, "ask");
    assert.equal(
      typeof detail.display.parameters.proposal.identity.inode,
      "string",
    );
    assert.match(detail.display.evidence[0].quote, /Import the project/);
    assert.equal(detail.remember_context, null);
    await client.command(
      "authorizations/" + op.authorization_id + "/decision",
      {
        request_id: id(),
        expected_revision: detail.revision,
        display_hash: detail.display_hash,
        decision: "APPROVE",
      },
    );
    app.scopeImports.drain();
    const env = app.store
      .all<Input>("Input")
      .find((i) => i.producer === "ENVIRONMENT")!;
    app.host.accept("Use the imported project on this new Master turn");
    await app.host.drain();
    await app.host.drain();
    const master = app.store.all<Input>("Input").at(-1)!;
    assert.equal(app.store.get<Input>("Input", env.id).state, "HANDLED");
    assert.notEqual(
      app.store.get<Input>("Input", env.id).loop_id,
      master.loop_id,
    );
    assert(batches.some((b) => b.length === 1 && b[0] === "ENVIRONMENT"));
    assert(
      !batches.some((b) => b.includes("ENVIRONMENT") && b.includes("MASTER")),
    );
    const tools = (app.host as any).tools(master.loop_id);
    const query = await tools
      .find((t: any) => t.name === "scope_query")
      .execute(id(), { kind: "imports", id: op.id });
    assert.match(JSON.stringify(query), /SUCCEEDED/);
    const created = app.store.all<any>("Scope")[0];
    await tools
      .find((t: any) => t.name === "task_propose")
      .execute(id(), {
        goal: "List the imported project",
        title_candidate: "Project listing",
        scope_id: created.id,
      });
    assert.equal(app.store.all<any>("TaskPlan")[0].scope_id, created.id);
    const sequence = app.store.sequence;
    app.scopeImports.drain();
    assert.equal(app.store.sequence, sequence);
  } finally {
    await server.close();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
