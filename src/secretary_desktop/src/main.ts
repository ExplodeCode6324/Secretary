if (import.meta.env.VITE_NATIVE_TEST === "1")
  await import("@wdio/tauri-plugin");
import { mount } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import type { MotionMode } from "./phaseui/motion/controller";
const target = document.getElementById("app")!;
try {
  const mode = await invoke<{
    study: boolean;
    phase: string;
    motion: MotionMode;
    seed: number;
    measure: boolean;
  }>("study_mode");
  if (mode.study) {
    await import("./style.css");
    const { default: App } = await import("./App.svelte");
    mount(App, { target });
  } else {
    await import("./phaseui/tokens.css");
    if (mode.phase && import.meta.env.VITE_NATIVE_TEST === "1") {
      const { motionController } = await import("./phaseui/motion/controller");
      (window as unknown as { phaseTest: unknown }).phaseTest =
        motionController;
    }
    if (mode.phase === "gallery") {
      const { default: Gallery } = await import("./phaseui/Gallery.svelte");
      mount(Gallery, { target, props: { mode: mode.motion, seed: mode.seed } });
    } else if (mode.phase) {
      const { default: Harness } = await import("./phaseui/Harness.svelte");
      mount(Harness, {
        target,
        props: {
          scenario: mode.phase,
          mode: mode.motion,
          seed: mode.seed,
          measure: mode.measure,
        },
      });
    } else {
      const { default: Connected } = await import("./Connected.svelte");
      mount(Connected, { target });
    }
  }
} catch (error) {
  target.textContent = `Secretary could not start: ${String(error)}`;
}
