import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
export const sha = (data) => createHash("sha256").update(data).digest("hex");
export const inside = (p, root) => p === root || p.startsWith(root + path.sep);
export function fail(code) {
  throw new Error(code);
}
export function safePath(root, relative) {
  if (
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).some((x) => x === "..")
  )
    fail("PATH_ESCAPE");
  const result = path.resolve(root, relative);
  if (!inside(result, root)) fail("PATH_ESCAPE");
  let current = root;
  for (const part of path
    .relative(root, result)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) fail("SYMLINK_INPUT");
  }
  return result;
}
export function rootPath(value) {
  const resolved = path.resolve(value);
  if (fs.realpathSync(resolved) !== resolved) fail("SYMLINK_ROOT");
  return resolved;
}
export function readFile(file, max = 64 * 1024 * 1024) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > max) fail("FILE_LIMIT_OR_TYPE");
    const chunks = [];
    let count = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(65536, max + 1 - count));
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!n) break;
      count += n;
      if (count > max) fail("FILE_LIMIT_OR_TYPE");
      chunks.push(chunk.subarray(0, n));
    }
    const data = Buffer.concat(chunks);
    const after = fs.fstatSync(fd);
    if (
      data.length > max ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      fail("INPUT_CHANGED");
    return data;
  } finally {
    fs.closeSync(fd);
  }
}
export function readJSON(file, max) {
  return JSON.parse(readFile(file, max).toString("utf8"));
}
export function privateJSON(
  file,
  value,
  { replace = false, max = 1024 * 1024, forbidden = [] } = {},
) {
  const data = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(data) > max) fail("OUTPUT_LIMIT");
  const target = path.resolve(file);
  if (forbidden.some((r) => inside(target, path.resolve(r))))
    fail("UNSAFE_OUTPUT_PATH");
  let ancestor = path.dirname(target);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (fs.realpathSync(ancestor) !== ancestor) fail("UNSAFE_OUTPUT_PATH");
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const parent = fs.realpathSync(path.dirname(target));
  if (
    parent !== path.dirname(target) ||
    forbidden.some((r) => inside(target, path.resolve(r)))
  )
    fail("UNSAFE_OUTPUT_PATH");
  const tmp = replace ? target + ".tmp-" + process.pid : target;
  const fd = fs.openSync(
    tmp,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (replace) fs.renameSync(tmp, target);
  const dir = fs.openSync(parent, "r");
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
}
export function args(argv, allowed) {
  const [command, ...rest] = argv;
  const result = { command };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.replace(/^--/, "");
    if (
      !rest[i]?.startsWith("--") ||
      !allowed.includes(key) ||
      Object.hasOwn(result, key) ||
      rest[i + 1] === undefined ||
      rest[i + 1].startsWith("--")
    )
      fail("INVALID_ARGUMENTS");
    result[key] = rest[i + 1];
  }
  return result;
}
export function stamp(st) {
  return [
    String(st.dev),
    String(st.ino),
    Number(st.mode),
    Number(st.size),
    String(st.mtimeNs ?? st.mtimeMs),
  ];
}
