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
  const fixture = fixtureBridge();
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
      if (scenario === "stream-stress" || scenario === "bridge-cadence") {
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
  initialMode={mode}
  initialTheme={theme}
  transientCadence={scenario === "stream-stress" ? 50 : 250}
/>
