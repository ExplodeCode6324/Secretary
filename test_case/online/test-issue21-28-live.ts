// Explicit paid LIVE_MODEL+PG acceptance; synthetic facts, no external actions.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { contentText } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import { roleModel, type StreamFn } from "../../src/pi_secretary/src/model.ts";
import {
  withTestDatabase,
  testDatabaseURL,
} from "../offline/helpers/postgres.ts";
import { getInstructions } from "../../src/pi_secretary/src/instructions.ts";
import { emptySettings } from "../../src/pi_secretary/src/settings-payload.ts";
import { id, hash } from "../../src/pi_secretary/src/store.ts";
import { readLog } from "../../src/pi_secretary/src/memory-search.ts";
import type {
  Consciousness,
  SettingsApplication,
  Context,
} from "../../src/pi_secretary/src/contracts.ts";
const evidence = process.env.SECRETARY_LIVE_EVIDENCE,
  dsn = testDatabaseURL(),
  credential = process.env.SECRETARY_CREDENTIALS_FILE;
if (!evidence || !dsn || !credential)
  throw Error(
    "LIVE_NOT_RUN: isolated test DSN, existing credentials and private evidence directory required",
  );
fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
const secret = JSON.parse(fs.readFileSync(credential, "utf8")).main;
assert(typeof secret === "string" && secret.length > 0);
let nonce = "ARCHIVE-" + randomUUID();
const resumeStore = process.env.SECRETARY_LIVE_RESUME_STORE;
const model = getModel("opencode-go", "deepseek-v4.1-flash");
const config = roleModel(model, secret);
const started = Date.now(),
  limits = {
    calls: Number(process.env.SECRETARY_LIVE_MAX_CALLS ?? 100),
    wall_ms: Number(process.env.SECRETARY_LIVE_WALL_MS ?? 40 * 60_000),
    request_ms: 90_000,
  };
assert(
  Number.isSafeInteger(limits.calls) &&
    limits.calls > 0 &&
    limits.calls <= 100 &&
    Number.isSafeInteger(limits.wall_ms) &&
    limits.wall_ms > 0 &&
    limits.wall_ms <= 40 * 60_000,
  "LIVE_LIMITS_INVALID",
);
let calls = 0,
  stage = "initial",
  failed = false;
