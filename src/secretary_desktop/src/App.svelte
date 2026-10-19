<script lang="ts">
  import { onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import Phase from "./Phase.svelte";
  import MessageView from "./Message.svelte";
  import {
    fixture,
    loadFixture,
    shouldSend,
    safeDraft,
    percentiles,
    phaseFrames,
    streamChunk,
  } from "./study";
  let messages = $state(fixture());
  let draft = $state("");
  let composing = false;
  let compositionEndedWithoutKey = false;
  let frame = $state(0);
  let reduce = $state(false);
  let systemReduce = $state(false);
  let panel = $state(false);
  let selection = $state(false);
  let baseline = $state(false);
  let status = $state("准备就绪");
  let zoom = $state(1);
  let pending = 0;
  let stream = $state("");
  let running = $state(false);
  let sent = $state<string[]>([]);
  let events = $state<unknown[]>([]);
  let textarea: HTMLTextAreaElement;
  let scroll: HTMLElement;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let streamTimer: ReturnType<typeof setInterval> | undefined;
  let raf = 0;
  let measuring = false;
  let intervals: number[] = [];
  let updateTimes: number[] = [];
  let inputTimes: number[] = [];
  let last = 0;
  const stopped = () => reduce || systemReduce;
  function resetPhase() {
    timers.forEach(clearTimeout);
    timers = [];
    frame = 0;
  }
  function phase(n: number) {
    resetPhase();
    frame = stopped() ? 0 : n;
  }
  function play() {
    resetPhase();
    if (stopped()) return;
    frame = 1;
    timers = [
      setTimeout(() => (frame = 2), 100),
      setTimeout(() => (frame = 3), 190),
      setTimeout(() => (frame = 0), 300),
    ];
  }
  $effect(() => {
    if (reduce || systemReduce) resetPhase();
  });
  function log(e: Event, decision = "") {
    const k = e as KeyboardEvent;
    events = [
      ...events.slice(-499),
      {
        t: performance.now(),
        type: e.type,
        key: k.key,
        keyCode: k.keyCode,
        isComposing: k.isComposing,
        composing,
        value: textarea?.value,
        decision,
      },
    ];
  }
  function send(e?: Event) {
    // AXPress can make WebKit commit romanized preedit before dispatching click,
    // without pointerdown. That same gesture must not submit unfinished text.
    if (e?.type === "click" && compositionEndedWithoutKey) {
      compositionEndedWithoutKey = false;
      status = "输入已结束，请确认文字后再发送";
      log(e, "composition-commit-click-blocked");
      textarea?.focus();
      return;
    }
    const value = safeDraft(draft, composing);
    if (e) log(e, value === null ? "blocked" : "send");
    if (value === null) return;
    sent = [...sent, value];
    messages = [
      ...messages,
      { id: 10000 + sent.length, role: "你", time: "现在", source: value },
    ];
    draft = "";
    play();
    textarea?.focus();
  }
  function keydown(e: KeyboardEvent) {
    // A candidate-confirmation key or a new independent key establishes the
    // explicit keyboard action; 229/isComposing still prevent candidate sends.
    compositionEndedWithoutKey = false;
    const yes = shouldSend(e, composing);
    log(e, yes ? "send" : "keep");
    if (yes) {
      e.preventDefault();
      send();
    }
  }
  function input(e: Event) {
    draft = (e.target as HTMLTextAreaElement).value;
    log(e);
    const t = performance.now();
    requestAnimationFrame(() => inputTimes.push(performance.now() - t));
  }
  async function load() {
    stopStream();
    messages = loadFixture();
    stream = "";
    selection = false;
    status = "1,000 条合成记录";
    await tick();
    scroll.scrollTop = 0;
  }
  function frameSample(t: number) {
    if (!running) return;
    if (last) intervals.push(t - last);
    last = t;
    raf = requestAnimationFrame(frameSample);
  }
  function stopStream() {
    cancelAnimationFrame(raf);
    if (streamTimer) clearInterval(streamTimer);
    streamTimer = undefined;
    running = false;
  }
  function startStream() {
    stopStream();
    stream = "## 正在整理\n\n";
    running = true;
    status = "正在更新";
    let n = 0;
    intervals = [];
    updateTimes = [];
    last = 0;
    raf = requestAnimationFrame(frameSample);
    streamTimer = setInterval(async () => {
      const t = performance.now();
      pending++;
      stream += streamChunk;
      if (++n % 10 === 0) stream += "\n\n";
      if (n === 600) stream += "\n```typescript\n";
      if (n === 620) stream += "\n```\n";
      await tick();
      pending--;
      updateTimes.push(performance.now() - t);
      if (n >= 1200) {
        stopStream();
        status = "更新完成";
      }
    }, 50);
  }
  async function prepend() {
    const activeSelection = getSelection();
    const saved = activeSelection?.rangeCount
      ? activeSelection.getRangeAt(0)
      : null;
    // Store node boundaries, not live parent offsets: inserting preceding siblings
    // can leave WebKit's Range at the same index but pointing into new messages.
    const startNode = saved?.startContainer;
    const endNode = saved?.endContainer;
    const startOffset = saved?.startOffset ?? 0;
    const endOffset = saved?.endOffset ?? 0;
    const startChild = startNode?.childNodes[startOffset];
    const endChild = endNode?.childNodes[endOffset - 1];
    const anchor = [...scroll.querySelectorAll<HTMLElement>(".message")].find(
      (el) =>
        el.getBoundingClientRect().bottom > scroll.getBoundingClientRect().top,
    );
    const before = anchor?.getBoundingClientRect().top;
    const min = Math.min(...messages.map((m) => m.id));
    messages = [
      ...fixture(200).map((m, i) => ({ ...m, id: min - 200 + i })),
      ...messages,
    ];
    await tick();
    if (saved && startNode?.isConnected && endNode?.isConnected) {
      const restored = document.createRange();
      if (startChild?.isConnected) restored.setStartBefore(startChild);
      else restored.setStart(startNode, startOffset);
      if (endChild?.isConnected) restored.setEndAfter(endChild);
      else restored.setEnd(endNode, endOffset);
      activeSelection?.removeAllRanges();
      activeSelection?.addRange(restored);
    }
    if (anchor && before !== undefined)
      scroll.scrollTop += anchor.getBoundingClientRect().top - before;
  }
  async function setZoom(value: number) {
    try {
      await getCurrentWebview().setZoom(value);
      zoom = value;
    } catch (e) {
      status = String(e);
    }
  }
  function snapshot() {
    return {
      ua: navigator.userAgent,
      frame,
      transforms: phaseFrames[frame],
      sent: [...sent],
      events: [...events],
      count: messages.length,
      mounted: document.querySelectorAll(".prose").length,
      selection,
      baseline,
      zoom,
      reduce,
      systemReduce,
      running,
      queue: pending,
      metrics: {
        frames: percentiles(intervals),
        updates: percentiles(updateTimes),
        inputs: percentiles(inputTimes),
      },
      textarea: textarea?.getBoundingClientRect().toJSON(),
      focus: document.activeElement?.tagName,
      streamLength: stream.length,
    };
  }
  async function selectAll(e: KeyboardEvent) {
    if (
      (e.metaKey || e.ctrlKey) &&
      e.key === "a" &&
      !(e.target instanceof HTMLTextAreaElement) &&
      !(e.target instanceof HTMLInputElement)
    ) {
      e.preventDefault();
      selection = true;
      await tick();
      const range = document.createRange();
      range.selectNodeContents(scroll.querySelector(".messages")!);
      const s = getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }
  }
  onMount(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    systemReduce = mq.matches;
    const motion = () => (systemReduce = mq.matches);
    mq.addEventListener("change", motion);
    const selectionChange = () => {
      if (!getSelection()?.toString() && !document.querySelector(":active"))
        selection = false;
    };
    document.addEventListener("selectionchange", selectionChange);
    Object.assign(window, {
      study: {
        snapshot,
        load,
        startStream,
        stopStream,
        phase,
        play,
        prepend,
        setZoom,
        setReduced: (value: boolean) => (reduce = value),
        setBaseline: (value: boolean) => (baseline = value),
        clearEvents: () => (events = []),
      },
    });
    (async () => {
      let mode = "";
      try {
        mode = await invoke<string>("study_mode");
      } catch {}
      measuring = mode === "load" || mode === "stream";
      if (measuring) await load();
      await tick();
      requestAnimationFrame(() =>
        requestAnimationFrame(async () => {
          await invoke("study_ready").catch(() => {});
          if (mode === "stream") startStream();
        }),
      );
    })();
    const report = setInterval(() => {
      if (!measuring) return;
      invoke("study_metrics", {
        report: JSON.stringify({
          metrics: snapshot().metrics,
          running,
          queue: pending,
          textarea: textarea?.getBoundingClientRect().toJSON(),
          zoom,
          streamLength: stream.length,
          count: messages.length,
          mounted: document.querySelectorAll(".prose").length,
        }),
      }).catch(() => {});
    }, 1000);
    return () => {
      resetPhase();
      stopStream();
      cancelAnimationFrame(raf);
      clearInterval(report);
      mq.removeEventListener("change", motion);
      document.removeEventListener("selectionchange", selectionChange);
    };
  });
