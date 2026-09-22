import fs from "node:fs";
import { App } from "../../src/app.ts";
import { Agent, fixtureModel, fixtureStream } from "../../src/model.ts";
import { hash } from "../../src/store.ts";
const [mode, file] = process.argv.slice(2);
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
  const raw = fs.readFileSync(file);
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
