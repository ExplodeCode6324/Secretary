import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fail, stamp, safePath, inside } from "./io.mjs";
export async function digestFile(file) {
  const hash = createHash("sha256");
  for await (const b of fs.createReadStream(file, {
    flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  }))
    hash.update(b);
  return hash.digest("hex");
}
export function tree(root, exclude = []) {
  const result = {};
  function visit(rel) {
    if (exclude.some((x) => rel === x || rel.startsWith(x + "/"))) return;
    const file = path.join(root, rel),
      st = fs.lstatSync(file, { bigint: true });
    const kind = st.isSymbolicLink()
      ? "symlink"
      : st.isDirectory()
        ? "directory"
        : st.isFile()
          ? "file"
          : st.isSocket()
            ? "socket"
            : st.isFIFO()
              ? "fifo"
              : "unsupported";
    result[rel] = {
      kind,
      stat: stamp(st),
      ...(kind === "symlink" ? { target: fs.readlinkSync(file) } : {}),
    };
    if (kind === "directory")
      for (const name of fs.readdirSync(file).sort())
        visit(rel ? rel + "/" + name : name);
  }
  // Do not compare the containing directory mtime when explicitly excluded child files may change.
  for (const name of fs.readdirSync(root).sort()) visit(name);
  return result;
}
export async function copyTree(
  source,
  destination,
  { exclude = [], deadline = Infinity } = {},
) {
  const before = tree(source, exclude),
    hashes = {};
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const [rel, info] of Object.entries(before)) {
    if (Date.now() > deadline) fail("COPY_DEADLINE");
    const from = path.join(source, rel),
      to = path.join(destination, rel);
    if (info.kind === "directory") {
      fs.mkdirSync(to, { mode: info.stat[2] & 0o777 });
      fs.chmodSync(to, info.stat[2] & 0o777);
    } else if (info.kind === "symlink") fail("UNMAPPED_SYMLINK");
    else if (info.kind === "file") {
      const hash = createHash("sha256"),
        output = fs.openSync(to, "wx", info.stat[2] & 0o777);
      try {
        for await (const b of fs.createReadStream(from, {
          flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
        })) {
          if (Date.now() > deadline) fail("COPY_DEADLINE");
          hash.update(b);
          fs.writeFileSync(output, b);
        }
        fs.fchmodSync(output, info.stat[2] & 0o777);
        fs.fsyncSync(output);
      } finally {
        fs.closeSync(output);
      }
      hashes[rel] = {
        sha256: hash.digest("hex"),
        bytes: info.stat[3],
        mode: info.stat[2] & 0o777,
      };
      const st = fs.statSync(from);
      fs.utimesSync(to, st.atime, st.mtime);
    } else if (!["socket", "fifo"].includes(info.kind))
      fail("UNSUPPORTED_FILE_TYPE");
  }
  if (JSON.stringify(tree(source, exclude)) !== JSON.stringify(before))
    fail("FROZEN_ROOT_CHANGED");
  return { before, files: hashes };
}
export async function verifyFiles(root, files) {
  for (const [rel, m] of Object.entries(files)) {
    const p = safePath(root, rel),
      st = fs.statSync(p);
    if (
      !st.isFile() ||
      st.size !== m.bytes ||
      (st.mode & 0o777) !== m.mode ||
      (await digestFile(p)) !== m.sha256
    )
      fail("COPY_HASH_OR_MODE");
  }
}

export function verifyMetadata(root, before) {
  const actual = tree(root);
  const expected = Object.entries(before).filter(
    ([, v]) => !["socket", "fifo"].includes(v.kind),
  );
  if (Object.keys(actual).length !== expected.length)
    fail("COPY_ENTRY_MISMATCH");
  for (const [rel, v] of expected) {
    const a = actual[rel];
    if (
      !a ||
      a.kind !== v.kind ||
      (a.stat[2] & 0o777) !== (v.stat[2] & 0o777) ||
      (v.kind === "symlink" && a.target !== v.target)
    )
      fail("COPY_METADATA_MISMATCH");
  }
}

export function assertSourceLinks(root, entries) {
  for (const [rel, v] of Object.entries(entries))
    if (v.kind === "symlink") {
      const link = path.join(root, rel),
        target = path.resolve(path.dirname(link), v.target);
      if (
        !inside(target, root) ||
        (fs.existsSync(link) && !inside(fs.realpathSync(link), root))
      )
        fail("UNMAPPED_SOURCE_LINK");
    }
}
