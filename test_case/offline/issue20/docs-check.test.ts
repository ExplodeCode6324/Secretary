import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("docs check ignores untracked reports but rejects tracked broken links", () => {
  const root = mkdtempSync(join(tmpdir(), "secretary-docs-check-"));
  const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
    assert.ifError(result.error);
    return result;
  };
  const git = (...args: string[]) => {
    const result = run("git", args);
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    for (const dir of ["src/pi_secretary/scripts", "docs", "test_case/offline"])
      mkdirSync(join(root, dir), { recursive: true });
    const script = "src/pi_secretary/scripts/check-docs.py";
    copyFileSync(new URL("../../../" + script, import.meta.url), join(root, script));
    writeFileSync(join(root, "README.md"), "[Guide](docs/guide.md)\n");
    writeFileSync(join(root, "docs/guide.md"), "# Guide\n");
    writeFileSync(join(root, "docs/migration-map.json"), "{}\n");
    // Spaces and newlines must not split a filename returned by Git.
    const report = "test_case/local report\nfixture.md";
    writeFileSync(join(root, report), "[Broken](missing-evidence.txt)\n");
    git("init", "--quiet");
    git("add", "README.md", "docs");
    let result = run("python3", [script]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).markdown_files, 2);
    git("add", report);
    result = run("python3", [script]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).errors, [`${report}: missing-evidence.txt`]);
    writeFileSync(join(root, report), "[Guide](../docs/guide.md)\n");
    result = run("python3", [script]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    writeFileSync(join(root, "docs/guide.md"), "[Broken](missing.md)\n");
    result = run("python3", [script]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).errors, ["docs/guide.md: missing.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
