<script lang="ts">
  import Divider from "./Divider.svelte";
  import type { Snippet } from "svelte";
  let {
    state = "idle",
    children,
  }: {
    state?: "idle" | "pending" | "success" | "error" | "offline" | "stale";
    children: Snippet;
  } = $props();
</script>

<div
  class="phase-banner"
  data-state={state}
  role={state === "error" ? "alert" : "status"}
>
  <Divider edge="bottom" />
  {@render children()}
</div>
