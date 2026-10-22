<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import Connected from "../Connected.svelte";
  import { tickDue } from "./schedule";
  import { fixtureBridge } from "./fixture";
  import { motionController, type MotionMode } from "./motion/controller";
  let {
    scenario,
    mode,
    seed,
    measure,
    coverage = true,
    theme = "light",
    width = 1180,
  }: {
    scenario: string;
    mode: MotionMode;
    seed: number;
    measure: boolean;
    coverage?: boolean;
    theme?: "light" | "dark";
    width?: number;
  } = $props();
  // svelte-ignore state_referenced_locally
  const fixture = fixtureBridge(scenario.startsWith("conversation-"));
  let conversationStats: Record<string,number> = {};
  const conversationPeak: Record<string,number> = {};
  function metrics(value: Record<string,number>) {
    conversationStats = value;
    for (const [key,n] of Object.entries(value)) conversationPeak[key] = Math.max(conversationPeak[key] ?? 0,n);
  }
  onMount(() => {
    motionController.configure({ seed, measure, coverage });
    void invoke("phaseui_view", { width, zoom: 1 });
    let raf = 0,
      previous = 0,
      count = 0,
      stopped = false,
      activeStart = 0,
      drainedAt = 0,
      ticks = 0,
      backgroundTicks = 0,
      maxLateness = 0;
    const period = scenario === "stream-stress" ? 50 : 250;
    const expectedTicks = 60000 / period;
    const started = performance.now(),
      deltas: number[] = [],
      latencies: number[] = [];
    let baseline = motionController.counts();
    const settle = scenario === "idle" ? 30000 : 5000;
    const percentile = (values: number[], p: number) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor((sorted.length - 1) * p)] ?? null;
    };
    const frames = (now: number) => {
      if (previous && activeStart && !drainedAt) deltas.push(now - previous);
      previous = now;
      step();
      if (!stopped) raf = requestAnimationFrame(frames);
    };
    if (measure) raf = requestAnimationFrame(frames);
    const ready = setTimeout(() => {
      void invoke("study_ready").catch(() => {});
    }, 500);
    const step = () => {
      const now = performance.now();
      if (now - started < settle || stopped) return;
      if (!activeStart) {
        activeStart = now;
        baseline = motionController.counts();
      }
      if (drainedAt) {
        if (now - drainedAt < 30000) return;
        finish();
        return;
      }
      if (
        now - activeStart >= 60000 &&
        (scenario === "idle" || ticks >= expectedTicks)
      ) {
        fixture.drain();
        document
          .querySelector<HTMLElement>("[data-page=conversation]")
          ?.click();
        motionController.clearAll();
        drainedAt = now;
        return;
      }
      if (!tickDue(now - activeStart, ticks, period, expectedTicks)) return;
      maxLateness = Math.max(maxLateness, now - activeStart - ticks * period);
      const targets = [
        ...document.querySelectorAll<HTMLElement>(".phase-directory a"),
      ];
      ticks++;
      if (document.hidden || !document.hasFocus()) backgroundTicks++;
      if (
        scenario === "stream-stress" ||
        scenario === "bridge-cadence" ||
        scenario === "conversation-stream"
      ) {
        fixture.advance();
        count++;
      }
      let action = false;
      if (
        (scenario === "stream-stress" && ticks % 10 === 1) ||
        (scenario === "bridge-cadence" && ticks % 2 === 1)
      ) {
        const node = targets[((ticks / 2) | 0) % targets.length];
        node?.focus();
        action = true;
      }
      if (scenario === "single" && ticks % 2 === 1) {
        const candidates = [
          ...document.querySelectorAll<HTMLElement>(
            ".phase-directory a,.phase-brand,.phase-avatar,.phase-input",
          ),
        ].filter((n) => {
          const b = n.getBoundingClientRect();
          return (
            n.getClientRects().length && b.top >= 0 && b.bottom <= innerHeight
          );
        });
        const node = candidates[count % candidates.length];
        if (node) motionController.play(node);
        count++;
        action = true;
      }
      if (scenario === "navigation" && ticks % 2 === 1) {
        const node = targets[count % targets.length];
        node?.click();
        queueMicrotask(() => node?.focus());
        count++;
        action = true;
      }
      if (scenario === "input-scroll" && ticks % 2 === 1) {
        const editor = document.querySelector<HTMLTextAreaElement>("#draft");
        if (editor) {
          editor.value = "人工输入 " + count;
          editor.dispatchEvent(new Event("input", { bubbles: true }));
          editor.focus();
        }
        const panel = document.querySelector<HTMLElement>("main.connected");
        if (panel) panel.scrollTop = count % 2 ? panel.scrollHeight : 0;
        count++;
        action = true;
      }
      if (scenario.startsWith("conversation-") && ticks % 2 === 1) {
        const buttons = [
          ...document.querySelectorAll<HTMLButtonElement>(
            "main.connected button",
          ),
        ];
        const click = (text: string) =>
          buttons.find((b) => b.textContent?.trim() === text)?.click();
        if (scenario === "conversation-history")
          click(count % 3 === 2 ? "转到最新消息" : "较早消息");
        if (scenario === "conversation-expand") {
          const row = [
            ...document.querySelectorAll<HTMLElement>("[data-testid=message]"),
          ].find((r) => {
            const b = r.getBoundingClientRect();
            return b.top >= 188 && b.bottom < innerHeight - 200;
          });
          row?.querySelector<HTMLElement>("summary")?.click();
          [...(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
            .find((b) => b.textContent?.trim() === "复制完整正文")
            ?.click();
        }
        if (scenario === "conversation-stream" && count === 1) {
          const text = document.querySelector(
            "[data-testid=message] .prose p",
          )?.firstChild;
          if (text) {
            const range = document.createRange();
            range.selectNodeContents(text);
            getSelection()?.removeAllRanges();
            getSelection()?.addRange(range);
          }
        }
        count++;
        action = true;
      }
      if (action && measure)
        requestAnimationFrame(() => latencies.push(performance.now() - now));
    };
    // Reporting-off idle has no rAF loop. Active instrumented replay uses one
    // shared frame loop and clock deadlines, never timer callback parity.
    const interval = measure ? undefined : setInterval(step, 250);
    function finish() {
      stopped = true;
      cancelAnimationFrame(raf);
      clearInterval(interval);
      const report = {
        phaseui: true,
        conversation: { peak: conversationPeak, recovery: conversationStats },
        scenario,
        mode,
        seed,
        completed:
          !!drainedAt &&
          (scenario === "idle" || ticks === expectedTicks) &&
          fixture.status().pending === 0 &&
          fixture.status().previewLength === 0,
        queue: fixture.status().pending,
        coverage,
        theme,
        background_ticks: backgroundTicks,
        active_ticks: ticks,
        expected_ticks: expectedTicks,
        schedule_lateness_max_ms: maxLateness,
        samples: deltas.length,
        raf_p50: percentile(deltas, 0.5),
        raf_p95: percentile(deltas, 0.95),
        raf_p99: percentile(deltas, 0.99),
        over_25ms: deltas.filter((n) => n > 25).length,
        over_33ms: deltas.filter((n) => n > 1000 / 30).length,
        action_samples: latencies.length,
        action_raf_p50: percentile(latencies, 0.5),
        action_raf_p95: percentile(latencies, 0.95),
        updates: count,
        baseline,
        recovery: motionController.counts(),
        motion: {
          completed: motionController.metrics.completed,
          interrupted: motionController.metrics.interrupted,
          covered: motionController.metrics.covered,
          construction_count: motionController.metrics.construction.length,
          construction_p95: percentile(
            motionController.metrics.construction,
            0.95,
          ),
          construction_max: Math.max(
            0,
            ...motionController.metrics.construction,
          ),
        },
        active_ms: drainedAt - activeStart,
        recovery_ms: performance.now() - drainedAt,
        elapsed_ms: performance.now() - started,
        viewport: {
          width: innerWidth,
          height: innerHeight,
          scale: devicePixelRatio,
        },
      };
      if (measure)
        void invoke("study_metrics", { report: JSON.stringify(report) }).catch(
          () => {},
        );
    }
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      clearInterval(interval);
      clearTimeout(ready);
      motionController.clearAll();
    };
  });
</script>

<Connected
  bridge={fixture.port}
  synthetic
  {metrics}
  initialMode={mode}
  initialTheme={theme}
  transientCadence={scenario === "stream-stress" ? 50 : 250}
/>
