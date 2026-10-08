import { contentText } from "@earendil-works/pi-ai";
import type { SettingsApplication } from "./contracts.ts";
import type { AgentMessage } from "./model.ts";
import { messageIdentityHash } from "./message-identity.ts";
import type { SettingsSource } from "./settings-memory.ts";
import { hash, type Store } from "./store.ts";

export type ExtractionMessage = {
  id: string;
  text: string;
  role?: "user" | "assistant";
};
export const extractionSourceKey = (message: ExtractionMessage) =>
  hash(
    JSON.stringify({
      id: message.id,
      text: message.text,
      role: message.role ?? null,
    }),
  );

/** Recover pre-fix settings aliases from immutable, session-scoped evidence.
 * Read historical application snapshots because explicit retry clears source_ref.
 * Never infer identity from quote text alone. */
export function legacySettingsAliases(
  store: Store,
  sessionID: string,
  loopIDs: Set<string>,
) {
  const aliases = new Map<string, { keys: string[]; ambiguous: boolean }>();
  const applications = new Set(
    store
      .all<SettingsApplication>("SettingsApplication")
      .filter((app) => app.session_id === sessionID && loopIDs.has(app.id))
      .map((app) => app.id),
  );
  if (!applications.size) return aliases;
  const refs = new Map<
    string,
    NonNullable<SettingsApplication["source_ref"]>
  >();
  for (const frame of store.projectionFrames)
    for (const mutation of frame.mutations) {
      if (
        mutation.object_type !== "SettingsApplication" ||
        !applications.has(mutation.object_id)
      )
        continue;
      const app = store.read<SettingsApplication>(mutation.snapshot);
      if (app.source_ref && app.session_id === sessionID)
        refs.set(app.source_ref.sha256, app.source_ref);
    }
  const events = new Map(
    store.logs
      .filter(
        (e) =>
          e.event_type === "main.message" && e.scope.session_id === sessionID,
      )
      .map((e) => [e.event_id, e]),
  );
  for (const ref of refs.values()) {
    const source = store.read<SettingsSource>(ref);
    const messages = source.extraction_messages ?? [];
    const snapshots = messages.filter((m) => /^[a-f0-9]{64}:\d+$/.test(m.id));
    for (const digest of new Set(snapshots.map((m) => m.id.slice(0, 64)))) {
      const old = snapshots
        .filter((m) => m.id.startsWith(digest + ":"))
        .sort((a, b) => Number(a.id.slice(65)) - Number(b.id.slice(65)));
      const matched = messages
        .flatMap((m) => {
          const event = events.get(m.id);
          if (!event || event.sequence > source.end_sequence) return [];
          const raw = store.read<AgentMessage>(event.payload);
          return messageIdentityHash(raw) === digest &&
            (raw.role === "user" || raw.role === "assistant") &&
            m.role === raw.role &&
            m.text === contentText(raw.content)
            ? [{ message: m, sequence: event.sequence }]
            : [];
        })
        .sort((a, b) => a.sequence - b.sequence);
      // A partially retained identical-object snapshot cannot identify which
      // distinct event was attempted. Such legacy evidence needs explicit repair.
      const ambiguous = matched.length !== old.length;
      matched.forEach(({ message }, index) => {
        const candidates = ambiguous ? old : [old[index]];
        const keys = candidates
          .filter(
            (m): m is ExtractionMessage =>
              !!m && m.text === message.text && m.role === message.role,
          )
          .map(extractionSourceKey);
        if (!keys.length) return;
        const key = extractionSourceKey(message),
          prior = aliases.get(key);
        aliases.set(key, {
          keys: [...new Set([...(prior?.keys ?? []), ...keys])],
          ambiguous: ambiguous || !!prior?.ambiguous,
        });
      });
    }
  }
  return aliases;
}
