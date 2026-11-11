import { App } from "../../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../../src/pi_secretary/src/model.ts";
import { id } from "../../../../src/pi_secretary/src/store.ts";
const app = await App.open(
  process.argv[2],
  { model: fixtureModel, stream: fixtureStream },
  process.env.SECRETARY_TEST_DATABASE_URL,
);
await app.world!.migrate();
app.host.accept("Preserve this explicit constraint: no external messages.");
await app.host.drain();
const entity = process.argv[3];
app.settings.save(
  {
    instructions: {
      content: "After crash use this setting",
      expected_revision: 1,
    },
    edits: [
      {
        kind: "ENTITY",
        entity_id: entity,
        entity_kind: "PERSON",
        display_name: "Crash test",
        expected_revision: 0,
      },
    ],
    command_ids: [],
  },
  app.settings.draft().revision,
);
const crashStage = process.argv[4] ?? "after-database";
if (crashStage === "after-database")
  app.world!.export = async () => {
    process.kill(process.pid, "SIGKILL");
  };
else if (crashStage === "before-database")
  app.world!.applyBatch = async () => {
    process.kill(process.pid, "SIGKILL");
  };
else {
  const commit = app.store.commit.bind(app.store);
  app.store.commit = (records, events, receipt) => {
    const final = records.some(
      (r) => r.record_type === "SettingsApplication" && r.state === "APPLIED",
    );
    if (final && crashStage === "before-local")
      process.kill(process.pid, "SIGKILL");
    commit(records, events, receipt);
    if (final && crashStage === "after-local")
      process.kill(process.pid, "SIGKILL");
    if (
      crashStage === "summary-checkpoint" &&
      records.some(
        (r) =>
          r.record_type === "SettingsApplication" &&
          r.state === "SUMMARIZING" &&
          r.candidate_ref,
      )
    )
      process.kill(process.pid, "SIGKILL");
  };
}
app.settings.request(app.settings.draft().revision, id());
await app.settings.tick();
