<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { BridgePort, MessageOutbox, MessageBody } from "../bridge";
  import type { TimelineItem } from "../contracts";
  import { outboxLabel } from "./model";
  import { Button, Dialog } from "../phaseui";
  let {
    domain,
    bridge,
    restore,
    items,
  }: {
    domain: string;
    bridge: BridgePort;
    restore: (text: string) => Promise<void>;
    items: TimelineItem[];
  } = $props();
  let page = $state<MessageOutbox | null>(null),
    body = $state<MessageBody | null>(null);
  let error = $state(""),
    recovered = $state(""),
    busy = $state(false),
    confirm = $state(false);
  let sequence = 0;
  async function load(before?: number) {
    if (busy) return;
    busy = true;
    const seq = ++sequence;
    try {
      const value = await bridge.messageOutbox(domain, before);
      if (seq === sequence) page = value;
    } catch (e) {
      if (seq === sequence) error = String(e);
    } finally {
      if (seq === sequence) busy = false;
    }
  }
  async function inspect(id: string) {
    if (busy) return;
    busy = true;
    const seq = ++sequence;
    body = null;
    recovered = "";
    error = "";
    try {
      const value = await bridge.messageBody(domain, id);
      if (seq === sequence) body = value;
    } catch (e) {
      if (seq === sequence) error = String(e);
    } finally {
      if (seq === sequence) busy = false;
    }
  }
  async function recover(copy: boolean) {
    if (!body || busy) return;
    const value = body;
    busy = true;
    try {
      if (copy) await bridge.copyText(value.text);
      else await restore(value.text);
      recovered = value.id;
      error = copy ? "已复制完整原文" : "已恢复到编辑器；尚未发送";
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }
  async function discard() {
    if (!body || recovered !== body.id || body.state !== "FAILED" || busy)
      return;
    busy = true;
    try {
      await bridge.discardMessage(domain, body.id);
      body = null;
      confirm = false;
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
      await load();
    }
  }
  onMount(() => {
    void load();
  });
  onDestroy(() => sequence++);
</script>

<section aria-label="消息恢复" class="message-recovery">
  <h2>未完成与失败消息</h2>
  <p>这里读取本机完整发送意图；恢复不会自动发送。</p>
  <Button variant="text" disabled={busy} onclick={() => load()}>刷新列表</Button
  >
  {#each page?.items ?? [] as row (row.id)}<p>
      <code>{row.id}</code> · {outboxLabel(row.state)}
      <Button variant="text" disabled={busy} onclick={() => inspect(row.id)}
        >查看完整原文</Button
      >
    </p>{/each}
  {#if page?.next}<Button
      variant="text"
      disabled={busy}
      onclick={() => load(page!.next!)}>更早记录</Button
    >{/if}
  {#if body}<article>
      <p>{outboxLabel(body.state)}</p>
      {#if body.state !== "FAILED"}<p role="alert">
          此请求可能已被记录。恢复后再次手动发送会产生新请求，可能重复原操作。
        </p>{/if}
      {#if items.some((r) => r.kind === "message" && r.request_id === body?.id)}<p
        >
          已加载窗口包含此请求的持久输入记录。
        </p>{/if}
      <pre>{body.text}</pre>
      <Button variant="text" disabled={busy} onclick={() => recover(true)}
        >复制完整原文</Button
      ><Button variant="text" disabled={busy} onclick={() => recover(false)}
        >我已核对，恢复到空编辑器</Button
      >
      {#if body.state === "FAILED" && recovered === body.id}<Button
          variant="text"
          onclick={() => (confirm = true)}>丢弃已恢复的失败记录…</Button
        >{/if}
    </article>{/if}
  {#if error}<p role="status">{error}</p>{/if}
  <Dialog bind:open={confirm} title="丢弃失败记录"
    ><p>只删除这条已确认失败的本机原文。请确认已保留所需文本。</p>
    <Button onclick={discard} disabled={busy}>确认丢弃这一条</Button><Button
      onclick={() => (confirm = false)}>取消</Button
    ></Dialog
  >
</section>
