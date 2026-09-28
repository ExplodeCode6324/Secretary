// Paid-provider probe, only synthetic data in an explicitly supplied isolated PostgreSQL database.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { getModel } from "@earendil-works/pi-ai/compat";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../src/pi_secretary/src/app.ts";
import {
  roleModel,
  fixtureModel,
  fixtureStream,
  type StreamFn,
} from "../../src/pi_secretary/src/model.ts";
import { id } from "../../src/pi_secretary/src/store.ts";
import { emptySettings } from "../../src/pi_secretary/src/settings-payload.ts";
import { getInstructions } from "../../src/pi_secretary/src/instructions.ts";
import type {
  Context,
  SettingsApplication,
} from "../../src/pi_secretary/src/contracts.ts";
if (!process.env.SECRETARY_TEST_DATABASE_URL || !process.argv[2])
  throw Error("test database and report path required");
const keys = JSON.parse(
  fs.readFileSync(
    process.env.SECRETARY_CREDENTIALS_FILE ??
      ".demo-data/live-credentials.json",
    "utf8",
  ),
);
const model = getModel("opencode-go", "deepseek-v4.1-flash"),
  config = roleModel(model, keys.main);
let calls = 0;
const stream: StreamFn = (m, c, o) => {
  if (++calls > 18) throw Error("TEST_CALL_LIMIT");
  return config.stream(m, c, o);
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-settings-live-"));
const app = await App.open(
  dir,
  {
    main: { model, stream },
    task: { model: fixtureModel, stream: fixtureStream },
  },
  process.env.SECRETARY_TEST_DATABASE_URL,
);
const report: {
  model: string;
  started_at: string;
  pass: boolean;
  cases: unknown[];
  calls?: number;
  error?: string;
  completed_at?: string;
} = {
  model: model.id,
  started_at: new Date().toISOString(),
  pass: false,
  cases: [],
};
async function apply(edits: any[], instructions: any = null) {
  app.settings.save(
    { ...emptySettings(), edits, instructions },
    app.settings.draft().revision,
  );
  const a = app.settings.request(
    app.settings.draft().revision,
    id(),
  ) as SettingsApplication;
  await app.settings.tick();
  const done = app.store.get<SettingsApplication>("SettingsApplication", a.id);
  assert.equal(done.state, "APPLIED", done.error ?? "");
  return done;
}
async function turn(text: string) {
  app.host.accept(text);
  await app.host.drain();
  assert.equal(
    app.host.session.state,
    "IDLE",
    app.host.session.recovery_error ?? "",
  );
  const context = app.store.get<Context>(
    "Context",
    app.host.session.last_context_id!,
  );
  const messages = app.store.read<any[]>(context.raw_context);
  return {
    text: contentText(
      messages
        .findLast((m) => m.role === "assistant")
        .content.filter((p: any) => p.type === "text"),
    ),
    context,
  };
}
try {
  await app.world!.migrate();
  const entity = id();
  await apply([
    {
      kind: "ENTITY",
      entity_id: entity,
      entity_kind: "PERSON",
      display_name: "Synthetic Live Person",
      expected_revision: 0,
    },
    {
      kind: "FACT",
      mode: "ASSERT",
      subject_id: entity,
      predicate_key: "person.display_name",
      scope_key: "",
      expected_revision: 0,
      value: "Amber",
    },
  ]);
  const before = await turn(
    `这是合成数据验证，不创建任务。约束：不得发送外部消息。请用 memory_read 的 world 来源查询实体 ${entity}，只报告当前登记的名字。`,
  );
  assert(before.text.includes("Amber"));
  report.cases.push({
    case: "original fact",
    response: before.text,
    pass: true,
  });
  console.log("original fact: PASS");
  let row = (await app.world!.browse({ subject: entity })).rows[0];
  await apply(
    [
      {
        kind: "FACT",
        mode: "CORRECT",
        subject_id: entity,
        predicate_key: "person.display_name",
        scope_key: "",
        expected_revision: Number(row.current_revision),
        assertion_id: row.assertion_id,
        value: "Cobalt",
      },
    ],
    {
      content:
        "Always answer in English. Address the user as Master. Never create a task during this synthetic verification.",
      expected_revision: getInstructions(app.store).revision,
    },
  );
  const corrected = await turn(
    `Do not create tasks. Query world entity ${entity}. Return JSON only with exactly two string fields: current_name (only its current name, no historical names), communication_constraint (the explicit communication constraint I gave earlier).`,
  );
  const parsed = JSON.parse(
    corrected.text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""),
  );
  report.cases.push({
    case: "correction raw response",
    response: corrected.text,
  });
  assert.equal(parsed.current_name, "Cobalt");
  assert(/external|outside/i.test(parsed.communication_constraint));
  assert(!/[\u3400-\u9fff]/u.test(corrected.text));
  report.cases.push({
    case: "corrected fact, new language and preserved constraint",
    response: corrected.text,
    instructions_revision: corrected.context.instructions_revision,
    pass: true,
  });
  console.log("corrected fact and instructions: PASS");
  row = (await app.world!.browse({ subject: entity })).rows[0];
  await apply([
    {
      kind: "FACT",
      mode: "RETRACT",
      subject_id: entity,
      predicate_key: "person.display_name",
      scope_key: "",
      expected_revision: Number(row.current_revision),
      assertion_id: row.assertion_id,
    },
  ]);
  const retracted = await turn(
    `Do not create tasks. Query world entity ${entity}. Is there a currently valid name assertion? If none, say "NO_CURRENT_NAME". Retraction does not mean the person has no name.`,
  );
  assert(retracted.text.includes("NO_CURRENT_NAME"));
  assert.equal(app.store.all("TaskPlan").length, 0);
  report.cases.push({
    case: "retracted assertion is not current",
    response: retracted.text,
    pass: true,
  });
  report.pass = true;
  console.log("retraction: PASS");
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
  console.log("probe failed: " + String(error));
} finally {
  await app.close();
  report.calls = calls;
  report.completed_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(process.argv[2]), { recursive: true });
  fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, calls }));
}
