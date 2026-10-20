<script lang="ts">
  let { label, value }: { label: string; value?: number } = $props();
</script>

<div class="phase-progress" role="status">
  <span>{label}</span>{#if value !== undefined}<progress
      aria-label={label}
      {value}
      max="100"
    ></progress>{/if}
</div>
