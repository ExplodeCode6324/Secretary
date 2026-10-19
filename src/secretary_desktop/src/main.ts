if (import.meta.env.VITE_NATIVE_TEST === "1")
  await import("@wdio/tauri-plugin");
import { mount } from "svelte";
import App from "./App.svelte";
import Connected from "./Connected.svelte";
import { invoke } from "@tauri-apps/api/core";
import "./style.css";
const mode = await invoke<{ study: boolean }>("study_mode").catch(() => ({
  study: true,
}));
mount(mode.study ? App : Connected, {
  target: document.getElementById("app")!,
});
