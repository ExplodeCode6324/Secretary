<script lang="ts">
  import { onMount } from "svelte";
  import type { Message, TimelineItem } from "./contracts";
  import { bridge as realBridge, type BridgePort } from "./bridge";
  import { Button, Divider } from "./phaseui";
  import MessageRow from "./conversation/MessageRow.svelte";
  import { ContentStore, bytes } from "./conversation/model";
  import { Renderer } from "./conversation/render";
  let {
    items,
    domain,
    name = "Secretary",
    bridge = realBridge,
    store,
    thinking = true,
    active = true,
    select = () => {},
    changed = () => {},
    changing = () => () => {},
    reloadRow = async (_id: string) => {},
    stats = (_bytes: number) => {},
  }: {
    items: TimelineItem[];
    domain: string;
    name?: string;
    bridge?: BridgePort;
    store: ContentStore;
    thinking?: boolean;
    active?: boolean;
    select?: (item: TimelineItem) => void;
    changed?: () => void;
    changing?: () => () => void;
    reloadRow?: (id: string) => Promise<void>;
    stats?: (bytes: number) => void;
  } = $props();
  const renderer = new Renderer();
  let revision = $state(0);
  let error = $state("");
  let loading = $state("");
  let root: HTMLElement;
  let dead = false,
    sequence = 0,
    polling = false,
    turn = 0;
  const hydrated = new Set<string>();
  const prefixes = new Map<string, number>();
  const failedPrefixes = new Set<string>();
  const key = (m: Message) => m.id + ":" + m.revision;
  function preserve(m: Message, length: number) {
    prefixes.set(key(m), Math.max(prefixes.get(key(m)) ?? 0, length));
  }
  function updated() {
    const restore = changing();
    revision++;
    restore();
    changed();
  }
  let observedEpoch = -1;
  $effect(() => {
    const epoch = store.epoch;
    void thinking;
    if (epoch !== observedEpoch) {
      observedEpoch = epoch;
      sequence++;
      hydrated.clear();
      prefixes.clear();
      failedPrefixes.clear();
      renderer.clear();
      revision++;
    }
    store.retain(items);
    const keys = new Set(
      items
        .filter((r) => r.kind === "message")
        .map((r) => r.id + ":" + r.revision),
    );
    for (const key of hydrated) if (!keys.has(key)) hydrated.delete(key);
    for (const key of prefixes.keys())
      if (!keys.has(key)) {
        prefixes.delete(key);
        failedPrefixes.delete(key);
      }
    renderer.retain(new Set(items.map((r) => r.id)));
  });
  async function read(m: Message, replace = false) {
    const seq = sequence;
    loading = m.id;
    error = "";
    try {
      const minimum = prefixes.get(key(m));
      if (minimum && !replace)
        await store.readThrough(m, minimum, bridge, domain, thinking);
      else await store.read(m, bridge, domain, thinking, replace);
      if (seq === sequence) {
        failedPrefixes.delete(key(m));
        prefixes.delete(key(m));
        updated();
      }
    } catch (e) {
      if (seq === sequence)
        error = String(e).includes("CURSOR_EXPIRED")
          ? "内容版本已变化，请重新读取；已加载部分仍保留。"
          : String(e);
    } finally {
      if (seq === sequence) loading = "";
    }
  }
  async function fullCopy(m: Message) {
    const seq = sequence;
    loading = m.id;
    error = "";
    try {
      const text = await store.complete(m, bridge, domain, thinking);
      if (seq !== sequence) throw Error("CURSOR_EXPIRED");
      revision++;
      return text;
    } finally {
      if (seq === sequence) {
        loading = "";
        revision++;
      }
    }
  }
  function cachedMessage(m: Message, _revision: number) {
    return store.get(m);
  }
  function visible() {
    const bounds = root?.parentElement?.getBoundingClientRect();
    return items.filter(
      (m): m is Message =>
        m.kind === "message" &&
        [...(root?.querySelectorAll<HTMLElement>("[data-row-id]") ?? [])].some(
          (el) =>
            el.dataset.rowId === m.id &&
            (!bounds ||
              (el.getBoundingClientRect().bottom >= bounds.top &&
                el.getBoundingClientRect().top <= bounds.bottom)),
        ),
    );
  }
  onMount(() => {
    const timer = setInterval(async () => {
      stats(renderer.size);
      if (polling || !active || document.hidden) return;
      const candidates = visible();
      const pending = items.find(
        (m): m is Message =>
          m.kind === "message" &&
          m.persistence === "durable" &&
          prefixes.has(key(m)) &&
          !failedPrefixes.has(key(m)),
      );
      if (pending && store.budget.active < 2) {
        polling = true;
        const seq = sequence;
        loading = pending.id;
        error = "";
        try {
          await store.readThrough(
            pending,
            prefixes.get(key(pending))!,
            bridge,
            domain,
            thinking,
          );
          if (!dead && seq === sequence) {
            prefixes.delete(key(pending));
            if (thinking) hydrated.add(key(pending));
            updated();
          }
        } catch (e) {
          if (!dead && seq === sequence) {
            failedPrefixes.add(key(pending));
            error = "已保留正文；补读失败，可重试：" + String(e);
          }
        } finally {
          if (seq === sequence) loading = "";
          polling = false;
        }
        return;
      }
      if (!thinking) return;
      const durable = candidates.find(
        (m) =>
          m.persistence === "durable" &&
          m.thinking === undefined &&
          !prefixes.has(key(m)) &&
          !hydrated.has(m.id + ":" + m.revision),
      );
      if (durable && store.budget.active < 2) {
        polling = true;
        const seq = sequence;
        try {
          await store.read(durable, bridge, domain, true, true);
          if (!dead && seq === sequence) {
            hydrated.add(durable.id + ":" + durable.revision);
            revision++;
            changed();
          }
        } catch (e) {
          if (!dead && seq === sequence) error = String(e);
        } finally {
          polling = false;
        }
        return;
      }
      const running = candidates.filter(
        (m) =>
          m.persistence === "transient" &&
          m.preview_status === "running" &&
          m.preview_availability !== "expired",
      );
      const m = running[turn++ % running.length];
      if (!m) return;
      polling = true;
      const seq = sequence,
        epoch = store.epoch;
      try {
        const response = await bridge.query<Message>(domain, {
          operation: "messages/{id}/content",
          id: m.id,
          parameters: { thinking: true, streaming: true },
        });
        if (
          dead ||
          seq !== sequence ||
          epoch !== store.epoch ||
          !thinking ||
          !active ||
          response.id !== m.id ||
          !items.some(
            (row) =>
              row.id === m.id &&
              row.revision === m.revision &&
              row.kind === "message" &&
              row.persistence === "transient",
          )
        )
          return;
        if (bytes(JSON.stringify(response)) > 64 * 1024)
          throw Error("THINKING_LIMIT");
        // SSE is always the only transient text source. The query's text and
        // cursor deliberately never enter the row, even when they are longer.
        store.put({ ...m, thinking: response.thinking ?? "" });
        revision++;
        changed();
      } catch (e) {
        if (!dead && seq === sequence) error = String(e);
      } finally {
        polling = false;
      }
    }, 1000);
    return () => {
      dead = true;
      sequence++;
      clearInterval(timer);
      renderer.clear();
      store.clear();
    };
  });
