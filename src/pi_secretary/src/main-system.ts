import { composeInstructions, FAILURE_SYSTEM } from "./instructions.ts";
import { worldSnapshot, profiles, recall } from "./world-recall.ts";
import { now, type Store } from "./store.ts";
export function assembleMainSystem(
  store: Store,
  instructions: string,
  scopes: string,
  input = "",
  failure = false,
) {
  const at = now(),
    snapshot = worldSnapshot(store, at);
  const profileMode = process.env.SECRETARY_WORLD_PROFILE ?? "on",
    recallMode = process.env.SECRETARY_WORLD_RECALL ?? "shadow";
  if (
    !["on", "off"].includes(profileMode) ||
    !["off", "shadow", "on"].includes(recallMode)
  )
    throw Error("INVALID_WORLD_CONTEXT_MODE");
  const profile =
    profileMode === "on" && snapshot.ready
      ? profiles(snapshot, at)
      : { text: "", fact_ids: [] };
  const recalled = recall(
    snapshot,
    input,
    { exclude_ids: profile.fact_ids },
    at,
  );
  const system =
    composeInstructions(instructions) +
    (profile.text
      ? "\n\n<derived-world-profile>\n" +
        profile.text +
        "\n</derived-world-profile>"
      : "") +
    scopes +
    (failure ? "\n\n" + FAILURE_SYSTEM : "") +
    (recallMode === "on" && recalled.text
      ? "\n\n<world-recall-data>\n" + recalled.text + "\n</world-recall-data>"
      : "");
  return {
    system,
    recall: {
      ...recalled,
      profile_ids: profile.fact_ids,
      profile_mode: profileMode,
      recall_mode: recallMode,
    },
  };
}
