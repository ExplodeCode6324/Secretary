import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { base, id, revise } from "../../../src/pi_secretary/src/store.ts";
import type { Execution } from "../../../src/pi_secretary/src/contracts.ts";
import { project } from "../../../src/pi_secretary/src/api/protocol.ts";

test("R2/R3: public dates and predicate JSON do not expose private schema references", () => {
  const ref = {
    path: "objects/" + "a".repeat(64),
    sha256: "a".repeat(64),
    bytes: 7,
    media_type: "application/json",
  };
  const projectedRef = {
    content_version: ref.sha256,
    bytes: "7",
    media_type: ref.media_type,
  };
  const schema = {
    type: "object",
    properties: {
      entrypoint: { type: "string" },
      workspace: { type: "number" },
    },
  };
  assert.deepEqual(
    project({
      created_at: new Date("2032-06-17T12:34:56.789Z"),
      retired_at: null,
      workspace: "private",
      entrypoint: "private",
      parameters_ref: ref,
      parameters_schema: ref,
      result_schema: ref,
      value_schema: schema,
    }),
    {
      created_at: "2032-06-17T12:34:56.789Z",
      retired_at: null,
      parameters_schema: projectedRef,
      result_schema: projectedRef,
      value_schema: schema,
    },
  );
});

for (const actor of ["MASTER", "MAIN"] as const) {
  for (const reopen of [false, true]) {
    test(`R1: historical ${actor} decision answer ID conflicts over HTTP (reopen=${reopen})`, async () => {
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "secretary-answer-identity-"),
      );
      let app = await App.open(dir, {
        model: fixtureModel,
        stream: fixtureStream,
      });
      let server: Awaited<ReturnType<typeof serveCore>> | undefined;
      try {
        const plan = app.scheduler.propose(
          "Synthetic choice",
          id(),
          app.host.sessionID,
        );
        await app.settle();
        const execution = app.store.all<Execution>("Execution")[0];
        const decision = {
          ...base(),
          record_type: "DecisionRequest" as const,
          schema_version: 1 as const,
          state: "OPEN" as const,
          task_id: plan.id,
          execution_id: execution.id,
          question: "Synthetic option?",
          options: ["A", "B"],
          impact: "Synthetic only",
          materials: [],
          deadline: new Date(Date.now() + 60000).toISOString(),
          answer: null,
          answered_by: null,
          answer_request_id: null,
        };
        app.store.commit([
          decision,
          revise(execution, {
            state: "WAIT_DECISION",
            waiting_request_ids: [decision.id],
          }),
        ]);
        const requestID = id();
        app.scheduler.answer(decision.id, "A", requestID, actor);
        assert.equal(
          app.store.hasReceipt(requestID),
          false,
          "exercise the historical path without CommandReceipt",
        );
        if (reopen) {
          await app.close();
          app = await App.open(dir, {
            model: fixtureModel,
            stream: fixtureStream,
          });
        }
        server = await serveCore(app, 0, undefined, { pump: false });
        const client = new CoreClient(server.endpoint),
          profile = await client.assistant();
        const sequence = app.store.sequence;
        const response = await fetch(
          server.endpoint.url + "/api/v1/assistant/profile",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${server.endpoint.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              request_id: requestID,
              expected_revision: profile.revision,
              name: "Must not rename",
            }),
          },
        );
        assert.equal(response.status, 409);
        assert.equal(
          ((await response.json()) as any).error.code,
          "REQUEST_CONFLICT",
        );
        assert.deepEqual(await client.assistant(), profile);
        assert.equal(app.store.sequence, sequence);
        assert.equal(app.store.find("ApiCommand", requestID), undefined);
      } finally {
        if (server) await server.close();
        else await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}

test("R4: external consumer imports every operation DTO and gets meaningful field types", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const operations = JSON.parse(
    fs.readFileSync(path.join(root, "docs/api/v1/operations.json"), "utf8"),
  ) as { request?: string; response: string }[];
  const names = [
    ...new Set(
      operations
        .flatMap((o) => [o.request, o.response])
        .filter((n): n is string => !!n && n !== "binary"),
    ),
  ].sort();
  const schema = JSON.parse(
    fs.readFileSync(path.join(root, "docs/api/v1/schema.json"), "utf8"),
  );
  const allNames = [
    ...new Set(["ApiV1", ...names, ...Object.keys(schema.$defs)]),
  ].sort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-dto-consumer-"));
  try {
    const consumer = path.join(dir, "consumer.mts");
    fs.writeFileSync(
      consumer,
      `import type { ${allNames.join(", ")} } from ${JSON.stringify(path.join(root, "src/pi_secretary/src/api/contracts.ts"))};
type AllOperationTypes = [${names.join(", ")}];
declare const detail: TaskDetail; const revision: string = detail.revision;
declare const message: Message; const text: string = message.text;
declare const settings: Settings; const blocked: boolean = settings.blocked;
const command: TaskCommand = {request_id: "synthetic", goal: "arithmetic"};
// @ts-expect-error revisions are decimal strings
const badRevision: number = detail.revision;
// @ts-expect-error message text is not numeric
const badText: number = message.text;
// @ts-expect-error goal is required
const missingGoal: TaskCommand = {request_id: "synthetic"};
// @ts-expect-error authority cannot be supplied by clients
const authority: TaskCommand = {request_id: "synthetic", goal: "x", actor: "MASTER"};
// @ts-expect-error settings blocked is boolean
const badBlocked: string = settings.blocked;
`,
    );
    const program = ts.createProgram([consumer], {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      skipLibCheck: true,
      types: [],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(
      diagnostics.length,
      0,
      ts.formatDiagnostics(diagnostics, {
        getCurrentDirectory: () => root,
        getCanonicalFileName: (f) => f,
        getNewLine: () => "\n",
      }),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
