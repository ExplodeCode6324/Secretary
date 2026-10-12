import { Pool } from "pg";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../../src/pi_secretary/src/model.ts";
const [directory, mode] = process.argv.slice(2),
  dsn = process.env.SECRETARY_TEST_DATABASE_URL!;
if (mode.startsWith("project")) {
  const connect = Pool.prototype.connect;
  (Pool.prototype as any).connect = function (...args: any[]) {
    if (args.length) return (connect as any).apply(this, args);
    return (connect as any).call(this).then((client: any) => {
      const query = client.query.bind(client);
      let checkpoint = false;
      client.query = async (...queryArgs: any[]) => {
        const sql =
          typeof queryArgs[0] === "string" ? queryArgs[0] : queryArgs[0]?.text;
        if (sql?.includes("INSERT INTO mem.checkpoint")) checkpoint = true;
        if (checkpoint && sql === "COMMIT" && mode === "project-before")
          process.kill(process.pid, "SIGKILL");
        const result = await query(...queryArgs);
        if (checkpoint && sql === "COMMIT" && mode === "project-after")
          process.kill(process.pid, "SIGKILL");
        return result;
      };
      return client;
    });
  };
}
export const proposalStream: StreamFn = (model, context, options) => {
  const last = context.messages.at(-1);
  if (last?.role === "user")
    return replyStream(
      [
        {
          type: "toolCall",
          id: "durable-world-proposal",
          name: "memory_propose_change",
          arguments: {
            intent: "ASSERT",
            subject: "Crash subject",
            predicate: "person.height",
            value: 170,
          },
        },
      ],
      model,
    );
  return fixtureStream(model, context, options);
};
const app = await App.open(
  directory,
  {
    model: fixtureModel,
    stream: mode === "world" ? proposalStream : fixtureStream,
  },
  dsn,
);
if (mode === "world") {
  const commit = app.store.commit.bind(app.store);
  app.store.commit = (...args: Parameters<typeof commit>) => {
    const result = commit(...args);
    if (args[0].some((record) => record.record_type === "WorldCommand"))
      process.kill(process.pid, "SIGKILL");
    return result;
  };
  await app.host.drain();
} else await app.world!.memorySearch.catchUp();
throw Error("CRASH_BOUNDARY_NOT_REACHED");
