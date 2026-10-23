import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ApiError } from "./api/protocol.ts";
import type {
  Attachment,
  AttachmentImport,
  AttachmentBinding,
  ApiCommand,
} from "./contracts.ts";
import { base, id, revise, hash, type Store } from "./store.ts";

// Only one importer runs, and decoder caches cannot accumulate source pixels.
sharp.cache(false);
sharp.concurrency(1);

export const ATTACHMENT_DEFAULTS = Object.freeze({
  file_bytes: 5 * 1024 ** 2,
  side: 4096,
  pixels: 4194304,
  message_count: 4,
  message_bytes: 10 * 1024 ** 2,
  reserved_bytes: 1024 ** 3,
  import_count: 10000,
  wire_bytes: 24 * 1024 ** 2,
});
export function attachmentLimits() {
  return Object.fromEntries(
    Object.entries(ATTACHMENT_DEFAULTS).map(([key, ceiling]) => {
      const raw = process.env[`SECRETARY_ATTACHMENT_${key.toUpperCase()}`];
      const n = raw === undefined ? ceiling : Number(raw);
      if (!Number.isSafeInteger(n) || n <= 0 || n > ceiling)
        throw Error("ATTACHMENT_CONFIG_INVALID");
      return [key, n];
    }),
  ) as Record<keyof typeof ATTACHMENT_DEFAULTS, number>;
}
export type ImportArguments = {
  request_id: string;
  source_path: string;
  expected_sha256: string;
  expected_bytes: string;
  name: string;
};
const failure = (code: string): never => {
  throw new ApiError(code);
};
/** Check container framing independently of libvips' first-frame decoding. */
export function imageFormat(bytes: Buffer): "image/png" | "image/jpeg" {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    let offset = 8,
      ihdr = false,
      data = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset),
        type = bytes.toString("ascii", offset + 4, offset + 8);
      if (length > bytes.length - offset - 12)
        return failure("ATTACHMENT_INVALID_IMAGE");
      if (!ihdr && (type !== "IHDR" || length !== 13))
        return failure("ATTACHMENT_INVALID_IMAGE");
      if (["acTL", "fcTL", "fdAT"].includes(type))
        return failure("ATTACHMENT_TYPE_UNSUPPORTED");
      if (type === "IHDR") {
        if (ihdr) return failure("ATTACHMENT_INVALID_IMAGE");
        ihdr = true;
      }
      if (type === "IDAT") data = true;
      offset += 12 + length;
      if (type === "IEND") {
        if (!data || length !== 0 || offset !== bytes.length)
          return failure("ATTACHMENT_INVALID_IMAGE");
        return "image/png";
      }
    }
    return failure("ATTACHMENT_INVALID_IMAGE");
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2,
      scan = false,
      sawScan = false;
    while (offset < bytes.length) {
      if (scan) {
        while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
      }
      if (bytes[offset++] !== 0xff) return failure("ATTACHMENT_INVALID_IMAGE");
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (scan && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7)))
        continue;
      scan = false;
      if (marker === 0xd9) {
        if (!sawScan || offset !== bytes.length)
          return failure("ATTACHMENT_INVALID_IMAGE");
        return "image/jpeg";
      }
      if (
        marker === 0xd8 ||
        marker === 0 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7) ||
        offset + 2 > bytes.length
      )
        return failure("ATTACHMENT_INVALID_IMAGE");
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length)
        return failure("ATTACHMENT_INVALID_IMAGE");
      if (
        marker === 0xe2 &&
        bytes.subarray(offset + 2, offset + 6).equals(Buffer.from("MPF\0"))
      )
        return failure("ATTACHMENT_TYPE_UNSUPPORTED");
      offset += length;
      if (marker === 0xda) {
        scan = true;
        sawScan = true;
      }
    }
    return failure("ATTACHMENT_INVALID_IMAGE");
  }
  return failure("ATTACHMENT_TYPE_UNSUPPORTED");
}
export async function validateImage(
  bytes: Buffer,
  limits = attachmentLimits(),
) {
  if (!bytes.length || bytes.length > limits.file_bytes)
    return failure("ATTACHMENT_TOO_LARGE");
  const media_type = imageFormat(bytes);
  try {
    const decoder = sharp(bytes, {
      limitInputPixels: limits.pixels,
      failOn: "warning",
      sequentialRead: true,
    });
    const meta = await decoder.metadata();
    if (
      !meta.width ||
      !meta.height ||
      meta.width > limits.side ||
      meta.height > limits.side ||
      meta.width * meta.height > limits.pixels
    )
      return failure("ATTACHMENT_TOO_LARGE");
    if (
      (meta.pages ?? 1) !== 1 ||
      meta.channels > 4 ||
      !["png", "jpeg"].includes(meta.format!)
    )
      return failure("ATTACHMENT_TYPE_UNSUPPORTED");
    // Force complete bounded pixel decoding; metadata alone accepts truncated streams.
    await decoder.raw().toBuffer();
    return { media_type, width: meta.width, height: meta.height };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return failure("ATTACHMENT_INVALID_IMAGE");
  }
}
function sourceBytes(args: ImportArguments, limit: number): Buffer {
  let fd: number;
  try {
    fd = fs.openSync(
      args.source_path,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
  } catch {
    return failure("ATTACHMENT_SOURCE_UNREADABLE");
  }
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile()) return failure("ATTACHMENT_SOURCE_UNREADABLE");
    if (before.size !== BigInt(args.expected_bytes))
      return failure("ATTACHMENT_SOURCE_CHANGED");
    if (before.size > BigInt(limit)) return failure("ATTACHMENT_TOO_LARGE");
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!n) return failure("ATTACHMENT_SOURCE_CHANGED");
      offset += n;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    if (
      ["dev", "ino", "size", "mtimeNs", "ctimeNs"].some(
        (key) =>
          before[key as keyof typeof before] !==
          after[key as keyof typeof after],
      ) ||
      hash(bytes) !== args.expected_sha256
    )
      return failure("ATTACHMENT_SOURCE_CHANGED");
    return bytes;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return failure("ATTACHMENT_SOURCE_UNREADABLE");
  } finally {
    fs.closeSync(fd);
  }
}
export function attachmentMetadata(
  store: Store,
  attachment: Attachment,
  verifyContent = true,
) {
  let availability: "available" | "unavailable" = "available";
  try {
    if (verifyContent) store.bytes(attachment.content);
    else {
      const stat = fs.lstatSync(path.join(store.dir, attachment.content.path));
      if (!stat.isFile() || stat.size !== attachment.content.bytes)
        throw Error("ATTACHMENT_UNAVAILABLE");
    }
  } catch {
    availability = "unavailable";
  }
  return {
    attachment_id: attachment.id,
    import_request_id: attachment.import_request_id,
    name: attachment.name,
    media_type: attachment.content.media_type,
    bytes: String(attachment.content.bytes),
    sha256: attachment.content.sha256,
    width: attachment.width,
    height: attachment.height,
    created_at: attachment.updated_at,
    availability,
  };
}
export function attachmentBindings(
  store: Store,
  ids: string[],
): AttachmentBinding[] {
  const limits = attachmentLimits();
  if (ids.length > limits.message_count || new Set(ids).size !== ids.length)
    return failure("INVALID_REQUEST");
  const bindings = ids.map((attachmentID) => {
    const a = store.find<Attachment>("Attachment", attachmentID);
    if (!a) return failure("ATTACHMENT_NOT_READY");
    try {
      store.bytes(a.content);
    } catch {
      return failure("ATTACHMENT_UNAVAILABLE");
    }
    return {
      attachment_id: a.id,
      import_request_id: a.import_request_id,
      name: a.name,
      content: a.content,
      width: a.width,
      height: a.height,
    };
  });
  if (bindings.reduce((n, a) => n + a.content.bytes, 0) > limits.message_bytes)
    return failure("ATTACHMENT_TOO_LARGE");
  return bindings;
}
/** One worker owns imports. Unknown IO leaves the QUEUED reservation for restart. */
export class AttachmentImports {
  private running?: Promise<void>;
  private closed = false;
  constructor(
    readonly store: Store,
    private readonly phase?: (name: string, requestID: string) => void,
  ) {}
  usage() {
    const all = this.store.all<AttachmentImport>("AttachmentImport");
    return {
      reserved_bytes: all.reduce((n, a) => n + a.reserved_bytes, 0),
      import_count: all.length,
    };
  }
  admit(command: ApiCommand, args: ImportArguments) {
    const limits = attachmentLimits(),
      count = Number(args.expected_bytes),
      usage = this.usage();
    if (
      !path.isAbsolute(args.source_path) ||
      args.source_path.includes("\0") ||
      Buffer.byteLength(args.source_path) > 4096 ||
      !Number.isSafeInteger(count) ||
      count <= 0
    )
      return failure("INVALID_REQUEST");
    if (count > limits.file_bytes) return failure("ATTACHMENT_TOO_LARGE");
    if (
      usage.import_count >= limits.import_count ||
      usage.reserved_bytes + count > limits.reserved_bytes
    )
      return failure("ATTACHMENT_CAPACITY_FULL");
    const entry: AttachmentImport = {
      ...base(command.id),
      schema_version: 1,
      record_type: "AttachmentImport",
      attachment_id: id(),
      expected_sha256: args.expected_sha256,
      expected_bytes: count,
      reserved_bytes: count,
      state: "PENDING",
      error_code: null,
      validation_limits: {
        file_bytes: limits.file_bytes,
        side: limits.side,
        pixels: limits.pixels,
      },
    };
    this.store.commit([
      entry,
      {
        ...command,
        state: "QUEUED",
        resource_ids: [{ type: "AttachmentImport", id: entry.id }],
      },
    ]);
    this.phase?.("reservation", entry.id);
    this.schedule();
  }
  schedule() {
    if (this.running || this.closed) return;
    this.running = new Promise<void>((resolve) => setImmediate(resolve))
      .then(async () => {
        const attempted = new Set<string>();
        while (!this.closed) {
          const next = this.store
            .all<AttachmentImport>("AttachmentImport")
            .find((a) => a.state === "PENDING" && !attempted.has(a.id));
          if (!next) break;
          attempted.add(next.id);
          // A failed journal/fsync is not a definite failed import. Keep reservation.
          try {
            await this.process(next);
          } catch {
            // No path or OS exception text enters a public receipt. If journal IO
            // is still usable, expose that this QUEUED identity requires restart.
            try {
              const command = this.store.get<ApiCommand>("ApiCommand", next.id);
              if (command.state === "QUEUED")
                this.store.commit([
                  revise(command, {
                    error_code: "ATTACHMENT_IMPORT_RETRY_REQUIRED",
                  }),
                ]);
            } catch {
              /* A failed journal remains fail-closed until restart. */
            }
          }
        }
      })
      .finally(() => {
        this.running = undefined;
      });
  }
  async settle() {
    await this.running;
  }
  async close() {
    this.closed = true;
    await this.running;
  }
  private async process(entry: AttachmentImport) {
    const store = this.store,
      command = store.get<ApiCommand>("ApiCommand", entry.id);
    if (command.command !== "attachments/import" || command.state !== "QUEUED")
      throw Error("ATTACHMENT_IMPORT_INVARIANT");
    const args = store.read<ImportArguments>(command.arguments_ref);
    let casMayExist = fs.existsSync(
      path.join(store.dir, "objects", entry.expected_sha256),
    );
    try {
      // Reservations accepted under older limits retain their original hard ceilings.
      const bytes = casMayExist
        ? store.bytes({
            path: "objects/" + entry.expected_sha256,
            sha256: entry.expected_sha256,
            bytes: entry.expected_bytes,
            media_type: "application/octet-stream",
          })
        : sourceBytes(args, entry.validation_limits.file_bytes);
      const decoded = await validateImage(bytes, {
        ...ATTACHMENT_DEFAULTS,
        ...entry.validation_limits,
      });
      casMayExist = true;
      const content = store.put(bytes, decoded.media_type);
      this.phase?.("cas", entry.id);
      const attachment: Attachment = {
        ...base(entry.attachment_id),
        schema_version: 1,
        record_type: "Attachment",
        import_request_id: entry.id,
        name: args.name,
        content,
        width: decoded.width,
        height: decoded.height,
      };
      store.commit([
        attachment,
        revise(entry, { state: "READY" }),
        revise(command, {
          state: "COMPLETED",
          error_code: null,
          resource_ids: [
            { type: "AttachmentImport", id: entry.id },
            { type: "Attachment", id: attachment.id },
          ],
          result_ref: store.put(attachmentMetadata(store, attachment)),
        }),
      ]);
      this.phase?.("ready", entry.id);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      store.commit([
        revise(entry, {
          state: "FAILED",
          error_code: error.code,
          reserved_bytes: casMayExist ? entry.reserved_bytes : 0,
        }),
        revise(command, { state: "FAILED", error_code: error.code }),
      ]);
    }
  }
}
export function attachmentInputView(store: Store, inputID: string) {
  const input = store.get<import("./contracts.ts").Input>("Input", inputID);
  if (!input.attachments?.length) return {};
  return {
    input_id: input.id,
    input_revision: String(input.revision),
    input_state: input.state,
    attachments: input.attachments.map((b) =>
      attachmentMetadata(
        store,
        store.get<Attachment>("Attachment", b.attachment_id),
        false,
      ),
    ),
    withdrawn: input.state === "WITHDRAWN",
  };
}
