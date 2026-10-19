if (import.meta.env.VITE_NATIVE_TEST === "1")
  await import("@wdio/tauri-plugin");
import { mount } from "svelte";
import App from "./App.svelte";
import "./style.css";
mount(App, { target: document.getElementById("app")! });
