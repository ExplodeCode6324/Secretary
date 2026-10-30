import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// This 123 KB ordinary message exhausted a 128 MiB V8 heap when each retained
// block Markdown contained its own copy of the entire reference dictionary.
test("reference-heavy ordinary Markdown renders in a bounded child heap", async () => {
  const program = `
    import assert from 'node:assert/strict';
    import { SourceMarkdown } from './src/pi_secretary/src/tui/view.ts';
    const refs=Array.from({length:900},(_,n)=>'[r'+n+']: https://example.com/'+ 'x'.repeat(60)+n+'\\n').join('');
    const text=Array.from({length:2000},(_,n)=>'paragraph '+n+' [r1]\\n\\n').join('');
    const source=text+refs;
    const md=new SourceMarkdown(source);
    const first=md.render(80),second=md.render(80);
    assert.deepEqual(second,first);
    assert(first.lines.some(line=>line.includes('example.com')));
    assert(first.rows.some(row=>row.block_start_utf16>0));
    console.log(JSON.stringify({sourceBytes:Buffer.byteLength(source),rows:first.lines.length}));
  `;
  const result = await promisify(execFile)(
    process.execPath,
    [
      "--max-old-space-size=128",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      program,
    ],
    { timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  const observation = JSON.parse(result.stdout.trim());
  assert(observation.sourceBytes < 1024 * 1024);
  assert(observation.rows >= 2000);
});
