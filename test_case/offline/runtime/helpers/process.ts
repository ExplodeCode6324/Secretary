import { App } from "../../../../src/pi_secretary/src/app.ts";
import {
  Agent,
  fixtureModel,
  fixtureStream,
} from "../../../../src/pi_secretary/src/model.ts";
import type { Context } from "../../../../src/pi_secretary/src/contracts.ts";
import { Store, hash } from "../../../../src/pi_secretary/src/store.ts";
const [mode, file, contextID] = process.argv.slice(2);
if (mode === "crash") {
  const app = await App.open(file, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  app.host.accept("ACK survives abrupt process termination");
  await new Promise<void>((resolve) =>
    process.stdout.write("ACK\n", () => resolve()),
  );
  process.kill(process.pid, "SIGKILL");
} else {
  const store = await Store.open(file);
  const raw = store.contentText(
    store.get<Context>("Context", contextID).raw_context,
  );
  await store.close();
  const agent = new Agent({
    initialState: {
      model: fixtureModel,
      messages: JSON.parse(raw.toString()),
      tools: [],
    },
    streamFn: fixtureStream,
  });
  process.stdout.write(
    JSON.stringify({
      original: hash(raw),
      restored: hash(JSON.stringify(agent.state.messages)),
    }),
  );
}
