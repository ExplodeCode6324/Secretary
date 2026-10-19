<script lang="ts">
  import { onMount } from "svelte";
  import { render, type Message } from "./study";
  let {
    message,
    retain = false,
    baseline = false,
  }: { message: Message; retain?: boolean; baseline?: boolean } = $props();
  let host: HTMLElement;
  let visible = $state(false);
  let height = $state(180);
  let html = $derived(
    visible || retain || baseline ? render(message.source) : "",
  );
  onMount(() => {
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { root: document.querySelector(".document-scroll"), rootMargin: "900px" },
    );
    io.observe(host);
    const ro = new ResizeObserver(() => {
      if (visible || retain || baseline)
        height = host.getBoundingClientRect().height;
    });
    ro.observe(host);
    return () => {
      io.disconnect();
      ro.disconnect();
    };
  });
</script>

<section
  bind:this={host!}
  class:baseline
  class="message"
  data-message={message.id}
  style:min-height={html ? undefined : height + "px"}
>
  {#if html}
    <header>
      <span>{message.role}</span><time>{message.time}</time><small
        >{String(message.id + 1).padStart(3, "0")}</small
      >
    </header>
    <div class="prose">{@html html}</div>
  {/if}
</section>
