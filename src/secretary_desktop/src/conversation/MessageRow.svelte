<script lang="ts">
  import { onMount } from "svelte";
  import type { Message } from "../contracts";
  import type { BridgePort } from "../bridge";
  import { Avatar, Button, Divider } from "../phaseui";
  import { messageLabel } from "../workflow";
  import { visibleFragment } from "./model";
  import type { Renderer } from "./render";
  let {
    message,
    bridge,
    name,
    renderer,
    more,
    full,
    reload,
    select,
    thinking,
    loading = false,
  }: {
    message: Message;
    bridge: BridgePort;
    name: string;
    renderer: Renderer;
    more: () => void;
    full: () => Promise<string>;
    reload: () => void;
    select: () => void;
    thinking: boolean;
    loading?: boolean;
  } = $props();
  let article: HTMLElement;
  let selected = $state(false);
  let shown = $state("");
  let shownThought = $state("");
  let copiedBody = $state("");
  let copiedPartial = $state(true);
  let expanded = $state(false);
  let status = $state("");
  let inspectedUrl = $state("");
  let label = $derived(
    (
      {
        master_input: "Master 输入",
        assistant_response: "助手回复",
        task_feedback: "任务反馈",
        notification: "通知",
        system_input: "系统输入",
      } as Record<string, string>
    )[message.source_kind ?? ""] ?? "消息",
  );
  let sender = $derived(
    ["master", "user"].includes(message.role)
      ? "Master"
      : message.role === "system"
        ? "System"
        : name,
  );
  let time = $derived(
    message.at && Number.isFinite(Date.parse(message.at))
      ? new Date(message.at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "时间未知",
  );
  $effect(() => {
    if (!selected) {
      copiedBody = message.text;
      copiedPartial =
        !!message.next_cursor ||
        !!message.loaded_portion ||
        message.persistence !== "durable";
      shown = visibleFragment(
        message.text,
        message.persistence === "durable" && !message.next_cursor,
      );
      shownThought = thinking
        ? visibleFragment(
            message.thinking ?? "",
            message.persistence === "durable" && !message.next_cursor,
          )
        : "";
    }
    if (!thinking) {
      shownThought = "";
      expanded = false;
    }
  });
  onMount(() => {
    const update = () => {
      const s = getSelection();
      selected =
        !!s &&
        !s.isCollapsed &&
        !!s.rangeCount &&
        s.getRangeAt(0).intersectsNode(article);
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  });
  async function copy(text: string) {
    try {
      try {
        if (!navigator.clipboard?.writeText) throw Error();
        await navigator.clipboard.writeText(text);
      } catch {
        await bridge.copyText(text);
      }
      status = "已复制";
    } catch (e) {
      status = "复制失败：" + String(e);
    }
  }
  async function openLink() {
    try {
      const result = await bridge.openUrl(inspectedUrl);
      status =
        result === "REQUESTED_UNCONFIRMED"
          ? "已请求打开，尚未确认"
          : "已请求在浏览器打开";
    } catch (e) {
      status = String(e);
    }
  }
  function inspect(event: MouseEvent) {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-url]",
    );
    if (target) {
      event.preventDefault();
      inspectedUrl = target.dataset.url ?? "";
    }
  }
</script>

<article
  bind:this={article}
  data-row-id={message.id}
  data-message-id={message.id}
  data-testid="message"
  class="phase-message"
>
  <Divider edge="bottom" />
  <header>
    <Avatar
      name={sender}
      assistant={["assistant", "secretary"].includes(message.role)}
    /><strong>{sender}</strong>
    <time datetime={message.at} title={message.at}>{time}</time><small
      >{label} · {messageLabel(message)}{message.truncated
        ? " · 预览截断"
        : ""}</small
    >
    <Button variant="text" onclick={select} aria-label="查看此消息关联"
      >关联</Button
    >
  </header>
  {#if thinking && (shownThought || message.role === "assistant" || message.role === "secretary")}
    <details bind:open={expanded} data-testid="thinking">
      <summary
        >思考 · {shownThought
          ? message.persistence === "durable"
            ? "已记录"
            : "部分预览"
          : "暂无可显示内容"}</summary
      >
      {#if expanded}<div class="prose thinking-body">
          {@html renderer.render(message.id + "|thought", shownThought)}
        </div>{/if}
    </details>
  {/if}
  <!-- Delegated buttons are emitted by the HTML-disabled renderer. -->
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="prose" onclick={inspect}>
    {@html renderer.render(message.id + "|body", shown)}
  </div>
  {#if message.preview_availability === "expired"}<p>
      预览已失效，无最终记录。
    </p>{/if}
  {#if selected}<small>选中文本保持不变；取消选择后显示最新内容。</small>{/if}
  <div class="actions">
    {#if message.next_cursor && message.persistence === "durable"}<Button
        variant="text"
        disabled={loading}
        onclick={more}>继续读取内容</Button
      >{/if}
    <Button variant="text" onclick={() => copy(copiedBody)}
      >{copiedPartial ? "复制已加载部分" : "复制完整正文"}</Button
    >
    {#if message.persistence === "durable" && copiedPartial}<Button
        variant="text"
        disabled={loading || selected}
        onclick={async () => {
          status = "正在读取到末尾…";
          try {
            await copy(await full());
          } catch (e) {
            status = "未复制完整正文：" + String(e);
          }
        }}>读取并复制完整正文</Button
      >{/if}
    {#if message.persistence === "durable"}<Button
        variant="text"
        disabled={loading}
        onclick={reload}>重新读取</Button
      >{/if}
  </div>
  {#if inspectedUrl}<div class="link-inspection">
      <p>链接地址：<code>{inspectedUrl}</code></p>
      <Button variant="text" onclick={openLink}>在浏览器打开</Button><Button
        variant="text"
        onclick={() => copy(inspectedUrl)}>复制地址</Button
      ><Button variant="text" onclick={() => (inspectedUrl = "")}>关闭</Button>
    </div>{/if}
  {#if status}<p role="status">{status}</p>{/if}
</article>
