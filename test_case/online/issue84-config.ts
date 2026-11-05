import assert from "node:assert/strict";
import fs from "node:fs";
import { parseEnv } from "node:util";
import { Client } from "pg";
import { hash } from "../../src/pi_secretary/src/store.ts";
import type { App } from "../../src/pi_secretary/src/app.ts";
import type {
  Consciousness,
  CompactionJob,
} from "../../src/pi_secretary/src/contracts.ts";
import { budgetConfig } from "../../src/pi_secretary/src/budget.ts";
import {
  acceptanceModel as model,
  acceptanceEndpoint,
} from "./issue84-model.ts";

export const profile = {
  version: 1,
  provider: model.provider,
  api: model.api,
  model: model.id,
  baseUrl: model.baseUrl,
  tokens_per_image: 1024,
  max_side: 2000,
  max_pixels: 4_000_000,
  source: "DeepSeek official vision guide, isolated issue #84 acceptance",
};
export function acceptanceKey(name: "DEEPSEEK_API_KEY" | "OPENAI_API_KEY") {
  let key = process.env[name];
  if (!key && fs.existsSync(".env.local")) {
    const stat = fs.lstatSync(".env.local");
    assert(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        (stat.mode & 0o077) === 0 &&
        stat.uid === process.getuid?.(),
      "UNSAFE_CREDENTIAL_FILE",
    );
    key = parseEnv(fs.readFileSync(".env.local", "utf8"))[name];
  }
  assert(
    typeof key === "string" && key.trim(),
    "ISSUE84_PROVIDER_KEY_REQUIRED",
  );
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  return key;
}
export function freezeAcceptanceConfig(
  policy: "bounded" | "observe" = "observe",
) {
  assert(
    model.api === "openai-completions" &&
      model.input.includes("image") &&
      new URL(model.baseUrl).origin === new URL(acceptanceEndpoint).origin,
    "UNEXPECTED_MODEL",
  );
  const values = {
    SECRETARY_MODE: "live",
    SECRETARY_MAIN_CONTEXT_WINDOW: "90000",
    SECRETARY_MAIN_OUTPUT_TOKENS: "8192",
    SECRETARY_TASK_OUTPUT_TOKENS: "8192",
    SECRETARY_MAX_OUTPUT_TOKENS: "8192",
    SECRETARY_MEMORY_UPDATE_TURNS: "8",
    SECRETARY_MEMORY_UPDATE_SECONDS: "60",
    SECRETARY_MEMORY_MIN_INTERVAL_SECONDS: "120",
    SECRETARY_MAX_WORKERS: "2",
    SECRETARY_VISION_BUDGET_PROFILES: JSON.stringify([profile]),
  };
  Object.assign(process.env, values);
  const manifest = {
    policy,
    values,
    main: budgetConfig("main"),
    task: budgetConfig("task"),
    model,
    postgres: true,
    profile,
    lock: hash(fs.readFileSync("package-lock.json")),
  };
  return { manifest, hash: hash(JSON.stringify(manifest)) };
}
export async function requireEmptyDatabase(dsn: string) {
  const client = new Client({
    connectionString: dsn,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const schema = await client.query(
      "SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname NOT LIKE 'pg_%'",
    );
    const relations = await client.query(
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public'",
    );
    assert(
      schema.rowCount === 0 && relations.rowCount === 0,
      "ISSUE84_DATABASE_NOT_EMPTY",
    );
    return { empty: true, checkedAt: new Date().toISOString() };
  } finally {
    await client.end();
  }
}
export function maintenancePending(app: App) {
  if (app.activitySnapshot().activities.some((a) => a.scope === "maintenance"))
    return true;
  if (
    app.store.indexed("MemoryExtractionJob", "pending_extraction", [true])
      .length
  )
    return true;
  if (
    app.store
      .all<CompactionJob>("CompactionJob")
      .some((j) => ["FAILED", "SUMMARIZING"].includes(String(j.state)))
  )
    return true;
  const cs = app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );
  // Include work not due yet, so the 60/120-second timer cannot move it into
  // the next path's account. Operator waits for normal Core maintenance.
  return app.store
    .eventsSince("input.handled", cs.covered_event_sequence ?? 0)
    .some((e) => e.scope.session_id === app.host.sessionID);
}
