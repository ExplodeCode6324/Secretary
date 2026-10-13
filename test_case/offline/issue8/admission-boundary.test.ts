import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import { ApiError } from "../../../src/pi_secretary/src/api/protocol.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import { reconciled } from "./helpers.ts";

test("command HTTP rejection precedes admission; admitted errors and replay retain the original receipt", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-admission-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  const server = await serveCore(app, 0, undefined, { pump: false });
  const client = new CoreClient(server.endpoint);
  const request = async (route: string, body?: unknown) => {
    const response = await fetch(server.endpoint.url + "/api/v1/" + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${server.endpoint.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  const accept = app.host.accept.bind(app.host);
  try {
    for (const [route, fields, status] of [
      ["messages", { text: "bad", actor: "MASTER" }, 400],
      ["missing-route", {}, 404],
      [
        "assistant/profile",
        { name: "bad revision", expected_revision: "999999" },
        409,
      ],
    ] as const) {
      const requestID = id();
      const before = app.store.sequence;
      assert.equal(
        (await request(route, { request_id: requestID, ...fields })).status,
        status,
      );
      assert.equal(app.store.sequence, before);
      assert.equal(app.store.find("ApiCommand", requestID), undefined);
      const lookup = await request("requests/" + requestID);
      assert.equal(lookup.status, 404);
      assert.equal(lookup.body.error.code, "NOT_FOUND");
    }
    // Fault injection at the domain boundary also covers the client's reserved 410/422 rejection classes.
    for (const status of [410, 422]) {
      app.host.accept = () => {
        throw new ApiError("SYNTHETIC_PRE_ADMISSION", status);
      };
      const requestID = id();
      assert.equal(
        (await request("messages", { request_id: requestID, text: "rejected" }))
          .status,
        status,
      );
      assert.equal(app.store.find("ApiCommand", requestID), undefined);
    }
    let accepts = 0;
    app.host.accept = (...args) => {
      accepts++;
      accept(...args);
      throw new ApiError("SYNTHETIC_AFTER_ADMISSION", 409);
    };
    const command = {
      request_id: id(),
      text: "accepted once, response may be lost",
    };
    const admitted = await request("messages", command);
    assert.equal(admitted.status, 202);
    assert.equal(admitted.body.data.acceptance, "ACCEPTED");
    assert.equal(admitted.body.data.state, "ACCEPTED");
    assert.equal(app.store.all("Input").length, 1);
    // Reconcile a lost response, then deliberately replay the exact request.
    assert.deepEqual(
      (await request("requests/" + command.request_id)).body.data.receipt,
      admitted.body.data,
    );
    assert.deepEqual((await request("messages", command)).body, admitted.body);
    assert.equal(accepts, 1);
    const conflict = await request("messages", {
      ...command,
      text: "different intent",
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, "REQUEST_CONFLICT");
    assert.deepEqual(
      (await request("requests/" + command.request_id)).body.data.receipt,
      admitted.body.data,
    );
    assert.equal(app.store.all("Input").length, 1);
    // A queued command failing later keeps its admission and reports UNKNOWN, never HTTP rejection.
    let compactions = 0;
    app.host.compact = async () => {
      compactions++;
      throw new ApiError("SYNTHETIC_QUEUED_FAILURE", 409);
    };
    const queued = { request_id: id() };
    const first = await request("session/compact", queued);
    assert.equal(first.status, 202);
    const settled = await reconciled(client, queued.request_id);
    assert.equal(settled.receipt.acceptance, "ACCEPTED");
    assert.equal(settled.receipt.state, "UNKNOWN");
    assert.equal(settled.receipt.error_code, "SYNTHETIC_QUEUED_FAILURE");
    const replay = await request("session/compact", queued);
    assert.equal(replay.status, 202);
    assert.deepEqual(replay.body.data, settled.receipt);
    assert.equal(compactions, 1);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
