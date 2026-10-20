<script lang="ts">
  import { motion } from "./motion/controller";
  let {
    navigation = false,
    edge,
  }: { navigation?: boolean; edge?: "top" | "bottom" | "left" | "right" } =
    $props();
</script>

<div
  class="phase-divider"
  class:phase-edge={!!edge}
  data-edge={edge}
  data-nav-divider={navigation || undefined}
  aria-hidden="true"
  use:motion={{
    kind: "divider",
    vertical: edge === "left" || edge === "right",
  }}
>
  <span data-phase-layer aria-hidden="true"></span>
</div>
