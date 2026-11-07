import { createHash } from "node:crypto";
import type {
  Guidance,
  GuidanceCommand,
  Receipt,
  TaskTargetResolution,
} from "../api/contracts.ts";
import {
  equalSnapshotContent,
  expandSnapshot,
  validateSnapshot,
  type DraftSnapshot,
} from "./draft.ts";
import { parseGuide } from "./guide-command.ts";
export type GuidanceEnvelope = {
  version: 1;
  id: string;
  domain: string;
  mode: string;
  path: string;
  target: TaskTargetResolution;
  body: GuidanceCommand;
  sha256: string;
  fingerprint: string;
  raw: string;
  snapshot: DraftSnapshot;
  generation: number;
  created_at: string;
  attempts: string[];
  cursor?: string;
  status:
    | "UNKNOWN"
    | "CONFLICT"
    | "ACCEPTED_VERIFICATION_PENDING"
    | "ACCEPTED_WITH_INTEGRITY_ERROR"
    | "ACCEPTED"
    | "NOT_ACCEPTED";
  receipt?: Receipt;
  guidance?: Guidance;
  error?: string;
};
export const guidanceHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export const guidanceFingerprint = (path: string, body: GuidanceCommand) =>
  guidanceHash(
    JSON.stringify([path, body.request_id, body.task_id, body.text]),
  );
export function validateGuidance(
  p: GuidanceEnvelope,
  domain: string,
  mode: string,
) {
  const cmd = parseGuide(p.raw);
  const uuid =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  validateSnapshot(p.snapshot);
  if (
    p.version !== 1 ||
    p.domain !== domain ||
    p.mode !== mode ||
    !uuid.test(p.id) ||
    !uuid.test(p.target.task_id) ||
    !uuid.test(p.target.execution_id) ||
    Object.keys(p.body).sort().join(",") !== "request_id,task_id,text" ||
    !Number.isFinite(Date.parse(p.created_at)) ||
    p.body.request_id !== p.id ||
    p.body.task_id !== p.target.task_id ||
    p.path !== `executions/${p.target.execution_id}/guidance` ||
    !cmd ||
    cmd.text !== p.body.text ||
    cmd.title !== p.target.title ||
    cmd.round !== p.target.execution_round ||
    expandSnapshot(p.snapshot) !== p.raw ||
    p.snapshot.damaged ||
    p.sha256 !== guidanceHash(p.body.text) ||
    p.fingerprint !== guidanceFingerprint(p.path, p.body) ||
    !Number.isSafeInteger(p.generation) ||
    !Array.isArray(p.attempts) ||
    p.attempts.some((x) => typeof x !== "string") ||
    ![
      "UNKNOWN",
      "CONFLICT",
      "ACCEPTED_VERIFICATION_PENDING",
      "ACCEPTED_WITH_INTEGRITY_ERROR",
      "ACCEPTED",
      "NOT_ACCEPTED",
    ].includes(p.status)
  )
    throw Error("INVALID_GUIDANCE_ENVELOPE");
  if (p.status.startsWith("ACCEPTED")) {
    const r = p.receipt,
      links = r?.resource_ids.filter((r) => r.type === "Guidance");
    if (
      !r ||
      r.request_id !== p.id ||
      r.command !== p.path ||
      r.acceptance !== "ACCEPTED" ||
      !["ACCEPTED", "COMPLETED"].includes(r.state) ||
      r.error_code ||
      links?.length !== 1
    )
      throw Error("INVALID_GUIDANCE_ACCEPTANCE");
    if (
      p.status === "ACCEPTED" &&
      (!p.guidance ||
        p.guidance.id !== links[0].id ||
        p.guidance.source !== "MASTER" ||
        p.guidance.task_id !== p.target.task_id ||
        p.guidance.execution_id !== p.target.execution_id ||
        p.guidance.text !== p.body.text)
    )
      throw Error("INVALID_GUIDANCE_ACCEPTED_DETAIL");
  } else if (p.receipt) throw Error("INVALID_GUIDANCE_ACCEPTANCE_STATE");
}
export function sameGuidanceDraft(
  p: GuidanceEnvelope,
  d: {
    raw: string;
    snapshot?: DraftSnapshot;
    generation: number;
    binding?: string;
  },
) {
  return (
    d.raw === p.raw &&
    equalSnapshotContent(d.snapshot, p.snapshot) &&
    (d.generation === p.generation || d.binding === p.id)
  );
}
