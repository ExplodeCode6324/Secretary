<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import {
    Shell,
    Button,
    Avatar,
    Field,
    Divider,
    Status,
    Row,
    Progress,
    Filters,
    Dialog,
  } from "./index";
  import { geometry } from "./geometry";
  import { motionController, type MotionMode } from "./motion/controller";
  let { mode = "base", seed = 62 }: { mode?: MotionMode; seed?: number } =
    $props();
  let open = $state(false),
    filter = $state("all"),
    scale = $state(14),
    brand = $state("Secretary"),
    width = $state(1180),
    zoom = $state(1),
    motionMode = $state<MotionMode>("base");
  $effect(() => {
    motionMode = mode;
  });
  async function view() {
    await invoke("phaseui_view", { width: Number(width), zoom: Number(zoom) });
  }
  onMount(() => motionController.configure({ seed }));
</script>

<Shell
  name={brand}
  synthetic
  fontSize={scale}
  initialMode={motionMode}
  page="settings"
  navigate={() => {}}
>
  <div class="phase-page-heading">
    <h1>PhaseUI · 组件验证</h1>
    <p>冻结 v1.0 形状 / 三帧离散故障</p>
  </div>
  <main class="phase-scroll">
    <div class="phase-filters">
      <label>品牌 <input aria-label="品牌名称" bind:value={brand} /></label>
      <label
        >宽度 <select bind:value={width} onchange={view}
          >{#each [480, 599, 600, 601, 849, 850, 851, 1099, 1100, 1101, 1180] as n}<option
              value={n}>{n}</option
            >{/each}</select
        ></label
      ><label
        >缩放 <select bind:value={zoom} onchange={view}
          >{#each [1, 1.25, 1.5, 2] as n}<option value={n}>{n * 100}%</option
            >{/each}</select
        ></label
      ><label
        >文字 <select bind:value={scale}
          ><option value={14}>14px</option><option value={18}>18px</option
          ></select
        ></label
      >{#each ["off", "base", "extended", "reduced", "outline"] as choice}<Button
          onclick={() => (motionMode = choice as MotionMode)}>{choice}</Button
        >{/each}<Button
        onclick={() =>
          motionController.configure({
            labels: !motionController.options.labels,
          })}>文字扩展开关</Button
      ><Button
        onclick={() =>
          motionController.configure({
            separatorKeys: !motionController.options.separatorKeys,
          })}>分隔线扩展开关</Button
      >
    </div>
    <div class="phase-filters">
      <Button
        onclick={() => motionController.configure({ mode: "base", freeze: 0 })}
        >BASE</Button
      ><Button
        onclick={() =>
          motionController.configure({ mode: "extended", freeze: 0 })}
        >EXTENDED</Button
      >{#each [0, 1, 2, 3] as frame}<Button
          onclick={() => motionController.configure({ freeze: frame })}
          >{frame ? "帧 " + frame : "播放"}</Button
        >{/each}{#each [0, 1, 2] as scheme}<Button
          onclick={() => motionController.configure({ scheme })}
          >{["A 160ms", "B 180ms", "C 200ms"][scheme]}</Button
        >{/each}
    </div>
    <div class="phase-gallery-grid">
      <section>
        <h2>字形</h2>
        {#each Object.keys(geometry) as name}<Button
            icon={name}
            aria-label={name}
            title={name}
          />{/each}
      </section>
      <section>
        <h2>身份</h2>
        <Avatar name="Master" /><Avatar name="Secretary" assistant /><Avatar
          name="👩‍💻开发者"
        /><Avatar name="系统" />
      </section>
      <section>
        <h2>按钮 / 焦点 / 禁用</h2>
        <Button>操作</Button><Button primary>主要操作</Button><Button disabled
          >不可用</Button
        ><Button variant="text">文字链接</Button><Button
          variant="send"
          primary
          icon="send"
          aria-label="发送"
        />
      </section>
      <section>
        <h2>输入</h2>
        <Field><input aria-label="示例名称" placeholder="名称" /></Field><Field
          ><select aria-label="选项"
            ><option>默认选项</option><option>第二项</option></select
          ></Field
        ><Field
          ><textarea aria-label="多行示例" placeholder="支持中文输入"
          ></textarea></Field
        >
      </section>
      <section>
        <h2>状态</h2>
        {#each ["idle", "pending", "success", "error", "offline"] as const as state}<Status
            {state}>{state}</Status
          >{/each}<Progress label="等待响应" /><Progress
          label="已处理"
          value={65}
        />
      </section>
      <section>
        <h2>行与筛选</h2>
        <Filters options={["全部", "进行中"]} bind:value={filter} /><Row
          >示例记录{#snippet meta()}刚刚{/snippet}</Row
        ><Divider /><Button onclick={() => (open = true)}>打开对话框</Button>
      </section>
    </div>
    <h2>Consumer examples · #63–#66</h2>
    <div class="phase-gallery-grid">
      <section>
        <h3>#63 Conversation</h3>
        <Row
          ><Avatar name="Master" /> Master{#snippet meta()}人工示例{/snippet}</Row
        >
        <p>正文保持可选择，输入不随装饰位移。</p>
        <Field><textarea aria-label="示例消息"></textarea></Field><Button
          variant="send"
          icon="send"
          primary
          aria-label="示例发送"
        />
      </section>
      <section>
        <h3>#64 Task / decision</h3>
        <Row>核对实施计划{#snippet meta()}待处理{/snippet}</Row><Status
          state="pending">等待确认</Status
        ><Button onclick={() => (open = true)}>查看详情</Button><Button disabled
          >批准（示例）</Button
        >
      </section>
      <section>
        <h3>#65 Settings</h3>
        <label for="example-name">显示名</label><Field
          ><input id="example-name" value="Secretary" /></Field
        ><Button>保存示例</Button><Status state="idle"
          >仅演示组件，不保存配置。</Status
        >
      </section>
      <section>
        <h3>#66 Artifact / notification</h3>
        <Row>report.md{#snippet meta()}Markdown · 2 KiB{/snippet}</Row><Button
          variant="text"
          disabled>保存产物（示例）</Button
        ><Status state="success">任务已完成 · 人工示例</Status>
      </section>
    </div>
    <Dialog bind:open title="验证对话框"
      ><p>Esc 关闭并归还焦点。</p>
      <Field><input aria-label="对话框输入" /></Field></Dialog
    >
  </main>
</Shell>
