<script lang="ts">
  import { bridge, type Snapshot } from "./bridge";
  import type {
    TaskPage,
    TaskDetail,
    Execution,
    Authorization,
    Artifact,
    Attention,
    RequestStatus,
  } from "./contracts";
  import {
    projection,
    capability,
    approvalProblem,
    approvalDisplay,
  } from "./workflow";
  import Results from "./Results.svelte";
  import { onMount } from "svelte";
  let { data }: { data: Snapshot } = $props();
  let tasks = $derived(projection<TaskPage>(data.cache, "tasks"));
  let attention = $derived(projection<Attention>(data.cache, "attention"));
  let taskId = $state("");
  let authId = $state("");
  let task = $state<TaskDetail | null>(null);
  let execution = $state<Execution | null>(null);
  let auth = $state<Authorization | null>(null);
  let artifacts = $state<Artifact[]>([]);
  let detailError = $state("");
  let approvalError = $state("");
  let inspected = $state(false);
  let pending = $state("");
  let now = $state(Date.now());
  let refresh = $state(0);
  let detailLoading = $state(false);
  let authLoading = $state(false);
  let taskReadKey = "",
    authReadKey = "";
  let sequence = 0,
    authSequence = 0;
  let taskPage = $state<TaskPage | null>(null);
  let pageGeneration = 0;
  let receipt = $state<unknown>(null);
  let receiptGeneration = 0;
  let knownContext = "",
    selectedTask = "",
    selectedAuth = "";
  $effect(() => {
    const context = data.domain + ":" + data.core?.instance_id;
    if (context !== knownContext) {
      knownContext = context;
      taskId = "";
      authId = "";
      task = null;
      execution = null;
      auth = null;
      artifacts = [];
      taskPage = null;
      receipt = null;
      inspected = false;
      pending = "";
      pageGeneration++;
      receiptGeneration++;
    }
  });
  $effect(() => {
    const d = data.domain,
      id = taskId,
      cursor = data.cursor,
      r = refresh;
    void cursor;
    void r;
    const key = JSON.stringify([d, id, cursor, r]);
    if (key === taskReadKey) return;
    taskReadKey = key;
    const seq = ++sequence;
    if (!d || !id) {
      task = null;
      execution = null;
      artifacts = [];
      return;
    }
    if (selectedTask !== id) {
      selectedTask = id;
      task = null;
      execution = null;
      artifacts = [];
    }
    detailLoading = true;
    detailError = "";
    void (async () => {
      try {
        const t = await bridge.query<TaskDetail>(d, {
          operation: "tasks/{id}",
          id,
        });
        const e = t.latest_execution_id
          ? await bridge.query<Execution>(d, {
              operation: "executions/{id}",
              id: t.latest_execution_id,
            })
          : null;
        const result = e?.result ?? t.result;
        const files = await Promise.all(
          (result?.artifact_ids ?? [])
            .slice(0, 100)
            .map((id) =>
              bridge.query<Artifact>(d, { operation: "artifacts/{id}", id }),
            ),
        );
        if (seq !== sequence) return;
        task = t;
        execution = e;
        artifacts = files;
      } catch (e) {
        if (seq === sequence) detailError = String(e);
      } finally {
        if (seq === sequence) detailLoading = false;
      }
    })();
  });
  $effect(() => {
    const d = data.domain,
      id = authId,
      cursor = data.cursor,
      r = refresh;
    void cursor;
    void r;
    const key = JSON.stringify([d, id, cursor, r]);
    if (key === authReadKey) return;
    authReadKey = key;
    const seq = ++authSequence;
    if (selectedAuth !== id) {
      selectedAuth = id;
      inspected = false;
      auth = null;
    }
    authLoading = true;
    approvalError = "";
    if (!d || !id) {
      authLoading = false;
      return;
    }
    void bridge
      .query<Authorization>(d, { operation: "authorizations/{id}", id })
      .then((a) => {
        if (seq === authSequence) {
          if (
            auth?.revision !== a.revision ||
            auth?.display_hash !== a.display_hash ||
            auth?.state !== a.state
          )
            inspected = false;
          auth = a;
        }
      })
      .catch((e) => {
        if (seq === authSequence) {
          approvalError = String(e);
          auth = null;
          inspected = false;
        }
      })
      .finally(() => {
        if (seq === authSequence) authLoading = false;
      });
  });
  const unresolved = $derived(
    !!pending || !!data.approvals?.some((a) => a.target === authId),
  );
  const uncertain = $derived(
    data.approvals?.find(
      (a) =>
        a.target === authId && ["UNKNOWN", "RECEIPT_MISSING"].includes(a.state),
    ),
  );
  const problem = $derived(
    uncertain
      ? `已有提交状态为 ${uncertain.state}，为避免重复决策暂不能重试；请先核对 Core 授权状态及原请求回执`
      : approvalProblem(auth, now, unresolved),
  );
  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 500);
    return () => {
      clearInterval(t);
      sequence++;
      authSequence++;
    };
  });
  async function decide(decision: "APPROVE" | "REJECT") {
    if (
      !auth ||
      problem ||
      !inspected ||
      authLoading ||
      data.error ||
      !data.domain
    )
      return;
    const a = auth,
      d = data.domain,
      seq = authSequence;
    pending = a.id;
    approvalError = "";
    try {
      const id = await bridge.submit(
        d,
        { operation: "authorizations/{id}/decision", id: a.id },
        {
          expected_revision: a.revision,
          display_hash: a.display_hash,
          decision,
        },
      );
      if (seq === authSequence) approvalError = "已排队，等待 Core 回执：" + id;
    } catch (e) {
      if (seq === authSequence) {
        approvalError = String(e);
        auth = null;
        inspected = false;
      }
    } finally {
      if (pending === a.id) pending = "";
      if (seq === authSequence) {
        inspected = false;
        refresh++;
      }
    }
  }
  async function nextTasks() {
    if (!data.domain) return;
    const cursor = (taskPage ?? tasks)?.next_cursor;
    if (!cursor) return;
    const seq = ++pageGeneration;
    try {
      const page = await bridge.query<TaskPage>(data.domain, {
        operation: "tasks",
        parameters: { cursor },
      });
      if (seq === pageGeneration) taskPage = page;
    } catch (e) {
      detailError = String(e);
    }
  }
  async function fullReceipt(id: string) {
    if (!data.domain) return;
    const seq = ++receiptGeneration;
    try {
      const value = await bridge.query<RequestStatus>(data.domain, {
        operation: "requests/{id}",
        id,
      });
      if (seq === receiptGeneration) receipt = value;
    } catch (e) {
      if (seq === receiptGeneration) receipt = { error: String(e) };
    }
  }
  async function cancel() {
    if (!data.domain || !execution || detailLoading || task?.id !== taskId)
      return;
    try {
      await bridge.submit(
        data.domain,
        { operation: "executions/{id}/cancel", id: execution.id },
        {},
      );
      refresh++;
    } catch (e) {
      detailError = String(e);
    }
  }
