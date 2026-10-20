<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    bridge as realBridge,
    type BridgePort,
    type Snapshot,
  } from "./bridge";
  import Conversation from "./Conversation.svelte";
  import Work from "./Work.svelte";
  import {
    conversation,
    projection,
    capability,
    retainPreview,
  } from "./workflow";
  import type { Timeline } from "./contracts";
  import { Shell, Button, Dialog, Field, Status, Divider } from "./phaseui";
  import type { Page } from "./phaseui/Shell.svelte";
  import {
    motionController,
    type MotionMode,
  } from "./phaseui/motion/controller";
  import { sendShortcut } from "./phaseui/input";
  import { displayName } from "./phaseui/identity";
  let {
    bridge = realBridge,
    synthetic = false,
    initialMode,
    transientCadence = 250,
  }: {
    bridge?: BridgePort;
    synthetic?: boolean;
    initialMode?: MotionMode;
    transientCadence?: number;
  } = $props();
  let page = $state<Page>("conversation");
  let connectionOpen = $state(false);
  let readingOffset = 0;
  let selection: { start: number; end: number } | null = null;
  let editor: HTMLTextAreaElement;
  const titles = {
    conversation: "对话",
    tasks: "任务",
    memory: "记忆",
    artifacts: "产物",
    attention: "待处理",
    settings: "设置",
  };
  async function navigate(next: Page) {
    if (next === page) return;
    if (page === "conversation") {
      if (editor) {
        selection = { start: editor.selectionStart, end: editor.selectionEnd };
        editor.blur();
      }
      composing = false;
      readingOffset = panel?.scrollTop ?? 0;
      anchor(true);
    }
    page = next;
    await tick();
    if (next === "conversation") {
      if (panel) panel.scrollTop = readingOffset;
      if (editor && selection)
        editor.setSelectionRange(selection.start, selection.end);
    }
  }
  function keydown(event: KeyboardEvent) {
    if (sendShortcut(event, composing)) {
      event.preventDefault();
      void send();
    }
  }
  let data = $state<Snapshot>({ profiles: [], sync: "DISCONNECTED" });
  let assistant = $derived(
    displayName(
      projection<import("./contracts").Assistant>(data.cache, "assistant")
        ?.name,
    ),
  );
  let live = $state<unknown>(null);
  let reconnecting = $state(false);
  let history = $state<Timeline | null>(null);
  let finalized = new Set<string>();
  let base = $derived(projection<Timeline>(data.cache, "timeline"));
  let timeline = $derived(history ?? base);
  let items = $derived(
    conversation(timeline, history ? null : live, finalized),
  );
  let polling = false,
    livePolling = false;
  let profile = $state("");
  let text = $state("");
  let version = 0;
  let dirty = $state(false);
  let error = $state("");
  let notice = $state("");
  let busy = $state(false);
  let saving = $state(false);
  let composing = $state(false);
  let artifact = $state("");
  let stopConfirm = $state(false);
  let tail = $state<HTMLElement>();
  let chain = Promise.resolve();
  let disposed = false;
  let generation = 0;
  let panel = $state<HTMLElement>();
  let anchorTimer: ReturnType<typeof setTimeout>;
  function anchor(immediate = false) {
    if (page !== "conversation") return;
    clearTimeout(anchorTimer);
    const domain = data.domain;
    const first = [
      ...(panel?.querySelectorAll<HTMLElement>("[data-message-id]") ?? []),
    ].find(
      (e) =>
        e.getBoundingClientRect().bottom >
        (panel?.getBoundingClientRect().top ?? 0),
    );
    const atBottom =
      panel &&
      (panel.scrollHeight - panel.scrollTop - panel.clientHeight <= 24 ||
        (tail &&
          tail.getBoundingClientRect().top >=
            panel.getBoundingClientRect().top &&
          tail.getBoundingClientRect().bottom <=
            panel.getBoundingClientRect().bottom));
    const value =
      !history && atBottom
        ? "latest"
        : first
          ? JSON.stringify({
              v: 1,
              id: first.dataset.messageId,
              offset:
                first.getBoundingClientRect().top -
                (panel?.getBoundingClientRect().top ?? 0),
            })
          : String(panel?.scrollTop ?? 0);
    if (domain) {
      const persist = () => {
        void bridge.anchor(domain, value).catch(displayError);
      };
      if (immediate) persist();
      else anchorTimer = setTimeout(persist, 300);
    }
  }
  async function resync() {
    if (!data.domain) return;
    try {
      await bridge.subscribe(data.domain, [
        { operation: "assistant" },
        { operation: "timeline" },
        { operation: "attention" },
        { operation: "tasks" },
      ]);
    } catch (e) {
      displayError(e);
    }
  }
  const displayError = (e: unknown) => {
    error = String(e);
  };
  function save() {
    const value = text;
    const domain = data.domain;
    dirty = true;
    chain = chain
      .catch(() => {})
      .then(async () => {
        if (!domain) return;
        saving = true;
        try {
          const d = await bridge.draft(domain, version, value);
          version = d.version;
          if (text === value) dirty = false;
        } catch (e) {
          displayError(e);
          throw e;
        } finally {
          saving = false;
        }
      });
    // A failed save stays visible and keeps the editor contents. The next edit
    // retries; version conflicts still require reconnect before sending.
    void chain.catch(() => {});
  }
  async function connect(start = false) {
    if (dirty && data.profile && profile !== data.profile) {
      error = "请先保存当前数据域的草稿";
      return;
    }
    busy = true;
    generation++;
    live = null;
    reconnecting = false;
    history = null;
    finalized = new Set();
    error = "";
    try {
      await chain.catch(() => {});
      const pending = dirty ? text : null;
      data = await bridge.connect(profile, start);
      text = pending ?? data.draft?.text ?? "";
      version = data.draft?.version ?? 0;
      dirty = false;
      chain = Promise.resolve();
      if (pending !== null) save();
      if (data.anchor?.startsWith("{")) {
        try {
          const saved = JSON.parse(data.anchor);
          if (
            saved.v === 1 &&
            typeof saved.id === "string" &&
            !projection<Timeline>(data.cache, "timeline")?.items.some(
              (item) => item.id === saved.id,
            )
          )
            history = await bridge.query<Timeline>(data.domain!, {
              operation: "timeline/around",
              parameters: { message_id: saved.id },
            });
        } catch {
          notice = "阅读位置不可用，已加载最近消息";
        }
      }
      connectionOpen = false;
      await tick();
      if (panel) {
        if (data.anchor === "latest") tail?.scrollIntoView({ block: "end" });
        else if (data.anchor?.startsWith("{")) {
          try {
            const saved = JSON.parse(data.anchor);
            const element = [
              ...panel.querySelectorAll<HTMLElement>("[data-message-id]"),
            ].find((e) => e.dataset.messageId === saved.id);
            if (element)
              panel.scrollTop +=
                element.getBoundingClientRect().top -
                panel.getBoundingClientRect().top -
                (Number(saved.offset) || 0);
          } catch {}
        } else panel.scrollTop = Number(data.anchor) || 0;
      }
    } catch (e) {
      displayError(e);
    } finally {
      busy = false;
    }
  }
  async function send() {
    if (busy || composing || !text.trim() || !data.domain) return;
    const boundary = document.getElementById("composer-boundary");
    if (boundary && !motionController.active.has(boundary))
      motionController.play(boundary);
    const value = text,
      domain = data.domain,
      round = generation;
    busy = true;
    error = "";
    notice = "正在保存发送意图…";
    chain = chain
      .catch(() => {})
      .then(async () => {
        const saved = await bridge.draft(domain, version, value);
        version = saved.version;
        const id = await bridge.submit(
          domain,
          { operation: "messages" },
          { text: value },
          version,
        );
        version++; // the same transaction cleared this draft version
        if (round === generation) {
          if (text === value) {
            text = "";
            dirty = false;
          }
          notice = "已持久排队：" + id;
          await latest();
        }
      });
    try {
      await chain;
    } catch (e) {
      displayError(e);
    } finally {
      busy = false;
    }
  }
  async function older() {
    if (!timeline?.before || !data.domain) return;
    const round = generation;
    try {
      const page = await bridge.query<Timeline>(data.domain, {
        operation: "timeline",
        parameters: { cursor: timeline.before, direction: "before" },
      });
      if (round === generation) history = page;
    } catch (e) {
      displayError(e);
    }
  }
  async function stop() {
    if (!data.domain) return;
    busy = true;
    try {
      await bridge.stop(data.domain, data.core!.instance_id);
      data = await bridge.snapshot();
    } catch (e) {
      displayError(e);
    } finally {
      busy = false;
      stopConfirm = false;
    }
  }
  async function refresh() {
    if (polling) return;
    polling = true;
    const round = generation;
    try {
      const next = await bridge.snapshot();
      if (disposed || round !== generation) return;
      if (data.core?.instance_id !== next.core?.instance_id) {
        live = null;
        reconnecting = false;
        history = null;
        finalized = new Set();
      }
      data = next;
      if (!profile) profile = next.profiles[0]?.id ?? "";
    } catch (e) {
      displayError(e);
    } finally {
      polling = false;
    }
  }
  onMount(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!busy && !saving) void refresh();
    }, 1500);
    const transientTimer = setInterval(
      async () => {
        if (livePolling || !data.domain || !data.core) return;
        livePolling = true;
        const round = generation,
          d = data.domain,
          i = data.core.instance_id;
        try {
          const snapshot = await bridge.transient(d, i);
          if (
            !disposed &&
            round === generation &&
            d === data.domain &&
            i === data.core?.instance_id
          ) {
            reconnecting = !snapshot?.connected;
            // A disconnect is not a deletion. Retain the last preview in this
            // domain/instance until a fresh snapshot or durable row replaces it.
            live = retainPreview(live, snapshot);
          }
        } catch {
          if (round === generation) reconnecting = true;
        } finally {
          livePolling = false;
        }
      },
      synthetic ? transientCadence : 250,
    );
    return () => {
      disposed = true;
      clearInterval(transientTimer);
      clearInterval(timer);
      clearTimeout(anchorTimer);
    };
  });
  async function latest() {
    history = null;
    await tick();
    if (page === "conversation") tail?.scrollIntoView({ block: "end" });
    else readingOffset = Number.MAX_SAFE_INTEGER;
    if (data.domain)
      void bridge.anchor(data.domain, "latest").catch(displayError);
  }
