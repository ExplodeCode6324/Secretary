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

async function approve(
  app: App,
  commandID: string,
  decision: "APPROVE" | "REJECT" = "APPROVE",
) {
  const command = app.store.get<WorldCommand>("WorldCommand", commandID);
  const op = app.store.get<Operation>("Operation", command.operation_id);
  const request = app.store.get<AuthorizationRequest>(
    "AuthorizationRequest",
    op.authorization_id!,
  );
  app.authorization.decide({
    schema_version: 1,
    record_type: "ApprovalCommand",
    request_id: id(),
    authorization_id: request.id,
    expected_revision: request.revision,
    display_hash: request.display_hash,
    decision,
  });
  await app.world!.drain();
  await app.settings.tick();
  return app.store.get<WorldCommand>("WorldCommand", commandID);
}
async function entity(
  app: App,
  name: string,
  aliases: string[] = [],
  entityID = id(),
  revision = 0,
) {
  const draft = app.settings.draft();
  app.settings.save(
    {
      ...emptySettings(),
      edits: [
        {
          kind: "ENTITY",
          entity_id: entityID,
          entity_kind: "PERSON",
          display_name: name,
          aliases,
          expected_revision: revision,
        },
      ],
    },
    draft.revision,
  );
  const application = app.settings.request(
    app.settings.draft().revision,
    id(),
  ) as SettingsApplication;
  await app.settings.tick();
  assert.equal(
    app.store.get<SettingsApplication>("SettingsApplication", application.id)
      .state,
    "APPLIED",
  );
  return entityID;
}

testPostgres(
  "W1/W2/W3/D1: aliases, ambiguity, structured fact intents, evidence and authorization",
  (dsn) =>
    scenario(dsn, async (app) => {
      const world = app.world!;
      await world.migrate();
      await world.migrate();
      const subject = await entity(app, "Synthetic person", [
        "  主人别名  ",
        "ALIAS",
        "alias",
      ]);
      const aliases = (
        await world.pool.query(
          "SELECT aliases FROM wm.entity WHERE entity_id=$1",
          [subject],
        )
      ).rows[0].aliases;
      assert.equal(aliases.length, 2);
      assert(aliases.includes("主人别名"));
      assert.equal((await resolveEntity(world, "主人别名")).status, "resolved");
      const scope = {
        session_id: app.host.sessionID,
        task_id: null,
        execution_id: null,
      };
      app.host.accept(
        "Synthetic person height is 170. Corrections are supplied as synthetic evidence.",
      );
      await app.host.drain();
      const events = app.store.logs
        .filter((e) => e.event_type === "input.accepted")
        .map((e) => e.event_id);
      const args = {
        intent: "ASSERT" as const,
        subject: "主人别名",
        predicate: "person.height",
        value: 170,
        source_event_ids: events,
      };
      const source = await proposeWorld(world, scope, args, id(), []);
      assert.equal(source.status, "source_registration_required");
      assert("command_id" in source);
      assert.equal(
        (await world.pool.query("SELECT count(*) FROM wm.assertion")).rows[0]
          .count,
        "0",
      );
      await approve(app, source.command_id!);
      const callID = id(),
        fact = await proposeWorld(world, scope, args, callID, []);
      assert("command_id" in fact);
      assert.deepEqual(
        await proposeWorld(world, scope, args, callID, []),
        fact,
        "replay reuses durable proposal",
      );
      assert.equal(
        (await world.pool.query("SELECT count(*) FROM wm.assertion")).rows[0]
          .count,
        "0",
      );
      await approve(app, fact.command_id!);
      const current = (await readWorld(world, {
        subject: "主人别名",
        predicate: "person.height",
      })) as any;
      assert.equal(current.rows[0].value, 170);
      const correction = await proposeWorld(
        world,
        scope,
        {
          ...args,
          intent: "CORRECT",
          target_fact_id: current.rows[0].assertion_id,
          value: 171,
        },
        id(),
        [],
      );
      assert("command_id" in correction);
      await approve(app, correction.command_id!);
      const corrected = (await readWorld(world, {
        subject: subject,
        predicate: "person.height",
      })) as any;
      assert.equal(corrected.rows[0].value, 171);
      const retract = await proposeWorld(
        world,
        scope,
        {
          ...args,
          intent: "RETRACT",
          target_fact_id: corrected.rows[0].assertion_id,
        },
        id(),
        [],
      );
      assert("command_id" in retract);
      await approve(app, retract.command_id!);
      assert.equal(
        (
          (await readWorld(world, {
            subject: subject,
            predicate: "person.height",
          })) as any
        ).rows.length,
        0,
      );
      await assert.rejects(
        () =>
          proposeWorld(
            world,
            scope,
            {
              ...args,
              source_event_ids: undefined,
              source_note: "Master said so",
            },
            id(),
            [],
          ),
        /EVIDENCE_REQUIRED/,
      );
      await assert.rejects(
        () =>
          proposeWorld(
            world,
            scope,
            { ...args, source_event_ids: [id()] },
            id(),
            [],
          ),
        /SOURCE_EVENT_MISMATCH/,
      );
      await assert.rejects(
        () =>
          proposeWorld(
            world,
            scope,
            { ...args, intent: "CORRECT", target_fact_id: id() },
            id(),
            [],
          ),
        /TARGET_FACT_MISMATCH/,
      );
      const rejected = await proposeWorld(world, scope, args, id(), []);
      assert("command_id" in rejected);
      await approve(app, rejected.command_id!, "REJECT");
      assert.equal(
        (
          (await readWorld(world, {
            subject: subject,
            predicate: "person.height",
          })) as any
        ).rows.length,
        0,
      );
      await entity(app, "Another person", ["主人别名"]);
      assert.equal(
        (await readWorld(world, { subject: "主人别名" })).status,
        "ambiguous",
      );
      assert.equal(
        (await resolveEntity(world, "missing person")).status,
        "not_found",
      );
    }),
);

