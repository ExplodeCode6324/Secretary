import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canonicalArtifactPath,
  describedArtifacts,
  currentArtifactPath,
} from "../../../src/pi_secretary/src/artifact-path.ts";

test("registration requires exactly bound descriptions before snapshotting", () => {
  assert.throws(() => describedArtifacts(["a.txt"]), /DESCRIPTION/);
  assert.throws(
    () =>
      describedArtifacts(
        ["a.txt", "./a.txt"],
        [{ path: "a.txt", description: "a" }],
      ),
    /DUPLICATE/,
  );
  assert.throws(
    () => describedArtifacts(["a"], [{ path: "b", description: "a" }]),
    /DESCRIPTION/,
  );
  assert.throws(
    () =>
      describedArtifacts(["a"], [{ path: "a", description: " ".repeat(3) }]),
    /DESCRIPTION/,
  );
  assert.throws(
    () =>
      describedArtifacts(["a"], [{ path: "a", description: "x".repeat(2001) }]),
    /DESCRIPTION/,
  );
  assert.deepEqual(
    describedArtifacts(
      ["./中文 目录/Report.txt"],
      [{ path: "中文 目录/./Report.txt", description: "Report" }],
    ),
    [{ path: "中文 目录/Report.txt", description: "Report" }],
  );
  assert.deepEqual(describedArtifacts([]), []);
  for (const p of ["/a", "../a", "a/../b", "a//b", "a\nb", "C:\\a", ""])
    assert.throws(() => canonicalArtifactPath(p));
  assert.equal(canonicalArtifactPath("a/./b"), "a/b");
});

test("current paths use immutable binding only and never recreate deleted roots", () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "issue94-")),
  );
  const artifact: any = { workspace_path: "./report.txt" };
  const execution: any = {
    workspace_binding: { kind: "NONE", root_path: root },
  };
  fs.writeFileSync(path.join(root, "report.txt"), "new current bytes");
  assert.equal(
    currentArtifactPath(artifact, execution).current_path,
    path.join(root, "report.txt"),
  );
  assert.equal(
    currentArtifactPath(artifact, execution).current_state,
    "available",
  );
  fs.unlinkSync(path.join(root, "report.txt"));
  fs.symlinkSync("/etc/hosts", path.join(root, "report.txt"));
  assert.equal(
    currentArtifactPath(artifact, execution).current_state,
    "unavailable",
  );
  fs.rmSync(root, { recursive: true });
  assert.equal(
    currentArtifactPath(artifact, execution).current_state,
    "unavailable",
  );
  assert.equal(fs.existsSync(root), false);
  assert.equal(currentArtifactPath(artifact, {} as any).current_path, null);
});
