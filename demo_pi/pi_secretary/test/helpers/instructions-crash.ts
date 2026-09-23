import { App } from "../../src/app.ts";
import { fixtureModel } from "../../src/model.ts";
import { saveInstructions } from "../../src/instructions.ts";
const app = await App.open(process.argv[2], {
  model: fixtureModel,
  stream: async () => {
    saveInstructions(app.store, "POST_CRASH_NEW_CONFIG", 1);
    process.kill(process.pid, "SIGKILL");
    throw Error("unreachable");
  },
});
app.host.accept("Resume this exact turn after abrupt termination");
await app.host.drain();