testPostgres(
  "W1/W2: more than 100 facts page completely; MULTI/ENTITY slots are stable",
  (dsn) =>
    scenario(dsn, async (app) => {
      await app.world!.migrate();
      const world = app.world!;
      const subject = await entity(app, "Page subject"),
        object = await entity(app, "Related person");
      app.host.accept("Synthetic multi-fact evidence");
      await app.host.drain();
      const eventIDs = app.store.logs
        .filter((e) => e.event_type === "input.accepted")
        .map((e) => e.event_id);
      const scope = {
        session_id: app.host.sessionID,
        task_id: null,
        execution_id: null,
      };
      const args = {
        intent: "ASSERT" as const,
        subject: subject,
        predicate: "preference.statement",
        value: "Synthetic preference",
        source_event_ids: eventIDs,
      };
      const source = await proposeWorld(world, scope, args, id(), []);
      assert("command_id" in source);
      await approve(app, source.command_id!);
      const changes: WorldChange[] = [];
      for (let n = 0; n < 105; n++) {
        const proposal = await proposeWorld(
          world,
          scope,
          { ...args, value: "Synthetic preference " + n },
          id(),
          [],
        );
        assert("command_id" in proposal);
        const command = app.store.get<WorldCommand>(
          "WorldCommand",
          proposal.command_id!,
        );
        assert.equal(command.change.record_type, "WorldChange");
        changes.push(command.change as WorldChange);
      }
      // The fixture's direct domain batches avoid 105 model/settings rounds; real SQL constraints still apply.
      for (let n = 0; n < changes.length; n += 50)
        await world.applyBatch(id(), "a".repeat(64), changes.slice(n, n + 50));
      let cursor: string | undefined,
        count = 0;
      const seen = new Set<string>();
      do {
        const page: any = await readWorld(world, {
          subject,
          predicate: "preference.statement",
          cursor,
          limit: 20,
        });
        for (const row of page.rows) {
          assert(!seen.has(row.assertion_id));
          seen.add(row.assertion_id);
        }
        count += page.rows.length;
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      assert.equal(count, 105);
      const same = await proposeWorld(
        world,
        scope,
        { ...args, value: "Synthetic preference 0" },
        id(),
        [],
      );
      assert("command_id" in same);
      const change = app.store.get<WorldCommand>(
        "WorldCommand",
        same.command_id!,
      ).change as WorldChange;
      assert.equal(change.scope_key, changes[0].scope_key);
      assert.equal(change.expected_revision, 1);
      const relation = await proposeWorld(
        world,
        scope,
        { ...args, predicate: "person.member_of", value: object },
        id(),
        [],
      );
      assert("command_id" in relation);
      assert.equal(
        (
          app.store.get<WorldCommand>("WorldCommand", relation.command_id!)
            .change as WorldChange
        ).object_entity_id,
        object,
      );
      assert.equal(
        (
          app.store.get<WorldCommand>("WorldCommand", relation.command_id!)
            .change as WorldChange
        ).value,
        null,
      );
    }),
);
