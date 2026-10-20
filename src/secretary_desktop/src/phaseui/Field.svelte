<script lang="ts">
  import type { Snippet } from "svelte";
  import { motion } from "./motion/controller";
  let {
    children,
    disabled = false,
    id,
  }: { children: Snippet; disabled?: boolean; id?: string } = $props();
</script>

<div class="phase-input" {id} use:motion={{ kind: "input", disabled }}>
  {@render children()}<span data-phase-layer aria-hidden="true"></span>
</div>