</script>

<Shell
  name={assistant}
  {page}
  {navigate}
  connection={() => (connectionOpen = true)}
  {synthetic}
  {initialMode}
>
  {#snippet status()}<span data-testid="status"
      >{data.sync}{data.error ? " · " + data.error : ""}</span
    >{/snippet}
  <div class="phase-page-heading"><h1>{titles[page]}</h1></div>
  {#if error}<Status state="error">{error}</Status>{/if}
  {#if notice}<Status state="pending">{notice}</Status>{/if}
  {#if !data.domain}<div class="phase-scroll">
      <p class="phase-empty">请选择连接配置以使用 Secretary。</p>
      <Button onclick={() => (connectionOpen = true)}>连接本机 Core</Button>
    </div>{/if}
  <main
    class="phase-scroll connected"
    bind:this={panel}
    hidden={page !== "conversation" || !data.domain}
    onscroll={() => anchor()}
    aria-label="对话记录"
  >
    {#if history}<p data-testid="history-banner">
        正在阅读历史页面。<Button variant="text" onclick={latest}
          >查看最新消息</Button
        >
      </p>{/if}
    {#if reconnecting && !history}<Status state="offline"
        >正在重新连接，保留上次预览</Status
      >{/if}
    <Button variant="text" onclick={resync}>重建投影</Button>
    {#if timeline?.before}<Button variant="text" onclick={older}
        >较早消息</Button
      >{/if}
    {#if data.domain}{#key data.domain + ":" + data.core?.instance_id}<Conversation
          {items}
          domain={data.domain}
          name={assistant}
          {bridge}
        />{/key}{/if}
    <div bind:this={tail}></div>
    <Button variant="text" onclick={latest}>跳到最新消息</Button>
  </main>
  <section
    class="phase-composer"
    aria-label="发送"
    hidden={page !== "conversation" || !data.domain}
  >
    <Divider edge="top" />
    <Field id="composer-boundary"
      ><label for="draft" class="sr-only">消息内容</label><textarea
        id="draft"
        data-testid="draft"
        bind:this={editor}
        bind:value={text}
        oninput={save}
        onkeydown={keydown}
        oncompositionstart={() => (composing = true)}
        oncompositionend={() => (composing = false)}
        placeholder="写下你的想法…"></textarea></Field
    >
    <div class="phase-composer-row">
      <span
        >Cmd + Enter 发送 · Enter 换行<br />{saving
          ? "保存中"
          : dirty
            ? "尚未保存"
            : "草稿已保存"}</span
      ><Button
        variant="send"
        primary
        icon="send"
        aria-label="保存并发送"
        data-testid="send"
        onclick={send}
        disabled={busy ||
          composing ||
          !text.trim() ||
          !capability(data.core, "messages")}
      />
    </div>
  </section>
  {#if data.domain}{#key data.domain + ":" + data.core?.instance_id}<Work
        {data}
        {page}
        {bridge}
      />{/key}{/if}
  {#if data.domain && ["memory", "settings", "artifacts"].includes(page)}<div
      class="phase-scroll"
    >
      <p class="phase-empty">
        此栏目尚未接入。{page === "artifacts"
          ? "已有执行产物可从任务详情保存。"
          : ""}
      </p>
    </div>{/if}
  <Dialog bind:open={connectionOpen} title="连接本机 Core">
    <label for="profile">连接配置</label><Field disabled={busy}
      ><select id="profile" bind:value={profile} disabled={busy}
        >{#each data.profiles as p}<option value={p.id}
            >{p.id} · {p.mode}</option
          >{/each}</select
      ></Field
    >
    {#if !data.profiles.length}<p>
        请先配置本机 profiles.json，配置方法见桌面运行说明。
      </p>{/if}
    <div class="actions">
      <Button
        onclick={() => connect()}
        disabled={busy || !profile}
        data-testid="attach">附着 / 重新连接</Button
      ><Button
        onclick={() => connect(true)}
        disabled={busy || !profile}
        data-testid="start">启动本机 Core</Button
      >
    </div>
    {#if data.domain}<p>数据域：<code>{data.domain}</code></p>
      <p>实例：<code>{data.core?.instance_id}</code></p>
      <Divider /><Button
        variant="text"
        onclick={() => (stopConfirm = true)}
        disabled={busy}>停止当前 Core…</Button
      >{/if}
    {#if stopConfirm}<p>这会停止当前独立 Core 服务。</p>
      <Button onclick={stop}>确认停止</Button><Button
        onclick={() => (stopConfirm = false)}>取消</Button
      >{/if}
    {#if error}<Status state="error">{error}</Status>{/if}
  </Dialog>
</Shell>