</script>

<div class="work">
  <section aria-label="任务">
    <h2>任务</h2>
    {#each (taskPage ?? tasks)?.items ?? [] as t (t.id)}<button
        class:selected={taskId === t.id}
        data-testid="task"
        data-task-id={t.id}
        onclick={() => (taskId = t.id)}>{t.goal} · {t.state}</button
      >{/each}
    {#if (taskPage ?? tasks)?.next_cursor}<button onclick={nextTasks}
        >下一页任务</button
      >{/if}{#if taskPage}<button
        onclick={() => {
          pageGeneration++;
          taskPage = null;
        }}>最近任务</button
      >{/if}
    {#if detailLoading}<p>正在刷新详情…</p>{/if}{#if detailError}<p
        role="alert"
      >
        {detailError}
      </p>{/if}
    {#if task}<article data-testid="task-detail">
        <h3>{task.goal}</h3>
        <p>{task.id} · {task.state}</p>
        <p>Scope：{task.scope_id ?? "unknown"}</p>
        <details>
          <summary>提案与验收</summary>
          <pre>{JSON.stringify(
              task.effective_proposal ?? task.baseline,
              null,
              2,
            )}</pre>
        </details>
        {#each task.pending_requests as request}<p>
            任务请求：{request.request_id} · 等待 {request.due_at}
          </p>{/each}
        {#if execution}<p>执行：{execution.id} · {execution.state}</p>
          <p>{execution.cancel_requested ? "取消已请求" : ""}</p>
          <details>
            <summary>条件与待处理操作</summary>
            <pre>{JSON.stringify(
                {
                  conditions: execution.condition_results,
                  unknown: execution.unknown_operation_ids,
                },
                null,
                2,
              )}</pre>
          </details>
          {#if ["RUNNING", "WAIT_AUTH", "WAIT_DECISION", "READY"].includes(execution.state)}<button
              onclick={cancel}
              disabled={detailLoading ||
                task.id !== taskId ||
                !capability(data.core, "tasks") ||
                !!data.error ||
                execution.cancel_requested}>请求取消执行</button
            >{/if}{/if}
        {#key task.id + ":" + execution?.id + ":" + (execution?.result ?? task.result)?.id}
          <Results
            result={execution?.result ?? task.result}
            {artifacts}
            domain={data.domain!}
          />
        {/key}
      </article>{/if}
    <button onclick={() => refresh++}>刷新详情</button>
  </section>
  <section aria-label="待批准操作">
    <h2>需要批准</h2>
    {#each attention?.items.filter((x) => x.type === "authorization") ?? [] as a (a.id)}<button
        data-testid="authorization"
        data-auth-id={a.id}
        onclick={() => (authId = a.id)}>查看操作 {a.id}</button
      >{/each}
    {#if attention?.counts.decisions}<p>
        另有 {attention.counts.decisions} 项用户决策等待处理，本阶段未提供该入口。
      </p>{/if}
    {#if authLoading && authId}<p>读取实际参数…</p>{/if}{#if approvalError}<p
        role="status"
      >
        {approvalError}
      </p>{/if}
    {#if auth}<article data-testid="approval-detail">
        <h3>操作详情 · {auth.state}</h3>
        <p>{auth.id} · revision {auth.revision}</p>
        <p>到期：{auth.expires_at ?? "无"}</p>
        <pre data-testid="approval-parameters">{approvalDisplay(
            auth.display,
          )}</pre>
        <p>Scope：{JSON.stringify(auth.scope)}</p>
        {#if auth.remember_context}<p>
            根目录：{auth.remember_context.root}
          </p>{/if}
        <details>
          <summary>参数校验值</summary><code>{auth.display_hash}</code>
        </details>
        {#if problem}<p>{problem}</p>{/if}
        <label
          ><input
            type="checkbox"
            bind:checked={inspected}
            disabled={!!problem || authLoading}
          />我已查看以上实际参数</label
        >
        <button
          data-testid="approve"
          disabled={!!problem ||
            !inspected ||
            authLoading ||
            !!data.error ||
            !capability(data.core, "authorizations")}
          onclick={() => decide("APPROVE")}>批准本次操作</button
        >
        <button
          data-testid="reject"
          disabled={!!problem ||
            !inspected ||
            authLoading ||
            !!data.error ||
            !capability(data.core, "authorizations")}
          onclick={() => decide("REJECT")}>拒绝本次操作</button
        >
      </article>{/if}
  </section>
  <section aria-label="命令记录">
    <h2>命令与回执</h2>
    <p>
      ACCEPTED 表示受理；业务结果见任务详情。消息到后续 TaskPlan 的关联未由 API
      暴露。
    </p>
    {#each data.outbox ?? [] as row (row.id)}<article data-testid="outbox-item">
        <code>{row.id}</code> <strong>{row.state}</strong><button
          onclick={() => fullReceipt(row.id)}>完整回执</button
        >
        <details>
          <summary>原始提交与回执摘要</summary>
          <pre>{row.body}</pre>
          <pre>{row.receipt ?? "尚无回执"}</pre>
        </details>
      </article>{/each}
    {#if receipt}<pre>{JSON.stringify(receipt, null, 2)}</pre>{/if}
  </section>
</div>

<style>
  section {
    padding: 16px 0;
    border-top: 1px solid #ccd9e8;
  }
  article {
    padding: 10px 0;
  }
  button.selected {
    background: #cee4ff;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 420px;
    overflow: auto;
  }
  code {
    overflow-wrap: anywhere;
  }
  label {
    display: block;
  }
</style>
