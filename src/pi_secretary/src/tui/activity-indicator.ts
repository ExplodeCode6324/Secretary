import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { TimelineItem } from "../api/contracts.ts";
import { paint, theme } from "./theme.ts";
import { safeText } from "./view.ts";

/** What Main is doing right now, derived only from Core-reported state. */
export type MainActivity = {
  kind: "sending" | "thinking" | "replying" | "tool" | "memory";
  label: string;
  /** ISO time from Core (or local send time for "sending"). */
  since?: string;
};

/**
 * Priority: a running tool > streaming reply > model call > memory upkeep.
 * Task (background) activities are ignored: they must not make Main look busy.
 * A locally pending send is reported separately and never as "thinking" (IN-05).
 */
export function mainActivity(
  items: Iterable<TimelineItem>,
  pendingSend?: { status: string; created_at?: string },
): MainActivity | undefined {
  let model: MainActivity | undefined,
    tool: MainActivity | undefined,
    reply: MainActivity | undefined,
    memory: MainActivity | undefined;
  for (const item of items) {
    if (item.kind === "message") {
      if (item.persistence === "transient" && item.preview_status === "running")
        reply = item.text
          ? { kind: "replying", label: "正在回复", since: item.at as string }
          : reply;
      continue;
    }
    const a = item.activity;
    if (a.status !== "running" || a.execution_id || a.source === "durable")
      continue;
    const entry = {
      label: safeText(String(a.phase ?? "")).replace(/\s+/g, " "),
      since: a.started_at as string | undefined,
    };
    if (a.kind === "tool") tool = { kind: "tool", ...entry };
    else if (a.kind === "model")
      model = { kind: "thinking", ...entry, label: entry.label || "正在思考" };
    else if (a.kind === "compaction" || a.kind === "settings")
      memory = { kind: "memory", ...entry };
  }
  const active = tool ?? reply ?? model ?? memory;
  if (active) return active;
  // UNKNOWN = handed to the Core, receipt not yet confirmed. CONFLICT is an error, not progress.
  if (pendingSend?.status === "UNKNOWN")
    return {
      kind: "sending",
      label: "正在送达 Core",
      since: pendingSend.created_at,
    };
  return undefined;
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const ACTIVITY_FRAME_MS = 80;

/** One fixed row above the editor. Blank when idle, so the layout never jumps. */
export class ActivityIndicator implements Component {
  activity?: MainActivity;
  /** false => static glyph, no timer (SECRETARY_TUI_MOTION=off, or tests). */
  motion = true;
  now = () => Date.now();
  invalidate() {}

  private elapsed() {
    const start = this.activity?.since ? Date.parse(this.activity.since) : NaN;
    if (Number.isNaN(start)) return "";
    const seconds = Math.max(0, Math.floor((this.now() - start) / 1000));
    if (seconds < 1) return "";
    return seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
  }

  /** A soft highlight that sweeps across the label; pure function of time. */
  private shimmer(label: string, frame: number) {
    const chars = Array.from(label),
      head = frame % (chars.length + 8);
    return chars
      .map((c, i) => {
        const d = Math.abs(i - head);
        return paint(d === 0 ? "ice" : d === 1 ? "sky" : "blue")(c);
      })
      .join("");
  }

  render(width: number): string[] {
    const a = this.activity;
    if (!a) return [""];
    const frame = this.motion ? Math.floor(this.now() / ACTIVITY_FRAME_MS) : 0;
    const accent = a.kind === "sending" ? theme.waiting : theme.working;
    const glyph = this.motion ? FRAMES[frame % FRAMES.length] : "●";
    const label = this.motion
      ? this.shimmer(a.label, Math.floor(frame / 2))
      : theme.running(a.label);
    const elapsed = this.elapsed();
    return [
      truncateToWidth(
        ` ${accent(glyph)} ${label}${elapsed ? theme.hint(" · " + elapsed) : ""}`,
        Math.max(1, width),
      ),
    ];
  }
}
