<script lang="ts">
  import Button from "./Button.svelte";
  let {
    options,
    value = $bindable(""),
  }: { options: string[]; value?: string } = $props();
</script>

<div class="phase-filters" role="group" aria-label="筛选">
  {#each options as option}<Button
      variant="text"
      aria-pressed={value === option}
      onclick={() => (value = option)}>{option}</Button
    >{/each}
</div>
