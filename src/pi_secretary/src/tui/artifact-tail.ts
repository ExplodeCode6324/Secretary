import type { Artifact } from "../api/contracts.ts";
export type ArtifactTail = {
  items: Artifact[];
  total: number;
  next_cursor: string | null;
  previous: (string | null)[];
  cursor: string | null;
  error?: string;
};
export const tailBytes = (tail?: ArtifactTail) =>
  tail ? Buffer.byteLength(JSON.stringify(tail)) : 0;
