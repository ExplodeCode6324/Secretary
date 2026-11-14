import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  roleModel,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import {
  appendJSON,
  noLinks,
  read,
  repository,
  requireThat,
  sha,
  writeJSON,
} from "./io.ts";
import { reserve, settle } from "./campaign.ts";

export const modelIDs = [
  "gpt-6.1-sol",
  "deepseek-flash",
  "gpt-6-luna",
] as const;
export type ModelID = (typeof modelIDs)[number];
export type Profile = "RC" | "DEP";
export function descriptor(id: ModelID): Model<Api> {
  requireThat(modelIDs.includes(id), "MODEL_NOT_APPROVED");
  if (id === "deepseek-flash") {
    const m = structuredClone(getModel("deepseek", "deepseek-flash"));
    requireThat(
      m &&
        m.baseUrl === "https://api.deepseek.com" &&
        m.api === "openai-completions",
      "MODEL_REGISTRY_DRIFT",
    );
    // Peak uncached rates are conservative estimates, not a provider invoice.
    return {
      ...m,
      cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0.3 },
    };
  }
  const input = id === "gpt-6.1-sol" ? 2 : 0.1,
    output = id === "gpt-6.1-sol" ? 10 : 0.5;
  return {
    id,
    name: id,
    provider: "openai",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    input: ["text"],
    contextWindow: 1050000,
    maxTokens: 128000,
    cost: { input, output, cacheRead: input, cacheWrite: input },
  };
}
export function credential(id: ModelID) {
  const root = path.join(repository, ".local/test-credentials");
  const file = path.join(
    root,
    id === "deepseek-flash"
      ? ".env.Secretary_test_deepseek"
      : ".env.secretary_test_openai",
  );
  noLinks(file);
  for (const [p, mode] of [
    [root, 0o700],
    [file, 0o600],
  ] as const) {
    const stat = fs.statSync(p);
    requireThat(
      stat.uid === process.getuid?.() &&
        (stat.mode & 0o777) === mode &&
        (p === root || stat.nlink === 1),
      "CREDENTIAL_PERMISSIONS",
    );
  }
  const keyName =
    id === "deepseek-flash" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY";
  const matches = read(file)
    .toString()
    .split(/\r?\n/)
    .filter((line) => line.startsWith(keyName + "="));
  requireThat(matches.length === 1, "CREDENTIAL_MISSING");
  const key = matches[0]
    .slice(keyName.length + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");
  requireThat(key.length > 10 && !/[\r\n]/.test(key), "CREDENTIAL_INVALID");
  return key;
}
export function configureProfile(profile: Profile) {
  requireThat(profile === "RC" || profile === "DEP", "UNKNOWN_PROFILE");
  if (profile === "RC")
    Object.assign(process.env, {
      SECRETARY_MAIN_CONTEXT_WINDOW: "65536",
      SECRETARY_TASK_CONTEXT_WINDOW: "65536",
      SECRETARY_RECENT_INPUT_MAX_COUNT: "2",
      SECRETARY_RECENT_INPUT_BUDGET_RATIO: "0.05",
    });
}
type Attribution = { role: string; context_sha256: string };
const attribution = new AsyncLocalStorage<Attribution>();
export function liveRoles(id: ModelID, key: string, evidence: string) {
  const model = descriptor(id);
  const role = (name: "main" | "task") => {
    const config = roleModel(model, key, name);
    const stream: StreamFn = async (m, context, options) => {
      const raw = JSON.stringify(context);
      requireThat(!raw.includes(key), "CREDENTIAL_CONTEXT_LEAK");
      const hash = sha(raw);
      appendJSON(path.join(evidence, "live-contexts.jsonl"), {
        at: new Date().toISOString(),
        role: name,
        context_sha256: hash,
        context,
      });
      return attribution.run({ role: name, context_sha256: hash }, () =>
        config.stream(m, context, options),
      );
    };
    return { model, stream };
  };
  return { main: role("main"), task: role("task") };
}
export function usageCost(model: Model<Api>, usage: any): number | null {
  if (!usage || typeof usage !== "object") return null;
  const input = usage.input_tokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens;
  if (![input, output].every((v) => Number.isSafeInteger(v) && v >= 0))
    return null;
  return (input * model.cost.input + output * model.cost.output) / 1e6;
}
/** Enforce origin/method/body before sending; reserve and fsync in this process. */
export function meteredFetch(
  options: {
    root: string;
    run: string;
    episode?: string;
    evidence: string;
    model: ModelID;
    key: string;
    maxSends: number;
    forbidden?: string[];
  },
  transport: typeof fetch = globalThis.fetch,
): typeof fetch {
  const model = descriptor(options.model),
    base = new URL(model.baseUrl);
  const endpoint =
    base.origin +
    (model.api === "openai-responses" ? "/v1/responses" : "/chat/completions");
  let sends = 0;
  return async (input, init) => {
    const request = new Request(input, init);
    requireThat(
      request.url === endpoint && request.method === "POST",
      "PROVIDER_ENDPOINT_NOT_APPROVED",
    );
    const body = await request.clone().text();
    requireThat(
      ![options.key, ...(options.forbidden ?? [])]
        .filter(Boolean)
        .some((secret) => body.includes(secret)),
      "PROVIDER_PAYLOAD_LEAK",
    );
    const payload = JSON.parse(body);
    requireThat(
      payload.model === options.model && payload.stream === true,
      "PROVIDER_MODEL_PROTOCOL_MISMATCH",
    );
    requireThat(++sends <= options.maxSends, "EPISODE_SEND_LIMIT");
    const maxOutput =
      payload.max_output_tokens ??
      payload.max_completion_tokens ??
      payload.max_tokens;
    requireThat(
      Number.isSafeInteger(maxOutput) &&
        maxOutput > 0 &&
        maxOutput <= model.maxTokens,
      "PROVIDER_OUTPUT_CAP_MISSING",
    );
    const worst =
      (Buffer.byteLength(body) * model.cost.input +
        maxOutput * model.cost.output) /
      1e6;
    const id = await reserve(
      options.root,
      {
        model: options.model,
        run: options.run,
        episode: options.episode ?? options.run,
        request_sha256: sha(body),
        reserved_usd: worst,
      },
      options.maxSends,
    );
    writeJSON(path.join(options.evidence, `send-${id}.json`), {
      id,
      attribution: attribution.getStore() ?? { role: "component-or-probe" },
      payload,
      at: new Date().toISOString(),
    });
    let response: Response;
    try {
      response = await transport(new Request(request, { redirect: "error" }));
    } catch {
      await settle(options.root, id, "NETWORK_UNCERTAIN", null, null);
      // Never propagate a provider exception that might contain request headers.
      throw Error("PROVIDER_NETWORK_UNCERTAIN");
    }
    appendJSON(path.join(options.evidence, "http.jsonl"), {
      id,
      status: response.status,
      at: new Date().toISOString(),
    });
    if (!response.ok || !response.body) {
      await settle(options.root, id, `HTTP_${response.status}`, null, null);
      // Error bodies can echo input/headers; SDK only needs the category and status.
      return new Response(
        JSON.stringify({
          error: {
            message: `HTTP_${response.status}`,
            type: "benchmark_provider_error",
          },
        }),
        {
          status: response.status >= 400 ? response.status : 502,
          headers: { "content-type": "application/json" },
        },
      );
    }
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let pending = "",
      usage: unknown = null,
      returnedModel: string | null = null,
      done = false;
    const observe = (chunk: Uint8Array) => {
      const text = decoder.decode(chunk, { stream: true });
      requireThat(!text.includes(options.key), "CREDENTIAL_RESPONSE_LEAK");
      pending += text;
      requireThat(pending.length < 8 * 1024 * 1024, "PROVIDER_FRAME_TOO_LARGE");
      const lines = pending.split("\n");
      pending = lines.pop()!;
      for (const line of lines)
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          const data = JSON.parse(line.slice(6));
          usage = data.usage ?? data.response?.usage ?? usage;
          returnedModel = data.model ?? data.response?.model ?? returnedModel;
        }
    };
    const finish = async (outcome: string) => {
      if (done) return;
      done = true;
      await settle(
        options.root,
        id,
        outcome,
        { provider: usage, returned_model: returnedModel },
        usageCost(model, usage),
      );
    };
    return new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              await finish("RESPONSE_COMPLETE");
              controller.close();
            } else {
              observe(chunk.value);
              controller.enqueue(chunk.value);
            }
          } catch {
            await finish("STREAM_UNCERTAIN");
            await reader.cancel().catch(() => {});
            controller.error(Error("PROVIDER_STREAM_UNCERTAIN"));
          }
        },
        async cancel() {
          await reader.cancel();
          await finish("CANCELLED_UNCERTAIN");
        },
      }),
      { status: response.status, headers: response.headers },
    );
  };
}
