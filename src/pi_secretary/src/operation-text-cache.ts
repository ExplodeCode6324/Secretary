import fs from "node:fs";
import path from "node:path";
import type { ObjectRef } from "./contracts.ts";
import type { Store } from "./store.ts";

export type SourceStamp = { ref: ObjectRef; stamp: string };
export function statStamp(stat: fs.BigIntStats) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}
export function sourceStamp(store: Store, ref: ObjectRef): SourceStamp {
  if (
    ref.path !== "objects/" + ref.sha256 ||
    !/^[a-f0-9]{64}$/.test(ref.sha256) ||
    !Number.isSafeInteger(ref.bytes) ||
    ref.bytes < 0 ||
    fs.lstatSync(path.join(store.dir, "objects")).isSymbolicLink()
  )
    throw Error("CORRUPT_SOURCE");
  const stat = fs.lstatSync(path.join(store.dir, ref.path), { bigint: true });
  if (!stat.isFile() || stat.size !== BigInt(ref.bytes))
    throw Error("CORRUPT_SOURCE");
  return { ref: { ...ref }, stamp: statStamp(stat) };
}

/** Optional capture, with a fixed byte ceiling and bounded block count. */
export class TextCapture {
  private blocks: Buffer[] = [];
  private length = 0;
  private overflow = false;
  constructor(readonly limit: number) {}
  write(text: string) {
    if (this.overflow) return;
    const bytes = Buffer.from(text);
    // Preserve the uncached JSON representation of isolated surrogate code units.
    if (
      this.length + bytes.length > this.limit ||
      /[\uD800-\uDFFF]/u.test(text)
    ) {
      this.overflow = true;
      this.blocks = [];
      return;
    }
    let offset = 0;
    while (offset < bytes.length) {
      const index = Math.floor(this.length / 65536),
        used = this.length % 65536;
      const block = (this.blocks[index] ??= Buffer.allocUnsafe(
        Math.min(65536, this.limit - index * 65536),
      ));
      const count = Math.min(bytes.length - offset, block.length - used);
      bytes.copy(block, used, offset, offset + count);
      offset += count;
      this.length += count;
    }
  }
  finish() {
    return this.overflow ? null : Buffer.concat(this.blocks, this.length);
  }
}
export type CachedText = {
  content: Buffer;
  version: string;
  sources: SourceStamp[];
};
export class OperationTextCache {
  static readonly captureLimit = 8 * 1024 * 1024;
  private entries = new Map<string, CachedText>();
  private bytes = 0;
  constructor(
    readonly store: Store,
    readonly limit = 16 * 1024 * 1024,
    readonly maxEntries = 64,
  ) {}
  private remove(key: string) {
    const value = this.entries.get(key);
    if (value) this.bytes -= value.content.length;
    this.entries.delete(key);
  }
  get(key: string) {
    const value = this.entries.get(key);
    if (!value) return;
    if (!this.valid(value.sources)) {
      this.remove(key);
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }
  private valid(sources: SourceStamp[]) {
    try {
      return sources.every(
        (source) => sourceStamp(this.store, source.ref).stamp === source.stamp,
      );
    } catch {
      return false;
    }
  }
  put(key: string, value: CachedText) {
    this.remove(key);
    if (value.content.length > this.limit || !this.valid(value.sources)) return;
    while (
      this.entries.size &&
      (this.bytes + value.content.length > this.limit ||
        this.entries.size >= this.maxEntries)
    )
      this.remove(this.entries.keys().next().value!);
    this.entries.set(key, value);
    this.bytes += value.content.length;
  }
}
