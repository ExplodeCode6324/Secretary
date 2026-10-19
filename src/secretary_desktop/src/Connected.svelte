<script lang="ts">
  import { onMount, tick } from "svelte";
  import { bridge, type Snapshot } from "./bridge";
  let data = $state<Snapshot>({ profiles: [], sync: "DISCONNECTED" });
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
  function anchor() {
    clearTimeout(anchorTimer);
    const domain = data.domain;
    if (domain)
      anchorTimer = setTimeout(() => {
        void bridge
          .anchor(domain, String(panel?.scrollTop ?? 0))
          .catch(displayError);
      }, 300);
  }
  async function resync() {
    if (!data.domain) return;
    try {
      await bridge.subscribe(data.domain, [
        { operation: "assistant" },
        { operation: "timeline" },
        { operation: "attention" },
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
    chain = chain.catch(() => {}).then(async () => {
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
      await tick();
      if (panel) {
        if (data.anchor === "latest") tail?.scrollIntoView({ block: "end" });
        else panel.scrollTop = Number(data.anchor) || 0;
      }
    } catch (e) {
      displayError(e);
    } finally {
      busy = false;
    }
  }
  async function send() {
    if (busy || composing || !text.trim() || !data.domain) return;
    busy = true;
    error = "";
    try {
      save();
      await chain;
      await bridge.submit(
        data.domain,
        { operation: "messages" },
        { text },
        version,
      );
      const next = await bridge.snapshot();
      data = next;
      text = next.draft?.text ?? "";
      version = next.draft?.version ?? 0;
      dirty = false;
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
    const round = generation;
    try {
      const next = await bridge.snapshot();
      if (disposed || round !== generation) return;
      data = next;
      if (!profile) profile = next.profiles[0]?.id ?? "";
    } catch (e) {
      displayError(e);
    }
  }
  onMount(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!busy && !saving) void refresh();
    }, 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
      clearTimeout(anchorTimer);
    };
  });
  function latest() {
    tail?.scrollIntoView({ block: "end" });
    if (data.domain)
      void bridge.anchor(data.domain, "latest").catch(displayError);
  }
</script>

<main class="connected" bind:this={panel} onscroll={anchor}>
  <header>
    <h1>Secretary</h1>
    <p>本机 Core · 原生通信</p>
  </header>
  <section aria-label="连接">
    <label
      >连接配置 <select bind:value={profile} disabled={busy}
        >{#each data.profiles as p}<option value={p.id}
            >{p.id} · {p.mode}</option
          >{/each}</select
      ></label
    >
    <button
      onclick={() => connect()}
      disabled={busy || !profile}
      data-testid="attach">附着 / 重新连接</button
    >
    <button
      onclick={() => connect(true)}
      disabled={busy || !profile}
      data-testid="start">启动本机 Core</button
    >
    <span data-testid="status"
      >{data.sync}{data.error ? " · " + data.error : ""}</span
    >
    {#if data.domain}<p>
        数据域：{data.domain} · 实例：{data.core?.instance_id}
      </p>{/if}
    {#if !data.profiles.length}<p>
        请先在应用数据目录配置 profiles.json。配置示例见桌面工程 README。
      </p>{/if}
  </section>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if notice}<p role="status">{notice}</p>{/if}
  {#if data.domain}
    <section aria-label="消息">
      <h2>最近投影</h2>
      <button onclick={resync}>重建投影</button>
      {#each Object.entries(data.cache ?? {}) as [key, value]}
        <details open={key.includes("timeline")}>
          <summary>{JSON.parse(key).operation}</summary>
          <pre>{JSON.stringify(value, null, 2)}</pre>
        </details>
      {/each}
      <div bind:this={tail}></div>
      <button onclick={latest}>跳到最新消息</button>
    </section>
    <section aria-label="发送">
      <label for="draft">输入</label>
      <textarea
        id="draft"
        data-testid="draft"
        bind:value={text}
        oninput={save}
        oncompositionstart={() => (composing = true)}
        oncompositionend={() => (composing = false)}
        disabled={busy}></textarea>
      <button
        onclick={send}
        disabled={busy || composing || !text.trim()}
        data-testid="send">保存并发送</button
      ><span>{saving ? "保存中" : dirty ? "尚未保存" : "草稿已保存"}</span>
    </section>
    <section aria-label="命令记录">
      <h2>命令与回执</h2>
      {#each data.outbox ?? [] as item}<article data-testid="outbox-item">
          <code>{item.id}</code> <strong>{item.state}</strong>
          <details>
            <summary>命令与回执</summary>
            <pre>{item.body}</pre>
            <pre>{item.receipt ?? "尚未确认受理"}</pre>
          </details>
        </article>{/each}
    </section>
    <section>
      <label>产物 ID <input bind:value={artifact} /></label><button
        onclick={() =>
          bridge
            .download(data.domain!, artifact)
            .then((s) => (notice = s))
            .catch(displayError)}
        disabled={!artifact}>保存产物…</button
      >
    </section>
    <section>
      <button onclick={() => (stopConfirm = true)} disabled={busy}
        >停止当前 Core…</button
      >{#if stopConfirm}<p>这会停止当前独立 Core 服务。</p>
        <button onclick={stop}>确认停止</button><button
          onclick={() => (stopConfirm = false)}>取消</button
        >{/if}
    </section>
  {/if}
</main>

<style>
  .connected {
    display: block;
    max-width: 1100px;
    margin: 24px auto;
    padding: 0 24px;
    color: #182b46;
    background: #fff;
    overflow: auto;
    height: calc(100vh - 48px);
  }
  header,
  section {
    border-bottom: 1px solid #ccd9e8;
    padding: 16px 0;
  }
  h1 {
    font-size: 24px;
  }
  h2 {
    font-size: 17px;
  }
  button,
  select,
  input {
    margin: 4px;
    padding: 7px 10px;
  }
  button {
    border: 1px solid #9ab4d3;
    color: #164b8a;
    background: #f3f8ff;
    cursor: pointer;
  }
  textarea {
    display: block;
    width: 100%;
    min-height: 100px;
    box-sizing: border-box;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 12px;
    max-height: 420px;
    overflow: auto;
  }
  article {
    padding: 8px;
    border-top: 1px solid #dce5ef;
  }
  p[role="alert"] {
    color: #a83232;
  }
</style>
