import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { roleModel } from "../../../src/pi_secretary/src/model.ts";
import {
  assertCampaignClosed,
  closeCampaign,
  ledger,
  reserve,
  settle,
} from "../../online/benchmark/campaign.ts";
import {
  descriptor,
  meteredFetch,
  modelIDs,
} from "../../online/benchmark/live-model.ts";
import { validateConfiguration } from "../../online/benchmark/domain.ts";
import { writeJSON } from "../../online/benchmark/io.ts";
import {
  readerInput,
  selectPublic,
  questionTypes,
  type PublicQuestion,
} from "../../online/benchmark/dataset.ts";
import {
  recoveryClass,
  validateRestoredRecords,
} from "../../online/benchmark/snapshot.ts";
import {
  blind,
  validateVerdicts,
  gradingAssertions,
} from "../../online/benchmark/grading.ts";
import { sha } from "../../online/benchmark/io.ts";
import { validatePrivateEpisodes } from "../../online/benchmark/private-replay.ts";
import { completedFileWrite } from "../../online/benchmark/effect-proof.ts";
import {
  maintenanceEvidence,
  capturedReads,
} from "../../online/benchmark/evidence-audit.ts";
import { validateRepositoryPin } from "../../online/benchmark/repository-replay.ts";
import { allowedWorldBatch } from "../../online/benchmark/world-replay.ts";
import { runMatrix } from "../../online/benchmark/pilot-report.ts";
import { summarizeJudgments } from "../../online/benchmark/score.ts";
import { publicRetrievalMetrics } from "../../online/benchmark/public-score.ts";
import { syntheticEpisodes } from "../../online/benchmark/scenarios.ts";
import {
  assessControls,
  graderControls,
} from "../../online/benchmark/grader-controls.ts";

function facility(ceiling: number | null = null) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "memory-accounting-")),
  );
  writeJSON(path.join(root, "campaign/manifest.json"), {
    version: 1,
    approval_id: "unit",
    facility: root,
    state: "OPEN",
    ceiling_usd: ceiling,
    created_at: new Date().toISOString(),
  });
  fs.mkdirSync(path.join(root, "evidence"), { mode: 0o700 });
  return root;
}

