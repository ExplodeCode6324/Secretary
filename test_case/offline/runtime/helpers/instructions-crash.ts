import { App } from "../../../../src/pi_secretary/src/app.ts";
import { fixtureModel } from "../../../../src/pi_secretary/src/model.ts";
const app = await App.open(process.argv[2], {
  model: fixtureModel,
  stream: async () => {
    app.settings.save(
      {
        instructions: {
          content: "POST_CRASH_NEW_CONFIG",
          expected_revision: 1,
        },
        edits: [],
        command_ids: [],
      },
      app.settings.draft().revision,
    );
    process.kill(process.pid, "SIGKILL");
    throw Error("unreachable");
  },
});
app.host.accept("Resume this exact turn after abrupt termination");
await app.host.drain();
