import fs from "node:fs";
import path from "node:path";
import { inside, mkdir, noLinks, read, requireThat, sha } from "./io.ts";

export const publicSourceFiles = [
  "longmemeval_s_cleaned.json",
  "longmemeval_oracle.json",
  "README.md",
  "LICENSE",
  "evaluate_qa.py",
  "print_qa_metrics.py",
] as const;
export function publicSourceURL(
  name: string,
  dataset: string,
  repository: string,
) {
  requireThat(publicSourceFiles.includes(name as any), "UNKNOWN_PUBLIC_SOURCE");
  return publicSourceFiles.slice(0, 3).includes(name as any)
    ? `https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/${dataset}/${name}`
    : `https://raw.githubusercontent.com/xiaowu0162/LongMemEval/${repository}/${name === "LICENSE" ? name : "src/evaluation/" + name}`;
}

/** Operator-supplied official-download bundle. Hash validation is not a new origin attestation. */
export function readPublicBundle(file: string) {
  noLinks(file);
  const manifestBytes = read(file),
    manifest = JSON.parse(manifestBytes.toString());
  requireThat(
    manifest.version === 1 &&
      /^[a-f0-9]{40}$/.test(manifest.dataset_commit) &&
      /^[a-f0-9]{40}$/.test(manifest.repository_commit),
    "PUBLIC_BUNDLE_PIN_INVALID",
  );
  requireThat(
    Array.isArray(manifest.files) &&
      manifest.files.length === publicSourceFiles.length &&
      new Set(manifest.files.map((f: any) => f.name)).size ===
        publicSourceFiles.length,
    "PUBLIC_BUNDLE_DENOMINATOR_INVALID",
  );
  const files = publicSourceFiles.map((name) => {
    const entry = manifest.files.find((f: any) => f.name === name);
    requireThat(
      entry && typeof entry.path === "string" && !path.isAbsolute(entry.path),
      "PUBLIC_BUNDLE_PATH_INVALID",
    );
    const source = path.resolve(path.dirname(file), entry.path);
    requireThat(
      inside(path.dirname(file), source),
      "PUBLIC_BUNDLE_PATH_INVALID",
    );
    noLinks(source);
    const stat = fs.statSync(source);
    requireThat(
      stat.isFile() &&
        stat.size > 0 &&
        stat.size <= (name.endsWith(".json") ? 350_000_000 : 1_000_000),
      "PUBLIC_BUNDLE_SIZE_INVALID",
    );
    const bytes = read(source);
    const url = publicSourceURL(
      name,
      manifest.dataset_commit,
      manifest.repository_commit,
    );
    requireThat(
      entry.url === url &&
        entry.bytes === bytes.length &&
        entry.sha256 === sha(bytes),
      "PUBLIC_BUNDLE_CONTENT_CHANGED",
    );
    return { name, url, bytes, sha256: entry.sha256 };
  });
  return { manifest, manifest_sha256: sha(manifestBytes), files };
}

export function importPublicBundle(file: string, destination: string) {
  const bundle = readPublicBundle(file);
  mkdir(destination);
  const files = bundle.files.map((entry) => {
    const target = path.join(destination, entry.name);
    noLinks(target);
    const fd = fs.openSync(target, "wx", 0o600);
    try {
      fs.writeFileSync(fd, entry.bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    requireThat(
      sha(read(target)) === entry.sha256,
      "PUBLIC_BUNDLE_COPY_CHANGED",
    );
    return {
      url: entry.url,
      bytes: entry.bytes.length,
      sha256: entry.sha256,
      path: target,
    };
  });
  return {
    dataset_commit: bundle.manifest.dataset_commit,
    repository_commit: bundle.manifest.repository_commit,
    bundle_sha256: bundle.manifest_sha256,
    files,
  };
}
