import { App } from "../../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../../src/pi_secretary/src/model.ts";
const [dir, mode] = process.argv.slice(2);
const app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
const commit = app.store.commit.bind(app.store);
app.store.commit = (...args: Parameters<typeof commit>) => {
  const applying = args[0].some(
    (r) =>
      r.record_type === "Operation" &&
      r.action.action === "world.change" &&
      r.state === "SUCCEEDED",
  );
  if (applying && mode === "before") process.kill(process.pid, "SIGKILL");
  const result = commit(...args);
  if (applying && mode === "after") process.kill(process.pid, "SIGKILL");
  return result;
};
await app.world!.drain();
throw Error("CRASH_BOUNDARY_NOT_REACHED");