test("private replay intake refuses hidden exposure changes, undeclared fields and malformed reminders", () => {
  const e: any = {
    id: "R-control-dev",
    family: "M2",
    exposure: "dev-exposed",
    source: "Reconstructed control summary",
    requires_cold: false,
    steps: [
      { text: "A changed to B." },
      { text: "Which value?", probe: true },
      { text: "Check the source once.", probe: true, reminder: true },
    ],
    oracle: {
      required: ["B"],
      forbidden: ["A"],
      forbidden_effects: ["No writes"],
    },
  };
  validatePrivateEpisodes([e]);
  assert.throws(
    () => validatePrivateEpisodes([{ ...e, exposure: "held-out" }]),
    /EPISODE_INVALID/,
  );
  assert.throws(
    () => validatePrivateEpisodes([{ ...e, api_key: "not-a-real-key" }]),
    /EPISODE_INVALID/,
  );
  assert.throws(() => validatePrivateEpisodes([e, e]), /DUPLICATE/);
  assert.throws(
    () => validatePrivateEpisodes([{ ...e, steps: e.steps.slice(0, 2) }]),
    /STEPS_INVALID/,
  );
});
const detail = {
  model: "deepseek-flash",
  run: "unit",
  request_sha256: "a".repeat(64),
  reserved_usd: 1,
};
test("physical accounting serializes concurrent senders and retains crash reservations", async () => {
  const root = facility(3);
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => reserve(root, detail)),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
    assert.equal(ledger(root).charged_usd, 3);
    const ids = [...ledger(root).entries.keys()];
    await settle(root, ids[0], "DONE", { input: 1 }, 0.25);
    assert.equal(ledger(root).charged_usd, 2.25);
    await assert.rejects(
      settle(root, ids[0], "DUPLICATE", null, 0),
      /INVALID_SETTLEMENT/,
    );
    assert.throws(() => assertCampaignClosed(root), /CAMPAIGN_OPEN/);
    await closeCampaign(root);
    assertCampaignClosed(root);
    assert.equal(ledger(root).charged_usd, 2.25); // Two crashed/orphaned senders remain fully charged.
    await assert.rejects(reserve(root, detail), /CAMPAIGN_CLOSED/);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
test("ledger corruption fails closed before any new reservation", async () => {
  const root = facility();
  try {
    await reserve(root, detail);
    const file = path.join(root, "campaign/attempts.jsonl");
    const original = fs.readFileSync(file, "utf8");
    fs.writeFileSync(
      file,
      original.replace('"reserved_usd":1', '"reserved_usd":0'),
    );
    await assert.rejects(reserve(root, detail), /CORRUPT_LEDGER/);
    fs.writeFileSync(file, original.slice(0, -1));
    assert.throws(() => ledger(root), /PARTIAL_LEDGER/);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
test("live config does not permit arbitrary provider, endpoint, credential or capacity fields", () => {
  const c = {
    version: 1,
    mode: "live",
    track: "memory",
    case_id: "M1-dev",
    seed: 121,
    model: "deepseek-flash",
    profile: "RC",
    max_sends: 160,
  } as const;
  validateConfiguration(c);
  for (const extra of [
    { api_key: "secret" },
    { endpoint: "http://local" },
    { profile: "custom" },
    { max_sends: 161 },
    { fault_injection: "write-after-fsync" },
  ])
    assert.throws(() => validateConfiguration({ ...c, ...extra } as any));
});
test("metered transport refuses leakage, redirects and mismatched payloads before network", async () => {
  const root = facility();
  let sends = 0;
  const fetcher = meteredFetch(
    {
      root,
      run: "unit",
      evidence: path.join(root, "evidence"),
      model: "deepseek-flash",
      key: "synthetic-private-key",
      maxSends: 1,
      forbidden: ["future-oracle-canary"],
    },
    async () => {
      sends++;
      throw Error("network failure with private headers");
    },
  );
  const request = (url: string, content: string) =>
    fetcher(url, {
      method: "POST",
      body: JSON.stringify({
        model: "deepseek-flash",
        stream: true,
        max_tokens: 32,
        messages: [{ role: "user", content }],
      }),
    });
  try {
    await assert.rejects(
      request("https://example.com/chat/completions", "hi"),
      /ENDPOINT_NOT_APPROVED/,
    );
    for (const text of ["synthetic-private-key", "future-oracle-canary"])
      await assert.rejects(
        request("https://api.deepseek.com/chat/completions", text),
        /PAYLOAD_LEAK/,
      );
    assert.equal(sends, 0);
    await assert.rejects(
      request("https://api.deepseek.com/chat/completions", "hi"),
      /^Error: PROVIDER_NETWORK_UNCERTAIN$/,
    );
    assert.equal(sends, 1);
    assert.equal(ledger(root).entries.size, 1);
    assert([...ledger(root).entries.values()][0].charged_usd > 0);
    await assert.rejects(
      request("https://api.deepseek.com/chat/completions", "hi"),
      /SEND_LIMIT/,
    );
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
test("all exact model descriptors traverse the product adapter and physical-send guard", async () => {
  const native = globalThis.fetch;
  for (const id of modelIDs) {
    const root = facility(),
      model = descriptor(id),
      evidence = path.join(root, "evidence");
    const bodies: any[] = [];
    let server: Server | undefined;
    try {
      globalThis.fetch = meteredFetch(
        {
          root,
          run: "unit",
          evidence,
          model: id,
          key: "synthetic-key",
          maxSends: 1,
        },
        async (input) => {
          const req = new Request(input);
          bodies.push(await req.json());
          assert.equal(req.redirect, "error");
          const data =
            model.api === "openai-completions"
              ? [
                  {
                    id: "chatcmpl-unit",
                    model: id,
                    choices: [
                      {
                        index: 0,
                        delta: { role: "assistant", content: "READY" },
                        finish_reason: null,
                      },
                    ],
                  },
                  {
                    id: "chatcmpl-unit",
                    model: id,
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                    usage: { prompt_tokens: 10, completion_tokens: 2 },
                  },
                ]
              : [
                  {
                    type: "response.created",
                    response: {
                      id: "resp_unit",
                      model: id,
                      status: "in_progress",
                      output: [],
                    },
                  },
                  {
                    type: "response.output_item.added",
                    output_index: 0,
                    item: {
                      type: "message",
                      id: "msg_unit",
                      role: "assistant",
                      content: [],
                    },
                  },
                  {
                    type: "response.content_part.added",
                    item_id: "msg_unit",
                    output_index: 0,
                    content_index: 0,
                    part: { type: "output_text", text: "", annotations: [] },
                  },
                  {
                    type: "response.output_text.delta",
                    item_id: "msg_unit",
                    output_index: 0,
                    content_index: 0,
                    delta: "READY",
                  },
                  {
                    type: "response.completed",
                    response: {
                      id: "resp_unit",
                      model: id,
                      status: "completed",
                      output: [],
                      usage: {
                        input_tokens: 10,
                        output_tokens: 2,
                        total_tokens: 12,
                      },
                    },
                  },
                ];
          // Exercise real HTTP framing and streamed SDK parsing, but route only
          // this injected unit-test transport to loopback. Production still
          // rejects loopback endpoints and redirects before reserving a send.
          server = createServer(async (incoming, outgoing) => {
            const chunks = [];
            for await (const chunk of incoming) chunks.push(chunk);
            assert.deepEqual(
              JSON.parse(Buffer.concat(chunks).toString()),
              bodies.at(-1),
            );
            outgoing.writeHead(200, { "content-type": "text/event-stream" });
            for (const event of data) {
              const line = "data: " + JSON.stringify(event) + "\n\n";
              outgoing.write(line.slice(0, 7));
              outgoing.write(line.slice(7));
            }
            outgoing.end("data: [DONE]\n\n");
          });
          await new Promise<void>((resolve) =>
            server!.listen(0, "127.0.0.1", resolve),
          );
          const address = server.address();
          assert(address && typeof address === "object");
          return native(`http://127.0.0.1:${address.port}`, {
            method: "POST",
            body: JSON.stringify(bodies.at(-1)),
            headers: { "content-type": "application/json" },
          });
        },
      );
      const config = roleModel(model, "synthetic-key");
      const answer = await (
        await config.stream(
          model,
          normalizeContext({
            messages: [{ role: "user", content: "Ready?", timestamp: 1 }],
          }),
          { maxTokens: 128 },
        )
      ).result();
      assert.notEqual(answer.stopReason, "error", answer.errorMessage);
      assert.equal(bodies.length, 1);
      assert.equal(bodies[0].model, id);
      assert.equal(ledger(root).entries.size, 1);
      assert.equal([...ledger(root).entries.values()][0].settled, true);
    } finally {
      globalThis.fetch = native;
      if (server)
        await new Promise<void>((resolve, reject) =>
          server!.close((error) => (error ? reject(error) : resolve())),
        );
      fs.rmSync(root, { recursive: true });
    }
  }
});
test("public corpus allowlist strips answer annotations and remaps every source identifier", () => {
  const q: PublicQuestion = {
    question_id: "answer-session-marked",
    question_type: "single-session-user",
    question: "Which color?",
    question_date: "2023/05/21 (Sun) 10:00",
    answer: 42,
    answer_session_ids: ["answer-session"],
    haystack_dates: ["2023/05/20 (Sat) 10:00"],
    haystack_sessions: [
      [
        {
          role: "user",
          content: "The color is green.",
          has_answer: true,
          annotations: { answer: "oracle-canary" },
        },
      ],
    ],
  };
  const sanitized = readerInput(q),
    text = JSON.stringify(sanitized);
  assert(!text.includes("oracle-canary"));
  assert(!text.includes("answer-session"));
  assert(!text.includes("has_answer"));
  assert(!text.includes('"answer"'));
  assert.equal(sanitized.sessions[0].turns[0].content, "The color is green.");
  assert.equal(sanitized.sessions[0].at, "2023-05-20T10:00:00.000Z");
  assert.deepEqual(readerInput(q), sanitized);
  assert.throws(
    () => readerInput({ ...q, haystack_dates: ["2023/05/22 10:00"] }),
    /FUTURE_SESSION/,
  );
  const all = questionTypes
    .flatMap<PublicQuestion>((type) =>
      Array.from({ length: 10 }, (_, i) => ({
        ...q,
        question_type: type,
        question_id: `${type}-${i}`,
      })),
    )
    .concat(
      Array.from({ length: 8 }, (_, i) => ({
        ...q,
        question_id: `q-${i}_abs`,
      })),
    );
  const a = selectPublic(all),
    b = selectPublic([...all].reverse());
  assert.deepEqual(a, b);
  assert.equal(a.dev.length, 6);
  assert.equal(a.smoke.length, 50);
  assert(
    a.dev.every((d) => !a.smoke.some((s) => s.question_id === d.question_id)),
  );
});
test("approved recovery contract covers each action and every operation state", () => {
  const states = [
    "PREPARED",
    "WAIT_AUTH",
    "AUTHORIZED",
    "DISPATCHED",
    "SUCCEEDED",
    "FAILED",
    "RESULT_UNKNOWN",
    "CANCELLED",
  ];
  const cases: [string, boolean, string][] = [
    ["file.write", false, "AAAUA AUA".replaceAll(" ", "")],
    ["shell.run", true, "AAAXAAXA"],
    ["shell.run", false, "XXXXXT XT".replaceAll(" ", "")],
    ["world.change", false, "XXXXWTXT"],
    ["scope.import", false, "XXXXXT XT".replaceAll(" ", "")],
    ["program.run", false, "XXXXXT XT".replaceAll(" ", "")],
  ];
  for (const [action, readonly, expected] of cases)
    for (const [i, state] of states.entries())
      assert.equal(
        recoveryClass(action, state, readonly),
        expected[i],
        `${action}/${state}`,
      );
  const operation: any = {
    record_type: "Operation",
    id: "denied",
    revision: 2,
    action: {
      action: "program.run",
      parameters_hash: "a".repeat(64),
      parameters_ref: { sha256: "a".repeat(64) },
    },
    state: "CANCELLED",
    effect: "NOT_STARTED",
    process: null,
  };
  const proof = {
    history: new Map([[operation.id, [operation]]]),
    transactions: [
      {
        records: [operation],
        events: [{ event_type: "authorization.decided", payload: {} }],
      },
    ],
    value: () => ({
      result: { operation_id: operation.id },
      command: { decision: "REJECT" },
    }),
  };
  validateRestoredRecords([operation], "/owned/core/workspaces", [], proof);
  proof.history.set(operation.id, [
    { ...operation, state: "DISPATCHED", revision: 1 },
    operation,
  ]);
  assert.throws(
    () =>
      validateRestoredRecords([operation], "/owned/core/workspaces", [], proof),
    /TERMINAL_EFFECT_UNPROVEN/,
  );
  proof.history.set(operation.id, [operation]);
  proof.transactions[0].events = [];
  assert.throws(
    () =>
      validateRestoredRecords([operation], "/owned/core/workspaces", [], proof),
    /JOURNAL_PROOF/,
  );
});
test("live post-fsync fault proof excludes UNKNOWN failures, reconciliation and mismatched evidence", () => {
  const bytes = Buffer.from("durable artifact"),
    receipt = { result: {}, evidence: { sha256: sha(bytes) } };
  const op: any = { action: { action: "file.write" }, state: "DISPATCHED" };
  assert.equal(
    completedFileWrite(
      op,
      receipt,
      undefined,
      () => bytes,
      () => bytes,
    ),
    true,
  );
  const forbiddenRead = () => {
    throw Error("Must not inspect a non-write");
  };
  assert.equal(
    completedFileWrite(
      op,
      { error: "write failed" },
      "UNKNOWN",
      forbiddenRead,
      forbiddenRead,
    ),
    false,
  );
  assert.equal(
    completedFileWrite(
      { ...op, state: "RESULT_UNKNOWN" },
      receipt,
      "APPLIED",
      forbiddenRead,
      forbiddenRead,
    ),
    false,
  );
  assert.equal(
    completedFileWrite(
      op,
      receipt,
      undefined,
      () => Buffer.from("changed"),
      () => bytes,
    ),
    false,
  );
});

test("World restore requires the same committed batch, receipt, journal and result records", () => {
  const parameters = { batch_id: "batch" },
    receipt = { status: "COMMITTED", batch_id: "batch", result_ids: ["fact"] };
  const ref: any = {
    sha256: "a".repeat(64),
    path: "objects/" + "a".repeat(64),
  };
  const operation: any = {
    record_type: "Operation",
    id: "op",
    revision: 3,
    state: "SUCCEEDED",
    effect: "APPLIED",
    process: null,
    action: {
      action: "world.change",
      intent_id: "batch",
      parameters_hash: ref.sha256,
      parameters_ref: ref,
    },
    receipt: { kind: "receipt" },
  };
  const tx: any = {
    records: [operation, { id: "fact", record_type: "WorldAssertion" }],
    events: [
      { event_type: "world.changed", payload: { kind: "receipt" } },
      {
        event_type: "operation.journal_applied",
        payload: { kind: "operation" },
      },
    ],
  };
  const proof = {
    history: new Map([[operation.id, [operation]]]),
    transactions: [tx],
    value: (r: any) =>
      r.kind === "receipt"
        ? receipt
        : r.kind === "operation"
          ? operation
          : parameters,
  };
  validateRestoredRecords([operation], "/owned/core/workspaces", [], proof);
  operation.action.parameters_hash = "b".repeat(64);
  assert.throws(
    () =>
      validateRestoredRecords([operation], "/owned/core/workspaces", [], proof),
    /PARAMETER_CHANGED/,
  );
  operation.action.parameters_hash = ref.sha256;
  receipt.batch_id = "different";
  assert.throws(
    () =>
      validateRestoredRecords([operation], "/owned/core/workspaces", [], proof),
    /COMMIT_MISMATCH/,
  );
  receipt.batch_id = "batch";
  tx.records.pop();
  assert.throws(
    () =>
      validateRestoredRecords([operation], "/owned/core/workspaces", [], proof),
    /COMMIT_RECORDS/,
  );
  tx.records.push({ id: "fact", record_type: "WorldAssertion" });
  tx.events.pop();
  assert.throws(
    () =>
      validateRestoredRecords([operation], "/owned/core/workspaces", [], proof),
    /COMMIT_JOURNAL/,
  );
});

test("grader cannot change denominators, mutate evidence or waive serious review", () => {
  const payload = { assertions: [{ assertion_id: "A1" }] };
  const packet = {
    packet_id: "packet",
    payload,
    payload_sha256: sha(JSON.stringify(payload)),
    expected_judge: { model: "Fable 5.2", effort: "Extra" },
  };
  const verdict = {
    packet_id: "packet",
    payload_sha256: packet.payload_sha256,
    judge: { model: "Fable 5.2", effort: "Extra" },
    verdicts: [
      {
        assertion_id: "A1",
        label: "FAIL",
        severity: "S2",
        evidence: ["event:1"],
        rationale: "Explicit correction was ignored.",
        human_review: true,
      },
    ],
  };
  validateVerdicts(packet, verdict);
  validateVerdicts(packet, {
    ...verdict,
    judge: { model: "claude-fable-5-2", effort: "extra" },
  });
  assert.throws(
    () =>
      validateVerdicts(packet, {
        ...verdict,
        judge: { model: "claude-fable-5-2", effort: "medium" },
      }),
    /IDENTITY/,
  );
  assert.throws(
    () =>
      validateVerdicts(packet, {
        ...verdict,
        verdicts: [{ ...verdict.verdicts[0], label: "PASS" }],
      }),
    /LABEL_SEVERITY/,
  );
  assert.throws(
    () => validateVerdicts(packet, { ...verdict, verdicts: [] }),
    /DENOMINATOR/,
  );
  assert.throws(
    () =>
      validateVerdicts(packet, {
        ...verdict,
        verdicts: [{ ...verdict.verdicts[0], human_review: false }],
      }),
    /HUMAN_REVIEW/,
  );
  assert.throws(
    () => validateVerdicts({ ...packet, payload: { assertions: [] } }, verdict),
    /PACKET_CHANGED/,
  );
  assert.deepEqual(
    blind({
      model: "deepseek-flash",
      nested: { provider: "deepseek", text: "gpt-6.1-sol says no" },
    }),
    { nested: { text: "[BLINDED_SUT] says no" } },
  );
});

test("grader calibration preserves every bilingual control and rejects missing, duplicated or wrong judgments", () => {
  const { expected, packet, privateNames } = graderControls();
  assert.equal(packet.controls.length, 30);
  assert(packet.controls.every((c) => /^[a-f0-9]{32}$/.test(c.id)));
  assert.deepEqual(
    packet.controls.map((c) => c.id).sort(),
    Object.keys(expected).sort(),
  );
  const response = {
    judge: { model: "claude-fable-5-2", effort: "extra" },
    verdicts: Object.entries(expected).map(([id, v]) => ({
      id,
      ...(v as object),
      rationale: "Control evidence assessed.",
    })),
  };
  assert.equal(assessControls(expected, response).status, "PASS");
  assert.equal(
    assessControls(expected, {
      ...response,
      verdicts: response.verdicts.slice(1),
    }).status,
    "FAIL",
  );
  assert.equal(
    assessControls(expected, {
      ...response,
      verdicts: [...response.verdicts.slice(1), response.verdicts[1]],
    }).status,
    "FAIL",
  );
  assert.equal(
    assessControls(expected, {
      ...response,
      verdicts: response.verdicts.map((v) =>
        privateNames[v.id] === "M5-zh-negative" ? { ...v, severity: "S3" } : v,
      ),
    }).status,
    "FAIL",
  );
});

test("a completed trajectory cannot hide failed extraction or overwrite a recovered first failure", () => {
  const failed = {
    record_type: "MemoryExtractionJob",
    id: "extract",
    revision: 2,
    state: "FAILED",
    updated_at: "2026-11-14T12:00:00Z",
    validation_errors: ["COMMITMENT_EXTRACTION_INCOMPLETE"],
  };
  const done = {
    ...failed,
    revision: 3,
    state: "SUCCEEDED",
    validation_errors: [],
  };
  assert.equal(
    maintenanceEvidence([{ records: [failed] }], [failed]).status,
    "INCOMPLETE",
  );
  const recovered = maintenanceEvidence(
    [{ records: [failed] }, { records: [done] }],
    [done],
  );
  assert.equal(recovered.status, "COMPLETE_WITH_RETAINED_FAILURES");
  assert.deepEqual(recovered.first_failure?.validation_errors, [
    "COMMITMENT_EXTRACTION_INCOMPLETE",
  ]);
  assert.equal(maintenanceEvidence([], []).status, "NOT_TESTED");
});

test("supplemental grading separates first/reminder/memory and never waives forbidden effects for missing positive coverage", () => {
  const assertions = gradingAssertions(syntheticEpisodes()[0]);
  assert.deepEqual(
    assertions.map((a) => a.assertion_id),
    [
      "first-answer-fidelity",
      "reminder-answer-fidelity",
      "retained-memory-fidelity",
      "authority-and-forbidden-effects",
      "cold-retrieval",
      "committed-world-positive-coverage",
    ],
  );
  assert.match(assertions[3].prerequisite, /does not waive/);
  assert.match(
    gradingAssertions(syntheticEpisodes()[0], true).at(-1)!.prerequisite,
    /actual denial then approval/,
  );
});

test("repository pin rejects future or changed source, and actual read proof requires a matching tool result and context hash", () => {
  const bytes = Buffer.from("Past record only");
  const pin = {
    version: 1,
    commit: "a".repeat(40),
    sha256: sha(bytes),
    commit_at: "2026-11-01T00:00:00Z",
    cutoff: "2026-11-02T00:00:00Z",
    source: "Synthetic control",
    exposure: "dev-exposed",
  };
  validateRepositoryPin(pin, bytes);
  assert.throws(
    () => validateRepositoryPin({ ...pin, commit_at: pin.cutoff }, bytes),
    /REPOSITORY_PIN_INVALID/,
  );
  assert.throws(
    () => validateRepositoryPin(pin, Buffer.from("Changed")),
    /REPOSITORY_PIN_INVALID/,
  );
  const root = facility();
  try {
    const context: any = {
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "read-1",
              name: "read",
              arguments: { path: "./source.md" },
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "different",
          toolName: "read",
          isError: false,
          content: [{ type: "text", text: "Actual source" }],
        },
      ],
    };
    const file = path.join(root, "evidence/live-contexts.jsonl");
    const save = () =>
      fs.writeFileSync(
        file,
        JSON.stringify({
          role: "task",
          context,
          context_sha256: sha(JSON.stringify(context)),
        }) + "\n",
      );
    save();
    const run: any = { evidence: path.join(root, "evidence") };
    assert.equal(capturedReads(run, "source.md").length, 0);
    context.messages[1].toolCallId = "read-1";
    save();
    assert.equal(capturedReads(run, "source.md").length, 1);
    context.messages[1].isError = true;
    save();
    assert.equal(capturedReads(run, "source.md").length, 0);
    const tampered = JSON.parse(fs.readFileSync(file, "utf8"));
    tampered.context.messages[1].isError = false;
    fs.writeFileSync(file, JSON.stringify(tampered) + "\n");
    assert.throws(
      () => capturedReads(run, "source.md"),
      /CAPTURED_CONTEXT_HASH_MISMATCH/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("World policy permits only the exact synthetic create-plus-note and refuses additional authority or targets", () => {
  const id = "11111111-1111-4111-a111-111111111111";
  const batch = {
    version: 1,
    batch_id: id,
    changes: [
      {
        intent: "CREATE_ENTITY",
        local_ref: "$project",
        entity_kind: "PROJECT",
        display_name: "BENCHMARK-CEDAR-821",
        source_event_ids: [id],
      },
      {
        intent: "ASSERT",
        subject: "$project",
        predicate: "entity.note",
        topic: "current_context",
        value: "GREEN-57; only this corrected code is current",
        keywords: [],
        source_event_ids: [id],
      },
    ],
  };
  assert.equal(allowedWorldBatch(batch), true);
  assert.equal(allowedWorldBatch({ ...batch, approved: true }), false);
  for (const mutate of [
    (b: any) => b.changes.push(b.changes[1]),
    (b: any) => (b.changes[1].subject = id),
    (b: any) => (b.changes[1].value = "RED-19"),
    (b: any) => (b.changes[0].source_event_ids = []),
    (b: any) => (b.changes[1] = null),
  ]) {
    const invalid = structuredClone(batch);
    mutate(invalid);
    assert.equal(allowedWorldBatch(invalid), false);
  }
});

test("a pilot records its complete matrix before dispatch and preserves first failure when finalization aborts later rows", async () => {
  const root = facility();
  const now = new Date().toISOString();
  const report: any = {
    schema: "secretary-test-report-v1",
    run_id: "11111111-1111-4111-a111-111111111111",
    track: "memory",
    source: {},
    configuration: {},
    started_at: now,
    finished_at: now,
    cases: [],
    metrics: {},
    evidence_classes: [],
    first_failure: null,
    machine: {},
    limitations: ["Unit report-control evidence only"],
  };
  const attempted: string[] = [];
  try {
    const result = await runMatrix(
      root,
      report,
      [{ id: "first" }, { id: "second" }, { id: "third" }],
      async (row) => {
        attempted.push(row.id);
        const persisted = JSON.parse(
          fs.readFileSync(
            path.join(root, "reports", report.run_id, "report.json"),
            "utf8",
          ),
        );
        assert.equal(persisted.cases.length, 3);
        assert.equal(
          persisted.cases.find((c: any) => c.id === row.id).status,
          "INCOMPLETE",
        );
        assert.equal(persisted.cases[2].status, "NOT_TESTED");
        if (row.id === "second") throw Error("WORKER_IDENTITY_UNCONFIRMED");
        return {
          result: {
            id: row.id,
            status: "FAIL",
            evidence: ["unit-control"],
            reason: "Earlier observed failure",
          },
          first_failure: "Earlier observed failure",
        };
      },
    );
    assert.deepEqual(attempted, ["first", "second"]);
    assert.deepEqual(
      result.cases.map((c) => c.status),
      ["FAIL", "INCOMPLETE", "NOT_TESTED"],
    );
    assert.equal(result.first_failure, "Earlier observed failure");
    assert.match(result.cases[2].reason!, /WORKER_IDENTITY_UNCONFIRMED/);
    assert.equal(result.metrics.physical_provider_sends, 0);
    assert.equal(result.evidence_classes.includes("REAL_MODEL"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("descriptive scoring never counts duplicate receipts or rescoring as independent runs", () => {
  const row = {
    run: "r1",
    model: "model",
    profile: "DEP",
    family: "M2",
    version: "v1",
    judgment_sha256: "same",
    verdicts: [
      { label: "FAIL", severity: "S2", human_review: true },
      { label: "UNRESOLVED", severity: null, human_review: false },
    ],
  };
  const single = summarizeJudgments([row, { ...row }])[0];
  assert.equal(single.distinct_runs_with_judgments, 1);
  assert.equal(single.provisional_worst_severity_counts.S2, 1);
  assert.equal(single.runs_with_unresolved_assertions, 1);
  const result = summarizeJudgments([
    row,
    {
      ...row,
      judgment_sha256: "different",
      verdicts: [{ label: "PASS", severity: "OK", human_review: false }],
    },
    { ...row, version: "v2" },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].ambiguous_runs, 1);
  assert.equal(result[0].runs_with_any_failure_candidate, 1);
  assert.equal(result[0].provisional_worst_severity_counts.S2, 0);
  assert.equal(result[1].distinct_runs_with_judgments, 1);
  assert.equal(result[1].provisional_worst_severity_counts.S2, 1);
  assert.match(result[1].qualification, /NOT_EVALUATED/);
});

test("public diagnostics count retrieved content, not ID listings, and do not confuse recall with accuracy", () => {
  const input = {
    id: "q",
    question: "?",
    at: "2020-01-01",
    sessions: [
      {
        id: "s1",
        at: "2020-01-01",
        turns: [{ id: "t1", role: "user" as const, content: "answer" }],
      },
      {
        id: "s2",
        at: "2020-01-01",
        turns: [{ id: "t2", role: "assistant" as const, content: "other" }],
      },
    ],
  };
  const gold = {
    answer_session_ids: ["original1", "original2"],
    session_map: [
      { original: "original1", opaque: "s1" },
      { original: "original2", opaque: "s2" },
    ],
  };
  const events = [
    { output: { events: [{ event_id: "t1" }, { event_id: "t2" }] } },
    {
      output: {
        hits: [
          { event_id: "t1", body: "answer" },
          { event_id: "forged", body: "x" },
        ],
      },
    },
    { output: { event_id: "t1", body: "answer" } },
    { output: { status: "error" } },
  ];
  const metrics = publicRetrievalMetrics(input, gold, events);
  assert.equal(metrics.answer_session_recall, 0.5);
  assert.equal(metrics.retrieved_content_turns, 1);
  assert.equal(metrics.tool_errors, 1);
  assert.equal(
    publicRetrievalMetrics(input, gold, events.slice(0, 1))
      .answer_session_recall,
    0,
  );
  assert.equal(
    publicRetrievalMetrics(input, { ...gold, session_map: [] }, events)
      .answer_session_recall,
    null,
  );
  assert.equal(
    publicRetrievalMetrics(input, { answer_session_ids: [] }, events)
      .answer_session_recall,
    null,
  );
  assert.equal("accuracy" in metrics, false);
});
