import { shapeDefinition } from "./store.ts";
export type WorldEdit = {
  kind: "FACT" | "ENTITY";
  expected_revision: number;
  entity_id?: string;
  entity_kind?:
    | "PERSON"
    | "ORGANIZATION"
    | "PROJECT"
    | "DEVICE"
    | "SERVICE"
    | "RESOURCE"
    | "GOAL";
  display_name?: string;
  external_key?: string | null;
  retire?: boolean;
  mode?: "ASSERT" | "CORRECT" | "RETRACT";
  subject_id?: string;
  predicate_key?: string;
  scope_key?: string;
  assertion_id?: string;
  value?: unknown;
  object_entity_id?: string | null;
  valid_from?: string;
  valid_to?: string | null;
  fresh_until?: string | null;
  resolve_conflict_id?: string | null;
  resolution_note?: string | null;
};
export type SettingsPayload = {
  instructions: { content: string; expected_revision: number } | null;
  edits: WorldEdit[];
  command_ids: string[];
};
export const emptySettings = (): SettingsPayload => ({
  instructions: null,
  edits: [],
  command_ids: [],
});
export function validatePayload(
  value: unknown,
): asserts value is SettingsPayload {
  shapeDefinition("SettingsPayload", value);
}
