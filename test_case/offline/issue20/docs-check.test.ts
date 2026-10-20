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
    for (const dir of ["src/pi_secretary/scripts", "docs/frontend", "docs/old", "src/secretary_desktop", "test_case/offline"])
      mkdirSync(join(root, dir), { recursive: true });
    const script = "src/pi_secretary/scripts/check-docs.py";
    copyFileSync(new URL("../../../" + script, import.meta.url), join(root, script));
    writeFileSync(join(root, "README.md"), "[Guide](docs/guide.md)\n");
    writeFileSync(join(root, "docs/guide.md"), "# Guide\n");
    writeFileSync(join(root, "docs/migration-map.json"), "{}\n");
    const specs = ["architecture-and-flows.md", "phaseui-design.md", "components-and-states.md", "acceptance.md", "source-migration.md"];
    const entry = specs.map((name) => `[Spec](${name})`).join("\n") + "\n";
    writeFileSync(join(root, "docs/frontend/README.md"), entry);
    for (const name of specs) writeFileSync(join(root, "docs/frontend", name), "# Spec\n");
    for (const [name, target] of [
      ["README.zh-CN.md", "docs/frontend/README.md"],
      ["docs/README.md", "frontend/README.md"],
      ["src/secretary_desktop/README.md", "../../docs/frontend/README.md"],
      ["docs/old/native-client-design-v0.3.md", "../frontend/README.md"],
    ]) writeFileSync(join(root, name), `[Current Frontend Spec](${target})\n`);
    // Spaces and newlines must not split a filename returned by Git.
    const report = "test_case/local report\nfixture.md";
    writeFileSync(join(root, report), "[Broken](missing-evidence.txt)\n");
    git("init", "--quiet");
    git("add", "README.md", "README.zh-CN.md", "docs", "src/secretary_desktop/README.md");
    let result = run("python3", [script]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).markdown_files, 12);
    writeFileSync(join(root, "docs/frontend/README.md"), "# Entry without component link\n" + entry.replace("[Spec](components-and-states.md)\n", ""));
    result = run("python3", [script]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).errors, ["frontend entry does not link components-and-states.md"]);
    writeFileSync(join(root, "docs/frontend/README.md"), entry);
    rmSync(join(root, "README.zh-CN.md"));
    result = run("python3", [script]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).errors, [
      "missing tracked document: README.zh-CN.md",
      "missing current frontend navigation: README.zh-CN.md",
    ]);
    writeFileSync(join(root, "README.zh-CN.md"), "[Current Frontend Spec](docs/frontend/README.md)\n");
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
