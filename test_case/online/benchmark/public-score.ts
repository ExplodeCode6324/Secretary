import fs from "node:fs";
import path from "node:path";
import type { ReaderInput } from "./dataset.ts";
import type { Run } from "./domain.ts";
import { read, readJSON, requireThat, sha } from "./io.ts";

/** Gold annotations are consumed after the run; they never select reader evidence. */
export function publicRetrievalMetrics(
  input: ReaderInput,
  gold: any,
  retrieval: any[],
) {
  const turnSessions = new Map(
    input.sessions.flatMap((s) => s.turns.map((t) => [t.id, s.id] as const)),
  );
  const seen = new Set<string>();
  const seenTurns = new Set<string>();
  for (const attempt of retrieval) {
    const output = attempt.output;
    // A listing containing only IDs is not a read of session content.
    const bodies = [
      ...(Array.isArray(output?.hits) ? output.hits : []),
      output,
    ];
    for (const body of bodies) {
      if (typeof body?.body !== "string" || !body.body.length) continue;
      const session = turnSessions.get(body.event_id);
      if (session) {
        seen.add(session);
        seenTurns.add(body.event_id);
      }
    }
  }
  const mapped = new Map(
    (gold.session_map ?? []).map((s: any) => [s.original, s.opaque]),
  );
  const expected = [...new Set(gold.answer_session_ids ?? [])];
  const complete =
    expected.length > 0 && expected.every((id) => mapped.has(id));
  const hit = complete
    ? expected.filter((id) => seen.has(mapped.get(id) as string)).length
    : null;
  return {
    answer_sessions: expected.length,
    retrieved_answer_sessions: hit,
    answer_session_recall: hit === null ? null : hit / expected.length,
    recall_status: complete
      ? "OBSERVED"
      : "NOT_APPLICABLE_OR_ANNOTATION_UNAVAILABLE",
    retrieved_content_sessions: seen.size,
    retrieved_content_turns: seenTurns.size,
    executed_tool_attempts: retrieval.length,
    tool_errors: retrieval.filter((r) => r.output?.status === "error").length,
    limitation:
      "Any nonempty slice counts as session access; recall does not prove retrieval of the answer-bearing span or correct interpretation",
  };
}

export function scorePublicComponents(root: string, runs: Run[]) {
  const rows: any[] = [];
  for (const run of runs) {
    const marker = path.join(run.evidence, "public-run.json");
    if (!fs.existsSync(marker)) continue;
    const meta = readJSON(marker);
    requireThat(
      meta.run_id === run.id && ["dev", "smoke"].includes(meta.split),
      "PUBLIC_RUN_METADATA_INVALID",
    );
    const dir = path.join(root, "oracles/longmemeval");
    const manifestPath = path.join(dir, "manifest.json");
    requireThat(
      meta.manifest_sha256 === sha(read(manifestPath)),
      "PUBLIC_MANIFEST_CHANGED",
    );
    const manifest = readJSON(manifestPath);
    const inputPath = path.join(
      root,
      "inputs",
      `longmemeval-${meta.split}.json`,
    );
    const goldPath = path.join(dir, `${meta.split}-gold.json`);
    requireThat(
      manifest.inputs_sha256?.[meta.split] === sha(read(inputPath)) &&
        manifest.gold_sha256?.[meta.split] === sha(read(goldPath)),
      "PUBLIC_INPUT_OR_GOLD_CHANGED",
    );
    const input = readJSON<ReaderInput[]>(inputPath).find(
      (q) => q.id === meta.question_id,
    );
    const gold = readJSON<any[]>(goldPath).find(
      (q) => q.id === meta.question_id,
    );
    requireThat(
      input && gold && meta.input_sha256 === sha(JSON.stringify(input)),
      "PUBLIC_QUESTION_CHANGED",
    );
    const retrievalPath = path.join(run.evidence, "retrieval.jsonl");
    const outputPath = path.join(run.evidence, "public-output.json");
    const failurePath = path.join(run.evidence, "first-failure.json");
    const retrieval = fs.existsSync(retrievalPath)
      ? read(retrievalPath)
          .toString()
          .split("\n")
          .filter(Boolean)
          .map((s) => JSON.parse(s))
      : [];
    const output = fs.existsSync(outputPath) ? readJSON(outputPath) : null;
    const firstFailure = fs.existsSync(failurePath)
      ? readJSON(failurePath).reason
      : (output?.error ?? null);
    rows.push({
      run: run.id,
      model: meta.model,
      split: meta.split,
      question_id: meta.question_id,
      stratum: gold.question_id.endsWith("_abs")
        ? "abstention"
        : gold.question_type,
      scope: "COMPONENT_ONLY",
      first_failure: firstFailure,
      status:
        firstFailure || !output
          ? "INCOMPLETE"
          : "SEMANTIC_ADJUDICATION_PENDING",
      output_sha256: output ? sha(read(outputPath)) : null,
      retrieval_sha256: fs.existsSync(retrievalPath)
        ? sha(read(retrievalPath))
        : null,
      retrieval: publicRetrievalMetrics(input, gold, retrieval),
      official_accuracy: "NOT_TESTED",
      variant_accuracy: "UNRESOLVED",
      semantic_prerequisite:
        "Pin and inspect the upstream evaluator prompt/parser, then independently calibrate the authorized judge variant. Retrieval recall is not answer accuracy.",
    });
  }
  return rows;
}
