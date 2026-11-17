import fs from "node:fs";
import path from "node:path";
import { mkdir, read, readJSON, requireThat, sha, writeJSON } from "./io.ts";
import { importPublicBundle } from "./public-bundle.ts";

export const questionTypes = [
  "single-session-user",
  "single-session-assistant",
  "single-session-preference",
  "temporal-reasoning",
  "knowledge-update",
  "multi-session",
] as const;
export type PublicQuestion = {
  question_id: string;
  question_type: string;
  question: string;
  question_date: string;
  answer: string | number;
  haystack_sessions: {
    role: string;
    content: string;
    [key: string]: unknown;
  }[][];
  haystack_dates: string[];
  [key: string]: unknown;
};
export type ReaderInput = {
  id: string;
  question: string;
  at: string;
  sessions: {
    id: string;
    at: string;
    turns: { id: string; role: "user" | "assistant"; content: string }[];
  }[];
};
const rank = (q: PublicQuestion) => sha("secretary-121-v1|" + q.question_id);
export function selectPublic(all: PublicQuestion[]) {
  requireThat(
    new Set(all.map((q) => q.question_id)).size === all.length,
    "DUPLICATE_PUBLIC_ID",
  );
  const ordered = [...all].sort(
    (a, b) =>
      rank(a).localeCompare(rank(b)) ||
      a.question_id.localeCompare(b.question_id),
  );
  const dev: PublicQuestion[] = [],
    smoke: PublicQuestion[] = [];
  for (const type of questionTypes) {
    const group = ordered.filter(
      (q) => q.question_type === type && !q.question_id.includes("_abs"),
    );
    requireThat(group.length >= 8, "PUBLIC_STRATUM_TOO_SMALL");
    dev.push(group[0]);
    smoke.push(...group.slice(1, 8));
  }
  const abstention = ordered.filter((q) => q.question_id.includes("_abs"));
  requireThat(abstention.length >= 8, "PUBLIC_ABSTENTION_TOO_SMALL");
  smoke.push(...abstention.slice(0, 8));
  return { dev, smoke };
}
function opaque(value: string) {
  const hash = sha("secretary-121-source-v1|" + value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export function corpusTime(value: string) {
  // Released LongMemEval timestamps carry no timezone; freeze their wall-clock interpretation at UTC.
  const converted = value
    .replace(/\([^)]*\)/g, " ")
    .trim()
    .replace(/\//g, "-")
    .replace(/\s+/, "T");
  const date = /(?:Z|[+-]\d\d:\d\d)$/.test(converted)
    ? converted
    : converted + "Z";
  requireThat(Number.isFinite(Date.parse(date)), "PUBLIC_DATE_INVALID");
  return new Date(date).toISOString();
}
/** Strict allowlist construction, never object spreads from the annotated corpus. */
export function readerInput(q: PublicQuestion): ReaderInput {
  requireThat(
    typeof q.question === "string" &&
      typeof q.question_id === "string" &&
      q.haystack_dates.length === q.haystack_sessions.length,
    "PUBLIC_QUESTION_INVALID",
  );
  const at = corpusTime(q.question_date);
  return {
    id: opaque(q.question_id),
    question: q.question,
    at,
    sessions: q.haystack_sessions.map((session, i) => {
      const occurred = corpusTime(q.haystack_dates[i]);
      requireThat(
        Date.parse(occurred) <= Date.parse(at),
        "PUBLIC_FUTURE_SESSION",
      );
      return {
        id: opaque(q.question_id + ":session:" + i),
        at: occurred,
        turns: session.map((turn, j) => {
          requireThat(
            ["user", "assistant"].includes(turn.role) &&
              typeof turn.content === "string",
            "PUBLIC_TURN_INVALID",
          );
          return {
            id: opaque(q.question_id + ":turn:" + i + ":" + j),
            role: turn.role as "user" | "assistant",
            content: turn.content,
          };
        }),
      };
    }),
  };
}
export function partitionPublicInputs(items: PublicQuestion[]) {
  const inputs: ReaderInput[] = [],
    blocked: { id: string; reason: string }[] = [];
  for (const item of items) {
    try {
      inputs.push(readerInput(item));
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "PUBLIC_INPUT_INVALID";
      if (
        !/^PUBLIC_(FUTURE_SESSION|DATE_INVALID|QUESTION_INVALID|TURN_INVALID)$/.test(
          reason,
        )
      )
        throw error;
      blocked.push({ id: opaque(item.question_id), reason });
    }
  }
  return { inputs, blocked };
}
async function download(url: string, file: string, maximum: number) {
  requireThat(!fs.existsSync(file), "DATASET_FILE_EXISTS");
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  requireThat(response.ok && response.body, "DATASET_DOWNLOAD_FAILED");
  mkdir(path.dirname(file));
  const fd = fs.openSync(file, "wx", 0o600);
  let size = 0;
  try {
    for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      requireThat(size <= maximum, "DATASET_TOO_LARGE");
      fs.writeSync(fd, chunk);
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return { url, bytes: size, sha256: sha(read(file)), path: file };
}
export async function preparePublic(root: string, sourceBundle?: string) {
  const dir = path.join(root, "oracles", "longmemeval");
  const imported = sourceBundle ? importPublicBundle(sourceBundle, dir) : null;
  let hf: any, gh: any;
  const files: { url: string; bytes: number; sha256: string; path: string }[] =
    [];
  if (imported) {
    hf = { sha: imported.dataset_commit };
    gh = { sha: imported.repository_commit };
    files.push(...imported.files);
  } else {
    hf = (await (
      await fetch(
        "https://huggingface.co/api/datasets/xiaowu0162/longmemeval-cleaned",
        { signal: AbortSignal.timeout(30000) },
      )
    ).json()) as any;
    gh = (await (
      await fetch(
        "https://api.github.com/repos/xiaowu0162/LongMemEval/commits/main",
        {
          headers: { "User-Agent": "secretary-benchmark" },
          signal: AbortSignal.timeout(30000),
        },
      )
    ).json()) as any;
    requireThat(
      /^[a-f0-9]{40}$/.test(hf.sha) && /^[a-f0-9]{40}$/.test(gh.sha),
      "DATASET_PIN_UNAVAILABLE",
    );
    for (const name of [
      "longmemeval_s_cleaned.json",
      "longmemeval_oracle.json",
      "README.md",
    ])
      files.push(
        await download(
          `https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/${hf.sha}/${name}`,
          path.join(dir, name),
          350_000_000,
        ),
      );
    for (const name of [
      "LICENSE",
      "src/evaluation/evaluate_qa.py",
      "src/evaluation/print_qa_metrics.py",
    ])
      files.push(
        await download(
          `https://raw.githubusercontent.com/xiaowu0162/LongMemEval/${gh.sha}/${name}`,
          path.join(dir, path.basename(name)),
          1_000_000,
        ),
      );
  }
  const all = readJSON<PublicQuestion[]>(
    path.join(dir, "longmemeval_s_cleaned.json"),
  );
  const selected = selectPublic(all);
  const partitions = Object.fromEntries(
    Object.entries(selected).map(([split, items]) => [
      split,
      partitionPublicInputs(items),
    ]),
  );
  for (const [split, items] of Object.entries(selected)) {
    writeJSON(
      path.join(dir, split + "-gold.json"),
      items.map((q) => ({
        id: opaque(q.question_id),
        question_id: q.question_id,
        question_type: q.question_type,
        answer: q.answer,
        question: q.question,
        split,
        answer_session_ids: q.answer_session_ids ?? [],
        session_map: Array.isArray(q.haystack_session_ids)
          ? q.haystack_session_ids.map((id, index) => ({
              original: id,
              opaque: opaque(q.question_id + ":session:" + index),
            }))
          : [],
      })),
    );
    writeJSON(
      path.join(root, "inputs", "longmemeval-" + split + ".json"),
      partitions[split].inputs,
    );
  }
  const manifest = {
    version: 1,
    dataset: "longmemeval_s_cleaned",
    hf_commit: hf.sha,
    repository_commit: gh.sha,
    source_bundle_sha256: imported?.bundle_sha256 ?? null,
    origin_verification: imported
      ? "Controller-approved official download bundle; local hashes/pins verified, transport provenance retained separately"
      : "Direct official HTTPS download",
    files,
    license: "MIT",
    selection:
      "sha256(secretary-121-v1|question_id); 6 dev; 42 stratified + 8 abstention smoke; disjoint",
    time_interpretation: "Source wall-clock timestamps interpreted as UTC",
    dev: selected.dev.map((q) => q.question_id),
    smoke: selected.smoke.map((q) => q.question_id),
    selected_inputs: Object.fromEntries(
      Object.entries(selected).map(([split, rows]) => [
        split,
        rows.map((q) => opaque(q.question_id)),
      ]),
    ),
    blocked_inputs: Object.fromEntries(
      Object.entries(partitions).map(([split, p]) => [split, p.blocked]),
    ),
    inputs_sha256: Object.fromEntries(
      ["dev", "smoke"].map((split) => [
        split,
        sha(read(path.join(root, "inputs", "longmemeval-" + split + ".json"))),
      ]),
    ),
    gold_sha256: Object.fromEntries(
      ["dev", "smoke"].map((split) => [
        split,
        sha(read(path.join(dir, split + "-gold.json"))),
      ]),
    ),
    evaluator:
      "Official code pinned but NOT_EXECUTED; Claude-based grading is a separately labelled variant, not the official score",
  };
  writeJSON(path.join(dir, "manifest.json"), manifest);
  return {
    dev: selected.dev.length,
    smoke: selected.smoke.length,
    blocked: Object.fromEntries(
      Object.entries(partitions).map(([split, p]) => [split, p.blocked.length]),
    ),
    dataset_sha256: files[0].sha256,
  };
}
