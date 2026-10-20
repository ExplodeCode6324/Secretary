<script lang="ts">
  import Divider from "./Divider.svelte";
  import type { Snippet } from "svelte";
  let { children, meta }: { children: Snippet; meta?: Snippet } = $props();
</script>

<div class="phase-row">
  <Divider edge="bottom" />
  <div class="row-main">{@render children()}</div>
  {#if meta}<small>{@render meta()}</small>{/if}
</div>
