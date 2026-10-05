import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  type StreamFn,
} from "../../../../src/pi_secretary/src/model.ts";
import { emptySettings } from "../../../../src/pi_secretary/src/settings-payload.ts";
import { getInstructions } from "../../../../src/pi_secretary/src/instructions.ts";
import { id } from "../../../../src/pi_secretary/src/store.ts";
const [dir, mode] = process.argv.slice(2);
let enabled = mode === "model";
const stream: StreamFn = async (m, c, o) => {
  if (
    enabled &&
    (mode === "model" ||
      c.messages.some(
        (x) =>
          x.role === "system" &&
          contentText(x.content).includes("CONSCIOUSNESS"),
      ))
  ) {
    process.stdout.write("IN_FLIGHT\n");
    await new Promise(() => {});
  }
  return fixtureStream(m, c, o);
};
const app = await App.open(dir, { model: fixtureModel, stream });
app.host.accept("synthetic before crash");
await app.host.drain();
if (mode === "settings") {
  enabled = true;
  app.settings.save(
    {
      ...emptySettings(),
      instructions: {
        content: "synthetic new settings",
        expected_revision: getInstructions(app.store).revision,
      },
    },
    app.settings.draft().revision,
  );
  app.settings.request(app.settings.draft().revision, id());
  await app.settings.tick();
}
