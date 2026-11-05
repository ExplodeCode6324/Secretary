/** Credential-free fault scenario; runs before the normal acceptance service. */
import assert from "node:assert/strict";
import type { App } from "../../src/pi_secretary/src/app.ts";
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
      states: ["CAPACITY_BLOCKED", "IDLE"],
      initialJob: old.id,
      catchupJob: catchup.id,
      target,
      latestSource: latest.sha256,
      input: handled.id,
      loop: handled.loop_id,
      sameInputHandled: true,
      automaticRecoveryTicks: 1,
      explicitRecoveryAttempts: 0,
      summaryRequests: fixture.summaries,
    };
  } finally {
    retryRuntime.delete(app.store);
    fixture.active = false;
  }
}
