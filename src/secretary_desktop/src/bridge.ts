import { invoke } from "@tauri-apps/api/core";
import type { Core } from "./contracts";
export type Query = {
  operation: string;
  id?: string;
  parameters?: Record<string, string | number | boolean>;
};
export type Draft = { text: string; version: number };
export type Snapshot = {
  profiles: { id: string; mode: string }[];
  cursor?: string;
  approvals?: { id: string; target: string; state: string }[];
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
export type MessageOutbox = {
  items: { id: string; state: string; position: number }[];
  next: number | null;
};
export type MessageBody = { id: string; state: string; text: string };
export const bridge = {
  copyText: (text: string) => invoke<void>("bridge_copy_text", { text }),
  openUrl: (url: string) => invoke<string>("bridge_open_url", { url }),
  messageOutbox: (expectedDomain: string, before?: number) =>
    invoke<MessageOutbox>("bridge_message_outbox", { expectedDomain, before }),
  messageBody: (expectedDomain: string, id: string) =>
    invoke<MessageBody>("bridge_message_body", { expectedDomain, id }),
  discardMessage: (expectedDomain: string, id: string) =>
    invoke<void>("bridge_discard_message", { expectedDomain, id }),
  transient: (expectedDomain: string, expectedInstance: string) =>
    invoke<import("./workflow").Transient | null>("bridge_transient", {
      expectedDomain,
      expectedInstance,
    }),
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
    invoke<{ request_id: string; status: string }>("bridge_stop", {
      expectedDomain,
      expectedInstance,
    }),
  download: (expectedDomain: string, id: string) =>
    invoke<string>("bridge_download", { expectedDomain, id }),
};

export type BridgePort = typeof bridge;
