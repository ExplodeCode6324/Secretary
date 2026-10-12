import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { id, now, revise } from "../../../src/pi_secretary/src/store.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";
import { fixture, executions } from "./helpers.ts";
import type { Execution as PublicExecution } from "../../../src/pi_secretary/src/api/contracts.ts";
import type { Execution } from "../../../src/pi_secretary/src/contracts.ts";

const schema = JSON.parse(
  fs.readFileSync(
    new URL("../../../docs/api/v1/schema.json", import.meta.url),
    "utf8",
  ),
);
const openapi = JSON.parse(
  fs.readFileSync(
    new URL("../../../docs/api/v1/openapi.json", import.meta.url),
    "utf8",
  ),
);

test("archived Scope rejects a fresh archive without state or event changes; original request replays", () =>
  fixture(async (app, api) => {
    const scope = app.scheduler.scopes.save({
      name: "Synthetic archive",
      kind: "NONE",
    });
    const route = `scopes/${scope.id}/archive`;
    const body = {
      request_id: id(),
      expected_revision: String(scope.revision),
    };
    const receipt = api.command(api.principal, route, body);
    const archived = app.scheduler.scopes.get(scope.id);
    const count = app.store.logs.filter(
      (x) => x.event_type === "scope.archived",
    ).length;
    assert.equal(count, 1);
    assert.throws(
      () =>
        api.command(api.principal, route, {
          request_id: id(),
          expected_revision: String(archived.revision),
        }),
      /SCOPE_ARCHIVED/,
    );
    assert.deepEqual(app.scheduler.scopes.get(scope.id), archived);
    assert.equal(
      app.store.logs.filter((x) => x.event_type === "scope.archived").length,
      count,
    );
    assert.deepEqual(api.command(api.principal, route, body), receipt);
    assert.deepEqual(app.scheduler.scopes.get(scope.id), archived);
    assert.equal(
      app.store.logs.filter((x) => x.event_type === "scope.archived").length,
      count,
    );
  }));

test("Execution public schema and OpenAPI expose typed condition results including safe evidence", () =>
  fixture(async (app, api) => {
    const ref =
      openapi.paths["/api/v1/executions/{id}"].get.responses["200"].content[
        "application/json"
      ].schema.properties.data.$ref;
    assert.equal(ref, "./schema.json#/$defs/Execution");
    const dto = schema.$defs.Execution;
    assert(dto.required.includes("condition_results"));
    assert.equal(
      dto.properties.condition_results.items.$ref,
      "#/$defs/ConditionResult",
    );
    app.scheduler.propose(
      "Synthetic waiting condition",
      id(),
      app.host.sessionID,
      {
        preconditions: [
          {
            condition_id: id(),
            kind: "RESOURCE_PRESENT",
            target: "missing",
            required_revision: null,
          },
        ],
      },
    );
    app.scheduler.tick();
    await app.scheduler.idle();
    const eid = executions(app)[0].id;
    const evidence = app.store.put({ synthetic: "condition evidence" });
    for (const reason of [
      "SCOPE_BUSY",
      "SCOPE_ARCHIVED",
      "SCOPE_ROOT_CONFLICT",
    ]) {
      const current = app.store.get<Execution>("Execution", eid);
      app.store.commit([
        revise(current, {
          condition_results: [
            {
              condition_id: id(),
              status: "NOT_MET",
              checked_at: now(),
              evidence: [evidence],
              reason,
            },
          ],
        }),
      ]);
      const value = (await api.query(
        api.principal,
        `executions/${eid}`,
      )) as PublicExecution;
      validate("Execution", value);
      const result = value.condition_results[0];
      validate("ConditionResult", result);
      assert.equal(result.reason, reason);
      assert.equal(result.status, "NOT_MET");
      assert.deepEqual(result.evidence, [
        {
          content_version: evidence.sha256,
          bytes: String(evidence.bytes),
          media_type: evidence.media_type,
        },
      ]);
      assert.throws(
        () => validate("ConditionResult", { ...result, status: "INVALID" }),
        /INVALID_REQUEST/,
      );
      assert.throws(
        () => validate("ConditionResult", { ...result, evidence: [evidence] }),
        /INVALID_REQUEST/,
      );
      const { condition_results: _, ...without } = value;
      assert.throws(() => validate("Execution", without), /INVALID_REQUEST/);
    }
  }));
