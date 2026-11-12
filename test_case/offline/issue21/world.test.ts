import assert from "node:assert/strict";
import { testPostgres } from "../helpers/postgres.ts";
import { scenario } from "./helpers.ts";
import { id, now } from "../../../src/pi_secretary/src/store.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import {
  proposeWorld,
  readWorld,
  resolveEntity,
} from "../../../src/pi_secretary/src/world-memory.ts";
import type {
  AuthorizationRequest,
  Operation,
  SettingsApplication,
  WorldCommand,
  WorldChange,
} from "../../../src/pi_secretary/src/contracts.ts";
import type { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureStream,
  replyStream,
} from "../../../src/pi_secretary/src/model.ts";

async function entity(app: App, name: string, aliases: string[] = []) {
  const result = app.world!.ownerChange(
    {
      version: 1,
      batch_id: id(),
      changes: [
        {
          intent: "CREATE_ENTITY",
          entity_kind: "PERSON",
          display_name: name,
          aliases: { add: aliases },
        },
      ],
    },
    { session_id: app.host.sessionID, task_id: null, execution_id: null },
  );
  return (app.world!.resolve(name) as any).entity.id;
}
testPostgres(
  "W1/B2: actual World read tool rejects two selectors and preserves legacy and null reads",
  async (dsn) => {
    let subject = "",
      other = "",
      callTools = false;
    const results = new Map<string, { isError: boolean; content: any[] }>();
    await scenario(
      dsn,
      async (app) => {
        await app.world!.migrate();
        subject = await entity(app, "Selector boundary subject", [
          "Boundary alias",
        ]);
        other = await entity(app, "Other selector subject");
        callTools = true;
        app.host.accept("Exercise synthetic World read selectors.");
        await app.host.drain();
        assert.equal(app.host.session.state, "IDLE");
        assert.equal(results.size, 5);
        for (const call of ["conflict", "same-entity"]) {
          assert.equal(results.get(call)!.isError, true);
          assert.match(
            JSON.stringify(results.get(call)),
            /SELECTOR_CONFLICT/,
            "both non-null selectors must be rejected, including equivalent selectors",
          );
        }
        for (const call of ["legacy", "subject", "null-legacy"]) {
          assert.equal(results.get(call)!.isError, false);
          assert.equal(
            JSON.parse(results.get(call)!.content[0].text).status,
            "ready",
          );
        }
      },
      (model, context, options) => {
        if (!callTools) return fixtureStream(model, context, options);
        if (context.messages.at(-1)?.role === "user")
          return replyStream(
            [
              ["conflict", { subject: "Boundary alias", subject_id: other }],
              [
                "same-entity",
                { subject: "Boundary alias", subject_id: subject },
              ],
              ["legacy", { subject_id: subject }],
              ["subject", { subject: "Boundary alias" }],
              ["null-legacy", { subject: "Boundary alias", subject_id: null }],
            ].map(([call, selectors]) => ({
              type: "toolCall" as const,
              id: call as string,
              name: "memory_read",
              arguments: { source: "world", ...(selectors as object) },
            })),
            model,
          );
        for (const message of context.messages)
          if (
            message.role === "toolResult" &&
            message.toolName === "memory_read"
          )
            results.set(message.toolCallId, message);
        return replyStream([{ type: "text", text: "done" }], model);
      },
    );
  },
);
