import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { read, repository, requireThat, sha } from "./io.ts";

export function fingerprint() {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
    }).trim();
  requireThat(
    git("-C", "src/pi_resource", "status", "--porcelain") === "",
    "SUBMODULE_MUST_BE_CLEAN",
  );
  const files = git(
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "src",
    "test_case/online/benchmark",
    "test_case/benchmarks/common",
    "package.json",
    "package-lock.json",
  )
    .split("\n")
    .filter(Boolean)
    .sort();
  const hashes = files
    .filter(
      (p) =>
        fs.existsSync(path.join(repository, p)) &&
        fs.statSync(path.join(repository, p)).isFile(),
    )
    .map((p) => [p, sha(read(path.join(repository, p)))]);
  return {
    head: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
    dirty: sha(
      git(
        "diff",
        "HEAD",
        "--",
        "src",
        "test_case",
        "package.json",
        "package-lock.json",
      ),
    ),
    source: sha(JSON.stringify(hashes)),
    lockfile: sha(read(path.join(repository, "package-lock.json"))),
    submodules: git("submodule", "status"),
    node: process.version,
  };
}
