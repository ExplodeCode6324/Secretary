// FE-04 synthetic native fixture: isolated storage, no model/provider calls.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { App } from "../../pi_secretary/src/app.ts";
import { id } from "../../pi_secretary/src/store.ts";
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const root = path.resolve(process.env.SECRETARY_DESKTOP_TEST_DATA ?? "");
assert(root.startsWith(path.join(repo, ".demo-data/issue63/")));
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
fs.chmodSync(root, 0o700);
const data = path.join(root, "core");
assert(
  !fs.existsSync(path.join(data, "journal.jsonl")),
  "use a new fixture directory",
);
const app = await App.open(data);
const scope = {
  session_id: app.host.sessionID,
  task_id: null,
  execution_id: null,
};
const ids: { id: string; event: string; text: string }[] = [];
for (let start = 0; start < 1000; start += 50) {
  const events = Array.from({ length: 50 }, (_, j) => {
    const index = start + j,
      call = id();
    const text =
      index === 980
        ? "中文👩‍💻é𠮷\n".repeat(12000)
        : index === 981
          ? "```typescript\n" +
            Array.from(
              { length: 10000 },
              (_, i) => `const line${i} = "中文";`,
            ).join("\n") +
            "\n```"
          : index === 982
            ? "LIMIT " + "中".repeat(800000)
            : `FE04-FIXTURE-${index}\n\n|列|值|\n|-|-|\n|A|B|\n\n[安全链接](https://example.com/)`;
    const event = app.store.event(
      "main.message",
      {
        role: "assistant",
        display_call_id: call,
        stopReason: "stop",
        content: [
          {
            type: "thinking",
            thinking: "人工思考摘要。默认折叠，可展开核对。",
          },
          { type: "text", text },
        ],
      },
      scope,
    );
    ids.push({
      id: "message:" + call,
      event: event.event_id,
      text: index >= 980 && index <= 982 ? text : "",
    });
    return event;
  });
  app.store.commit([], events);
}
await app.close();
fs.writeFileSync(
  path.join(root, "profiles.json"),
  JSON.stringify([
    {
      id: "issue63-fixture",
      data_dir: data,
      expected_mode: "fixture",
      node_abs: process.execPath,
      core_root: repo,
      backend_entry: path.join(repo, "src/pi_secretary/src/backend.ts"),
    },
  ]),
  { mode: 0o600 },
);
fs.writeFileSync(
  path.join(root, "fixture.json"),
  JSON.stringify({ ids, rows: 1000, synthetic: true }),
  { mode: 0o600 },
);
console.log("ISSUE63_FIXTURE_READY");
