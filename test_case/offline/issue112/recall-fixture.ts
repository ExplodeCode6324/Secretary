import { stableID } from "../../../src/pi_secretary/src/execution-utils.ts";
import type {
  WorldSnapshot,
  FactView,
} from "../../../src/pi_secretary/src/world-recall.ts";
import type { WorldEntity } from "../../../src/pi_secretary/src/contracts.ts";
export const asOf = "2026-11-12T00:00:00.000Z";
export const fid = (name: string) => stableID("probe:" + name);
export function recallFixture(): WorldSnapshot {
  const entity = (
    name: string,
    kind: WorldEntity["kind"] = "PERSON",
    aliases: string[] = [],
    role: WorldEntity["role"] = null,
  ): WorldEntity => ({
    schema_version: 1,
    record_type: "WorldEntity",
    id: fid(name),
    revision: 1,
    updated_at: asOf,
    kind,
    display_name: name,
    aliases,
    role,
    external_key: null,
    retired_at: null,
  });
  const entities = [
    entity("Master", "PERSON", ["老板"], "MASTER"),
    entity("Secretary", "SERVICE", [], "SECRETARY"),
    entity("Alice", "PERSON", ["小艾", "Researcher"]),
    entity("Bob", "PERSON", ["小波", "Researcher"]),
    entity("Atlas", "PROJECT", ["星图"]),
    entity("Orion", "SERVICE", ["猎户"]),
    entity("Cedar", "ORGANIZATION", ["雪松组织"]),
  ];
  const facts: FactView[] = [];
  const fact = (
    key: string,
    subject: string,
    predicate_key: string,
    value: unknown,
    patch: Partial<FactView> = {},
  ) =>
    facts.push({
      schema_version: 1,
      record_type: "WorldAssertion",
      id: fid(key),
      revision: 1,
      updated_at: asOf,
      subject_id: fid(subject),
      predicate_key,
      topic: "other",
      value,
      object_entity_id: null,
      keywords: [],
      source_kind: "MASTER",
      evidence_event_ids: [fid("evidence")],
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_to: null,
      observed_at: "2026-11-01T00:00:00.000Z",
      fresh_until: null,
      note: null,
      status: "LIVE",
      replaces_id: null,
      change_id: fid("change:" + key),
      evidence_status: "ACTIVE",
      stale: false,
      ...patch,
    });
  fact(
    "tea",
    "Alice",
    "preference.statement",
    "Prefers tea; does not drink coffee",
    { keywords: ["beverage", "茶饮"] },
  );
  fact("quiet", "Bob", "preference.statement", "Quiet work without music", {
    keywords: ["安静", "focus"],
  });
  fact("atlas", "Atlas", "project.constraint", "Do not publish draft maps", {
    keywords: ["map", "地图", "保密"],
  });
  fact("orion", "Orion", "resource.location", "North lab", {
    keywords: ["北实验室"],
  });
  fact("cedar", "Cedar", "entity.note", "Organization researches forests", {
    keywords: ["forest", "森林"],
  });
  fact("member", "Alice", "person.member_of", null, {
    object_entity_id: fid("Cedar"),
  });
  fact("depends", "Atlas", "resource.depends_on", null, {
    object_entity_id: fid("Orion"),
  });
  fact("old", "Alice", "preference.statement", "Drinks coffee", {
    status: "SUPERSEDED",
  });
  fact("retracted", "Bob", "preference.statement", "Enjoys loud music", {
    status: "RETRACTED",
  });
  fact("future", "Alice", "preference.statement", "Future appointment", {
    valid_from: "2030-01-01T00:00:00.000Z",
  });
  fact("expired", "Bob", "preference.statement", "Expired assignment", {
    valid_to: "2026-02-01T00:00:00.000Z",
  });
  fact("withdrawn", "Alice", "entity.note", "Withdrawn private report", {
    evidence_status: "EVIDENCE_WITHDRAWN",
  });
  fact(
    "stale",
    "Orion",
    "resource.observed_state",
    { state: "offline" },
    {
      fresh_until: "2026-02-01T00:00:00.000Z",
      observed_at: "2026-01-01T00:00:00.000Z",
      stale: true,
      source_kind: "OBSERVATION",
    },
  );
  fact("conflict-a", "Master", "entity.guideline", "Use English", {
    topic: "communication",
  });
  fact("conflict-b", "Master", "entity.guideline", "Use Chinese", {
    topic: "communication",
  });
  return { ready: true, entities, facts };
}
