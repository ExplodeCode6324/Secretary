<script lang="ts">
  import { phaseFrames, outline } from "./study";
  let { frame = 0 }: { frame?: number } = $props();
</script>

<svg
  class="phase-icon"
  viewBox="-4 0 40 36"
  aria-label="Secretary"
  role="img"
  data-frame={frame}
>
  <defs
    >{#each [0, 1, 2] as band}<clipPath id={"band-" + band}
        ><rect x="-10" y={band * 12} width="52" height="12" /></clipPath
      >{/each}</defs
  >
  {#each [0, 1, 2] as band}
    <g clip-path={"url(#band-" + band + ")"} data-band={band}>
      <path
        d={outline}
        transform={"translate(" + phaseFrames[frame][band] + " 0)"}
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
    </g>{/each}
</svg>
