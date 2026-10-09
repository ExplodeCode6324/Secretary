/* Generated from docs/api/v1/schema.json. Do not hand-edit. */

export type ApiV1 = Core | Assistant | Receipt | Error | Envelope;
export type Json =
  | string
  | number
  | boolean
  | null
  | unknown[]
  | {
      [k: string]: unknown;
    };

export interface Core {
  api_version: "1";
  data_domain_id: string;
  owner_id: string;
  instance_id: string;
  session_id: string;
  state: string;
  mode: string;
  capabilities: {
    [k: string]: Capability;
  };
}
export interface Capability {
  state: "supported" | "not_supported" | "not_configured";
  allowed: boolean;
  reason: string | null;
}
export interface Assistant {
  name: string;
  actor_id: "assistant";
  revision: string;
}
export interface Receipt {
  request_id: string;
  command: string;
  acceptance: "ACCEPTED";
  state: "ACCEPTED" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "UNKNOWN";
  revision: string;
  resource_ids: ResourceLink[];
  error_code: string | null;
}
export interface ResourceLink {
  type: string;
  id: string;
}
export interface Error {
  code: string;
  message: string;
}
export interface Envelope {
  api_version: "1";
  data: Json;
  [k: string]: unknown;
}
