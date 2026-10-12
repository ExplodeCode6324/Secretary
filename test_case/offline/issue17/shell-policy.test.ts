import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  readonlyShell,
  simpleCommand,
} from "../../../src/pi_secretary/src/shell-policy.ts";
const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "policy-test-")),
);
fs.mkdirSync(path.join(root, "src"));
fs.writeFileSync(path.join(root, "src", "sample.ts"), "foo\n");
execFileSync("git", ["init", "-q", root]);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const positive = [
  "ls",
  "ls -lah .",
  "ls -R src",
  "cat src/sample.ts",
  "stat src/sample.ts",
  "file src/sample.ts",
  "head -n 2 src/sample.ts",
  "tail -n 1 src/sample.ts",
  "wc -lw src/sample.ts",
  "grep -n foo src/sample.ts",
  "grep -r foo .",
  "find . -name '*.ts'",
  "find . -type f",
  "git status",
  "git diff --stat",
  "git diff -- src/sample.ts",
  "git log --oneline -n 1",
  "git show HEAD",
  "git branch",
  "git rev-parse HEAD",
];
for (const command of positive)
  test(`SHELL-P: ${command}`, () =>
    assert(readonlyShell(root, command), command));
const negative = [
  "ls; rm -rf x",
  "cat a | sh",
  "git status > f",
  "cat ~/.ssh/id_rsa",
  "cat ../x",
  "find . -delete",
  "git push",
  "git diff --output=report",
  "rg --pre sh x",
  "rg --pre-glob x y",
  "tree -o out",
  "find . -exec echo x",
  "find . -execdir echo x",
  "find . -ok x",
  "find . -okdir x",
  "find . -fprint x",
  "find . -fprintf f x",
  "find . -fls x",
  "head -f x",
  "tail -f x",
  "grep -f x y",
  "wc --files0-from x",
  "git branch new",
  "git -c a=b status",
  "git --git-dir=/tmp status",
  "git diff --ext-diff",
  "git show --textconv",
  "ls\npwd",
  "ls $(pwd)",
  "cat 'unterminated",
  "ls -L .",
  "grep -R foo .",
  "find -L .",
  "rg --follow foo .",
  "tree -l .",
];
for (const command of negative)
  test(`SHELL-N: ${command}`, () =>
    assert.equal(readonlyShell(root, command), null));
test("SHELL-ARGV: Git disables handlers before user args and path separator", () => {
  const argv = readonlyShell(root, "git diff --stat -- src/sample.ts")!.argv;
  assert.deepEqual(argv.slice(argv.indexOf("diff")), [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--stat",
    "--",
    "src/sample.ts",
  ]);
});
test("PROC-04/06: explicit symlinks and alternate object stores require approval", () => {
  fs.symlinkSync(os.tmpdir(), path.join(root, "outside"));
  assert.equal(readonlyShell(root, "cat outside/x"), null);
  const alt = path.join(root, ".git/objects/info/alternates");
  fs.writeFileSync(alt, "/synthetic/outside\n");
  assert.equal(readonlyShell(root, "git status"), null);
  fs.unlinkSync(alt);
});
test("PROC-01: direct argv preserves quoted glob and handles readonly output", () => {
  const e = readonlyShell(root, "find . -name '*.ts'")!;
  assert.equal(e.argv.at(-1), "*.ts");
  const out = execFileSync(e.argv[0], e.argv.slice(1), {
    cwd: root,
    env: e.env,
    encoding: "utf8",
  });
  assert.match(out, /sample.ts/);
});
test("REM-05: reusable grammar rejects expansions and retains quoted literals", () => {
  for (const c of [
    "npm test *.ts",
    "npm test ~",
    "npm test {a,b}",
    "npm test # hi",
    "if true",
  ])
    assert.equal(simpleCommand(c, true), null);
  assert.deepEqual(simpleCommand("npm test -- --grep 'hello world'", true), [
    "npm",
    "test",
    "--",
    "--grep",
    "hello world",
  ]);
});

test("PROC-05: explicit FIFO is not read; recursive grep skips it", () => {
  const fifo = path.join(root, "synthetic-fifo");
  execFileSync("mkfifo", [fifo]);
  try {
    assert.equal(readonlyShell(root, "cat synthetic-fifo"), null);
    const e = readonlyShell(root, "grep -r foo src")!;
    assert(e.argv.includes("--devices=skip"));
    const out = execFileSync(e.argv[0], e.argv.slice(1), {
      cwd: root,
      env: e.env,
      encoding: "utf8",
      timeout: 3000,
    });
    assert.match(out, /foo/);
  } finally {
    fs.unlinkSync(fifo);
  }
});
test("PROC-06: configured fsmonitor and external diff never execute", () => {
  const marker = path.join(root, "handler-ran"),
    handler = path.join(root, "handler.sh");
  fs.writeFileSync(handler, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
  execFileSync("git", ["-C", root, "config", "core.fsmonitor", handler]);
  execFileSync("git", ["-C", root, "config", "diff.external", handler]);
  for (const command of ["git status", "git diff"]) {
    const e = readonlyShell(root, command)!;
    execFileSync(e.argv[0], e.argv.slice(1), {
      cwd: root,
      env: e.env,
      timeout: 3000,
    });
  }
  assert.equal(fs.existsSync(marker), false);
  execFileSync("git", ["-C", root, "config", "--unset", "core.fsmonitor"]);
  execFileSync("git", ["-C", root, "config", "--unset", "diff.external"]);
});

test("SHELL-P rg: root directory and quoted glob are literal argv when installed", () => {
  const installed = [
    "/usr/bin/rg",
    "/bin/rg",
    "/opt/homebrew/bin/rg",
    "/usr/local/bin/rg",
  ].some((p) => fs.existsSync(p));
  for (const command of ["rg foo src", "rg -g '*.ts' foo ."]) {
    const e = readonlyShell(root, command);
    if (!installed) {
      assert.equal(e, null);
      continue;
    }
    assert(e);
    assert(e.argv.includes("--no-config"));
    const out = execFileSync(e.argv[0], e.argv.slice(1), {
      cwd: root,
      env: e.env,
      encoding: "utf8",
      timeout: 3000,
    });
    assert.match(out, /foo/);
    if (command.includes("-g")) assert(e.argv.includes("*.ts"));
  }
});

test("PROC-06 clean filters require approval before Git can invoke repository handlers", () => {
  const handler = path.join(root, "clean-handler.sh");
  fs.writeFileSync(handler, "#!/bin/sh\ncat\n", { mode: 0o700 });
  execFileSync("git", [
    "-C",
    root,
    "config",
    "filter.synthetic.clean",
    handler,
  ]);
  try {
    assert.equal(readonlyShell(root, "git diff"), null);
    assert.equal(readonlyShell(root, "git status"), null);
  } finally {
    execFileSync("git", [
      "-C",
      root,
      "config",
      "--unset",
      "filter.synthetic.clean",
    ]);
  }
});
