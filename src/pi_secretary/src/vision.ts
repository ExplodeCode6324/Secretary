import type { Model, Api } from "@earendil-works/pi-ai";
import { hash } from "./store.ts";
export type VisionProfile = {
  version: 1;
  provider: string;
  api: string;
  model: string;
  baseUrl: string;
  tokens_per_image: number;
  max_side: number;
  max_pixels: number;
  source: string;
};
const normalizedURL = (value: string) => new URL(value).href.replace(/\/$/, "");
export function visionProfile(model: Model<Api>): VisionProfile {
  if (
    !model.input.includes("image") ||
    !["openai-completions", "openai-responses"].includes(model.api)
  )
    throw Error("ATTACHMENT_MODEL_UNSUPPORTED");
  let profiles: VisionProfile[];
  try {
    profiles = JSON.parse(process.env.SECRETARY_VISION_BUDGET_PROFILES ?? "[]");
  } catch {
    throw Error("ATTACHMENT_BUDGET_CONFIG_INVALID");
  }
  if (!Array.isArray(profiles)) throw Error("ATTACHMENT_BUDGET_CONFIG_INVALID");
  for (const p of profiles) {
    if (
      !p ||
      p.version !== 1 ||
      ![p.provider, p.api, p.model, p.baseUrl, p.source].every(
        (s) => typeof s === "string" && s.trim(),
      ) ||
      ![p.tokens_per_image, p.max_side, p.max_pixels].every(
        (n) => Number.isSafeInteger(n) && n > 0,
      ) ||
      p.max_side > 4096 ||
      p.max_pixels > 4194304
    )
      throw Error("ATTACHMENT_BUDGET_CONFIG_INVALID");
    let url: string;
    try {
      url = normalizedURL(p.baseUrl);
    } catch {
      throw Error("ATTACHMENT_BUDGET_CONFIG_INVALID");
    }
    if (
      p.provider === model.provider &&
      p.api === model.api &&
      p.model === model.id &&
      url === normalizedURL(model.baseUrl)
    )
      return { ...p, baseUrl: url };
  }
  throw Error("ATTACHMENT_BUDGET_UNCONFIGURED");
}
export type ImageLeaf = {
  mime: string;
  data: string;
  sha256: string;
  bytes: number;
  path: (string | number)[];
};
export function imageLeaves(value: unknown): ImageLeaf[] {
  const images: ImageLeaf[] = [];
  function add(mime: unknown, data: unknown, path: (string | number)[]) {
    if (
      !["image/png", "image/jpeg"].includes(String(mime)) ||
      typeof data !== "string" ||
      !data.length ||
      data.length > (5 * 1024 ** 2 * 4) / 3 + 4
    )
      throw Error("ATTACHMENT_INVALID_IMAGE_BLOCK");
    const bytes = Buffer.from(data, "base64");
    if (bytes.toString("base64") !== data)
      throw Error("ATTACHMENT_INVALID_IMAGE_BLOCK");
    images.push({
      mime: String(mime),
      data,
      sha256: hash(bytes),
      bytes: bytes.length,
      path,
    });
  }
  function visit(node: unknown, at: (string | number)[]) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((n, i) => visit(n, [...at, i]));
      return;
    }
    const n = node as Record<string, any>;
    if (n.type === "image") {
      add(n.mimeType, n.data, [...at, "data"]);
      return;
    }
    if (n.type === "image_url" || n.type === "input_image") {
      const url = n.type === "image_url" ? n.image_url?.url : n.image_url;
      const match =
        typeof url === "string" &&
        /^data:(image\/(?:png|jpeg));base64,(.*)$/.exec(url);
      if (!match) throw Error("ATTACHMENT_INVALID_IMAGE_BLOCK");
      add(match[1], match[2], [
        ...at,
        "image_url",
        ...(n.type === "image_url" ? ["url"] : []),
      ]);
      return;
    }
    for (const [key, v] of Object.entries(n)) {
      // Tool JSON and schemas are text, even when their keys resemble image blocks.
      if (
        [
          "arguments",
          "parameters",
          "tools",
          "toolsAdded",
          "input_schema",
          "schema",
        ].includes(key)
      )
        continue;
      visit(v, [...at, key]);
    }
  }
  visit(value, []);
  return images;
}
function dimensions(bytes: Buffer, mime: string) {
  if (
    mime === "image/png" &&
    bytes.length >= 24 &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  )
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    let i = 2;
    while (i + 4 <= bytes.length) {
      if (bytes[i++] !== 255) break;
      while (bytes[i] === 255) i++;
      const marker = bytes[i++],
        length = bytes.readUInt16BE(i);
      if (length < 2 || i + length > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        length >= 8
      )
        return {
          width: bytes.readUInt16BE(i + 5),
          height: bytes.readUInt16BE(i + 3),
        };
      i += length;
    }
  }
  throw Error("ATTACHMENT_INVALID_IMAGE_BLOCK");
}
/** A token-estimation copy only. Exact wire bytes are kept separately. */
export function visionEstimate(model: Model<Api>, value: unknown) {
  const images = imageLeaves(value);
  if (!images.length) return { value, surcharge: 0, profile: undefined };
  const profile = visionProfile(model);
  if (
    images.length > 4 ||
    images.reduce((n, i) => n + i.bytes, 0) > 10 * 1024 ** 2
  )
    throw Error("CAPACITY_BLOCKED: attachment count/bytes");
  const copy = structuredClone(value) as any;
  for (const image of images) {
    const { width, height } = dimensions(
      Buffer.from(image.data, "base64"),
      image.mime,
    );
    if (
      !width ||
      !height ||
      width > profile.max_side ||
      height > profile.max_side ||
      width * height > profile.max_pixels
    )
      throw Error("CAPACITY_BLOCKED: vision profile dimensions");
    let parent = copy;
    for (const part of image.path.slice(0, -1)) parent = parent[part];
    parent[image.path.at(-1)!] =
      "[image bytes counted by deployment vision policy]";
  }
  return {
    value: copy,
    surcharge: images.length * profile.tokens_per_image,
    profile,
  };
}
export function assertImages(expected: unknown, actual: unknown) {
  const identity = (v: unknown) =>
    imageLeaves(v).map((i) => [i.mime, i.sha256, i.bytes]);
  if (JSON.stringify(identity(expected)) !== JSON.stringify(identity(actual)))
    throw Error("ATTACHMENT_PROVIDER_CONTENT_CHANGED");
}
