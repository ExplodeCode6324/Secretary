import { randomUUID } from "node:crypto";
import type { CoreClient } from "../core-client.ts";
import type {
  AttachmentCapability,
  AttachmentMetadata,
  RequestStatus,
} from "../api/contracts.ts";
import { validateImage, ATTACHMENT_DEFAULTS } from "../attachments.ts";
import type { Delivery } from "./delivery.ts";
import type { LocalFiles, ImageMaterial } from "./state.ts";
export const IMPORT_ADMISSION_REJECTIONS = [
  "INVALID_REQUEST",
  "ATTACHMENT_TOO_LARGE",
  "ATTACHMENT_CAPACITY_FULL",
];
export async function requireImageCapability(
  client?: Pick<CoreClient, "query">,
  importing = true,
) {
  if (!client) throw Error("CORE_NOT_CONNECTED");
  const response = await client.query<{
    capabilities?: { attachments?: AttachmentCapability };
    attachments?: AttachmentCapability;
  }>("core");
  const cap = response.capabilities?.attachments ?? response.attachments;
  if (
    !cap?.allowed ||
    (importing && !cap.import_allowed) ||
    !cap.formats?.includes("image/png") ||
    !cap.limits
  )
    throw Error(cap?.reason ?? "IMAGE_CAPABILITY_UNAVAILABLE");
  return cap;
}
/** Serialized admission; durable attempt exists before native read starts. */
export class ImageImports {
  private job?: Promise<void>;
  constructor(
    private delivery: Delivery,
    private files: LocalFiles,
  ) {}
  async begin() {
    if ((this.delivery.state.drafts.Main.materials?.length ?? 0) >= 4)
      throw Error("IMAGE_DRAFT_FULL_DISCARD_FIRST");
    const m: ImageMaterial = {
      id: randomUUID(),
      name: "clipboard.png",
      created_at: new Date().toISOString(),
      status: "CAPTURING",
    };
    const draft = this.delivery.state.drafts.Main;
    if (draft.binding && this.delivery.state.pending?.id === draft.binding)
      throw Error("DELIVERY_PENDING");
    draft.materials = [...(draft.materials ?? []), m];
    draft.generation++;
    await this.delivery.flush();
    this.delivery.onChange();
    return m;
  }
  async captured(m: ImageMaterial, bytes: Buffer, cap: AttachmentCapability) {
    const limits: Record<keyof typeof ATTACHMENT_DEFAULTS, number> = {
      ...ATTACHMENT_DEFAULTS,
    };
    for (const k of Object.keys(limits) as (keyof typeof limits)[]) {
      const n = Number(cap.limits?.[k]);
      if (!Number.isSafeInteger(n) || n <= 0)
        throw Error("IMAGE_CAPABILITY_LIMITS_INVALID");
      limits[k] = Math.min(n, limits[k]);
    }
    const info = await validateImage(bytes, limits).catch((error) => {
      if (String(error).includes("ATTACHMENT_TOO_LARGE"))
        throw Error(
          `ATTACHMENT_TOO_LARGE: file_bytes=${limits.file_bytes}, side=${limits.side}, pixels=${limits.pixels}`,
        );
      throw error;
    });
    if (info.media_type !== "image/png") throw Error("CLIPBOARD_EXPECTED_PNG");
    const active = this.delivery.state.drafts.Main.materials ?? [];
    if (
      active.length > limits.message_count ||
      active.reduce(
        (n, a) => n + Number(a.body?.expected_bytes ?? 0),
        bytes.length,
      ) > limits.message_bytes
    )
      throw Error("ATTACHMENT_TOO_LARGE");
    const staged = await this.files.stageImage(m.id, bytes);
    m.body = { request_id: randomUUID(), ...staged, name: m.name };
    m.status = "UNKNOWN";
    this.touch(m);
    await this.delivery.flush();
    await this.reconcile();
  }
  private touch(m: ImageMaterial) {
    if (this.delivery.state.drafts.Main.materials?.includes(m))
      this.delivery.state.drafts.Main.generation++;
  }
  async fail(m: ImageMaterial, error: unknown) {
    this.touch(m);
    m.status = "FAILED";
    m.error = String(error);
    await this.delivery.flush();
    this.delivery.onChange();
  }
  reconcile() {
    if (this.job) return this.job;
    this.job = this.run().finally(() => {
      this.job = undefined;
      this.delivery.onChange();
    });
    return this.job;
  }
  private async run() {
    const client = this.delivery.client;
    if (!client) return;
    for (const m of this.delivery.state.drafts.Main.materials ?? []) {
      if (!m.body || !["UNKNOWN", "IMPORTING"].includes(m.status)) continue;
      try {
        if (m.status === "UNKNOWN") {
          try {
            const receipt = await client.command("attachments/import", m.body);
            if (
              receipt.request_id !== m.body.request_id ||
              receipt.acceptance !== "ACCEPTED"
            )
              throw Error("INVALID_RECEIPT");
            m.status = "IMPORTING";
            this.touch(m);
            await this.delivery.flush();
          } catch (e) {
            if (IMPORT_ADMISSION_REJECTIONS.includes((e as Error).message)) {
              await this.fail(m, e);
              continue;
            }
            throw e;
          }
        }
        const result = await client.query<RequestStatus>(
          "requests/" + m.body.request_id,
        );
        if (
          result.receipt.request_id !== m.body.request_id ||
          result.receipt.acceptance !== "ACCEPTED"
        )
          throw Error("INVALID_RECEIPT");
        if (result.receipt.state === "FAILED") {
          await this.fail(m, "ATTACHMENT_IMPORT_FAILED");
          continue;
        }
        if (result.receipt.state !== "COMPLETED") continue;
        const attachmentID = (result.result as { attachment_id?: string })
          ?.attachment_id;
        if (!attachmentID) throw Error("INVALID_IMPORT_RESULT");
        const meta = await client.query<AttachmentMetadata>(
          "attachments/" + attachmentID,
        );
        if (
          meta.attachment_id !== attachmentID ||
          meta.import_request_id !== m.body.request_id ||
          meta.sha256 !== m.body.expected_sha256 ||
          meta.bytes !== m.body.expected_bytes ||
          meta.availability !== "available"
        )
          throw Error("INVALID_ATTACHMENT_METADATA");
        m.attachment_id = attachmentID;
        m.status = "READY";
        this.touch(m);
        delete m.error;
        await this.delivery.flush();
      } catch (e) {
        m.error = String(e);
        await this.delivery.flush();
      }
    }
  }
}
