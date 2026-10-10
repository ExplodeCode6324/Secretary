import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Store } from "./store.ts";
import type { ObjectRef } from "./contracts.ts";
/** Verify through a fixed-size buffer, then return at most 32 KiB at Unicode scalar boundaries. */
export function casTextChunk(store: Store, ref: ObjectRef, offset: number) {
  if (
    !/^objects\/[a-f0-9]{64}$/.test(ref.path) ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > ref.bytes
  )
    throw Error("INVALID_OBJECT_OFFSET");
  if (fs.lstatSync(path.join(store.dir, "objects")).isSymbolicLink())
    throw Error("OBJECT_SYMLINK");
  const fd = fs.openSync(
    path.join(store.dir, ref.path),
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size !== ref.bytes)
      throw Error("CORRUPT_OBJECT");
    const buffer = Buffer.alloc(65536),
      hash = createHash("sha256");
    const chunk = Buffer.alloc(Math.min(32769, stat.size - offset));
    let position = 0;
    while (position < stat.size) {
      const n = fs.readSync(
        fd,
        buffer,
        0,
        Math.min(buffer.length, stat.size - position),
        position,
      );
      if (!n) throw Error("CORRUPT_OBJECT");
      hash.update(buffer.subarray(0, n));
      const begin = Math.max(offset, position),
        end = Math.min(position + n, offset + chunk.length);
      if (end > begin)
        buffer.copy(chunk, begin - offset, begin - position, end - position);
      position += n;
    }
    if (hash.digest("hex") !== ref.sha256) throw Error("CORRUPT_OBJECT");
    const size = chunk.length;
    let end = Math.min(32768, size);
    if (offset + end < stat.size)
      while (end > 0 && (chunk[end] & 0xc0) === 0x80) end--;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      chunk.subarray(0, end),
    );
    return { text, next: offset + end < stat.size ? offset + end : null };
  } finally {
    fs.closeSync(fd);
  }
}
