import { invoke } from "@tauri-apps/api/core";
import type { Core, Receipt } from "./contracts";
export type Query = {
  operation: string;
  id?: string;
  parameters?: Record<string, string | number | boolean>;
};
export type Draft = { text: string; version: number };
export type Snapshot = {
  profiles: { id: string; mode: string }[];
  profile?: string;
  domain?: string;
  core?: Core;
  error?: string;
  sync: string;
  draft?: Draft;
  outbox?: {
    id: string;
    state: string;
    receipt: string | null;
    body: string;
  }[];
  cache?: Record<string, unknown>;
  transient?: unknown;
  anchor?: string;
};
export const bridge = {
  snapshot: () => invoke<Snapshot>("bridge_profiles"),
  connect: (profile: string, start = false) =>
    invoke<Snapshot>("bridge_connect", { profile, start }),
  draft: (expectedDomain: string, version: number, text: string) =>
    invoke<Draft>("bridge_draft", { expectedDomain, version, text }),
  submit: (
    expectedDomain: string,
    query: Query,
    body: unknown,
    draftVersion?: number,
  ) =>
    invoke<string>("bridge_submit", {
      expectedDomain,
      query,
      body,
      draftVersion,
    }),
  query: <T>(expectedDomain: string, query: Query) =>
    invoke<T>("bridge_query", { expectedDomain, query }),
  subscribe: (expectedDomain: string, queries: Query[]) =>
    invoke<void>("bridge_subscribe", { expectedDomain, queries }),
  anchor: (expectedDomain: string, value: string) =>
    invoke<void>("bridge_anchor", { expectedDomain, value }),
  stop: (expectedDomain: string, expectedInstance: string) =>
    invoke<Receipt>("bridge_stop", { expectedDomain, expectedInstance }),
  download: (expectedDomain: string, id: string) =>
    invoke<string>("bridge_download", { expectedDomain, id }),
};
