import { fingerprint } from "./source.ts";
// Durable accounting belongs to each sender, not to the short-lived CLI or a checkpoint.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  appendJSON,
  lease,
  read,
  readJSON,
  repository,
  requireThat,
  sha,
  writeJSON,
} from "./io.ts";

type FinalLedger = {
  hash: string;
  sequence: number;
  attempts: number;
  unsettled: number;
  charged_usd: number;
};
export type Campaign = {
  version: 1;
  approval_id: string;
  facility: string;
  state: "OPEN" | "CLOSED";
  ceiling_usd: number | null;
  created_at: string;
  source?: ReturnType<typeof fingerprint>;
  closed_at?: string;
  final_ledger?: FinalLedger;
};
type ClosedCampaign = Campaign & {
  state: "CLOSED";
  closed_at: string;
  final_ledger: FinalLedger;
};
export type Attempt = {
  id: string;
  model: string;
  run: string;
  episode?: string;
  request_sha256: string;
  reserved_usd: number;
  at: string;
  pid: number;
};
type Event =
  | { type: "RESERVE"; attempt: Attempt }
  | {
      type: "SETTLE";
      id: string;
      at: string;
      actual_usd: number | null;
      outcome: string;
      usage: unknown;
    };

async function locked<T>(root: string, fn: () => Promise<T>) {
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      return await lease(root, fn, "campaign.lock");
    } catch (e) {
      if (
        !(e instanceof Error) ||
        e.message !== "CONTROLLER_BUSY" ||
        Date.now() >= deadline
      )
        throw e;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
}
const directory = (root: string) => path.join(root, "campaign");
export function loadCampaign(root: string): Campaign {
  const c = readJSON(path.join(directory(root), "manifest.json")) as Campaign;
  requireThat(
    c.version === 1 &&
      /^[a-zA-Z0-9_-]{1,100}$/.test(c.approval_id) &&
      c.facility === root &&
      ["OPEN", "CLOSED"].includes(c.state),
    "CAMPAIGN_INVALID",
  );
  requireThat(
    c.ceiling_usd === null ||
      (Number.isFinite(c.ceiling_usd) && c.ceiling_usd > 0),
    "CAMPAIGN_INVALID_CEILING",
  );
  return c;
}
export function ledger(root: string) {
  const file = path.join(directory(root), "attempts.jsonl");
  const entries = new Map<
    string,
    {
      attempt: Attempt;
      settled: boolean;
      charged_usd: number;
      outcome?: string;
    }
  >();
  let previous = "0".repeat(64),
    sequence = 0;
  if (fs.existsSync(file)) {
    const bytes = read(file).toString();
    requireThat(bytes.endsWith("\n"), "CAMPAIGN_PARTIAL_LEDGER");
    for (const line of bytes.trimEnd().split("\n")) {
      const frame = JSON.parse(line);
      requireThat(
        frame.sequence === ++sequence &&
          frame.previous === previous &&
          frame.hash === sha(JSON.stringify(frame.event) + previous + sequence),
        "CAMPAIGN_CORRUPT_LEDGER",
      );
      previous = frame.hash;
      const event = frame.event as Event;
      if (event.type === "RESERVE") {
        requireThat(
          !entries.has(event.attempt.id) &&
            Number.isFinite(event.attempt.reserved_usd) &&
            event.attempt.reserved_usd >= 0,
          "CAMPAIGN_INVALID_RESERVATION",
        );
        entries.set(event.attempt.id, {
          attempt: event.attempt,
          settled: false,
          charged_usd: event.attempt.reserved_usd,
        });
      } else {
        requireThat(event.type === "SETTLE", "CAMPAIGN_UNKNOWN_EVENT");
        const item = entries.get(event.id);
        requireThat(item && !item.settled, "CAMPAIGN_INVALID_SETTLEMENT");
        requireThat(
          event.actual_usd === null ||
            (Number.isFinite(event.actual_usd) && event.actual_usd >= 0),
          "CAMPAIGN_INVALID_COST",
        );
        item.settled = true;
        item.charged_usd = event.actual_usd ?? item.attempt.reserved_usd;
        item.outcome = event.outcome;
      }
    }
  }
  return {
    entries,
    previous,
    sequence,
    charged_usd: [...entries.values()].reduce(
      (sum, v) => sum + v.charged_usd,
      0,
    ),
  };
}
function append(root: string, event: Event) {
  const { previous, sequence } = ledger(root);
  appendJSON(path.join(directory(root), "attempts.jsonl"), {
    sequence: sequence + 1,
    previous,
    event,
    hash: sha(JSON.stringify(event) + previous + (sequence + 1)),
  });
}
export async function createCampaign(
  root: string,
  approvalID: string,
  ceiling: number | null,
) {
  requireThat(
    /^[a-zA-Z0-9_-]{1,100}$/.test(approvalID),
    "CAMPAIGN_APPROVAL_ID",
  );
  requireThat(
    ceiling === null || (Number.isFinite(ceiling) && ceiling > 0),
    "CAMPAIGN_INVALID_CEILING",
  );
  const source = fingerprint();
  // A new facility cannot reset the same approval's ceiling.
  const registry = path.join(repository, ".local/benchmark/.campaign-registry");
  return locked(registry, async () => {
    const registration = path.join(registry, approvalID + ".json");
    requireThat(
      !fs.existsSync(registration),
      "CAMPAIGN_APPROVAL_ALREADY_BOUND",
    );
    requireThat(
      !fs.existsSync(path.join(directory(root), "manifest.json")),
      "CAMPAIGN_EXISTS",
    );
    const c: Campaign = {
      version: 1,
      source,
      approval_id: approvalID,
      facility: root,
      state: "OPEN",
      ceiling_usd: ceiling,
      created_at: new Date().toISOString(),
    };
    // A crash after binding fails closed; never silently rebind to a different root.
    writeJSON(registration, c);
    writeJSON(path.join(directory(root), "manifest.json"), c);
    return c;
  });
}
export function assertCampaignSource(root: string) {
  const c = loadCampaign(root);
  requireThat(c.state === "OPEN", "CAMPAIGN_CLOSED");
  requireThat(
    c.source && JSON.stringify(c.source) === JSON.stringify(fingerprint()),
    "CAMPAIGN_SOURCE_CHANGED",
  );
  return c;
}
export async function reserve(
  root: string,
  details: Omit<Attempt, "id" | "at" | "pid">,
  maxSends?: number,
) {
  return locked(directory(root), async () => {
    const campaign = assertCampaignSource(root),
      current = ledger(root);
    requireThat(campaign.state === "OPEN", "CAMPAIGN_CLOSED");
    if (maxSends !== undefined)
      requireThat(
        [...current.entries.values()].filter(
          (v) =>
            (v.attempt.episode ?? v.attempt.run) ===
            (details.episode ?? details.run),
        ).length < maxSends,
        "EPISODE_SEND_LIMIT",
      );
    requireThat(
      Number.isFinite(details.reserved_usd) && details.reserved_usd >= 0,
      "CAMPAIGN_INVALID_RESERVATION",
    );
    requireThat(
      campaign.ceiling_usd === null ||
        current.charged_usd + details.reserved_usd <= campaign.ceiling_usd,
      "CAMPAIGN_BUDGET_EXHAUSTED",
    );
    const attempt: Attempt = {
      ...details,
      id: randomUUID(),
      at: new Date().toISOString(),
      pid: process.pid,
    };
    append(root, { type: "RESERVE", attempt });
    return attempt.id;
  });
}
export async function settle(
  root: string,
  id: string,
  outcome: string,
  usage: unknown,
  actualUSD: number | null,
) {
  return locked(directory(root), async () => {
    requireThat(loadCampaign(root).state === "OPEN", "CAMPAIGN_CLOSED");
    const item = ledger(root).entries.get(id);
    requireThat(item && !item.settled, "CAMPAIGN_INVALID_SETTLEMENT");
    requireThat(
      actualUSD === null || (Number.isFinite(actualUSD) && actualUSD >= 0),
      "CAMPAIGN_INVALID_COST",
    );
    append(root, {
      type: "SETTLE",
      id,
      at: new Date().toISOString(),
      actual_usd: actualUSD,
      outcome,
      usage,
    });
  });
}
export async function closeCampaign(root: string): Promise<ClosedCampaign> {
  return locked(directory(root), async () => {
    const c = loadCampaign(root);
    if (c.state === "CLOSED" && c.final_ledger) {
      assertCampaignClosed(root);
      requireThat(
        typeof c.closed_at === "string" &&
          Number.isFinite(Date.parse(c.closed_at)),
        "CAMPAIGN_CLOSURE_INVALID",
      );
      return c as ClosedCampaign;
    }
    // Never discard orphan reservations: uncertain sends remain charged at full cost.
    const current = ledger(root);
    const closed = {
      ...c,
      state: "CLOSED" as const,
      closed_at: new Date().toISOString(),
      final_ledger: {
        hash: current.previous,
        sequence: current.sequence,
        attempts: current.entries.size,
        unsettled: [...current.entries.values()].filter((e) => !e.settled)
          .length,
        charged_usd: current.charged_usd,
      },
    };
    const registry = path.join(
      repository,
      ".local/benchmark/.campaign-registry",
    );
    const registration = path.join(registry, c.approval_id + ".json");
    if (fs.existsSync(registration))
      await locked(registry, async () => {
        const registered = readJSON(registration);
        requireThat(
          registered.facility === root &&
            registered.approval_id === c.approval_id,
          "CAMPAIGN_REGISTRY_MISMATCH",
        );
        writeJSON(registration, closed);
      });
    writeJSON(path.join(directory(root), "manifest.json"), closed);
    return closed;
  });
}
export function assertCampaignClosed(root: string) {
  if (fs.existsSync(path.join(directory(root), "manifest.json"))) {
    const c = loadCampaign(root);
    requireThat(c.state === "CLOSED", "CAMPAIGN_OPEN");
    const current = ledger(root),
      final = c.final_ledger;
    if (final)
      requireThat(
        final.hash === current.previous &&
          final.sequence === current.sequence &&
          final.attempts === current.entries.size &&
          final.charged_usd === current.charged_usd &&
          final.unsettled ===
            [...current.entries.values()].filter((e) => !e.settled).length,
        "CAMPAIGN_FINAL_LEDGER_CHANGED",
      );
  }
}
