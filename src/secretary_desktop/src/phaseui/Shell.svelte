<script lang="ts">
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import Button from "./Button.svelte";
  import Divider from "./Divider.svelte";
  import {
    motion,
    motionController,
    type MotionMode,
  } from "./motion/controller";
  import { displayName } from "./identity";
  export type Page =
    | "conversation"
    | "tasks"
    | "memory"
    | "artifacts"
    | "attention"
    | "settings";
  let {
    name = "Secretary",
    page = "conversation",
    navigate,
    connection,
    children,
    status,
    synthetic = false,
    initialMode,
    fontSize = 14,
    initialTheme = "light",
  }: {
    name?: string;
    page?: Page;
    navigate: (page: Page) => void;
    connection?: () => void;
    children: Snippet;
    status?: Snippet;
    synthetic?: boolean;
    initialMode?: MotionMode;
    fontSize?: number;
    initialTheme?: "light" | "dark";
  } = $props();
  let theme = $state("light");
  $effect(() => {
    if (synthetic) theme = initialTheme;
  });
  let mode = $state<MotionMode>("base");
  let collapsed = $state(false);
  const pages: [Page, string, string][] = [
    ["conversation", "对话", "chat"],
    ["tasks", "任务", "tasks"],
    ["memory", "记忆", "memory"],
    ["artifacts", "产物", "file"],
    ["attention", "待处理", "attention"],
    ["settings", "设置", "settings"],
  ];
  onMount(() => {
    if (initialMode) mode = initialMode;
    const narrow = matchMedia("(max-width:850px)");
    collapsed = narrow.matches;
    const resize = () => {
      collapsed = narrow.matches;
    };
    narrow.addEventListener("change", resize);
    try {
      if (!synthetic) {
        theme =
          localStorage.getItem("secretary.phaseui.v1.theme") === "dark"
            ? "dark"
            : "light";
        if (!initialMode) {
          const saved = localStorage.getItem("secretary.phaseui.v1.motion");
          mode = saved === "off" ? "off" : "base";
        }
      }
    } catch {}
    return () => narrow.removeEventListener("change", resize);
  });
  $effect(() => {
    if (initialMode) mode = initialMode;
  });
  $effect(() => {
    void theme;
    void fontSize;
    motionController.configure({ mode });
    if (!synthetic)
      try {
        localStorage.setItem("secretary.phaseui.v1.theme", theme);
        localStorage.setItem(
          "secretary.phaseui.v1.motion",
          mode === "off" ? "off" : "base",
        );
      } catch {}
  });
</script>

<div
  class="phaseui"
  style={`--font-size:${fontSize}px`}
  data-theme={theme}
  data-motion={mode}
>
  <div class="phase-shell">
    <aside class="phase-sidebar">
      <Divider edge="right" />
      <div class="phase-sidebar-scroll">
        <a
          class="phase-brand"
          href="#conversation"
          aria-label={displayName(name)}
          title={displayName(name)}
          onclick={(e) => {
            e.preventDefault();
            navigate("conversation");
          }}
          use:motion={{ kind: "identity" }}
          ><span data-identity-source>{displayName(name)}</span><span
            data-phase-layer
            aria-hidden="true"
          ></span></a
        >
        <nav class="phase-directory" aria-label="主导航">
          {#each pages as [id, label, icon]}{#if id === "settings"}<Divider
                navigation
              />{/if}<a
              href={"#" + id}
              data-page={id}
              aria-label={label}
              title={label}
              aria-current={id === page ? "page" : undefined}
              onclick={(e) => {
                e.preventDefault();
                navigate(id);
              }}
              use:motion={{
                kind: "glyph",
                label: true,
                adjacent: id === "attention" || id === "settings",
              }}
              ><Icon name={icon} /><span data-nav-label>{label}</span><span
                data-phase-layer
                aria-hidden="true"
              ></span></a
            >{/each}
        </nav>
        <footer>Secretary / PhaseUI</footer>
      </div>
    </aside>
    <div
      class="phase-workspace"
      class:has-activity={page === "conversation"}
      class:collapsed={page === "conversation" && collapsed}
    >
      <div class="phase-document">
        <div class="phase-toolbar">
          <Divider edge="bottom" />{#if synthetic}<strong
              >人工数据 · 验证</strong
            >{/if}<Button
            variant="text"
            onclick={() => (theme = theme === "light" ? "dark" : "light")}
            >{theme === "light" ? "深色模式" : "浅色模式"}</Button
          ><Button
            variant="text"
            onclick={() => (mode = mode === "off" ? "base" : "off")}
            >动效：{mode === "off" ? "关" : "开"}</Button
          >{#if connection}<Button variant="text" onclick={connection}
              >连接</Button
            >{/if}
        </div>
        {@render children()}
        <div class="phase-status">
          <Divider edge="top" />{@render status?.()}<span>Secretary</span>
        </div>
      </div>
      {#if page === "conversation"}<aside
          class="phase-rail"
          class:collapsed
          aria-label="当前活动"
        >
          <Divider edge="left" />
          <div class="phase-rail-toggle">
            <Button
              variant="text"
              icon={collapsed ? "expandRail" : "collapseRail"}
              aria-label={collapsed ? "展开活动栏" : "收起活动栏"}
              aria-expanded={!collapsed}
              onclick={() => (collapsed = !collapsed)}
            />
          </div>
          <div class="phase-rail-content" hidden={collapsed}>
            <section>
              <h2>正在进行</h2>
              <div class="empty-slot"></div>
            </section>
            <section>
              <h2>近期产物</h2>
              <div class="empty-slot"></div>
            </section>
            <section>
              <h2>快捷操作</h2>
              <div class="empty-slot"></div>
            </section>
          </div>
        </aside>{/if}
    </div>
  </div>
</div>
