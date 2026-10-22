<script lang="ts">
  import { motion } from "./motion/controller";
  import { initial } from "./identity";
  let { name, assistant = false }: { name: string; assistant?: boolean } =
    $props();
</script>

<span
  class="phase-avatar"
  class:assistant
  role="img"
  aria-label={name}
  use:motion={{ kind: "identity" }}
  ><span data-identity-source>{initial(name)}</span><span
    data-phase-layer
    aria-hidden="true"
  ></span></span
>
