// Paid online regression. All dates below are SYNTHETIC LOGICAL DAYS, not elapsed days.
// Run only with explicit authorization. No fixture cognition, scheduler pumping or external actions.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { contentText, type AssistantMessage } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import {
  roleModel,
  type AgentMessage,
  type StreamFn,
} from "../../src/pi_secretary/src/model.ts";
import { getInstructions } from "../../src/pi_secretary/src/instructions.ts";
import { emptySettings } from "../../src/pi_secretary/src/settings-payload.ts";
import type {
  CompactionJob,
  Consciousness,
  Context,
  ModelCall,
  MemoryCommitment,
  SettingsApplication,
} from "../../src/pi_secretary/src/contracts.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE = fileURLToPath(import.meta.url);
const LIMITS = {
  requests: 24,
  wall_ms: 15 * 60_000,
  request_ms: 90_000,
  output_tokens: 8192,
  context_bytes: 80_000,
} as const;
const READ_TOOLS = new Set(["memory_read", "task_query"]);
type Language = "zh" | "en";
type Result = { name: string; pass: boolean; detail?: unknown };
type RequestRecord = {
  number: number;
  stage: string;
  started_at: string;
  completed_at?: string;
  elapsed_ms?: number;
  model: string;
  provider: string;
  context_bytes: number;
  max_output_tokens: number;
  timeout_ms: number;
  request_sha256: string;
  usage?: AssistantMessage["usage"];
  stop_reason?: string;
  error?: string;
};

// Independent oracle: these values are NEVER interpolated into a probe or system prompt.
// They are derived from the synthetic source turns below, not from the model's own answers.
const ORACLE = Object.freeze({
  project_name: "LumenHarbor-X9",
  artifact_name: "CedarIndex.v3",
  current_deadline: "2031-05-16",
  former_deadline: "2031-05-12",
  funding_state: "unknown",
  external_sharing_allowed: false,
  obligation_id: "OBL-71",
  obligation_owner: "Master",
  obligation_action: "final_approval",
  obligation_state: "open",
});
// Field names/answer types establish an output contract, but disclose no correct field values.
const PROBE = `只根据之前对话和当前有效设置，做一次只读回忆检查，不执行任何事项。仅返回 JSON 对象，字段如下：
address（对用户的称呼）、project_name、artifact_name、current_deadline（ISO日期）、former_deadline（ISO日期）、funding_state（known/unknown/denied之一）、external_sharing_allowed（布尔值；没有证据则null）、obligation_id、obligation_owner、obligation_action（保留原始动作代号）、obligation_state（open/done/unknown之一）、explanation（按当前有效回复语言写一到两句自然语言，解释当前状态和未完事项）。专名保留原文，无法确定的其他字段用null。无需工具即可回答时不要调用工具。`;

function parseObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  );
  assert(
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
    "response must be a JSON object",
  );
  return parsed as Record<string, unknown>;
}
function evaluate(text: string, language: Language): Result[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseObject(text);
  } catch (error) {
    return [
      { name: "structured_response", pass: false, detail: String(error) },
    ];
  }
  const fields = Object.entries(ORACLE).map(([key, expected]) => ({
    name: key,
    pass: parsed[key] === expected,
    detail: { expected, actual: parsed[key] ?? null },
  }));
  const explanation =
    typeof parsed.explanation === "string" ? parsed.explanation : "";
  const han = (explanation.match(/\p{Script=Han}/gu) ?? []).length;
  const words = (explanation.match(/[A-Za-z]+/g) ?? []).length;
  // Names and ISO values elsewhere in JSON must not masquerade as English prose.
  // English requires real prose; Chinese requires a substantial Han-language sentence.
  const languagePass = language === "en" ? han === 0 && words >= 10 : han >= 14;
  return [
    { name: "structured_response", pass: true },
    ...fields,
    {
      name: "address",
      pass: parsed.address === "Master",
      detail: parsed.address,
    },
    {
      name: "explanation_language",
      pass: languagePass,
      detail: { expected: language, han, words, explanation },
    },
  ];
}
// A deliberately limited detector, not a general semantic judge. Every source answer
// remains subject to human review, including answers with no known-pattern matches.
function persistenceClaimCheck(answer: string): Result {
  const rules = [
    {
      id: "zh-denies-durable-storage",
      pattern:
        /不(?:构成|属于|算是)(?:真正的|任何|实际的)?(?:持久化|持久|长期)(?:存储|记忆|保存)/gu,
    },
    {
      id: "zh-cannot-retain",
      pattern:
        /(?:无法|不能|不会)(?:被|自动)?(?:持久化(?:保存|存储)?|长期(?:保存|记住|保留)|跨会话(?:保存|记住|保留))/gu,
    },
    {
      id: "zh-current-context-only",
      pattern:
        /(?:仅|只)(?:能)?(?:在|限于)(?:本轮|当前|这次)(?:的)?(?:对话)?上下文(?:中)?(?:保留|保存|记住)/gu,
    },
    {
      id: "en-no-persistent-memory",
      pattern:
        /(?:I (?:do not|don't) have|there is no|I (?:cannot|can't) provide) (?:any )?(?:persistent|durable|long[- ]term) (?:memory|storage)/giu,
    },
    {
      id: "en-current-context-only",
      pattern:
        /(?:only (?:retained|stored|remembered) (?:in|within)|limited to) (?:the |this )?(?:current|present) (?:conversation |chat )?context/giu,
    },
  ];
  const matches = rules.flatMap((rule) =>
    [...answer.matchAll(rule.pattern)].map((match) => ({
      rule: rule.id,
      quote: match[0],
      index: match.index,
    })),
  );
  return {
    name: "no_known_persistence_denial",
    pass: matches.length === 0,
    detail: {
      matches,
      full_answer: answer,
      human_review_required: true,
      scope:
        "No match means only that these limited denial patterns were not found; it does not establish general semantic accuracy. Review surrounding scope, quotations, negation and capability claims manually.",
    },
  };
}
function ledgerChecks(
  captured: MemoryCommitment[],
  current: MemoryCommitment[],
): Result[] {
  const refKey = (ref: MemoryCommitment["source_refs"][number]) =>
    JSON.stringify([ref.path, ref.sha256, ref.bytes, ref.media_type]);
  return captured
    .filter((entry) => entry.state === "OPEN")
    .map((entry) => {
      const after = current.find((candidate) => candidate.id === entry.id);
      const reasons: string[] = [];
      if (!after) reasons.push("captured OPEN ID disappeared");
      else {
        if (after.state !== "OPEN")
          reasons.push(
            "captured OPEN ID was closed without resolution evidence",
          );
        if (after.text !== entry.text)
          reasons.push("captured commitment text changed");
        if (
          entry.source_refs.some(
            (ref) =>
              !after.source_refs.some(
                (candidate) => refKey(ref) === refKey(candidate),
              ),
          )
        )
          reasons.push("source reference lost or changed");
        if (
          after.resolution_event_ids.some(
            (event) => !entry.resolution_event_ids.includes(event),
          )
        )
          reasons.push("resolution event added without evidence");
      }
      return {
        name: `open_commitment/${entry.id}`,
        pass: reasons.length === 0,
        detail: { reasons, before: entry, after: after ?? null },
      };
    });
}
function oracleSelfCheck() {
  const valid = {
    ...ORACLE,
    address: "Master",
    explanation:
      "当前记录保留更新后的截止日期，待确认事项仍然开放，需要用户继续确认。",
  };
  assert(evaluate(JSON.stringify(valid), "zh").every((r) => r.pass));
  for (const [field, wrong] of Object.entries({
    current_deadline: ORACLE.former_deadline,
    former_deadline: ORACLE.current_deadline,
    project_name: "LumenHarbour-X9",
    artifact_name: "CedarIndex.v2",
    funding_state: "denied",
    external_sharing_allowed: null,
    obligation_id: "OBL-17",
    obligation_owner: "Secretary",
    obligation_action: "send_external_message",
    obligation_state: "done",
    address: "User",
  })) {
    assert(
      evaluate(JSON.stringify({ ...valid, [field]: wrong }), "zh").some(
        (r) => r.name === field && !r.pass,
      ),
      `negative control failed: ${field}`,
    );
  }
  assert(
    evaluate(
      JSON.stringify({ ...valid, explanation: "Master CedarIndex.v3" }),
      "en",
    ).some((r) => !r.pass),
  );
  assert(evaluate(JSON.stringify(valid), "en").some((r) => !r.pass));
  assert(
    evaluate(
      `All correct answers appear here: ${Object.values(ORACLE).join(",")}`,
      "zh",
    ).some((r) => !r.pass),
  );
  assert(
    Object.values(ORACLE)
      .filter(
        (v) =>
          typeof v === "string" && !["unknown", "open", "Master"].includes(v),
      )
      .every((v) => typeof v !== "string" || !PROBE.includes(v)),
    "oracle leaked into probe",
  );
  for (const text of [
    "我当前没有可写工作记忆的工具，因此上述内容仅在本轮对话上下文中保留，不构成持久化存储。",
    "我无法长期保存这些记录。",
    "这不算是长期记忆。",
    "I do not have persistent memory.",
    "The notes are only stored in the current conversation context.",
  ])
    assert(
      !persistenceClaimCheck(text).pass,
      `denial detector missed: ${text}`,
    );
  for (const text of [
    "Master，已记住项目和未完事项，后续盘点会继续列出。",
    "宿主会自动持久化保存对话；没有单独的写工具不代表不能保存。",
    "不能保证完美回忆，但记录会保存。",
    "I cannot guarantee perfect recall; the host persists completed replies.",
  ])
    assert(
      persistenceClaimCheck(text).pass,
      `denial detector false positive: ${text}`,
    );
  const entry: MemoryCommitment = {
    id: "synthetic-ledger-id",
    text: "Synthetic promise",
    state: "OPEN",
    source_refs: [
      {
        path: "objects/synthetic",
        sha256: "synthetic",
        bytes: 1,
        media_type: "application/json",
      },
    ],
    task_refs: [],
    resolution_event_ids: [],
  };
  assert(
    ledgerChecks([entry], [structuredClone(entry)]).every(
      (result) => result.pass,
    ),
  );
  for (const current of [
    [],
    [{ ...entry, state: "COMPLETED" as const }],
    [{ ...entry, source_refs: [] }],
    [{ ...entry, resolution_event_ids: ["unjustified-event"] }],
    [{ ...entry, text: "changed" }],
  ]) {
    assert(
      ledgerChecks([entry], current).some((result) => !result.pass),
      "ledger negative control passed unexpectedly",
    );
  }
  console.log(
    "continuity oracle, capability-denial and ledger negative controls: PASS (no API calls)",
  );
}
if (process.argv.includes("--self-check")) {
  oracleSelfCheck();
} else {
  const index = process.argv.indexOf("--evidence");
  const target = index >= 0 ? process.argv[index + 1] : undefined;
  if (!target || !process.argv.includes("--live"))
    throw Error(
      "Usage: tsx test_case/online/test-continuity-astra-live.ts --live --evidence NEW_DIRECTORY (or --self-check)",
    );
  await run(path.resolve(target));
}

