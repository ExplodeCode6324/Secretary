import { Store, base, id } from "./store.ts";
import type { CoreIdentity, AssistantProfile } from "./contracts.ts";
export const IDENTITY = "995e1b45-b9e8-43e7-b0df-460814f2c7f1";
export const PROFILE = "1c5e07dd-0519-4266-8208-b00e9cbd997a";
export function coreIdentity(store: Store): CoreIdentity {
  const prior = store.find<CoreIdentity>("CoreIdentity", IDENTITY);
  if (prior) return prior;
  const value: CoreIdentity = {
    ...base(IDENTITY),
    schema_version: 1,
    record_type: "CoreIdentity",
    owner_id: id(),
  };
  store.commit([value]);
  return value;
}
export function assistantProfile(store: Store): AssistantProfile {
  const prior = store.find<AssistantProfile>("AssistantProfile", PROFILE);
  if (prior) return prior;
  const value: AssistantProfile = {
    ...base(PROFILE),
    schema_version: 1,
    record_type: "AssistantProfile",
    name: "",
  };
  store.commit([value]);
  return value;
}
