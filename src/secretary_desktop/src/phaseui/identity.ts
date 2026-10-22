export function displayName(name?: string) {
  return name?.trim() || "Secretary";
}
export function initial(name: string) {
  const value = displayName(name);
  if (typeof Intl.Segmenter === "function")
    return [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        value,
      ),
    ][0].segment;
  return [...value][0];
}
