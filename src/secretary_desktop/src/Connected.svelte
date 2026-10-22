<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    bridge as realBridge,
    type BridgePort,
    type Snapshot,
  } from "./bridge";
  import Conversation from "./Conversation.svelte";
  import RelatedRail from "./conversation/RelatedRail.svelte";
  import Recovery from "./conversation/Recovery.svelte";
  import {
    ReadingWindow,
    ContentStore,
    ReadBudget,
    thinkingPreference,
    saveThinking,
  } from "./conversation/model";
  import Work from "./Work.svelte";
  import {
    conversation,
    projection,
    capability,
    retainPreview,
    previews,
  } from "./workflow";
  import type { Timeline, TimelineItem } from "./contracts";
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
    initialTheme,
    transientCadence = 250,
    metrics = (_value: Record<string, number>) => {},
  }: {
    bridge?: BridgePort;
    synthetic?: boolean;
    initialMode?: MotionMode;
    initialTheme?: "light" | "dark";
    transientCadence?: number;
    metrics?: (value: Record<string, number>) => void;
  } = $props();
  let htmlBytes = 0;
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
    const selected = document.querySelector<HTMLElement>(
      `[data-page="${next}"]`,
    );
    if (selected) motionController.play(selected);
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
  let inHistory = $state(false);
  let thinking = $state(true);
  let readingBusy = $state(false);
  let readingStale = $state(false);
  let locate = $state("");
  let locateKind = $state("message_id");
  let findText = $state("");
  let related = $state<TimelineItem | null>(null);
  let workTarget = $state<{
    type: "task" | "authorization";
    id: string;
    sequence: number;
  } | null>(null);
  const readBudget = new ReadBudget();
  const reader: ReadingWindow = new ReadingWindow(
    readBudget,
    () => content.size,
  );
  const content: ContentStore = new ContentStore(readBudget, () => reader.size);
  let refreshedVersion = "",
    lastRefresh = 0;
  function pins() {
    const ids = new Set<string>();
    const selection = getSelection();
    for (const el of panel?.querySelectorAll<HTMLElement>("[data-row-id]") ??
      []) {
      if (
        (selection &&
          !selection.isCollapsed &&
          selection.rangeCount &&
          selection.getRangeAt(0).intersectsNode(el)) ||
        el.contains(document.activeElement) ||
        el.querySelector("details[open]")
      )
        ids.add(el.dataset.rowId!);
    }
    const anchor = capture();
    if (anchor) ids.add(anchor.id);
    return ids;
  }
  function capture() {
    const top = panel?.getBoundingClientRect().top ?? 0;
    const row = [
      ...(panel?.querySelectorAll<HTMLElement>("[data-row-id]") ?? []),
    ].find((el) => el.getBoundingClientRect().bottom > top);
    return row
      ? {
          id: row.dataset.rowId!,
          offset: row.getBoundingClientRect().top - top,
        }
      : null;
  }
  function follow() {
    return (
      !inHistory &&
      !!panel &&
      panel.scrollHeight - panel.scrollTop - panel.clientHeight <= 24 &&
      (getSelection()?.isCollapsed ?? true) &&
      !panel.querySelector("details:focus-within, details[open]:focus-within")
    );
  }
  async function restore(
    saved: ReturnType<typeof capture>,
    tailFollow = false,
  ) {
    await tick();
    if (tailFollow && page === "conversation") {
      tail?.scrollIntoView({ block: "end" });
      return;
    }
    const row = [
      ...(panel?.querySelectorAll<HTMLElement>("[data-row-id]") ?? []),
    ].find((el) => el.dataset.rowId === saved?.id);
    if (row && saved && panel)
      panel.scrollTop +=
        row.getBoundingClientRect().top -
        panel.getBoundingClientRect().top -
        saved.offset;
  }
  function flags() {
    return { limit: 50, thinking, streaming: false };
  }
  async function loadWindow(
    direction: "before" | "after" | "replace",
    id?: string,
    kind = "message_id",
  ) {
    if (!data.domain || readingBusy) return;
    const saved = capture(),
      round = generation;
    const cursor = direction === "before" ? timeline?.before : timeline?.after;
    if (direction !== "replace" && !cursor) return;
    readingBusy = true;
    error = "";
    try {
      await reader.load(
        bridge,
        data.domain,
        {
          operation: id ? "timeline/around" : "timeline",
          parameters: {
            ...flags(),
            ...(id
              ? { [kind]: id }
              : direction === "replace"
                ? {}
                : { cursor: cursor!, direction }),
          },
        },
        direction,
        pins(),
      );
      if (round !== generation) return;
      history = reader.value ?? null;
      readingStale = false;
      inHistory = !!id || direction !== "replace";
      content.retain(history?.items ?? []);
      await restore(saved);
      if (id) {
        const target = history?.items.find(
          (r) =>
            r.id === id || (r.kind === "message" && r.source_event_id === id),
        );
        if (target)
          [...(panel?.querySelectorAll<HTMLElement>("[data-row-id]") ?? [])]
            .find((el) => el.dataset.rowId === target.id)
            ?.scrollIntoView({ block: "center" });
      }
    } catch (e) {
      if (round === generation) displayError(e);
    } finally {
      if (round === generation) readingBusy = false;
    }
  }
  async function toggleThinking() {
    thinking = !thinking;
    if (data.domain) saveThinking(data.domain, thinking, localStorage);
    const saved = capture();
    const wasHistory = inHistory;
    const retained = history?.items.map((r) =>
      r.kind === "message"
        ? {
            ...content.get(r),
            thinking: undefined,
            next_cursor: null,
            loaded_portion: true,
          }
        : r,
    );
    reader.clear();
    content.clear();
    generation++;
    readingBusy = false;
    if (history)
      history = {
        ...history,
        before: null,
        after: null,
        items: retained ?? history.items,
      };
    notice = "显示偏好已改变，正在重新读取当前范围。";
    await loadWindow("replace", wasHistory ? saved?.id : undefined);
    inHistory = wasHistory;
    await restore(saved);
    notice = "";
  }
  function searchLoaded() {
    const query = findText.trim().toLocaleLowerCase();
    if (!query) return;
    const row = items.find((r) =>
      (r.kind === "message" ? content.get(r).text : JSON.stringify(r.activity))
        .toLocaleLowerCase()
        .includes(query),
    );
    if (!row) {
      notice = "已加载窗口中没有匹配内容。";
      return;
    }
    [...(panel?.querySelectorAll<HTMLElement>("[data-row-id]") ?? [])]
      .find((el) => el.dataset.rowId === row.id)
      ?.scrollIntoView({ block: "center" });
    notice = "匹配已加载窗口；未搜索其他历史。";
  }
  function openWork(type: "task" | "authorization", id: string) {
    workTarget = { type, id, sequence: (workTarget?.sequence ?? 0) + 1 };
    void navigate(type === "task" ? "tasks" : "attention");
  }
  async function restoreDraft(value: string) {
    if (text.trim()) throw Error("编辑器已有草稿，请先保留或清空后恢复。");
    text = value;
    save();
    await chain;
    await navigate("conversation");
    editor?.focus();
  }
  let finalized = new Set<string>();
  let base = $derived(projection<Timeline>(data.cache, "timeline"));
  let timeline = $derived(history ?? base);
  let items = $derived(
    conversation(timeline, inHistory ? null : live, finalized),
  );
  const previewChecks = new Set<string>();
  let polling = false,
    livePolling = false;
  let profile = $state("");
  let text = $state("");
  let version = 0;
  let dirty = $state(false);
  let error = $state("");
  let notice = $state("");
  let sendNotice = $state("");
  let busy = $state(false);
  let saving = $state(false);
  let composing = $state(false);
  let artifact = $state("");
  let stopConfirm = $state(false);
  let resumeConfirm = $state(false);
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
      ...(panel?.querySelectorAll<HTMLElement>("[data-row-id]") ?? []),
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
      !inHistory && atBottom
        ? "latest"
        : first
          ? JSON.stringify({
              v: 2,
              domain,
              session: data.core?.session_id,
              mode: inHistory ? "history" : "reading",
              id: first.dataset.rowId,
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
        { operation: "session" },
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
    sendNotice = "";
    live = null;
    reconnecting = false;
    history = null;
    inHistory = false;
    reader.clear();
    content.clear();
    readingBusy = false;
    related = null;
    finalized = new Set();
    previewChecks.clear();
    error = "";
    try {
      await chain.catch(() => {});
      const pending = dirty ? text : null;
      data = await bridge.connect(profile, start);
      thinking = thinkingPreference(data.domain!, localStorage);
      await loadWindow("replace");
      text = pending ?? data.draft?.text ?? "";
      version = data.draft?.version ?? 0;
      dirty = false;
      chain = Promise.resolve();
      if (pending !== null) save();
      if (data.anchor?.startsWith("{")) {
        try {
          const saved = JSON.parse(data.anchor);
          if (
            [1, 2].includes(saved.v) &&
            typeof saved.id === "string" &&
            !projection<Timeline>(data.cache, "timeline")?.items.some(
              (item) => item.id === saved.id,
            )
          )
            await loadWindow("replace", saved.id);
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
              ...panel.querySelectorAll<HTMLElement>("[data-row-id]"),
            ].find((e) => e.dataset.rowId === saved.id);
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
    if (
      busy ||
      composing ||
      !text.trim() ||
      !data.domain ||
      !capability(data.core, "messages")
    )
      return;
    const sendButton = document.querySelector<HTMLElement>(
      '[data-testid="send"]',
    );
    if (sendButton && !motionController.active.has(sendButton))
      motionController.play(sendButton);
    const boundary = document.getElementById("composer-boundary");
    if (boundary && !motionController.active.has(boundary))
      motionController.play(boundary);
    const value = text,
      domain = data.domain,
      round = generation;
    busy = true;
    error = "";
    sendNotice = "正在保存发送意图…";
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
          sendNotice =
            (synthetic ? "模拟请求已排队：" : "已保存到本机发送队列：") + id;
          // Sending never changes the reading position. Tail-follow is handled by projection updates.
        }
      });
    try {
      await chain;
    } catch (e) {
      sendNotice = "";
      displayError(e);
    } finally {
      busy = false;
    }
  }
  async function resumeSession() {
    if (!data.domain || busy || !capability(data.core, "messages")) return;
    busy = true;
    try {
      const id = await bridge.submit(
        data.domain,
        { operation: "session/resume" },
        {},
      );
      notice = "恢复请求已排队，等待 Core 回执：" + id;
      resumeConfirm = false;
    } catch (e) {
      displayError(e);
    } finally {
      busy = false;
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
      const savedPosition = capture(),
        tailFollow = follow();
      const next = await bridge.snapshot();
      if (disposed || round !== generation) return;
      if (data.core?.instance_id !== next.core?.instance_id) {
        live = null;
        reconnecting = false;
        history = null;
        inHistory = false;
        reader.clear();
        content.clear();
        related = null;
        generation++;
        readingBusy = false;
        finalized = new Set();
        previewChecks.clear();
      }
      data = next;
      const currentBase = projection<Timeline>(data.cache, "timeline");
      if (
        data.domain &&
        currentBase &&
        page === "conversation" &&
        !document.hidden &&
        !data.error &&
        currentBase.version !== refreshedVersion &&
        Date.now() - lastRefresh >= 2000 &&
        !reader.busy
      ) {
        lastRefresh = Date.now();
        if (!reader.pages.length) {
          thinking = thinkingPreference(data.domain, localStorage);
          await loadWindow("replace");
        } else {
          readingStale = true;
          await reader.refresh(
            bridge,
            data.domain,
            tailFollow ? new Set() : pins(),
          );
          readingStale = false;
          history = reader.value ?? null;
        }
        refreshedVersion = currentBase.version;
      }
      await restore(savedPosition, tailFollow);
      if (!profile) profile = next.profiles[0]?.id ?? "";
    } catch (e) {
      displayError(e);
    } finally {
      metrics({ rows: items.length, pages: reader.pages.length, rawBytes: reader.size + content.size, htmlBytes, foregroundReads: readBudget.active, transientRows: previews(live).length });
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
        if (
          livePolling ||
          !data.domain ||
          !data.core ||
          page !== "conversation" ||
          document.hidden
        )
          return;
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
            const savedPosition = capture(),
              tailFollow = follow();
            reconnecting = !snapshot?.connected;
            // A disconnect is not a deletion. Retain the last preview in this
            // domain/instance until a fresh snapshot or durable row replaces it.
            if (snapshot?.connected) {
              const fresh = new Set(previews(snapshot.data).map((p) => p.id));
              for (const old of previews(live))
                if (!fresh.has(old.id) && previewChecks.size < 8)
                  previewChecks.add(old.id);
            }
            live = retainPreview(live, snapshot);
            if (previewChecks.size && readBudget.active < 2) {
              const id = previewChecks.values().next().value!;
              previewChecks.delete(id);
              try {
                const row = await readBudget.run(() =>
                  bridge.query<import("./contracts").Message>(d, {
                    operation: "messages/{id}/content",
                    id: "message:" + id,
                    parameters: { thinking: false, streaming: false },
                  }),
                );
                if (
                  !disposed &&
                  round === generation &&
                  i === data.core?.instance_id &&
                  row.id === "message:" + id
                ) {
                  for (const p of reader.pages)
                    p.value = {
                      ...p.value,
                      items: p.value.items.map((old) =>
                        old.id === row.id ? row : old,
                      ),
                    };
                  history = reader.value ?? history;
                }
              } catch {
                /* normal snapshot refresh remains authoritative */
              }
            }
            await restore(savedPosition, tailFollow);
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
      anchor(true);
      clearTimeout(anchorTimer);
      reader.clear();
      content.clear();
    };
  });
  async function latest() {
    reader.clear();
    content.clear();
    readingBusy = false;
    await loadWindow("replace");
    inHistory = false;
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
  {initialTheme}
>
  {#snippet status()}<span data-testid="status"
      >{data.sync}{data.error ? " · " + data.error : ""}</span
    >{/snippet}
  {#snippet ongoing()}{#if data.domain}<RelatedRail
        {data}
        selected={related}
        {bridge}
        budget={readBudget}
        reset={() => (related = null)}
        {openWork}
      />{/if}{/snippet}
  <div class="phase-page-heading">
    <h1>{titles[page]}</h1>
    <Divider edge="bottom" />
  </div>
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
    {#if inHistory}<p data-testid="history-banner">
        正在阅读历史页面。<Button variant="text" onclick={latest}
          >转到最新消息</Button
        >
      </p>{/if}
    {#if reconnecting && !inHistory}<Status state="offline"
        >正在重新连接，保留上次预览</Status
      >{/if}
    <div class="conversation-tools">
      <Button variant="text" onclick={resync}>重建投影</Button>
      <Button variant="text" aria-pressed={thinking} onclick={toggleThinking}
        >思考：{thinking ? "开" : "关"}</Button
      >
      <label
        >定位类型<select bind:value={locateKind}
          ><option value="message_id">消息 / 活动 ID</option><option
            value="event_id">事件 ID</option
          ></select
        ></label
      >
      <label>定位 ID<input bind:value={locate} maxlength="256" /></label><Button
        variant="text"
        disabled={readingBusy || !locate.trim()}
        onclick={() => loadWindow("replace", locate.trim(), locateKind)}
        >定位</Button
      >
      <label
        >搜索已加载窗口<input bind:value={findText} maxlength="256" /></label
      ><Button variant="text" onclick={searchLoaded}>查找</Button>
    </div>
    {#if readingStale}<p role="status">历史缓存待刷新；内容可能已变化。</p>{/if}
    {#if (projection<import("./contracts").Session>(data.cache, "session")?.state ?? data.core?.state) === "RECOVERY_BLOCKED"}<Status
        state="error"
        >会话恢复被阻塞，已受理的消息仍保留。<Button
          variant="text"
          disabled={busy}
          onclick={() => (resumeConfirm = true)}>恢复会话…</Button
        ></Status
      >{/if}
    {#if !items.length}<p>当前没有可显示的记录。</p>{/if}
    {#if timeline?.before}<Button
        variant="text"
        disabled={readingBusy}
        onclick={() => loadWindow("before")}>较早消息</Button
      >{/if}
    {#if data.domain}{#key data.domain + ":" + data.core?.instance_id}<Conversation
          {items}
          domain={data.domain}
          name={assistant}
          {bridge}
          stats={(value) => (htmlBytes = value)}
          store={content}
          {thinking}
          active={page === "conversation" && !reconnecting && !data.error}
          select={(item) => (related = item)}
          reloadRow={(id) => loadWindow("replace", id)}
        />{/key}{/if}
    {#if timeline?.after}<Button
        variant="text"
        disabled={readingBusy}
        onclick={() => loadWindow("after")}>较新消息</Button
      >{/if}
    <div bind:this={tail}></div>
    <Button variant="text" onclick={latest}>转到最新消息</Button>
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
        disabled={!capability(data.core, "messages")}
        aria-disabled={busy ||
          composing ||
          !text.trim() ||
          !capability(data.core, "messages")}
      />
    </div>
    <div class="phase-send-status" role="status" aria-live="polite">
      {sendNotice}
    </div>
  </section>
  {#if data.domain}{#key data.domain + ":" + data.core?.instance_id}<Work
        {data}
        {page}
        target={workTarget}
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
  {#if data.domain && page === "attention"}<Recovery
      domain={data.domain}
      {bridge}
      restore={restoreDraft}
      {items}
    />{/if}
  <Dialog bind:open={resumeConfirm} title="恢复会话"
    ><p>
      Core 将继续未完成回合，可能再次调用模型。此操作不重新发送已受理的消息。
    </p>
    <Button disabled={busy} onclick={resumeSession}>确认恢复会话</Button><Button
      onclick={() => (resumeConfirm = false)}>取消</Button
    ></Dialog
  >
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
