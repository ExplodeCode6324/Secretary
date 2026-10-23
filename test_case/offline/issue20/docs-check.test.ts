import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
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
    for (const dir of [
      "src/pi_secretary/scripts",
      "docs/tui",
      "test_case/offline",
    ])
      mkdirSync(join(root, dir), { recursive: true });
    const script = "src/pi_secretary/scripts/check-docs.py";
    copyFileSync(
      new URL("../../../" + script, import.meta.url),
      join(root, script),
    );
    writeFileSync(join(root, "README.md"), "[Guide](docs/guide.md)\n");
    writeFileSync(join(root, "docs/guide.md"), "# Guide\n");
    writeFileSync(join(root, "docs/migration-map.json"), "{}\n");
    const requirements = "docs/tui/requirements-and-backend-plan.md";
    const coverage = "docs/tui/api-coverage.md";
    writeFileSync(
      join(root, requirements),
      "[API coverage](api-coverage.md)\n",
    );
    writeFileSync(join(root, coverage), "# Coverage\n");
    for (const [name, target] of [
      ["README.zh-CN.md", "docs/tui/requirements-and-backend-plan.md"],
      ["docs/README.md", "tui/requirements-and-backend-plan.md"],
    ])
      writeFileSync(join(root, name), `[TUI requirements](${target})\n`);
    // Spaces and newlines must not split a filename returned by Git.
    const report = "test_case/local report\nfixture.md";
    writeFileSync(join(root, report), "[Broken](missing-evidence.txt)\n");
    git("init", "--quiet");
    git("add", "README.md", "README.zh-CN.md", "docs");
    let result = run("python3", [script]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).markdown_files, 6);
    // Current TUI pages remain mandatory even if an accidental deletion is staged.
    git("rm", "--force", coverage);
    result = run("python3", [script]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).errors, [
      `${requirements}: api-coverage.md`,
      "missing current TUI document: docs/tui/api-coverage.md",
    ]);
    writeFileSync(join(root, coverage), "# Coverage\n");
    git("add", coverage);
    writeFileSync(join(root, "docs/README.md"), "# No current navigation\n");
    result = run("python3", [script]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).errors, [
      "missing current TUI navigation: docs/README.md",
    ]);
    writeFileSync(
      join(root, "docs/README.md"),
      "[TUI](tui/requirements-and-backend-plan.md)\n",
    );
    rmSync(join(root, "README.zh-CN.md"));
    result = run("python3", [script]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).errors, [
      "missing tracked document: README.zh-CN.md",
      "missing current TUI navigation: README.zh-CN.md",
    ]);
    writeFileSync(
      join(root, "README.zh-CN.md"),
      "[TUI requirements](docs/tui/requirements-and-backend-plan.md)\n",
    );
    git("add", report);
    result = run("python3", [script]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).errors, [
      `${report}: missing-evidence.txt`,
    ]);
    writeFileSync(join(root, report), "[Guide](../docs/guide.md)\n");
    result = run("python3", [script]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    writeFileSync(join(root, "docs/guide.md"), "[Broken](missing.md)\n");
    result = run("python3", [script]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).errors, [
      "docs/guide.md: missing.md",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