const requests: {
  stage: string;
  kind: string;
  messages: unknown;
  transport?: unknown;
}[] = [];
const stream: StreamFn = (m, c, o) => {
  assert(
    !failed && ++calls <= limits.calls && Date.now() - started < limits.wall_ms,
    "LIVE_BUDGET_EXHAUSTED_OR_FAILED",
  );
  const system = c.messages
    .filter((v) => v.role === "system")
    .map((v) => contentText(v.content))
    .join(" ");
  const callNumber = calls;
  const record = {
    stage,
    kind: system.includes("CONSCIOUSNESS:")
      ? "summary"
      : system.includes("COMMITMENT_EXTRACTION:")
        ? "extraction"
        : "main",
    messages: structuredClone(c.messages),
    transport: undefined as unknown,
  };
  requests.push(record);
  return config.stream(m, c, {
    ...o,
    signal: AbortSignal.any([
      ...(o?.signal ? [o.signal] : []),
      AbortSignal.timeout(
        Math.max(
          1,
          Math.min(limits.request_ms, limits.wall_ms - (Date.now() - started)),
        ),
      ),
    ]),
    onPayload: async (payload, actual) => {
      const changed = await o?.onPayload?.(payload, actual);
      record.transport = structuredClone(
        changed === undefined ? payload : changed,
      );
      fs.writeFileSync(
        path.join(evidence, `request-${callNumber}.json`),
        JSON.stringify(record, null, 2),
      );
      return changed;
    },
  });
};
let app: App | undefined;
const report: any = {
  evidence: "LIVE_MODEL+PG",
  limits,
  model: model.id,
  provider: model.provider,
  checks: [],
  source_sha256: hash(fs.readFileSync(new URL(import.meta.url))),
};
try {
  await withTestDatabase(dsn, async (url) => {
    try {
      const dir = resumeStore ?? path.join(evidence, "store");
      app = await App.open(dir, { model, stream }, url);
      await app.world!.migrate();
      async function turn(text: string) {
        const accepted = app!.host.accept(text);
        await app!.host.drain();
        assert.equal(
          app!.host.session.state,
          "IDLE",
          app!.host.session.recovery_error ?? "",
        );
        const event = app!.store.logs
          .filter((e) => e.event_type === "main.message")
          .at(-1)!;
        const reply = app!.store.read<any>(event.payload);
        assert.equal(reply.role, "assistant");
        return { accepted, text: contentText(reply.content) };
      }
      let factID = "",
        factText = "";
      if (resumeStore) {
        // Resume only the remaining acceptance phases using unchanged durable
        // synthetic history. Derive the oracle from the original accepted fact.
        const accepted = app!.store.logs.filter(
          (e) =>
            e.event_type === "input.accepted" &&
            app!.store.read<any>(e.payload).producer === "MASTER",
        );
        assert(
          accepted.length >= 24 && accepted.length <= 30,
          "resume requires the completed bounded source scenario",
        );
        const initial = readLog(app!.store, accepted[0].event_id, 0, 4000);
        assert(
          "body" in initial &&
            initial.body?.startsWith("这是持续到会话结束的两项独立回复限制"),
        );
        const facts = accepted.flatMap((e) => {
          const page = readLog(app!.store, e.event_id, 0, 4000);
          return "body" in page &&
            typeof page.body === "string" &&
            /ARCHIVE-[a-f0-9-]{36}/.test(page.body)
            ? [{ id: e.event_id, body: page.body }]
            : [];
        });
        assert.equal(facts.length, 1);
        factID = facts[0].id;
        factText = facts[0].body;
        nonce = factText.match(/ARCHIVE-[a-f0-9-]{36}/)![0];
        const replies = app!.store.logs
          .filter((e) => e.event_type === "main.message")
          .map((e) => app!.store.read<any>(e.payload))
          .filter(
            (m) =>
              m.role === "assistant" &&
              m.stopReason === "stop" &&
              contentText(m.content),
          );
        assert(replies.length >= 24 && replies.length <= 30);
        replies.forEach((m, index) => {
          const text = contentText(m.content);
          assert(text.startsWith("答复："));
          assert(text.endsWith(index >= 8 ? "【新尾】" : "【旧尾】"));
        });
        report.checks.push(
          "original 24 real replies retain the unchanged prefix and corrected suffix",
        );
        stage = "resume-runtime";
        await app!.settings.tick();
        assert.equal(app!.settings.blocked, false);
      } else {
        stage = "constraints";
        const first = await turn(
          "这是持续到会话结束的两项独立回复限制：每次自然语言答复必须以‘答复：’开头，并以‘【旧尾】’结束。以后如果只修正其中一项，另一项继续有效。现在简短确认，不创建任务、承诺或外部动作。",
        );
        assert(
          first.text.startsWith("答复：") && first.text.endsWith("【旧尾】"),
        );
        for (let round = 2; round <= 24; round++) {
          stage = `round-${round}`;
          let text =
            round === 5
              ? `仅供以后检索的合成背景事实，当前无需行动或持续记忆任务：鹭岛笔记的归档代号为 ${nonce}。只确认收到，不复述代号。`
              : round === 9
                ? "只修正持续回复限制中的末尾标记：从现在改为‘【新尾】’，替代‘【旧尾】’。开头‘答复：’限制继续有效。请简短确认。"
                : `一次已经完成的合成阅读练习 ${round}，无需创建任务或承诺，不必长期保存材料，只说已阅。材料：` +
                  "0123456789 abcdefghijklmnopqrstuvwxyz ".repeat(110);
          const result = await turn(text);
          assert(result.text.startsWith("答复："), `prefix round ${round}`);
          assert(
            result.text.endsWith(round >= 9 ? "【新尾】" : "【旧尾】"),
            `suffix round ${round}`,
          );
          if (round === 5) {
            factText = text;
            factID =
              app!.store.logs.find(
                (e) =>
                  e.event_type === "input.accepted" &&
                  app!.store.read<any>(e.payload).id === result.accepted.id,
              )?.event_id ?? "";
            assert(factID);
          }
        }
      }
      // Large recent inputs can leave the older small fact resident under the
      // noncontinuous window policy. Use one ordinary completed material turn
      // to make mandatory input consume the target, then normal Host maintenance.
      stage = "window-exit-pressure";
      const pressure = await turn(
        "一次已完成的合成材料阅读，仅回复已阅，不创建任务、承诺或外部动作；遵守当前有效回复限制。材料：" +
          "f".repeat(24000),
      );
      assert(
        pressure.text.startsWith("答复：") &&
          pressure.text.endsWith("【新尾】"),
      );
      stage = "normal-maintenance";
      await app!.host.compact();
      const memory = app!.store.get<Consciousness>(
        "Consciousness",
        app!.host.session.consciousness_id,
      );
      assert(memory.input_projection_ref);
      assert(
        !JSON.stringify({
          items: memory.items,
          commitments: memory.commitments,
        }).includes(nonce),
        "background fact must leave working memory and ledger",
      );
      const constraints = memory.items
        .flatMap((item) => item.constraints)
        .join(" ");
      assert(
        constraints.includes("答复：") &&
          /以[“"‘]?【新尾】[”"’]?结尾/.test(constraints) &&
          !/以[“"‘]?【旧尾】[”"’]?结尾/.test(constraints),
        "working memory must preserve latest effective constraints",
      );
      // Observe a fresh normal request, rather than substituting or deleting any checkpoint content.
      stage = "pre-settings-probe";
      await turn("只确认当前回复限制仍有效，无需回忆归档事实。");
      const before = requests.filter(
        (r) => r.stage === stage && r.kind === "main",
      );
      assert(before.length > 0);
      for (const r of before) {
        assert(!JSON.stringify(r.messages).includes(nonce));
        assert(r.transport && !JSON.stringify(r.transport).includes(nonce));
      }
      report.checks.push(
        "fact absent from actual normal MODEL_REQUEST, transport, working memory and ledger",
      );
      stage = "settings";
      app!.settings.save(
        {
          ...emptySettings(),
          instructions: {
            content: "答复尽量简短。",
            expected_revision: getInstructions(app!.store).revision,
          },
        },
        app!.settings.draft().revision,
      );
      const requested = app!.settings.request(
        app!.settings.draft().revision,
        id(),
      ) as SettingsApplication;
      await app!.settings.tick();
      assert.equal(
        app!.store.get<SettingsApplication>("SettingsApplication", requested.id)
          .state,
        "APPLIED",
      );
      await app!.close();
      app = await App.open(dir, { model, stream }, url);
      await app.world!.memorySearch.catchUp();
      stage = "post-restart";
      const resumed = await turn("只确认继续。遵守仍然有效的回复限制。");
      assert(
        resumed.text.startsWith("答复：") && resumed.text.endsWith("【新尾】"),
      );
      stage = "retrieve";
      const response = await turn(
        "请找回之前鹭岛笔记的归档代号，并引用原始 event_id。不要猜测。",
      );
      assert(response.text.includes(nonce));
      assert(response.text.includes(factID));
      assert(
        response.text.startsWith("答复：") &&
          response.text.endsWith("【新尾】"),
      );
      const retrieval = requests.filter(
        (r) => r.stage === stage && r.kind === "main",
      );
      assert(retrieval.length >= 2);
      assert(!JSON.stringify(retrieval[0].messages).includes(nonce));
      assert(!JSON.stringify(retrieval[0].transport).includes(nonce));
      assert(
        retrieval.some((r) =>
          JSON.stringify(r.messages).includes('"name":"memory_search"'),
        ),
        "actual model chose memory_search",
      );
      const original = readLog(app!.store, factID, 0, 4000);
      assert("body" in original && original.body === factText);
      report.checks.push(
        "latest suffix correction and unchanged prefix survive Settings plus restart",
        "model chooses historical search and returns fact with original event_id",
        "original event body remains readable",
      );
      await app!.close();
      app = undefined;
    } finally {
      // Close the App before the scenario helper drops its own database, even
      // when an assertion fails; preserve the original acceptance failure.
      if (app) {
        await app.close();
        app = undefined;
      }
    }
  });
  report.pass = true;
} catch (error) {
  failed = true;
  report.pass = false;
  report.error = String(error);
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  report.calls = calls;
  report.elapsed_ms = Date.now() - started;
  fs.writeFileSync(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      pass: report.pass,
      calls,
      elapsed_ms: report.elapsed_ms,
      checks: report.checks,
      error: report.error,
    }),
  );
}
