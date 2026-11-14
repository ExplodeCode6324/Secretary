import fs from "node:fs";
import { fail } from "./io.mjs";
/** One bounded prefix ending at a committed newline; later appends do not invalidate it. */
export function journalPrefix(file, max = 64 * 1024 ** 2) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > max) fail("JOURNAL_PREFIX_LIMIT");
    const b = Buffer.alloc(st.size);
    let offset = 0;
    while (offset < b.length) {
      const n = fs.readSync(fd, b, offset, b.length - offset, offset);
      if (!n) fail("JOURNAL_PREFIX_TRUNCATED");
      offset += n;
    }
    const end = b.lastIndexOf(10);
    if (end < 0) fail("JOURNAL_PREFIX_NO_FRAME");
    return b.subarray(0, end + 1);
  } finally {
    fs.closeSync(fd);
  }
}
