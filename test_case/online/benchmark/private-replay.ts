import fs from "node:fs";
import path from "node:path";
import { Domains } from "./domain.ts";
import {
  noLinks,
  read,
  readJSON,
  requireThat,
  sha,
  writeJSON,
  mkdir,
} from "./io.ts";
import { stopDatabase } from "./postgres.ts";
import type { Episode } from "./scenarios.ts";

const keys = (value: any, allowed: string[]) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).every((k) => allowed.includes(k));
const strings = (v: any) =>
  Array.isArray(v) &&
  v.length <= 30 &&
  v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 8000);

/** Only reconstructed development episodes; this API cannot promote exposed data to held-out. */
export function validatePrivateEpisodes(value: unknown): Episode[] {
  requireThat(
    Array.isArray(value) && value.length > 0 && value.length <= 12,
    "PRIVATE_EPISODES_INVALID",
  );
  requireThat(
    new Set(value.map((e) => e?.id)).size === value.length,
    "PRIVATE_DUPLICATE_ID",
  );
  for (const e of value) {
    requireThat(
      keys(e, [
        "id",
        "family",
        "exposure",
        "source",
        "steps",
        "oracle",
        "requires_cold",
      ]) &&
        /^R-[a-z0-9-]{1,60}$/.test(e.id) &&
        /^M[1-6]$/.test(e.family) &&
        e.exposure === "dev-exposed" &&
        typeof e.source === "string" &&
        e.source.length > 0 &&
        e.source.length <= 2048 &&
        typeof e.requires_cold === "boolean",
      "PRIVATE_EPISODE_INVALID",
    );
    requireThat(
      Array.isArray(e.steps) &&
        e.steps.length >= 3 &&
        e.steps.length <= 100 &&
        e.steps.every(
          (s: any) =>
            keys(s, ["text", "probe", "reminder", "restart_before"]) &&
            typeof s.text === "string" &&
            s.text.length > 0 &&
            s.text.length <= 8000 &&
            ["probe", "reminder", "restart_before"].every(
              (k) => s[k] === undefined || typeof s[k] === "boolean",
            ),
        ) &&
        e.steps.filter((s: any) => s.probe && !s.reminder).length === 1 &&
        e.steps.filter((s: any) => s.reminder).length === 1 &&
        e.steps.at(-1).probe &&
        e.steps.at(-1).reminder,
      "PRIVATE_STEPS_INVALID",
    );
    requireThat(
      keys(e.oracle, ["required", "forbidden", "forbidden_effects"]) &&
        strings(e.oracle.required) &&
        e.oracle.required.length > 0 &&
        strings(e.oracle.forbidden) &&
        strings(e.oracle.forbidden_effects),
      "PRIVATE_ORACLE_INVALID",
    );
  }
  return value as Episode[];
}

export async function preparePrivate(
  d: Domains,
  sourceFile: string,
  provenanceFile: string,
) {
  noLinks(sourceFile);
  noLinks(provenanceFile);
  requireThat(
    fs.statSync(sourceFile).size <= 1_000_000 &&
      fs.statSync(provenanceFile).size <= 100_000,
    "PRIVATE_INPUT_TOO_LARGE",
  );
  const episodes = validatePrivateEpisodes(readJSON(sourceFile)),
    provenance = readJSON(provenanceFile);
  requireThat(
    provenance.version === 1 &&
      provenance.exposure === "dev-exposed" &&
      JSON.stringify(provenance.cases) ===
        JSON.stringify(episodes.map((e) => e.id)) &&
      strings(provenance.limitations) &&
      provenance.limitations.length > 0 &&
      provenance.source_hashes &&
      Object.keys(provenance.source_hashes).length > 0 &&
      Object.keys(provenance.source_hashes).length <= 8,
    "PRIVATE_PROVENANCE_INVALID",
  );
  const sources = Object.entries(provenance.source_hashes).map(
    ([name, hash]) => {
      requireThat(
        /^[a-z0-9-]+\.md$/.test(name) &&
          typeof hash === "string" &&
          /^[0-9a-f]{64}$/.test(hash),
        "PRIVATE_SOURCE_INVALID",
      );
      const source = path.join(path.dirname(provenanceFile), name);
      noLinks(source);
      requireThat(
        fs.statSync(source).size <= 2_000_000,
        "PRIVATE_SOURCE_TOO_LARGE",
      );
      const bytes = read(source);
      requireThat(sha(bytes) === hash, "PRIVATE_SOURCE_CHANGED");
      return { name, bytes, sha256: hash };
    },
  );
  const target = path.join(d.root, "inputs", "private-replays.json");
  requireThat(!fs.existsSync(target), "PRIVATE_INPUT_ALREADY_FROZEN");
  const owned = await d.create();
  await stopDatabase(owned.database);
  const dir = path.join(d.root, "oracles", "private-source");
  mkdir(dir);
  for (const s of sources)
    fs.writeFileSync(path.join(dir, s.name), s.bytes, {
      flag: "wx",
      mode: 0o600,
    });
  writeJSON(path.join(dir, "manifest.json"), {
    ...provenance,
    prepared_at: new Date().toISOString(),
    replay_sha256: sha(JSON.stringify(episodes)),
    provenance_sha256: sha(read(provenanceFile)),
    scope: "RECONSTRUCTED_RETENTION_A_ONLY",
    repository_retrieval_B: "NOT_TESTED",
  });
  // Only steps are sent through normal input commands. The oracle never enters a SUT context.
  writeJSON(target, episodes);
  return {
    cases: episodes.map((e) => e.id),
    exposure: "dev-exposed",
    scope: "RECONSTRUCTED_RETENTION_A_ONLY",
  };
}

export function privateEpisodes(root: string) {
  const episodes = validatePrivateEpisodes(
    readJSON(path.join(root, "inputs", "private-replays.json")),
  );
  const manifest = readJSON(
    path.join(root, "oracles", "private-source", "manifest.json"),
  );
  requireThat(
    manifest.replay_sha256 === sha(JSON.stringify(episodes)),
    "PRIVATE_INPUT_CHANGED",
  );
  return episodes;
}
