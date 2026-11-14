#!/usr/bin/env node
/** Dev preview: print the splash tiers and a sample conversation as ANSI text.
 *   npx tsx src/pi_secretary/scripts/tui-preview.ts splash 120 30
 *   npx tsx src/pi_secretary/scripts/tui-preview.ts chat 100
 * No Core, no TTY, no timers: every frame is a pure function of its inputs. */
import type { Message, TimelineItem } from "../src/api/contracts.ts";
import {
  ActivityIndicator,
  mainActivity,
} from "../src/tui/activity-indicator.ts";
import { Splash } from "../src/tui/splash.ts";
import { setColorDepth, theme } from "../src/tui/theme.ts";
import { timelineComponent } from "../src/tui/view.ts";

const [view = "splash", w = "120", h = "30"] = process.argv.slice(2);
const width = Number(w),
  height = Number(h);
setColorDepth(
  (process.env.SECRETARY_TUI_COLOR as "truecolor" | "256" | "none") ??
    "truecolor",
);
const message = (role: string, text: string, extra = {}): Message =>
  ({
    id: role + text.length,
    kind: "message",
    role,
    text,
    revision: "1",
    persistence: "durable",
    ...extra,
  }) as unknown as Message;

if (view === "splash") {
  const splash = new Splash();
  splash.height = () => height;
  splash.info = {
    connection: "ready",
    mode: "live",
    session: "IDLE",
    reasoningShown: false,
    attention: 2,
  };
  console.log(splash.render(width).join("\n"));
} else {
  const now = Date.parse("2026-11-13T05:00:20Z");
  const items: TimelineItem[] = [
    message(
      "master",
      "帮我看一下 agile 分支昨晚的任务有没有跑完，顺便把 **失败的那一项** 的原因整理出来。",
    ),
    message(
      "assistant",
      "昨晚共 3 项任务：\n\n- `nightly-backup` 已完成\n- `scope-import` 已完成\n- `world-recall-eval` **失败**：召回评测在第 2 批超时\n\n需要我按原要求重做吗？",
    ),
    message("master", "重做，超时放宽到 10 分钟。"),
    {
      id: "tool-1",
      kind: "activity",
      revision: "1",
      activity: {
        id: "tool-1",
        kind: "tool",
        phase: "提交任务请求 world-recall-eval",
        status: "running",
        started_at: "2026-11-13T05:00:08Z",
      },
    } as TimelineItem,
  ];
  const lines = items.flatMap((item) => timelineComponent(item).render(width));
  const indicator = new ActivityIndicator();
  indicator.now = () => now;
  indicator.activity = mainActivity(items);
  console.log(
    [
      ...lines,
      ...indicator.render(width),
      theme.rule("─".repeat(width)),
      " ",
      theme.rule("─".repeat(width)),
      theme.hint("Main · 发送到 Main"),
      theme.hint(
        "/help · Shift+Enter 提交 · ↑ 事项 · PageUp 历史 · Ctrl+C 清空/空框退出",
      ),
    ].join("\n"),
  );
}
