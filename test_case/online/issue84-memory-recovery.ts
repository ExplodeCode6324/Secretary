/** Credential-free fault scenario; runs before the normal acceptance service. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { App } from "../../src/pi_secretary/src/app.ts";
import { acceptanceAdapter, type RequestObservation } from "./issue84-model.ts";
import {
  freezeAcceptanceConfig,
  requireEmptyDatabase,
} from "./issue84-config.ts";
import { hash } from "../../src/pi_secretary/src/store.ts";
import type {
  CompactionJob,
  Consciousness,
  Input,
} from "../../src/pi_secretary/src/contracts.ts";
import { retryRuntime } from "../../src/pi_secretary/src/model-retry.ts";
import { fixtureResponse } from "./issue84-fixture.ts";

export class MemoryRecoveryFixture {
  active = false;
  summaries = 0;
  respond(body: string) {
    if (!this.active) return;
    const { messages } = JSON.parse(body);
    const system = messages
      .filter((m: any) => m.role === "system")
      .map((m: any) =>
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      )
      .join("\n");
    if (system.includes("COMMITMENT_EXTRACTION:"))
      return fixtureResponse('{"quotes":[]}');
    if (system.includes("CONSCIOUSNESS:")) {
      this.summaries++;
      if (this.summaries === 1) return fixtureResponse('{"items":[]}');
      return fixtureResponse(
        JSON.stringify({
          items: [
            {
              tier: "MINIMAL",
              summary:
                "Completed synthetic recovery exchanges; no pending work.",
              goals: [],
              constraints: [],
              decisions: [],
              open_questions: [],
              unfulfilled_commitments: [],
              task_refs: [],
              pending_owner: null,
            },
          ],
        }),
      );
    }
    return fixtureResponse("Synthetic historical reply. " + "h".repeat(14000));
  }
}

export async function memoryRecoveryCheck(
  app: App,
  fixture: MemoryRecoveryFixture,
) {
  assert.equal(
    app.store.all("Input").length,
    0,
    "RECOVERY_REQUIRES_FRESH_SCRIPTED_DOMAIN",
  );
  const memory = () =>
    app.store.get<Consciousness>(
      "Consciousness",
      app.host.session.consciousness_id,
    );
  const jobs = () => app.store.all<CompactionJob>("CompactionJob");
  fixture.active = true;
  try {
    app.host.accept("仅本轮：synthetic delayed-summary recovery setup.");
    await app.host.drain();
    await app.host.compact(); // Setup the original invalid summary, not a recovery retry.
    const old = jobs().find((j) => j.mode === "WORKING_MEMORY")!;
    assert.equal(old.state, "FAILED");
    for (
      let n = 0;
      n < 12 && app.host.session.state !== "CAPACITY_BLOCKED";
      n++
    ) {
      app.host.accept("仅本轮：synthetic recovery backlog " + n);
      await app.host.drain();
    }
    assert.equal(app.host.session.state, "CAPACITY_BLOCKED");
    const states = [app.host.session.state];
    const blocked = app.store
      .all<Input>("Input")
      .find((i) => i.state === "CLAIMED")!;
    assert(blocked);
    const target = app.store.events("input.handled").at(-1)!.sequence;
    const latest = memory().pending_raw_refs[0];
    const before = fixture.summaries;
    const tick = async () => {
      app.host.maintainIfNeeded();
      await (app.host as unknown as { maintenance?: Promise<void> })
        .maintenance;
    };
    await tick();
    assert.equal(fixture.summaries, before, "RETRIED_BEFORE_DEADLINE");
    retryRuntime.set(app.store, {
      now: () => Date.parse(old.next_attempt_at!),
    });
    await tick();
    assert.equal(app.host.session.state, "IDLE");
    states.push(app.host.session.state);
    assert.equal(memory().covered_event_sequence, target);
    assert.deepEqual(memory().pending_raw_refs, [latest]);
    const recovered = app.store.get<CompactionJob>("CompactionJob", old.id);
    assert.equal(recovered.state, "COMMITTED");
    assert.equal(recovered.retry_generation, 0);
    assert.equal(recovered.retry_round, 1);
    const catchup = jobs().find(
      (j) => j.mode === "WORKING_MEMORY" && j.id !== old.id,
    )!;
    assert.equal(catchup.state, "COMMITTED");
    assert.equal(catchup.source_start_sequence, old.source_end_sequence);
    assert.equal(catchup.source_end_sequence, target);
    assert.equal(catchup.source_refs[0].sha256, latest.sha256);
    assert(
      jobs().some(
        (j) => j.mode === "CONTEXT_COMPACTION" && j.state === "COMMITTED",
      ),
    );
    await app.host.drain();
    const handled = app.store.get<Input>("Input", blocked.id);
    assert.equal(handled.state, "HANDLED");
    assert.equal(handled.loop_id, blocked.loop_id);
    return {
      status: "PASS",
      evidenceClass: "SCRIPTED_MODEL",
      native: false,
      clock: "Controlled retry deadline; no wall-clock waiting claim",
      states,
      initialJob: old.id,
      catchupJob: catchup.id,
      target,
      latestSource: latest.sha256,
      input: handled.id,
      loop: handled.loop_id,
      sameInputHandled:
        handled.state === "HANDLED" && handled.loop_id === blocked.loop_id,
      automaticRecoveryTicks: 1,
      explicitRecoveryAttempts: 0,
      summaryRequests: fixture.summaries,
    };
  } finally {
    retryRuntime.delete(app.store);
    fixture.active = false;
  }
}

/** Separate sibling domain: no fixture objects or attempts enter normal acceptance. */
export async function runRecoveryHarness(root: string, dsn: string) {
  assert(!fs.existsSync(root), "RECOVERY_FRESH_ROOT_REQUIRED");
  const git = (...args: string[]) =>
    execFileSync("git", args, { encoding: "utf8" }).trim();
  assert(
    !git("status", "--porcelain", "--untracked-files=no"),
    "TRACKED_WORKTREE_DIRTY",
  );
  const config = freezeAcceptanceConfig();
  const freshness = await requireEmptyDatabase(dsn);
  const fixture = new MemoryRecoveryFixture();
  const requests: RequestObservation[] = [];
  let enabled = false,
    guardCalls = 0;
  const adapter = (role: "main" | "task") =>
    acceptanceAdapter(role, {
      key: "synthetic-key",
      enabled: () => enabled,
      guard: () => {
        guardCalls++;
      },
      active: () => {},
      approvalScope: () => undefined,
      inputIds: () => [],
      observe: (request) => requests.push(request),
      violation: (reason) => {
        throw Error(reason);
      },
      scripted: (body) => {
        const reply = fixture.respond(body);
        assert(reply, "OUTSIDE_RECOVERY_SCENARIO");
        return reply;
      },
    });
  const app = await App.open(
    path.join(root, "core"),
    { main: adapter("main"), task: adapter("task") },
    dsn,
  );
  let result: Awaited<ReturnType<typeof memoryRecoveryCheck>>;
  try {
    await app.world!.migrate();
    await app.settle();
    assert.equal(guardCalls, 0);
    assert.equal(app.store.all("Input").length, 0);
    enabled = true;
    result = await memoryRecoveryCheck(app, fixture);
  } finally {
    await app.close();
  }
  fs.writeFileSync(
    path.join(root, "memory-recovery.json"),
    JSON.stringify(
      {
        head: git("rev-parse", "HEAD"),
        source: git("rev-parse", "HEAD^{tree}"),
        configHash: config.hash,
        freshness,
        ...result,
        requests,
        journalHash: hash(
          fs.readFileSync(path.join(root, "core/journal.jsonl")),
        ),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
}
