import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repository = fs.realpathSync(
  fileURLToPath(new URL("../../../", import.meta.url)),
);
export const sha = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export function requireThat(value: unknown, code: string): asserts value {
  if (!value) throw Error(code);
}
export const inside = (root: string, p: string) =>
  p === root || p.startsWith(root + path.sep);
export function noLinks(p: string) {
  requireThat(
    path.isAbsolute(p) && path.resolve(p) === p,
    "NON_CANONICAL_PATH",
  );
  for (let q = p; ; q = path.dirname(q)) {
    try {
      requireThat(!fs.lstatSync(q).isSymbolicLink(), "SYMLINK_PATH");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (q === path.dirname(q)) break;
  }
}
export function deploymentGuard(
  repo: string,
  root = path.join(repo, ".local/benchmark"),
) {
  noLinks(repo);
  noLinks(root);
  const agile = "/Users/muy/Desktop/secretary-agile";
  requireThat(
    !inside(agile, repo) && !inside(repo, agile),
    "PROTECTED_AGILE_CHECKOUT",
  );
  requireThat(
    inside(path.join(repo, ".local/benchmark"), root),
    "OUTSIDE_BENCHMARK_ROOT",
  );
  for (const marker of [
    "data/core/journal.jsonl",
    ".local/runtime.json",
    ".local/maintenance.json",
  ])
    requireThat(
      !fs.existsSync(path.join(repo, marker)),
      "PERSISTENT_DEPLOYMENT",
    );
  const local = path.join(repo, ".local");
  if (fs.existsSync(local))
    for (const entry of fs.readdirSync(local)) {
      if (entry.endsWith(".plist"))
        requireThat(
          !read(path.join(local, entry))
            .toString()
            .includes("com.secretary.agile"),
          "PERSISTENT_DEPLOYMENT",
        );
    }
}
export function mkdir(p: string) {
  noLinks(p);
  fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  requireThat(fs.statSync(p).uid === process.getuid?.(), "FOREIGN_DIRECTORY");
}
export function read(p: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    noLinks(p);
    const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd);
      // writeJSON may atomically replace the pathname between open and fstat.
      // Never consume the now-unlinked inode: reopen and revalidate the path.
      if (st.isFile() && st.nlink === 0) continue;
      requireThat(st.isFile() && st.nlink === 1, "UNSAFE_FILE");
      return fs.readFileSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  throw Error("ATOMIC_READ_CONTENTION");
}
export function readJSON<T = any>(p: string): T {
  return JSON.parse(read(p).toString());
}
export function syncDir(p: string) {
  const fd = fs.openSync(p, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
export function writeJSON(p: string, value: unknown) {
  noLinks(p);
  mkdir(path.dirname(p));
  if (fs.existsSync(p))
    requireThat(
      fs.lstatSync(p).isFile() && fs.statSync(p).nlink === 1,
      "UNSAFE_OUTPUT",
    );
  const tmp = p + ".tmp-" + randomUUID();
  const fd = fs.openSync(
    tmp,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, p);
  syncDir(path.dirname(p));
}
export function appendJSON(p: string, value: unknown) {
  noLinks(p);
  const fd = fs.openSync(
    p,
    fs.constants.O_WRONLY |
      fs.constants.O_APPEND |
      fs.constants.O_CREAT |
      fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    requireThat(fs.fstatSync(fd).nlink === 1, "UNSAFE_LEDGER");
    fs.writeFileSync(fd, JSON.stringify(value) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
export type FileEntry = {
  path: string;
  kind: "file" | "directory";
  bytes: number;
  sha256: string;
  mode: number;
};
export function inventory(
  root: string,
  exclude = new Set<string>(),
): FileEntry[] {
  noLinks(root);
  const entries: FileEntry[] = [];
  function walk(dir: string) {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name),
        relative = path.relative(root, p);
      if (exclude.has(relative)) continue;
      const st = fs.lstatSync(p);
      requireThat(!st.isSymbolicLink(), "SYMLINK_TREE");
      if (st.isDirectory()) {
        entries.push({
          path: relative,
          kind: "directory",
          bytes: 0,
          sha256: "",
          mode: st.mode & 0o777,
        });
        walk(p);
      } else {
        requireThat(st.isFile() && st.nlink === 1, "UNSAFE_TREE_ENTRY");
        entries.push({
          path: relative,
          kind: "file",
          bytes: st.size,
          sha256: sha(read(p)),
          mode: st.mode & 0o777,
        });
      }
    }
  }
  walk(root);
  return entries;
}
export function copyTree(
  source: string,
  destination: string,
  entries: FileEntry[],
) {
  requireThat(!fs.existsSync(destination), "DESTINATION_EXISTS");
  mkdir(destination);
  for (const entry of entries) {
    requireThat(
      !path.isAbsolute(entry.path) &&
        !entry.path.split(path.sep).includes(".."),
      "INVALID_MANIFEST_PATH",
    );
    const src = path.join(source, entry.path),
      dest = path.join(destination, entry.path);
    if (entry.kind === "directory") {
      noLinks(src);
      requireThat(fs.statSync(src).isDirectory(), "SOURCE_CHANGED");
      mkdir(dest);
      fs.chmodSync(dest, entry.mode);
      continue;
    }
    const bytes = read(src);
    requireThat(
      sha(bytes) === entry.sha256 && bytes.length === entry.bytes,
      "SOURCE_CHANGED",
    );
    mkdir(path.dirname(dest));
    fs.writeFileSync(dest, bytes, { flag: "wx", mode: entry.mode });
    fs.chmodSync(dest, entry.mode);
    const fd = fs.openSync(dest, "r");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  }
  syncDir(destination);
  const actual = inventory(destination);
  requireThat(
    JSON.stringify(actual.map(({ mode, ...e }) => e)) ===
      JSON.stringify(entries.map(({ mode, ...e }) => e)),
    "COPY_HASH_MISMATCH",
  );
}
export function cleanEnvironment(tmp: string): NodeJS.ProcessEnv {
  return {
    PATH: [
      path.dirname(process.execPath),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ].join(":"),
    LANG: "C.UTF-8",
    TZ: "UTC",
    TMPDIR: tmp,
    PYTHONDONTWRITEBYTECODE: "1",
  };
}
export function binary(name: string): string {
  for (const base of (process.env.PATH ?? "").split(path.delimiter)) {
    const p = path.join(base, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return fs.realpathSync(p);
    } catch {
      /* next */
    }
  }
  throw Error("MISSING_BINARY_" + name);
}
export async function lease<T>(root: string, fn: () => Promise<T>): Promise<T> {
  mkdir(root);
  const child = spawn(
    binary("python3"),
    [
      path.join(repository, "test_case/online/benchmark/lease.py"),
      path.join(root, "controller.lock"),
    ],
    { env: cleanEnvironment(root), stdio: ["pipe", "pipe", "pipe"] },
  );
  const exit = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  await new Promise<void>((resolve, reject) => {
    let ready = false;
    child.stdout.once("data", (data) => {
      ready = String(data).trim() === "LOCKED";
      ready ? resolve() : reject(Error("LEASE_PROTOCOL"));
    });
    child.once("error", reject);
    child.once("exit", () => {
      if (!ready) reject(Error("CONTROLLER_BUSY"));
    });
  });
  try {
    return await fn();
  } finally {
    child.stdin.end();
    await exit;
  }
}
export function processIdentity(pid: number, token: string) {
  return JSON.parse(
    execFileSync(
      binary("python3"),
      [
        path.join(repository, "test_case/online/benchmark/identity.py"),
        String(pid),
        token,
      ],
      { encoding: "utf8", env: cleanEnvironment("/tmp") },
    ),
  );
}
export function processStatus(
  record: any,
  signal?: "term" | "kill",
): "STOPPED" | "RUNNING" | "UNCONFIRMED" {
  try {
    return JSON.parse(
      execFileSync(
        binary("python3"),
        [
          path.join(repository, "src/pi_secretary/src/process-runner.py"),
          signal ? "--" + signal : "--probe",
        ],
        {
          input: JSON.stringify(record),
          encoding: "utf8",
          env: cleanEnvironment("/tmp"),
          timeout: 5000,
        },
      ),
    ).status;
  } catch {
    return "UNCONFIRMED";
  }
}
export async function stopOwned(record: any) {
  for (const signal of ["term", "kill"] as const) {
    const status = processStatus(record);
    if (status !== "RUNNING") return status;
    processStatus(record, signal);
    await until(() => processStatus(record) === "STOPPED", 2500).catch(
      () => {},
    );
  }
  return processStatus(record);
}
export async function until(
  check: () => boolean | Promise<boolean>,
  timeout = 20000,
) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    requireThat(Date.now() < end, "WAIT_TIMEOUT");
    await new Promise((r) => setTimeout(r, 30));
  }
}
