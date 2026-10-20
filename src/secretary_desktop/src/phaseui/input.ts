export function sendShortcut(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "metaKey"
    | "ctrlKey"
    | "altKey"
    | "shiftKey"
    | "isComposing"
    | "keyCode"
    | "repeat"
  >,
  composing: boolean,
) {
  return (
    event.key === "Enter" &&
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.repeat &&
    !composing &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}
