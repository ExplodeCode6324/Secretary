import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getNativeClipboard } from "@earendil-works/pi-tui";
import { assertLocalMac } from "./clipboard.ts";
export type PasteboardProbe = { types: string[]; changeCount: number };
export function parseProbe(raw: string): PasteboardProbe {
  const v = JSON.parse(raw);
  if (
    !v ||
    Object.keys(v).sort().join(",") !== "changeCount,types" ||
    !Array.isArray(v.types) ||
    !v.types.every((s: unknown) => typeof s === "string") ||
    !Number.isSafeInteger(v.changeCount)
  )
    throw Error("CLIPBOARD_PROBE_INVALID");
  return v;
}
export function probePasteboard(): Promise<PasteboardProbe> {
  assertLocalMac();
  return new Promise((resolve, reject) => {
    const child = spawn(
      "/usr/bin/osascript",
      [
        "-l",
        "JavaScript",
        fileURLToPath(new URL("./pasteboard-probe.js", import.meta.url)),
      ],
      { shell: false, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "",
      failed = false;
    const fail = (reason: string) => {
      failed = true;
      child.kill("SIGKILL");
      reject(Error(reason));
    };
    const timer = setTimeout(() => fail("CLIPBOARD_PROBE_TIMEOUT"), 3000);
    child.stdout.on("data", (b) => {
      stdout += b.toString();
      if (Buffer.byteLength(stdout) > 65536) fail("CLIPBOARD_PROBE_TOO_LARGE");
    });
    child.stderr.on("data", (b) => {
      stderr += b.toString();
      if (Buffer.byteLength(stderr) > 65536) fail("CLIPBOARD_PROBE_TOO_LARGE");
    });
    child.once("error", () => {
      clearTimeout(timer);
      fail("CLIPBOARD_PROBE_UNAVAILABLE");
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failed) return;
      try {
        if (code !== 0) throw Error("CLIPBOARD_PROBE_FAILED");
        resolve(parseProbe(stdout));
      } catch (e) {
        reject(e);
      }
    });
  });
}
export function clipboardKind(probe: PasteboardProbe) {
  if (
    probe.types.some((t) =>
      [
        "public.file-url",
        "NSFilenamesPboardType",
        "CorePasteboardFlavorType 0x6675726C",
      ].includes(t),
    )
  )
    throw Error("CLIPBOARD_FILE_REFERENCE_NOT_IMAGE");
  return probe.types.some((t) =>
    [
      "public.png",
      "public.tiff",
      "public.jpeg",
      "com.compuserve.gif",
      "public.heic",
      "public.heif",
      "com.microsoft.bmp",
      "public.image",
      "NSTIFFPboardType",
    ].includes(t),
  )
    ? "image"
    : "text";
}
export async function readClipboard(
  imageOnly: boolean,
  authorizeImage: () => Promise<unknown>,
  deps = { probe: probePasteboard, clipboard: getNativeClipboard },
) {
  assertLocalMac();
  const before = await deps.probe(),
    kind = clipboardKind(before);
  const clipboard = deps.clipboard();
  if (!clipboard) throw Error("CLIPBOARD_UNAVAILABLE");
  let image: Uint8Array | null | undefined = null;
  if (kind === "image") {
    await authorizeImage();
    image = await clipboard.getImage();
    if (!image?.length) throw Error("CLIPBOARD_IMAGE_UNAVAILABLE");
  }
  let text: string | null | undefined;
  if (!image && !imageOnly) text = await clipboard.getText();
  const after = await deps.probe();
  clipboardKind(after);
  if (before.changeCount !== after.changeCount)
    throw Error("CLIPBOARD_CHANGED");
  if (image) return { kind: "image" as const, bytes: Buffer.from(image) };
  if (imageOnly) throw Error("NO_CLIPBOARD_IMAGE");
  if (text === undefined) throw Error("CLIPBOARD_TEXT_UNAVAILABLE");
  if (!text) throw Error("CLIPBOARD_EMPTY");
  return { kind: "text" as const, text };
}
