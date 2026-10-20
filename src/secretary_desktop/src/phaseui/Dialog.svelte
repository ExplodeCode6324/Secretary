<script lang="ts">
  import { tick } from "svelte";
  import type { Snippet } from "svelte";
  import Button from "./Button.svelte";
  let {
    open = $bindable(false),
    title,
    children,
  }: { open?: boolean; title: string; children: Snippet } = $props();
  let element: HTMLDialogElement;
  let origin: HTMLElement | null = null;
  $effect(() => {
    if (!element) return;
    if (open && !element.open) {
      origin = document.activeElement as HTMLElement;
      element.showModal();
      void tick().then(() =>
        element
          .querySelector<HTMLElement>("input,select,textarea,button")
          ?.focus(),
      );
    } else if (!open && element.open) {
      element.close();
      if (origin?.isConnected) origin.focus();
    }
  });
  function close() {
    open = false;
    if (origin?.isConnected) origin.focus();
  }
</script>

<dialog
  bind:this={element}
  class="phase-dialog"
  aria-label={title}
  oncancel={close}
  onclose={close}
>
  <header>
    <h2>{title}</h2>
    <Button variant="text" onclick={close} aria-label="关闭对话框">关闭</Button>
  </header>
  {@render children()}
</dialog>
