import { wellFormed } from "./task-identity.ts";
export type SelectorKind = "title" | "id" | "auto";
export function selectorValue(value: string) {
  if (
    !wellFormed(value) ||
    /[\x00-\x1f\x7f-\x9f]/u.test(value) ||
    Buffer.byteLength(value) > 1024
  )
    throw Error("INVALID_LOCATOR");
  return value.normalize("NFC");
}
export function parseTaskSelector(
  rest: string,
): { id: string; selectorKind?: SelectorKind } | undefined {
  if (!rest.startsWith(" ") || /[\r\n]/.test(rest)) return;
  const arg = rest.slice(1).replace(/[ \t]+$/, "");
  try {
    if (arg.startsWith('"')) {
      if (!/^"(?:[^"\\\x00-\x1f\x7f-\x9f]|\\["\\])*"$/u.test(arg)) return;
      const id = selectorValue(JSON.parse(arg));
      return id ? { id, selectorKind: "title" } : undefined;
    }
    if (arg.startsWith("--id ")) {
      const id = arg.slice(5);
      return /^[0-9A-Za-z-]+$/.test(id)
        ? { id, selectorKind: "id" }
        : undefined;
    }
    if (!arg || /[\s"\\]/u.test(arg)) return;
    return { id: selectorValue(arg) };
  } catch {
    return;
  }
}
export function executionRound(value: string) {
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw Error("INVALID_EXECUTION_ROUND");
  return Number(value);
}
