<script lang="ts">
  import { Button, Divider } from "./phaseui";
  import type { Result, Artifact } from "./contracts";
  import { bridge as realBridge, type BridgePort } from "./bridge";
  let {
    result,
    artifacts,
    domain,
    bridge = realBridge,
  }: {
    result: Result | null;
    artifacts: Artifact[];
    domain: string;
    bridge?: BridgePort;
  } = $props();
  let notice = $state("");
  let downloading = $state(false);
  async function download(id: string) {
    downloading = true;
    try {
      notice = await bridge.download(domain, id);
    } catch (e) {
      notice = String(e);
    } finally {
      downloading = false;
    }
  }
</script>

{#if result}
  <section aria-label="执行结果" data-testid="result">
    <h3>执行结果 · {result.outcome}</h3>
    <p>{result.summary}</p>
    <p>
      验证来源：{result.verified_by} · {result.needs_action
        ? "需要处理"
        : "无需额外处理"}
    </p>
    {#each result.limitations as limitation}<p>限制：{limitation}</p>{/each}
    {#each artifacts as artifact (artifact.id)}
      <article data-testid="artifact">
        <Divider edge="bottom" />
        <strong>{artifact.name}</strong>
        <p>{artifact.bytes} bytes · {artifact.media_type} · {artifact.state}</p>
        <p>
          {artifact.path_base}: {artifact.relative_path ??
            artifact.path_unavailable_reason ??
            "路径不可用"}
        </p>
        <details>
          <summary>标识与完整性</summary>
          <p>{artifact.id}</p>
          <p>{artifact.content_version}</p>
          <p>Scope：{artifact.scope_id ?? "unknown"}</p>
        </details>
        <Button
          variant="text"
          disabled={downloading}
          onclick={() => download(artifact.id)}>保存产物…</Button
        >
      </article>{/each}
    {#if notice}<p role="status">
        {notice === "SAVED"
          ? "已保存并校验"
          : notice === "CANCELLED"
            ? "已取消保存"
            : notice}
      </p>{/if}
  </section>
{:else}<p>尚无结构化执行结果。</p>{/if}
