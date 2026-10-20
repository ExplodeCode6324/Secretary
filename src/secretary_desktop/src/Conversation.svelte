<script lang="ts">
  import type { Message, TimelineItem } from "./contracts";
  import { render } from "./study";
  import { messageLabel } from "./workflow";
  import { bridge } from "./bridge";
  let { items, domain }: { items: TimelineItem[]; domain: string } = $props();
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
    <article data-message-id={m.id} data-testid="message" class="message-row">
      <header>
        <strong
          >{["master", "user"].includes(m.role)
            ? "您"
            : m.role === "system"
              ? "系统"
              : "Secretary"}</strong
        > <time>{m.at ?? ""}</time>
        <small>{messageLabel(m)}{m.truncated ? " · 预览截断" : ""}</small>
      </header>
      <div class="prose">{@html render(m.text)}</div>
      {#if m.next_cursor}<button
          disabled={loading !== ""}
          onclick={() => more(m)}>继续读取内容</button
        >{/if}
    </article>
  {:else}<p class="activity">
      {item.activity.phase ?? item.activity.kind ?? "活动"} · {item.activity
        .status ?? ""}
    </p>{/if}
{/each}

<style>
  .message-row {
    padding: 12px 0;
    border-bottom: 1px solid #e0e8f1;
    overflow-wrap: anywhere;
  }
  header {
    font-size: 13px;
    color: #516582;
  }
  small {
    margin-left: 8px;
  }
  .activity {
    color: #64758b;
    font-size: 13px;
  }
</style>
