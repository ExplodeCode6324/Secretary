<script lang="ts">
  import { geometry } from "./geometry";
  let { name = "file", size = 24 }: { name?: string; size?: number } = $props();
</script>

<span
  class="phase-glyph"
  data-glyph={name}
  aria-hidden="true"
  style:width={size + "px"}
  style:height={size + "px"}
  ><svg viewBox="0 0 24 24" focusable="false"
    ><g data-source
      >{#each (geometry[name] ?? geometry.file).body as d}<path {d} />{/each}</g
    ></svg
  ></span
>
