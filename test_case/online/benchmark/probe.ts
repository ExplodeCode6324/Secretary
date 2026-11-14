import path from "node:path";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { roleModel } from "../../../src/pi_secretary/src/model.ts";
import {
  credential,
  descriptor,
  meteredFetch,
  modelIDs,
} from "./live-model.ts";
import { Domains, configuration } from "./domain.ts";
import { createCampaign } from "./campaign.ts";
import { writeJSON } from "./io.ts";
import { stopDatabase } from "./postgres.ts";

/** Connectivity evidence only. This deliberately has no memory PASS assertion. */
export async function probeModels(d: Domains, approvalID: string) {
  await createCampaign(d.root, approvalID, null);
  let run: Awaited<ReturnType<Domains["create"]>> | undefined;
  const transport = globalThis.fetch;
  const results: Record<string, unknown>[] = [];
  try {
    run = await d.create(configuration);
    for (const id of modelIDs) {
      const model = descriptor(id),
        key = credential(id);
      let listed: boolean | null = null,
        listingStatus: number | null = null;
      try {
        const r = await transport(model.baseUrl + "/models", {
          headers: { Authorization: "Bearer " + key },
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        listingStatus = r.status;
        if (r.ok)
          listed =
            ((await r.json()) as any).data?.some((m: any) => m.id === id) ??
            false;
      } catch {
        /* Preserve as a failed discovery probe; the actual request is a separate check. */
      }
      globalThis.fetch = meteredFetch(
        {
          root: d.root,
          run: run.id,
          episode: run.lineage + ":" + id,
          evidence: run.evidence,
          model: id,
          key,
          maxSends: 1,
        },
        transport,
      );
      try {
        const config = roleModel(model, key);
        const response = await (
          await config.stream(
            model,
            normalizeContext({
              messages: [
                {
                  role: "user",
                  content: "Reply with the single word READY.",
                  timestamp: Date.now(),
                },
              ],
            }),
            { maxTokens: 128, signal: AbortSignal.timeout(30000) },
          )
        ).result();
        const result = {
          id,
          listed,
          listing_http_status: listingStatus,
          live_status: ["error", "aborted"].includes(response.stopReason)
            ? "BLOCKED"
            : "CONNECTED",
          returned_model: response.model,
          stop_reason: response.stopReason,
          usage: response.usage,
          response: response.content,
          evidence_class: "CONNECTION_PROBE_ONLY",
        };
        // Error text is provider controlled; physical-send evidence retains its safe category.
        writeJSON(path.join(run.evidence, "probe-" + id + ".json"), result);
        results.push(result);
      } catch {
        const result = {
          id,
          listed,
          listing_http_status: listingStatus,
          live_status: "BLOCKED",
          evidence_class: "CONNECTION_PROBE_ONLY",
        };
        writeJSON(path.join(run.evidence, "probe-" + id + ".json"), result);
        results.push(result);
      } finally {
        globalThis.fetch = transport;
      }
    }
    writeJSON(path.join(run.evidence, "probes.json"), results);
    return { run_id: run.id, results, evidence: run.evidence };
  } finally {
    globalThis.fetch = transport;
    try {
      if (run) await stopDatabase(run.database);
    } finally {
      await d.closeStoppedCampaign();
    }
  }
}
