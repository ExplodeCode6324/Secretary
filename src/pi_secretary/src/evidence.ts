import { hash, type Store } from "./store.ts";
import type { ObjectRef } from "./contracts.ts";
import { imageLeaves } from "./vision.ts";
export const EVIDENCE_MEDIA = "application/vnd.secretary.image-evidence+json";
type Envelope = {
  encoding: "image-evidence-v1";
  exact_sha256: string;
  value: unknown;
  images: { path: (string | number)[]; prefix: string; content: ObjectRef }[];
};
export function putEvidence(store: Store, value: unknown): ObjectRef {
  const images = imageLeaves(value);
  if (!images.length) return store.put(value);
  // Evidence is JSON. Detach repeated object aliases before replacing individual
  // leaves, matching the exact serialized request rather than JS object identity.
  const copy = JSON.parse(JSON.stringify(value)) as any;
  const leaves = images.map((image) => {
    let parent = copy;
    for (const part of image.path.slice(0, -1)) parent = parent[part];
    const key = image.path.at(-1)!,
      original = parent[key] as string;
    const prefix = original.slice(0, original.length - image.data.length);
    parent[key] = null;
    return {
      path: image.path,
      prefix,
      content: store.put(Buffer.from(image.data, "base64"), image.mime),
    };
  });
  return store.put(
    {
      encoding: "image-evidence-v1",
      exact_sha256: hash(JSON.stringify(value)),
      value: copy,
      images: leaves,
    } satisfies Envelope,
    EVIDENCE_MEDIA,
  );
}
export function hydrateEvidence(store: Store, envelope: unknown): unknown {
  const e = envelope as Envelope;
  if (
    e?.encoding !== "image-evidence-v1" ||
    !Array.isArray(e.images) ||
    e.images.length > 40000 ||
    !/^[a-f0-9]{64}$/.test(e.exact_sha256)
  )
    throw Error("INVALID_IMAGE_EVIDENCE");
  const copy = structuredClone(e.value) as any;
  for (const leaf of e.images) {
    let parent = copy;
    for (const part of leaf.path.slice(0, -1)) {
      if (
        part === "__proto__" ||
        part === "constructor" ||
        !Object.hasOwn(parent, part)
      )
        throw Error("INVALID_IMAGE_EVIDENCE");
      parent = parent[part];
    }
    const key = leaf.path.at(-1)!;
    if (
      !Object.hasOwn(parent, key) ||
      parent[key] !== null ||
      !["", `data:${leaf.content.media_type};base64,`].includes(leaf.prefix)
    )
      throw Error("INVALID_IMAGE_EVIDENCE");
    parent[key] = leaf.prefix + store.bytes(leaf.content).toString("base64");
  }
  if (hash(JSON.stringify(copy)) !== e.exact_sha256)
    throw Error("IMAGE_EVIDENCE_HASH_MISMATCH");
  imageLeaves(copy);
  return copy;
}
