import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { CoreClient } from "../core-client.ts";
import type { Artifact } from "../api/contracts.ts";
import { canonicalArtifactPath } from "../artifact-path.ts";
import { assertLocalMac } from "./clipboard.ts";
const suffixes = new Set(
  ".txt .md .csv .tsv .json .yaml .yml .log .pdf .png .jpg .jpeg .gif .webp .docx .xlsx .pptx .odt .ods .odp".split(
    " ",
  ),
);
export function openArgument(value: string) {
  if (
    !value ||
    Buffer.byteLength(value) > 4096 ||
    /[\x00-\x1f\x7f-\x9f]/u.test(value)
  )
    throw Error("INVALID_OPEN_PATH");
  const match =
    /^--execution ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) (.+)$/i.exec(
      value,
    );
  if (value.startsWith("--execution ") && !match)
    throw Error("INVALID_EXECUTION_QUALIFIER");
  const filename = match?.[2] ?? value;
  if (match && path.isAbsolute(filename)) throw Error("EXPECTED_RELATIVE_PATH");
  return { filename, execution: match?.[1] };
}
export async function checkOpenFile(filename: string) {
  if (
    !path.isAbsolute(filename) ||
    !suffixes.has(path.extname(filename).toLowerCase())
  )
    throw Error("OPEN_DOCUMENT_TYPE_NOT_ALLOWED");
  const parts = filename
    .slice(path.parse(filename).root.length)
    .split(path.sep);
  let current = path.parse(filename).root;
  for (const [i, part] of parts.entries()) {
    current = path.join(current, part);
    const st = await fs.lstat(current);
    if (st.isSymbolicLink()) throw Error("OPEN_SYMLINK_NOT_ALLOWED");
    if (i === parts.length - 1) {
      if (!st.isFile()) throw Error("OPEN_NOT_REGULAR_FILE");
      if (st.mode & 0o111) throw Error("OPEN_EXECUTABLE_NOT_ALLOWED");
    } else if (!st.isDirectory()) throw Error("OPEN_NOT_DIRECTORY");
  }
}
export async function resolveOpen(
  value: string,
  client?: Pick<CoreClient, "query">,
) {
  const { filename, execution } = openArgument(value);
  if (path.isAbsolute(filename)) return filename;
  const relative = canonicalArtifactPath(filename);
  if (!client) throw Error("CORE_NOT_CONNECTED");
  const candidates = new Set<string>();
  let cursor: string | null = null,
    unavailable = false;
  do {
    const q = new URLSearchParams({
      relative_path: relative,
      limit: "20",
      ...(execution ? { execution_id: execution } : {}),
      ...(cursor ? { cursor } : {}),
    });
    const page: { items: Artifact[]; next_cursor: string | null } =
      await client.query("artifacts?" + q.toString().replace(/\+/g, "%20"));
    for (const a of page.items) {
      if (typeof a.current_path !== "string" || !a.source_root)
        unavailable = true;
      else candidates.add(a.current_path);
    }
    cursor = page.next_cursor;
  } while (cursor);
  if (candidates.size > 1 || (unavailable && candidates.size))
    throw Error("OPEN_AMBIGUOUS_USE_FULL_PATH");
  if (candidates.size !== 1) throw Error("OPEN_REGISTERED_PATH_UNAVAILABLE");
  return [...candidates][0];
}
export async function openCurrentFile(
  value: string,
  client?: Pick<CoreClient, "query">,
) {
  assertLocalMac();
  const filename = await resolveOpen(value, client);
  await checkOpenFile(filename);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/open", [filename], {
      shell: false,
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("OPEN_TIMEOUT"));
    }, 5000);
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(Error("OPEN_FAILED"));
    });
  });
  return filename;
}