async function run(directory: string) {
  // Refuse reuse: failures and their raw transcripts are immutable between invocations.
  assert(
    !fs.existsSync(directory),
    "evidence directory must not already exist",
  );
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(directory, "requests"), { mode: 0o700 });
  const started = Date.now();
  const requests: RequestRecord[] = [];
  const checks: Result[] = [];
  const stages: Record<string, unknown>[] = [];
  const blocked: unknown[] = [];
  const ledgerSnapshots: unknown[] = [];
  const capturedOpen = new Map<string, MemoryCommitment>();
  let stage = "setup";
  let app: App | undefined;
  let fatal: string | undefined;
  let transportFailed = false;
  let scenarioCompleted = false;
  let runCompleted = false;
  let finalized = false;
  let taskCalls = 0;
  let secret = "";
  const cleanError = (error: unknown) =>
    secret ? String(error).split(secret).join("[REDACTED]") : String(error);
  const write = (file: string, value: unknown) =>
    fs.writeFileSync(
      path.join(directory, file),
      JSON.stringify(value, null, 2) + "\n",
      { mode: 0o600 },
    );
  const report = {
    evidence: "LIVE_MODEL_ONLY",
    scenario: "five synthetic logical days; one wall-clock execution",
    logical_days: [
      "2031-05-01",
      "2031-05-02",
      "2031-05-03",
      "2031-05-04",
      "2031-05-05",
    ],
    limits: LIMITS,
    provider: "opencode-go",
    model: "deepseek-v4.1-flash",
    directory,
    started_at: new Date(started).toISOString(),
    requests,
    blocked,
    checks,
    stages,
    baseline_commit: "fb320a5561a1f1a484f3ecd51914773224e8346a",
    git_commit: "",
    upstream_commit: "",
    source_sha256: "",
    previous_harness_sha256:
      "481dd37656e3280a1ec85ff09afee156d04cd2cf14519e22dd3a0017c0ba0c3e",
    ledger_snapshots: ledgerSnapshots,
    source_capability_review:
      "Required manual review; automated source check detects only documented denial patterns.",
    source_files: {} as Record<string, string>,
    oracle: ORACLE,
    probe: PROBE,
    limitations: [
      "Synthetic logical days do not demonstrate wall-clock multi-day survival.",
      "Restart closes/reopens App and its durable store in the same process; this is not an OS process restart.",
      "The product may retain raw Master input anchors after compaction; this measures product continuity, not summary-only recall.",
      "Structured fact correctness and output language are deterministic checks; narrative explanation is retained for human semantic review.",
      "No World/PostgreSQL factual settings edits: settings activation here changes persistent language instructions only.",
    ],
  };
  const persist = () =>
    write("report.json", {
      ...report,
      state: finalized
        ? runCompleted && checks.every((c) => c.pass)
          ? "completed"
          : "failed"
        : fatal
          ? "failed"
          : "running",
      pass:
        runCompleted &&
        !fatal &&
        checks.length > 0 &&
        checks.every((c) => c.pass),
      error: fatal,
      completed_at: finalized ? new Date().toISOString() : null,
      elapsed_ms: Date.now() - started,
      actual_requests: requests.length,
      task_model_calls: taskCalls,
      usage: requests.reduce(
        (sum, r) => ({
          input: sum.input + (r.usage?.input ?? 0),
          output: sum.output + (r.usage?.output ?? 0),
          cacheRead: sum.cacheRead + (r.usage?.cacheRead ?? 0),
          cacheWrite: sum.cacheWrite + (r.usage?.cacheWrite ?? 0),
          total_tokens: sum.total_tokens + (r.usage?.totalTokens ?? 0),
          catalog_cost: sum.catalog_cost + (r.usage?.cost.total ?? 0),
          missing_usage_requests:
            sum.missing_usage_requests + (r.usage ? 0 : 1),
        }),
        {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total_tokens: 0,
          catalog_cost: 0,
          missing_usage_requests: 0,
        },
      ),
      input_note:
        "SDK input is uncached input; cacheRead/cacheWrite are reported separately. total_tokens is the SDK total.",
      cost_note:
        "SDK/provider model-catalog estimate; not a billing receipt. Missing usage is unknown, not zero.",
    });
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
    report.git_commit = git("rev-parse", "HEAD");
    report.upstream_commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: path.join(ROOT, "src/pi_resource"),
      encoding: "utf8",
    }).trim();
    fs.writeFileSync(
      path.join(directory, "git-status.txt"),
      git("status", "--short") + "\n",
    );
    fs.writeFileSync(
      path.join(directory, "tracked-diff.patch"),
      git("diff", "HEAD", "--", "src", "package.json", "package-lock.json"),
    );
    // Save executable harness and production TS source, not just a potentially dirty Git hash.
    const snapshot = (source: string, relative: string) => {
      const bytes = fs.readFileSync(source);
      const to = path.join(directory, "source", relative);
      fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
      fs.writeFileSync(to, bytes, { mode: 0o600 });
      report.source_files[relative] = createHash("sha256")
        .update(bytes)
        .digest("hex");
    };
    snapshot(SOURCE, "test_case/online/test-continuity-astra-live.ts");
    for (const file of git(
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "src/pi_secretary",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
    )
      .split("\n")
      .filter(Boolean)) {
      if (fs.statSync(path.join(ROOT, file)).isFile())
        snapshot(path.join(ROOT, file), file);
    }
    report.source_sha256 =
      report.source_files["test_case/online/test-continuity-astra-live.ts"];
    write("manifest.json", report);
    const credentialsPath = process.env.SECRETARY_CREDENTIALS_FILE;
    if (!credentialsPath && !process.env.SECRETARY_MAIN_API_KEY)
      throw Error(
        "Provide existing SECRETARY_CREDENTIALS_FILE or SECRETARY_MAIN_API_KEY; this test does not create credentials",
      );
    secret =
      process.env.SECRETARY_MAIN_API_KEY ??
      JSON.parse(fs.readFileSync(credentialsPath!, "utf8")).main;
    assert(
      typeof secret === "string" && secret.length > 0,
      "existing main credential required",
    );
    const model = getModel("opencode-go", "deepseek-v4.1-flash");
    const config = roleModel(model, secret);
    const stream: StreamFn = async (m, context, options) => {
      try {
        assert.equal(m.provider, "opencode-go");
        assert.equal(m.id, "deepseek-v4.1-flash");
        assert(
          !transportFailed,
          "prior request failed; automatic retry is forbidden",
        );
        assert(
          requests.length < LIMITS.requests,
          "24 actual request limit reached",
        );
        const remaining = LIMITS.wall_ms - (Date.now() - started);
        assert(remaining > 0, "15 minute wall limit reached");
        // Production compaction/settings may internally propose a validation retry.
        // Suppress that extra provider call while keeping the first failure and job record.
        const latestUser = context.messages.findLast(
          (message) => message.role === "user",
        );
        if (latestUser) {
          let packet: Record<string, unknown> | undefined;
          try {
            packet = JSON.parse(contentText(latestUser.content));
          } catch {
            /* Ordinary prose. */
          }
          assert(
            !packet?.previous_error,
            "automatic validation retry forbidden; inspect first response",
          );
        }
        const bounded = {
          ...context,
          messages: context.messages.map((message) =>
            message.role === "system"
              ? {
                  ...message,
                  toolsAdded: message.toolsAdded?.filter((tool) =>
                    READ_TOOLS.has(tool.name),
                  ),
                }
              : message,
          ),
        };
        const encoded = JSON.stringify(bounded);
        const bytes = Buffer.byteLength(encoded);
        assert(
          bytes <= LIMITS.context_bytes,
          `context too large: ${bytes} bytes`,
        );
        const number = requests.length + 1;
        const timeout = Math.min(LIMITS.request_ms, remaining);
        const tokens = Math.min(
          options?.maxTokens ?? 2048,
          LIMITS.output_tokens,
          model.maxTokens,
        );
        const record: RequestRecord = {
          number,
          stage,
          started_at: new Date().toISOString(),
          model: m.id,
          provider: m.provider,
          context_bytes: bytes,
          max_output_tokens: tokens,
          timeout_ms: timeout,
          request_sha256: createHash("sha256").update(encoded).digest("hex"),
        };
        requests.push(record);
        write(
          `requests/${String(number).padStart(2, "0")}-request.json`,
          bounded,
        );
        write("requests.json", requests);
        const requestStart = Date.now();
        const signal = AbortSignal.any([
          ...(options?.signal ? [options.signal] : []),
          AbortSignal.timeout(timeout),
        ]);
        let abortHandler: () => void = () => {};
        const aborted = new Promise<never>((_, reject) => {
          abortHandler = () =>
            reject(signal.reason ?? Error("request deadline exceeded"));
          if (signal.aborted) abortHandler();
          else signal.addEventListener("abort", abortHandler, { once: true });
        });
        void aborted.catch(() => {});
        try {
          signal.throwIfAborted();
          const response = await Promise.race([
            Promise.resolve(
              config.stream(m, bounded, {
                ...options,
                signal,
                maxTokens: tokens,
              }),
            ),
            aborted,
          ]);
          const result = await Promise.race([response.result(), aborted]);
          record.usage = result.usage;
          record.stop_reason = result.stopReason;
          write(
            `requests/${String(number).padStart(2, "0")}-response.json`,
            result,
          );
          if (["error", "aborted", "length"].includes(result.stopReason))
            throw Error(
              result.errorMessage ?? `provider stop: ${result.stopReason}`,
            );
          // Inspect the WHOLE result before durableStream/Agent can execute any tool.
          for (const part of result.content)
            if (part.type === "toolCall")
              assert(
                READ_TOOLS.has(part.name),
                `write or unknown tool blocked before execution: ${part.name}`,
              );
          return response;
        } catch (error) {
          transportFailed = true;
          record.error = cleanError(error);
          throw error;
        } finally {
          signal.removeEventListener("abort", abortHandler);
          record.elapsed_ms = Date.now() - requestStart;
          record.completed_at = new Date().toISOString();
          write("requests.json", requests);
          persist();
        }
      } catch (error) {
        blocked.push({
          stage,
          at: new Date().toISOString(),
          reason: cleanError(error),
        });
        persist();
        throw error;
      }
    };
    const forbiddenTaskStream: StreamFn = () => {
      taskCalls++;
      throw Error("TASK_MODEL_CALL_FORBIDDEN");
    };
    const open = () =>
      App.open(path.join(directory, "data"), {
        main: { model, stream },
        task: { model, stream: forbiddenTaskStream },
      });
    app = await open();
    const active = () => {
      assert(app);
      return app;
    };
    const noEffects = () => {
      for (const kind of [
        "TaskPlan",
        "Execution",
        "Operation",
        "Notification",
      ] as const)
        assert.equal(
          active().store.all(kind).length,
          0,
          `${kind} side effect detected`,
        );
      assert.equal(taskCalls, 0);
    };
    function observeLedger(name: string, requireCaptured = false) {
      const cs = active().store.get<Consciousness>(
        "Consciousness",
        active().host.session.consciousness_id,
      );
      const entries = structuredClone(cs.commitments ?? []);
      const results = ledgerChecks([...capturedOpen.values()], entries);
      if (requireCaptured) {
        const firstAnswer = stages.find(
          (entry) => entry.name === "day1/source",
        )?.answer;
        const assistantQuotes = entries.filter(
          (entry) =>
            entry.state === "OPEN" &&
            typeof firstAnswer === "string" &&
            firstAnswer.includes(entry.text) &&
            entry.source_refs.some((ref) => {
              const raw = active().store.read<unknown>(ref);
              return (
                Array.isArray(raw) &&
                raw.some(
                  (message) =>
                    message?.role === "assistant" &&
                    contentText(message.content).includes(entry.text),
                )
              );
            }),
        );
        results.push({
          name: "first_compact_captured_assistant_source_quote",
          pass: assistantQuotes.length > 0,
          detail: {
            matching_ids: assistantQuotes.map((entry) => entry.id),
            note: "Role and verbatim source check only; human review must still verify an actual promise and its full conditions.",
          },
        });
        results.push({
          name: "first_compact_captured_open_commitment",
          pass: entries.some(
            (entry) => entry.state === "OPEN" && entry.source_refs.length > 0,
          ),
          detail: { count: entries.length },
        });
      }
      results.push({
        name: "unique_commitment_ids",
        pass: new Set(entries.map((entry) => entry.id)).size === entries.length,
      });
      ledgerSnapshots.push({
        name,
        consciousness_revision: cs.revision,
        commitments: entries,
        results,
      });
      checks.push(
        ...results.map((result) => ({
          ...result,
          name: `${name}/${result.name}`,
        })),
      );
      for (const entry of entries)
        if (entry.state === "OPEN") {
          const old = capturedOpen.get(entry.id);
          if (!old) capturedOpen.set(entry.id, structuredClone(entry));
          else {
            // Union every observed source ref: a later snapshot must retain all of them.
            const refs = new Map(
              [...old.source_refs, ...entry.source_refs].map((ref) => [
                JSON.stringify(ref),
                ref,
              ]),
            );
            capturedOpen.set(entry.id, {
              ...old,
              source_refs: [...refs.values()],
            });
          }
        }
      write("commitments-ledger.json", ledgerSnapshots);
      persist();
    }
    async function turn(name: string, text: string, language?: Language) {
      stage = name;
      const before = requests.length;
      active().host.accept(text);
      await active().host.drain();
      assert.equal(
        active().host.session.state,
        "IDLE",
        active().host.session.recovery_error ?? "host not idle",
      );
      const context = active().store.get<Context>(
        "Context",
        active().host.session.last_context_id!,
      );
      const messages = active().store.read<AgentMessage[]>(context.raw_context);
      const assistant = messages.findLast(
        (message) => message.role === "assistant",
      );
      assert(assistant?.role === "assistant", "missing assistant answer");
      const answer = contentText(assistant.content);
      assert(answer.trim().length > 0, "empty assistant answer");
      const results = language
        ? evaluate(answer, language)
        : [{ name: "nonempty_acknowledgment", pass: true }];
      if (name === "day1/source") results.push(persistenceClaimCheck(answer));
      assert.equal(
        context.instructions_revision,
        getInstructions(active().store).revision,
        "request used stale settings revision",
      );
      checks.push(
        ...results.map((result) => ({
          ...result,
          name: `${name}/${result.name}`,
        })),
      );
      stages.push({
        name,
        type: "turn",
        input: text,
        answer,
        request_range: [before + 1, requests.length],
        context_id: context.id,
        instructions_revision: context.instructions_revision,
        results,
      });
      noEffects();
      persist();
      console.log(
        `${name}: ${results.every((result) => result.pass) ? "PASS" : "FAIL"}`,
      );
      // Cognitive mismatches are retained and later independent probes still run.
      // Provider/transport/schema failures terminate through the enclosing catch.
    }
    async function compact(name: string) {
      stage = name;
      const before = requests.length;
      observeLedger(`${name}/before`);
      await active().host.compact();
      observeLedger(`${name}/after`, name === "day2/compact-1");
      const status = active().host.memoryStatus();
      const job = active().store.all<CompactionJob>("CompactionJob").at(-1);
      stages.push({
        name,
        type: "compact",
        status,
        job,
        request_range: [before + 1, requests.length],
      });
      persist();
      assert.equal(
        status.state,
        "COMMITTED",
        JSON.stringify(job?.validation_errors),
      );
      assert.equal(
        job?.attempt,
        1,
        "compaction required a retry; first failure must remain a failure",
      );
      assert(
        requests.length > before,
        "compaction did not call the live model",
      );
      noEffects();
    }
    async function settings(language: Language) {
      stage = `settings-${language}`;
      const before = requests.length;
      observeLedger(`${stage}/before`);
      const content =
        language === "en"
          ? "Always reply in English unless Master explicitly requests another language for one reply. Address the user as Master. Preserve exact proper names."
          : "默认用简体中文回复，称呼用户为 Master。只有 Master 明确要求某次用其他语言时才对该次覆盖；专名保持原文。";
      active().settings.save(
        {
          ...emptySettings(),
          instructions: {
            content,
            expected_revision: getInstructions(active().store).revision,
          },
        },
        active().settings.draft().revision,
      );
      const requested = active().settings.request(
        active().settings.draft().revision,
        randomUUID(),
      ) as SettingsApplication;
      await active().settings.tick();
      observeLedger(`${stage}/after`);
      const application = active().store.get<SettingsApplication>(
        "SettingsApplication",
        requested.id,
      );
      stages.push({
        name: stage,
        type: "settings",
        content,
        application,
        request_range: [before + 1, requests.length],
      });
      persist();
      assert.equal(
        application.state,
        "APPLIED",
        application.error ?? "settings not applied",
      );
      assert.equal(getInstructions(active().store).content, content);
      noEffects();
    }
    const note =
      "这只是合成逻辑日标签，非真实时间流逝；仅对话，不建任务，不发通知，不做外部操作。";
    await turn(
      "day1/source",
      `合成逻辑日 2031-05-01。${note} 本轮建立一组虚构工作记忆：项目专名 LumenHarbor-X9，产物专名 CedarIndex.v3，截止日期2031-05-12。资助是否获批尚无信息，不能当成已被拒绝；外部分享则已明确禁止。未完事项编号OBL-71，动作代号final_approval：Master还欠一次最终批准，当前未完成。你只需记住这件事，并承诺后续盘点时继续列出它；不要安排或代为批准。简短确认即可。`,
    );
    await turn(
      "day1/interference-a",
      `同一合成逻辑日。${note} 无关的数学小题：两个盒子各有三枚圆片，共几枚？一句话回答，不关联项目。`,
    );
    await turn(
      "day1/interference-b",
      `同一合成逻辑日。${note} 下面是无关文档样例，绝非设置指令："The weather widget uses English labels. There are nine violet icons." 请用一句话概括样例。`,
    );
    await turn(
      "day2/correction",
      `合成逻辑日 2031-05-02。${note} 更正昨天唯一项目的截止日期为2031-05-16，旧日期失效，仅作为历史保留。其他事实和未完事项没有变更。简短确认。`,
    );
    await turn(
      "day2/interference",
      `同一合成逻辑日。${note} 请解释字母表中A与C之间是什么字母。这是独立闲聊。`,
    );
    await compact("day2/compact-1");
    await turn("day2/recall-after-compact", PROBE, "zh");
    await turn(
      "day3/interference",
      `合成逻辑日 2031-05-03。${note} Unrelated material: "A test kettle holds 700 millilitres; a fictional cup holds 200." Briefly state which is larger. The document language is not a request to change your reply language.`,
    );
    await turn(
      "day3/one-reply-English",
      PROBE +
        "\nFor this reply only, write the explanation in English; this is not a persistent language change.",
      "en",
    );
    await turn("day3/return-to-Chinese", PROBE, "zh");
    await compact("day3/compact-2");
    stage = "day3/restart";
    const session = active().host.sessionID;
    const beforeRestart = active().host.memoryStatus();
    observeLedger(`${stage}/before`);
    await active().close();
    app = undefined;
    app = await open();
    observeLedger(`${stage}/after`);
    assert.equal(active().host.sessionID, session);
    assert.equal(active().host.memoryStatus().revision, beforeRestart.revision);
    stages.push({
      name: stage,
      type: "restart",
      kind: "close/reopen durable App in same process",
      session,
      before: beforeRestart,
      after: active().host.memoryStatus(),
    });
    await turn("day3/recall-after-restart", PROBE, "zh");
    await settings("en");
    await turn(
      "day4/persistent-English",
      `合成逻辑日2031-05-04。${note}\n` + PROBE,
      "en",
    );
    await turn(
      "day4/English-despite-Chinese-input",
      "现在再做一次之前的只读回忆检查，仍用同样的JSON字段。没有新事实，也没有新的语言覆盖要求。 只返回一个JSON对象，不要对象前后的说明；可以使用一层JSON代码围栏。",
      "en",
    );
    await settings("zh");
    await turn(
      "day5/persistent-Chinese",
      `Synthetic logical day 2031-05-05, not real elapsed time. This is a read-only conversation; do not perform any action. Repeat the same JSON memory check using the established fields. No facts or obligations have changed. This English input does not request an output-language override. Return only one JSON object with no surrounding commentary; a single JSON code fence is allowed.`,
      "zh",
    );
    noEffects();
    checks.push({
      name: "two-live-compactions",
      pass:
        stages.filter(
          (entry) => (entry as { type?: string }).type === "compact",
        ).length === 2,
    });
    checks.push({
      name: "settings-both-directions",
      pass:
        stages.filter(
          (entry) => (entry as { type?: string }).type === "settings",
        ).length === 2,
    });
    checks.push({ name: "read-only-no-task-calls", pass: taskCalls === 0 });
    checks.push({
      name: "request-and-wall-budget",
      pass:
        requests.length <= LIMITS.requests &&
        Date.now() - started <= LIMITS.wall_ms,
    });
    checks.push({
      name: "all-requests-complete-with-usage",
      pass: requests.every(
        (request) => request.usage !== undefined && !request.error,
      ),
    });
    scenarioCompleted = true;
  } catch (error) {
    fatal = cleanError(error);
    process.exitCode = 1;
  } finally {
    if (app) {
      try {
        write("model-calls.json", app.store.all<ModelCall>("ModelCall"));
        write(
          "compaction-jobs.json",
          app.store.all<CompactionJob>("CompactionJob"),
        );
        write(
          "settings-applications.json",
          app.store.all<SettingsApplication>("SettingsApplication"),
        );
        write(
          "final-memory.json",
          app.store.all<Consciousness>("Consciousness"),
        );
        write(
          "side-effects.json",
          Object.fromEntries(
            (
              ["TaskPlan", "Execution", "Operation", "Notification"] as const
            ).map((kind) => [kind, app!.store.all(kind)]),
          ),
        );
        await app.close();
      } catch (error) {
        fatal = `${fatal ?? ""} close/evidence failure: ${cleanError(error)}`;
      }
    }
    finalized = true;
    runCompleted = scenarioCompleted && !fatal;
    if (
      !runCompleted ||
      fatal ||
      checks.some((check) => !check.pass) ||
      !checks.length
    )
      process.exitCode = 1;
    persist();
    console.log(
      JSON.stringify({
        report: path.join(directory, "report.json"),
        pass: process.exitCode !== 1,
        actual_requests: requests.length,
        error: fatal,
      }),
    );
  }
}
