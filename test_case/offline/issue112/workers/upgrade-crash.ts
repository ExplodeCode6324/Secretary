import { App } from "../../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  type StreamFn,
} from "../../../../src/pi_secretary/src/model.ts";
const stream: StreamFn = (...args) => {
  process.kill(process.pid, "SIGKILL");
  return fixtureStream(...args);
};
const app = await App.open(
  process.argv[2],
  { model: fixtureModel, stream },
  process.argv[3],
);
app.host.accept("Synthetic interrupted upgrade loop");
await app.host.drain();
throw Error("CRASH_BOUNDARY_NOT_REACHED");
