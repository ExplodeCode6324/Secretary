import { requireThat } from "./io.ts";
import { modelIDs, type ModelID, type Profile } from "./live-model.ts";
export type LiveConfiguration = {
  version: 1;
  mode: "live";
  track: "memory";
  case_id: string;
  seed: number;
  model: ModelID;
  profile: Profile;
  max_sends: number;
  fault_injection?: "write-after-fsync";
  fault_path?: string;
};
export function validateLiveConfiguration(c: LiveConfiguration) {
  const keys = [
    "version",
    "mode",
    "track",
    "case_id",
    "seed",
    "model",
    "profile",
    "max_sends",
    "fault_injection",
    "fault_path",
  ];
  requireThat(
    Object.keys(c).every((k) => keys.includes(k)) &&
      c.version === 1 &&
      c.mode === "live" &&
      c.track === "memory" &&
      /^[A-Za-z0-9_-]{1,100}$/.test(c.case_id) &&
      Number.isSafeInteger(c.seed) &&
      modelIDs.includes(c.model) &&
      ["RC", "DEP"].includes(c.profile) &&
      Number.isSafeInteger(c.max_sends) &&
      c.max_sends > 0 &&
      c.max_sends <= 160,
    "CONFIG_UNSUPPORTED_ISSUE121_LIVE",
  );
  requireThat(
    c.fault_injection === undefined
      ? c.fault_path === undefined
      : c.fault_injection === "write-after-fsync" &&
          typeof c.fault_path === "string" &&
          /^[a-zA-Z0-9_-]+\.txt$/.test(c.fault_path),
    "INVALID_LIVE_FAULT_TARGET",
  );
}
