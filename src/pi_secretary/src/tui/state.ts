import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Page } from "./input.ts";
import {
  plainSnapshot,
  validateSnapshot,
  expandSnapshot,
  type DraftSnapshot,
} from "./draft.ts";

export type Draft = {
  raw: string;
  generation: number;
  binding?: string;
  snapshot?: DraftSnapshot;
};
export type Pending = {
  id: string;
  raw: string;
  body: { request_id: string; text: string };
  created_at: string;
  attempts: string[];
  cursor?: string;
  status: "UNKNOWN" | "CONFLICT" | "ACCEPTED";
  snapshot?: DraftSnapshot;
};
export type LocalState = {
  version: 1 | 2;
  domain: string;
  mode: string;
  drafts: Record<Page, Draft>;
  pending?: Pending;
  recovery?: { file: string; id: string };
};
export const freshState = (domain: string, mode: string): LocalState => ({
  version: 2,
  domain,
  mode,
  drafts: {
    Main: { raw: "", generation: 0 },
    Task: { raw: "", generation: 0 },
  },
});
export interface StatePersistence {
  save(state: LocalState): Promise<void>;
  recover(pending: Pending): Promise<string>;
}
/** Only async filesystem work; each immutable snapshot is serialized in order. */
export class LocalFiles implements StatePersistence {
  private tail: Promise<void> = Promise.resolve();
  private holder?: ChildProcessWithoutNullStreams;
  private owned = false;
  constructor(readonly directory: string) {}
  async open(domain: string, mode: string): Promise<LocalState> {
    try {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const stat = await fs.lstat(this.directory);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        stat.uid !== process.getuid?.() ||
        stat.mode & 0o077
      )
        throw Error("UNSAFE_TUI_DIRECTORY");
      this.holder = spawn(
        "python3",
        [
          fileURLToPath(new URL("./state-lock.py", import.meta.url)),
          this.directory,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("TUI_LOCK_TIMEOUT")), 3000);
        this.holder!.once("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        this.holder!.once("exit", () => {
          this.owned = false;
          clearTimeout(timer);
          reject(Error("TUI_STATE_ALREADY_OWNED"));
        });
        this.holder!.stdout.once("data", (chunk) => {
          clearTimeout(timer);
          if (String(chunk).trim() === "LOCKED") {
            this.owned = true;
            resolve();
          } else reject(Error("TUI_LOCK_FAILED"));
        });
      });
      this.holder.on("exit", () => {
        this.owned = false;
      });
      try {
        const filename = path.join(this.directory, "state.json"),
          st = await fs.lstat(filename);
        if (
          !st.isFile() ||
          st.isSymbolicLink() ||
          st.uid !== process.getuid?.() ||
          st.mode & 0o077
        )
          throw Error("UNSAFE_TUI_STATE");
        const original = await fs.readFile(filename, "utf8");
        const s = JSON.parse(original) as LocalState;
        if (
          ![1, 2].includes(s.version) ||
          s.domain !== domain ||
          s.mode !== mode ||
          !s.drafts ||
          ![s.drafts.Main, s.drafts.Task].every(
            (d) =>
              typeof d?.raw === "string" && Number.isSafeInteger(d.generation),
          )
        )
          throw Error("INVALID_TUI_STATE");
        if (
          s.pending &&
          (s.pending.body.request_id !== s.pending.id ||
            typeof s.pending.body.text !== "string" ||
            typeof s.pending.raw !== "string" ||
            !Array.isArray(s.pending.attempts))
        )
          throw Error("INVALID_PENDING_STATE");
        const legacy = s.version === 1;
        for (const d of Object.values(s.drafts)) {
          if (!d.snapshot) d.snapshot = plainSnapshot(d.raw);
          validateSnapshot(d.snapshot);
          if (!d.snapshot.damaged && expandSnapshot(d.snapshot) !== d.raw)
            throw Error("DRAFT_RAW_SNAPSHOT_MISMATCH");
        }
        if (s.pending) {
          if (!s.pending.snapshot)
            s.pending.snapshot = plainSnapshot(s.pending.raw);
          validateSnapshot(s.pending.snapshot);
          if (
            !s.pending.snapshot.damaged &&
            expandSnapshot(s.pending.snapshot) !== s.pending.raw
          )
            throw Error("PENDING_RAW_SNAPSHOT_MISMATCH");
        }
        if (legacy) {
          await this.atomic(`v1-before-upgrade-${randomUUID()}.json`, original);
          s.version = 2;
          await this.save(s);
        }
        return s;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT")
          return freshState(domain, mode);
        throw e;
      }
    } catch (e) {
      await this.close();
      throw e;
    }
  }
  save(state: LocalState) {
    // Strings are immutable. Detach mutable metadata now, then encode bounded
    // chunks between async writes instead of blocking input on a 64 MiB stringify.
    const copySnapshot = (s: DraftSnapshot): DraftSnapshot => ({
      ...s,
      cursor: { ...s.cursor },
      ranges: s.ranges.map((r) => ({ ...r })),
      blocks: Object.fromEntries(
        Object.entries(s.blocks).map(([id, block]) => [id, { ...block }]),
      ),
    });
    const snapshot: LocalState = {
      ...state,
      version: 2,
      drafts: Object.fromEntries(
        Object.entries(state.drafts).map(([page, draft]) => [
          page,
          {
            ...draft,
            snapshot: copySnapshot(draft.snapshot ?? plainSnapshot(draft.raw)),
          },
        ]),
      ) as Record<Page, Draft>,
      ...(state.pending
        ? {
            pending: {
              ...state.pending,
              body: { ...state.pending.body },
              attempts: [...state.pending.attempts],
              snapshot: copySnapshot(
                state.pending.snapshot ?? plainSnapshot(state.pending.raw),
              ),
            },
          }
        : {}),
      ...(state.recovery ? { recovery: { ...state.recovery } } : {}),
    };
    const job = this.tail
      .catch(() => {})
      .then(() => this.atomic("state.json", snapshot));
    this.tail = job;
    return job;
  }
  async recover(p: Pending) {
    const file = `recovery-${randomUUID()}.json`;
    await this.atomic(
      file,
      JSON.stringify({
        created_at: p.created_at,
        raw: p.raw,
        body: p.body,
        id: p.id,
        snapshot: p.snapshot ?? plainSnapshot(p.raw),
      }),
    );
    return file;
  }
  private async atomic(name: string, bytes: string | LocalState) {
    if (!this.owned) throw Error("TUI_STATE_LOCK_LOST");
    const tmp = path.join(this.directory, `.tmp-${randomUUID()}`),
      target = path.join(this.directory, name);
    const h = await fs.open(tmp, "wx", 0o600);
    try {
      if (typeof bytes === "string") await h.writeFile(bytes);
      else for (const chunk of jsonChunks(bytes)) await h.writeFile(chunk);
      await h.sync();
    } finally {
      await h.close();
    }
    if (!this.owned) throw Error("TUI_STATE_LOCK_LOST");
    await fs.rename(tmp, target);
    const dir = await fs.open(this.directory, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }
  async collect(state: LocalState, now = new Date()) {
    // Only owned recovery/temp names; preserve current references and unknown data.
    for (const file of await fs.readdir(this.directory)) {
      const temporary = /^\.tmp-[a-f0-9-]+$/.test(file);
      if (
        (!temporary && !/^recovery-[a-f0-9-]+\.json$/.test(file)) ||
        file === state.recovery?.file
      )
        continue;
      const full = path.join(this.directory, file),
        st = await fs.lstat(full);
      if (!st.isFile() || st.isSymbolicLink()) continue;
      try {
        const r = JSON.parse(await fs.readFile(full, "utf8"));
        if (
          state.pending &&
          (state.pending.id === r.id || state.pending.id === r.pending?.id)
        )
          continue;
        if (
          temporary &&
          state.recovery &&
          (state.recovery.id === r.id || state.recovery.id === r.recovery?.id)
        )
          continue;
        if (
          temporary &&
          !(
            ([1, 2].includes(r.version) && r.drafts) ||
            (typeof r.raw === "string" && r.body)
          )
        )
          continue;
        if (expired(temporary ? st.mtime.toISOString() : r.created_at, now))
          await fs.unlink(full);
      } catch {
        /* Unknown/corrupt material is preserved, not declared expired. */
      }
    }
  }
  async close() {
    await this.tail.catch(() => {});
    this.owned = false;
    const holder = this.holder;
    this.holder = undefined;
    if (holder && holder.pid && holder.exitCode === null) {
      await new Promise<void>((resolve) => {
        holder.once("close", () => resolve());
        holder.stdin.end();
      });
    }
  }
}
/** JSON string chunks may split a surrogate pair: escaped halves round-trip exactly. */
function* jsonChunks(value: unknown): Generator<string> {
  if (typeof value === "string") {
    yield '"';
    for (let offset = 0; offset < value.length; offset += 65536)
      yield JSON.stringify(value.slice(offset, offset + 65536)).slice(1, -1);
    yield '"';
  } else if (Array.isArray(value)) {
    yield "[";
    for (let index = 0; index < value.length; index++) {
      if (index) yield ",";
      yield* jsonChunks(value[index] ?? null);
    }
    yield "]";
  } else if (value && typeof value === "object") {
    yield "{";
    let first = true;
    for (const [key, member] of Object.entries(value))
      if (member !== undefined) {
        if (!first) yield ",";
        first = false;
        yield JSON.stringify(key) + ":";
        yield* jsonChunks(member);
      }
    yield "}";
  } else yield JSON.stringify(value) ?? "null";
}
/** Export current content, never use a stale upgrade backup as a rollback shortcut. */
export function exportLegacyState(state: LocalState): LocalState {
  for (const draft of Object.values(state.drafts))
    if (draft.snapshot) {
      validateSnapshot(draft.snapshot);
      if (expandSnapshot(draft.snapshot) !== draft.raw)
        throw Error("DRAFT_RAW_SNAPSHOT_MISMATCH");
    }
  const { snapshot: _pendingSnapshot, ...pending } = state.pending ?? {};
  return {
    ...state,
    version: 1,
    drafts: Object.fromEntries(
      Object.entries(state.drafts).map(([page, { snapshot: _, ...draft }]) => [
        page,
        draft,
      ]),
    ) as Record<Page, Draft>,
    ...(state.pending ? { pending: pending as Pending } : {}),
  };
}
export function expired(created: string, now: Date) {
  const date = new Date(created);
  if (!Number.isFinite(+date)) return false;
  const month = date.getUTCMonth(),
    day = date.getUTCDate();
  date.setUTCFullYear(date.getUTCFullYear() + 3);
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return +date <= +now && day > 0;
}
