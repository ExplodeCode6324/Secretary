<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Snapshot, BridgePort } from "../bridge";
  import type {
    TimelineItem,
    RelatedPage,
    Attention,
    Execution,
    Artifact,
    Timeline,
  } from "../contracts";
  import { projection } from "../workflow";
  import { Button } from "../phaseui";
  import type { ReadBudget } from "./model";
  let {
    data,
    selected,
    bridge,
    reset,
    openWork,
    budget,
  }: {
    data: Snapshot;
    selected: TimelineItem | null;
    bridge: BridgePort;
    reset: () => void;
    openWork: (type: "task" | "authorization", id: string) => void;
    budget: ReadBudget;
  } = $props();
  let result = $state<RelatedPage | null>(null);
  let artifact = $state<Artifact | null>(null);
  let error = $state("");
  let busy = $state(false);
  let sequence = 0;
  let lastKey = "";
  let currentScope = { type: "session", id: "" };
  let attention = $derived(projection<Attention>(data.cache, "attention"));
  $effect(() => {
    const domain = data.domain,
      instance = data.core?.instance_id;
    const row = selected,
      session = data.core?.session_id;
    const version = projection<Timeline>(data.cache, "timeline")?.version;
    void instance;
    void version;
    const key = JSON.stringify([domain, instance, row?.id, session, version]);
    if (key === lastKey) return;
    lastKey = key;
    const seq = ++sequence;
    result = null;
    artifact = null;
    error = "";
    if (!domain || !session) return;
    busy = true;
    void (async () => {
      try {
        let scope = { type: "session", id: session };
        if (row?.kind === "message") scope = { type: "message", id: row.id };
        else if (row) {
          if (typeof row.activity.anchor_id === "string")
            scope = { type: "message", id: row.activity.anchor_id };
          else if (typeof row.activity.execution_id === "string") {
            const execution = await budget.run(() =>
              bridge.query<Execution>(domain, {
                operation: "executions/{id}",
                id: row.activity.execution_id as string,
              }),
            );
            scope = { type: "task", id: execution.task_id };
          } else {
            if (seq === sequence) error = "此活动未提供可信关联定位。";
            return;
          }
        }
        const response = await budget.run(() =>
          bridge.query<RelatedPage>(domain, {
            operation: "related",
            parameters: {
              scope_type: scope.type,
              scope_id: scope.id,
              limit: 20,
            },
          }),
        );
        if (seq === sequence) {
          currentScope = scope;
          result = response;
        }
      } catch (e) {
        if (seq === sequence) error = String(e);
      } finally {
        if (seq === sequence) busy = false;
      }
    })();
  });
  onDestroy(() => sequence++);
  async function next() {
    if (!data.domain || !result?.next_cursor || busy) return;
    const seq = sequence;
    busy = true;
    try {
      const response = await budget.run(() =>
        bridge.query<RelatedPage>(data.domain!, {
          operation: "related",
          parameters: {
            scope_type: currentScope.type,
            scope_id: currentScope.id,
            limit: 20,
            cursor: result!.next_cursor!,
          },
        }),
      );
      if (seq === sequence) result = response;
    } catch (e) {
      if (seq === sequence) error = String(e);
    } finally {
      if (seq === sequence) busy = false;
    }
  }
  async function inspect(id: string) {
    if (!data.domain || busy) return;
    const seq = sequence;
    busy = true;
    try {
      const value = await budget.run(() =>
        bridge.query<Artifact>(data.domain!, {
          operation: "artifacts/{id}",
          id,
        }),
      );
      if (seq === sequence) artifact = value;
    } catch (e) {
      if (seq === sequence) error = String(e);
    } finally {
      if (seq === sequence) busy = false;
    }
  }
</script>

<p>{selected ? "选中记录的关联" : "当前会话"}</p>
{#if selected}<code class="rail-id">{selected.id}</code><Button
    variant="text"
    onclick={reset}>返回会话范围</Button
  >{/if}
{#if busy}<p>读取关联…</p>{/if}
{#if error}<p role="status">{error}</p>{/if}
{#each result?.items ?? [] as item (item.type + item.id)}
  <div class="rail-relation">
    <small>{item.type} · {item.basis}</small>
    {#if item.type === "task"}<Button
        variant="text"
        onclick={() => openWork("task", item.id)}>查看任务 {item.id}</Button
      >
    {:else if item.type === "artifact"}<Button
        variant="text"
        disabled={busy}
        onclick={() => inspect(item.id)}>查看产物 {item.id}</Button
      >
    {:else}<span>未支持的关联类型</span>{/if}
  </div>
{/each}
{#if result && !result.items.length}<p>
    此范围没有已记录的任务或产物关联。
  </p>{/if}
{#if result?.next_cursor}<Button variant="text" disabled={busy} onclick={next}
    >下一页关联</Button
  >{/if}
{#if artifact}<p>{artifact.name} · {artifact.id}</p>{/if}
{#if !selected}
  {#each attention?.items.slice(0, 10) ?? [] as item (item.id)}
    {#if item.type === "authorization"}<Button
        variant="text"
        onclick={() => openWork("authorization", item.id)}
        >查看待批准操作 {item.id}</Button
      >
    {:else}<p>待处理：{item.type} · {item.id}（入口尚未实现）</p>{/if}
  {/each}
{/if}