</script>

<svelte:window onkeydown={selectAll} />
<div class="shell">
  <aside class="directory">
    <div class="brand"><Phase {frame} /><span>secretary</span></div>
    <div class="directory-label">工作目录 <span>01</span></div>
    <button class="active">今天的记录 <span>↗</span></button>
    <div class="directory-note">桌面研究<br />合成内容 · 本地演示</div>
    <button class="study-toggle" onclick={() => (panel = !panel)}
      >验证工具 <span>{panel ? "−" : "+"}</span></button
    >
  </aside>
  <main>
    <header class="page-header">
      <div>
        <small>工作札记 / 001</small>
        <h1>从这里继续</h1>
      </div>
      <span class="date">十月十九日<br />星期一</span>
    </header>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable document needs keyboard focus) -->
    <div
      class="document-scroll"
      bind:this={scroll!}
      onpointerdown={(e) => {
        if (e.target instanceof Element && !e.target.closest("button"))
          selection = true;
      }}
      role="region"
      aria-label="文档记录"
      tabindex="0"
    >
      <div class="messages">
        {#each messages as message (message.id)}<MessageView
            {message}
            retain={selection}
            {baseline}
          />{/each}
        {#if stream}<MessageView
            message={{
              id: 99999,
              role: "secretary",
              time: "现在",
              source: stream,
            }}
            retain={true}
          />{/if}
      </div>
      <div class="endnote">
        {messages.length} 条记录 <span>—</span> 内容可选择与复制
      </div>
    </div>
    <footer>
      <div class="composer" class:shifted={frame > 0}>
        <div
          class="composer-decoration"
          style:transform={"translateX(" +
            (frame ? phaseFrames[frame][0] : 0) +
            "px)"}
        ></div>
        <label for="draft">继续这段记录</label><textarea
          id="draft"
          bind:this={textarea!}
          value={draft}
          oninput={input}
          onkeydown={keydown}
          oncompositionstart={(e) => {
            composing = true;
            compositionEndedWithoutKey = false;
            log(e);
          }}
          oncompositionend={(e) => {
            composing = false;
            compositionEndedWithoutKey = true;
            draft = textarea.value;
            log(e);
          }}
          onblur={log}
          placeholder="写下你的想法…"
          rows="2"></textarea>
        <div class="composer-bottom">
          <span>Enter 发送 · Shift Enter 换行</span><button
            class="send"
            onpointerdown={(e) => {
              if (composing) e.preventDefault();
            }}
            onclick={send}>发送 <span>↗</span></button
          >
        </div>
      </div>
    </footer>
  </main>
  <aside class="margin">
    <span class="status-dot"></span><small>当前状态</small>
    <p>{status}</p>
    <div class="margin-rule"></div>
    <small>记录产物</small>
    <div class="artifact">
      <span>↳</span> 工作摘要.md<br /><small>合成样例 / 2.4 KB</small>
    </div>
    <div class="margin-bottom">本地窗口<br />WKWebView / Tauri 2</div>
  </aside>
</div>
{#if panel}<section class="tools" aria-label="验证工具">
    <header>
      <strong>可行性验证</strong><button onclick={() => (panel = false)}
        >关闭</button
      >
    </header>
    <p>合成数据；不连接 Core。</p>
    <div class="tool-row">
      <button onclick={load}>载入 1,000 条</button><button
        onclick={startStream}
        disabled={running}>流式 60 秒</button
      ><button onclick={stopStream}>停止</button><button onclick={prepend}
        >前插 200 条</button
      >
    </div>
    <div class="tool-row">
      <button onclick={play}>重演动效</button>{#each [0, 1, 2, 3] as n}<button
          onclick={() => phase(n)}>帧 {n}</button
        >{/each}
    </div>
    <div class="tool-row">
      <label><input type="checkbox" bind:checked={reduce} />减少动态效果</label
      ><label
        ><input type="checkbox" bind:checked={baseline} />全 DOM 基线</label
      >
    </div>
    <div class="tool-row">
      {#each [1, 1.25, 1.5, 2] as n}<button onclick={() => setZoom(n)}
          >{n * 100}%</button
        >{/each}
    </div>
    <p>
      发送 {sent.length} 次 · 事件 {events.length} 条 · {systemReduce
        ? "系统减少动态效果"
        : "系统常规动效"}
    </p>
    <details>
      <summary>最近事件</summary>
      <pre>{JSON.stringify(events.slice(-12), null, 2)}</pre>
    </details>
  </section>{/if}
