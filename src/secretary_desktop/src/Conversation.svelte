<script lang="ts">
  import type { Message, TimelineItem } from "./contracts";
  import { render } from "./study";
  import { messageLabel } from "./workflow";
  import { bridge as realBridge, type BridgePort } from "./bridge";
  import { Avatar, Button, Divider } from "./phaseui";
  let {
    items,
    domain,
    name = "Secretary",
    bridge = realBridge,
  }: {
    items: TimelineItem[];
    domain: string;
    name?: string;
    bridge?: BridgePort;
  } = $props();
  let extras = $state<Record<string, Message>>({});
  let error = $state("");
  let loading = $state("");
  async function more(m: Message) {
    const key = m.id + ":" + m.revision,
      d = domain;
    loading = key;
    try {
      const next = await bridge.query<Message>(d, {
        operation: "messages/{id}/content",
        id: m.id,
        parameters: { cursor: m.next_cursor! },
      });
      // Message content paths use message IDs; the bridge validates their public format.
      if (domain === d && next.revision === m.revision)
        extras[key] = { ...next, text: m.text + next.text };
    } catch (e) {
      error = String(e);
    } finally {
      loading = "";
    }
  }
</script>

{#if error}<p role="alert">{error}</p>{/if}
{#each items as item (item.id)}
  {#if item.kind === "message"}
    {@const m = extras[item.id + ":" + item.revision] ?? item}
    <article data-message-id={m.id} data-testid="message" class="phase-message">
      <Divider edge="bottom" />
      <header>
        <Avatar
          name={["master", "user"].includes(m.role)
            ? "Master"
            : m.role === "system"
              ? "System"
              : name}
          assistant={["assistant", "secretary"].includes(m.role)}
        />
        <strong
          >{["master", "user"].includes(m.role)
            ? "Master"
            : m.role === "system"
              ? "System"
              : name}</strong
        > <time>{m.at ?? ""}</time>
        <small>{messageLabel(m)}{m.truncated ? " · 预览截断" : ""}</small>
      </header>
      <div class="prose">{@html render(m.text)}</div>
      {#if m.next_cursor}<Button
          variant="text"
          disabled={loading !== ""}
          onclick={() => more(m)}>继续读取内容</Button
        >{/if}
    </article>
  {:else}<p class="activity">
      {item.activity.phase ?? item.activity.kind ?? "活动"} · {item.activity
        .status ?? ""}
    </p>{/if}
{/each}
