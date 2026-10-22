<script lang="ts">
  import type { HTMLButtonAttributes } from "svelte/elements";
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import { motion } from "./motion/controller";
  let {
    children,
    icon,
    variant = "border",
    primary = false,
    disabled = false,
    class: className = "",
    ...rest
  }: HTMLButtonAttributes & {
    children?: Snippet;
    icon?: string;
    variant?: "border" | "text" | "send";
    primary?: boolean;
  } = $props();
</script>

<button
  {...rest}
  {disabled}
  class={`${variant === "text" ? "phase-text-button" : "phase-button"} ${primary ? "primary" : ""} ${variant === "send" ? "phase-send" : ""} ${className}`}
  use:motion={{
    kind:
      variant === "send"
        ? "send"
        : icon
          ? "glyph"
          : variant === "text"
            ? "underline"
            : "border",
    disabled: !!disabled,
  }}
>
  {#if icon}<Icon name={icon} />{/if}{@render children?.()}<span
    data-phase-layer
    aria-hidden="true"
  ></span>
</button>
