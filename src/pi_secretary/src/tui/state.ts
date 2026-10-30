import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Page } from "./input.ts";

export type Draft = { raw: string; generation: number; binding?: string };
export type Pending = {
  id: string;
  raw: string;
  body: { request_id: string; text: string };
  created_at: string;
  attempts: string[];
  cursor?: string;
  status: "UNKNOWN" | "CONFLICT" | "ACCEPTED";
};
export type LocalState = {
  version: 1;
  domain: string;
  mode: string;
  drafts: Record<Page, Draft>;
  pending?: Pending;
  recovery?: { file: string; id: string };
};
export const freshState = (domain: string, mode: string): LocalState => ({
  version: 1,
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
        const s = JSON.parse(await fs.readFile(filename, "utf8")) as LocalState;
        if (
          s.version !== 1 ||
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
    const bytes = JSON.stringify(state);
    const job = this.tail
      .catch(() => {})
      .then(() => this.atomic("state.json", bytes));
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
      }),
    );
    return file;
  }
  private async atomic(name: string, bytes: string) {
    if (!this.owned) throw Error("TUI_STATE_LOCK_LOST");
    const tmp = path.join(this.directory, `.tmp-${randomUUID()}`),
      target = path.join(this.directory, name);
    const h = await fs.open(tmp, "wx", 0o600);
    try {
      await h.writeFile(bytes);
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
            (r.version === 1 && r.drafts) ||
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
export function expired(created: string, now: Date) {
  const date = new Date(created);
  if (!Number.isFinite(+date)) return false;
  const month = date.getUTCMonth(),
    day = date.getUTCDate();
  date.setUTCFullYear(date.getUTCFullYear() + 3);
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return +date <= +now && day > 0;
}