</script>

<div bind:this={root}>
  {#if error}<p role="alert">{error}</p>{/if}
  {#each items as item (item.id)}
    {#if item.kind === "message"}
      {@const cached = cachedMessage(item, revision)}
      {@const m =
        item.persistence === "transient"
          ? { ...item, thinking: cached.thinking }
          : cached}
      <MessageRow
        message={m}
        {name}
        {bridge}
        {renderer}
        {thinking}
        loading={loading === item.id}
        preserve={(length) => preserve(item, length)}
        more={() => read(item)}
        full={() => fullCopy(item)}
        reload={() => reloadRow(item.id)}
        select={() => select(item)}
      />
    {:else}
      {@const at =
        typeof item.at === "string"
          ? item.at
          : typeof item.activity.started_at === "string"
            ? item.activity.started_at
            : ""}
      <article class="phase-message activity" data-row-id={item.id}>
        <Divider edge="bottom" />
        <details>
          <summary
            ><time datetime={at} title={at}
              >{at
                ? new Date(at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "时间未知"}</time
            >
            · {item.activity.kind === "tool" ? "工具调用" : "活动"} · {item
              .activity.phase ??
              item.activity.kind ??
              "活动"} · {item.activity.status ?? "未知状态"}</summary
          >
          <pre>{JSON.stringify(item.activity, null, 2).slice(0, 65536)}</pre>
          {#if JSON.stringify(item.activity, null, 2).length > 65536}<p>
              活动详情已达到显示上限，仅展示前 65,536 个字符。
            </p>{/if}
        </details>
        <Button variant="text" onclick={() => select(item)}>关联</Button>
      </article>
    {/if}
  {/each}
</div>
