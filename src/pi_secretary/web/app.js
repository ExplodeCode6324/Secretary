import { TimelineView } from "./timeline-view.js";

const $ = (id) => document.getElementById(id);
const token =
  location.hash.slice(1) || sessionStorage.getItem("secretary-token");
if (location.hash) {
  sessionStorage.setItem("secretary-token", token);
  history.replaceState(null, "", "/");
}
let client,
  lastRevision = -1,
  approvalSignature = "",
  taskSignature = "",
  pendingMessage;
let polling = false;
const error = (message) => {
  $("error").textContent = message;
  $("error").hidden = !message;
};
async function api(route, body, signal) {
  const response = await fetch("/api/" + route, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "请求失败");
  return data;
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function detail(title, text) {
  $("detail-title").textContent = title;
  $("detail-body").textContent = text;
  if (!$("details").open) $("details").showModal();
}
async function command(line) {
  try {
    await api("command", { client, line });
    const poll = await api("poll?client=" + client);
    detail("工作记录", poll.output.map((o) => o.text).join("\n\n"));
    await refresh();
  } catch (e) {
    error(e.message);
  }
}
const displayPreferences = { streaming: true, thinking: true };
try {
  const stored = JSON.parse(localStorage.getItem("secretary-display") || "{}");
  for (const key of Object.keys(displayPreferences))
    if (typeof stored[key] === "boolean") displayPreferences[key] = stored[key];
} catch {}
let displayVersion = 0;
let lastState;
const panelData = { tasks: [], approvals: [], decisions: [] };
const panelPages = new Map();
const panelRequests = new Set();
let visibleTasks = "";
async function loadPanel(kind, offset = 0) {
  if (panelRequests.has(kind)) return;
  panelRequests.add(kind);
  try {
    const page = await api(
      `panels?client=${client}&kind=${kind}&offset=${offset}`,
    );
    panelData[kind] = page.items;
    panelPages.set(kind, { ...page, offset });
    if (lastState) render(lastState);
  } catch (e) {
    error(e.message);
  } finally {
    panelRequests.delete(kind);
  }
}
const timelineView = new TimelineView({
  scroller: $("timeline"),
  root: $("messages"),
  footer: $("activity"),
  request: (options, signal) => api("timeline", { client, options }, signal),
  preferences: displayPreferences,
  action: (action) => {
    if (action === "settings") $("world-tab").click();
    else if (action === "authorization" || action === "decisions") {
      $("attention").hidden = false;
      void loadPanel("approvals");
      void loadPanel("decisions");
    } else void command(action === "tasks" ? "/tasks" : "/status");
  },
  changed: (summary) => {
    if (summary.store_revision !== lastRevision) void refresh();
    const tasks = summary.locators
      .filter((l) => l.id.startsWith("task:"))
      .map((l) => l.id)
      .join();
    if (tasks !== visibleTasks) {
      visibleTasks = tasks;
      void loadPanel("tasks");
    }
    $("attention-count").textContent = summary.locators.some((l) =>
      l.actions.some((a) => a === "authorization" || a === "decisions"),
    )
      ? "●"
      : "";
  },
});
function restartStream() {
  void timelineView.open(
    timelineView.follow ? undefined : timelineView.capture()?.id,
    !timelineView.follow,
  );
}
for (const [id, key] of [
  ["display-streaming", "streaming"],
  ["display-thinking", "thinking"],
]) {
  $(id).checked = displayPreferences[key];
  $(id).onchange = () => {
    displayPreferences[key] = $(id).checked;
    displayVersion++;
    try {
      localStorage.setItem(
        "secretary-display",
        JSON.stringify(displayPreferences),
      );
    } catch {}
    // Clear immediately: an in-flight response from the previous generation cannot restore thinking.
    timelineView.generation++;
    timelineView.cache.reset();
    timelineView.revision = null;
    for (const node of timelineView.nodes.values()) {
      timelineView.observer.unobserve(node);
      node.remove();
    }
    timelineView.nodes.clear();
    timelineView.heights.clear();
    restartStream();
  };
}
window.addEventListener("online", () => void timelineView.sync());
window.addEventListener("offline", () => {
  timelineView.connection.textContent = "连接中断，活动状态暂不可确认";
});
window.addEventListener("pagehide", () => timelineView.close());
function render(state) {
  lastState = state;
  state = { ...state, ...panelData };
  if (state.settings) renderSettings(state.settings);
  $("connection").textContent = "● 已同步";
  $("runtime-state").textContent = state.settings?.blocked
    ? "设置待处理"
    : state.state === "IDLE"
      ? "待命"
      : state.state;
  $("model").textContent =
    `${state.mode === "live" ? "LIVE" : "DEMO"} · ${state.model}`;
  if (state.memory) {
    $("memory-state").textContent =
      `${state.memory.maintenance_mode === "WORKING_MEMORY" ? "记忆更新" : state.memory.maintenance_mode === "CONTEXT_COMPACTION" ? "上下文压缩" : "记忆"} ${state.memory.state} · r${state.memory.revision}${state.memory.compaction_target_reached === false ? " · 未达压缩目标" : ""}`;
    $("memory-state").title =
      `最近成功：${state.memory.last_success_at ?? "尚无"}；尝试 ${state.memory.attempt}/2；${state.memory.errors.join("; ")}${state.memory.compaction_target_reached === false ? "；原始输入与工具证据必须保留，压缩后仍高于目标比例" : ""}`;
  }
  const c = state.context,
    ratio = c.used == null ? 0 : (c.occupancy ?? c.used / c.budget) * 100;
  $("context-bar").style.width = Math.max(0, Math.min(100, ratio)) + "%";
  $("context-text").textContent =
    c.used == null
      ? `尚无模型请求 / ${c.budget.toLocaleString()} tokens`
      : `最近请求 ≈ ${c.used.toLocaleString()} / ${(c.usable_input ?? c.budget).toLocaleString()} · ${ratio.toFixed(1)}%`;
  const method =
    c.method === "historical_rough_estimate" ? "历史粗估" : "UTF-8 保守估算";
  const observed = c.observed_usage
    ? `；该请求供应商原始字段：input=${c.observed_usage.input}、output=${c.observed_usage.output}、cacheRead=${c.observed_usage.cache_read}、cacheWrite=${c.observed_usage.cache_write}（未相加）`
    : "；尚无对应供应商用量";
  $("context-text").title =
    `最近主会话模型请求（${c.model ?? "尚无"}）；${method}，不是精确 tokenizer 计量。可用输入 ${c.usable_input ?? "未知"}；窗口 ${c.budget}；输出上限 ${c.effective_output ?? "未知"}（请求 ${c.requested_output ?? "未知"}）；工具增长预留 ${c.tool_reserve ?? "未知"}；安全余量 ${c.safety_margin ?? "未知"}。${c.deployment_limit_verified ? "服务上限采用部署声明" : "使用模型注册容量，服务上限未核验"}${observed}。恢复检查点独立保留；下一请求发送前重算，待装入 ${c.pending_inputs ?? 0} 条。`;
  $("thinking").hidden = true;

  $("task-count").textContent =
    String(state.tasks.length) +
    (panelPages.get("tasks")?.next != null ? "+" : "");
  const tasks = JSON.stringify(state.tasks);
  if (tasks !== taskSignature) {
    taskSignature = tasks;
    $("task-list").replaceChildren();
    for (const task of [...state.tasks].reverse()) {
      const button = element("button", task.goal, "task-link");
      button.title = task.goal;
      button.onclick = () =>
        task.executions.length
          ? command("/show " + task.executions.at(-1).id)
          : detail("任务计划", JSON.stringify(task, null, 2));
      $("task-list").append(button);
    }
  }
  const signature = JSON.stringify([state.approvals, state.decisions]);
  if (signature !== approvalSignature) {
    approvalSignature = signature;
    $("approvals").replaceChildren();
    $("decisions").replaceChildren();
    const count = state.approvals.length + state.decisions.length;
    $("attention-count").textContent = count;
    $("nothing-pending").hidden = !!count;
    for (const a of state.approvals) {
      const section = element("section", null, "approval");
      section.append(
        element(
          "h3",
          `${a.state === "PENDING" ? "等待授权" : "已批准 · 可撤销"} · ${a.action.action}`,
        ),
      );
      const task = state.tasks.find((task) => task.id === a.scope.task_id);
      section.append(element("p", task?.goal ?? "主会话请求", "approval-goal"));
      const parameters = a.display.parameters ?? {};
      const summary =
        parameters.command ?? parameters.entrypoint ?? a.action.resource;
      section.append(element("pre", summary, "approval-summary"));
      const full = document.createElement("details");
      full.append(
        element("summary", "查看完整授权参数"),
        element("pre", JSON.stringify(a.display, null, 2)),
      );
      section.append(full);
      const label = element("label");
      const check = document.createElement("input");
      check.type = "checkbox";
      label.append(
        check,
        document.createTextNode(" 我已阅读本次操作的完整参数"),
      );
      section.append(label);
      const actions = element("div", null, "actions");
      for (const [text, decision] of a.state === "PENDING"
        ? [
            ["批准本次", "APPROVE"],
            ["拒绝", "REJECT"],
          ]
        : [["撤销批准", "REVOKE"]]) {
        const button = element("button", text);
        button.disabled = true;
        check.addEventListener("change", () => {
          button.disabled = !check.checked;
        });
        button.onclick = async () => {
          button.disabled = true;
          try {
            await api("approval", {
              client,
              id: a.id,
              revision: a.revision,
              display_hash: a.display_hash,
              request_id: crypto.randomUUID(),
              decision,
            });
            await refresh();
            await loadPanel("approvals");
          } catch (e) {
            error("授权未提交：" + e.message);
            button.disabled = false;
          }
        };
        actions.append(button);
      }
      section.append(actions);
      $("approvals").append(section);
    }
    for (const d of state.decisions) {
      const section = element("section", null, "decision");
      section.append(
        element("h3", d.question),
        element("pre", `${d.impact}\n${d.options.join("\n")}`),
      );
      const answer = document.createElement("textarea");
      answer.placeholder = "写下你的决定…";
      answer.setAttribute("aria-label", "工作决定回答");
      const button = element("button", "提交决定");
      button.onclick = async () => {
        if (!answer.value.trim()) return;
        await command("/answer " + d.id + " " + answer.value);
        await loadPanel("decisions");
      };
      section.append(answer, button);
      $("decisions").append(section);
    }
  }
  panelNavigation("tasks", $("task-list"));
  panelNavigation("approvals", $("approvals"));
  panelNavigation("decisions", $("decisions"));
}
function panelNavigation(kind, root) {
  root.querySelector(".panel-pages")?.remove();
  const page = panelPages.get(kind);
  if (!page) return;
  const nav = element("div", null, "panel-pages");
  for (const [label, offset] of [
    ["上一页", page.offset ? Math.max(0, page.offset - 20) : null],
    ["下一页", page.next],
  ]) {
    if (offset == null) continue;
    const b = element("button", label);
    b.onclick = () => loadPanel(kind, offset);
    nav.append(b);
  }
  root.append(nav);
}
async function refresh() {
  if (!client || polling) return;
  polling = true;
  const preferencesVersion = displayVersion;
  try {
    const state = await api(
      "state?window=1&client=" +
        client +
        "&since=" +
        lastRevision +
        "&thinking=" +
        Number(displayPreferences.thinking),
    );
    if (preferencesVersion !== displayVersion) return;
    if (!state.unchanged && state.revision !== lastRevision) {
      render(state);
      lastRevision = state.revision;
      if (state.notification_ids?.length)
        await api("presented", { client, ids: state.notification_ids });
    }
    $("connection").textContent = "● 已同步";
  } catch (e) {
    $("connection").textContent = "连接中断";
    if (e.message.includes("CLIENT_EXPIRED")) {
      client = (await api("client", {})).client;
      lastRevision = -1;
      restartStream();
    } else error(e.message);
  } finally {
    polling = false;
  }
}
$("composer").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("message").value.trim();
  if (!text || $("send").disabled) return;
  if (!pendingMessage || pendingMessage.text !== text)
    pendingMessage = { text, request_id: crypto.randomUUID() };
  $("send").disabled = true;
  error("");
  try {
    if (text.startsWith("/")) await command(text);
    else await api("message", { client, ...pendingMessage });
    $("message").value = "";
    pendingMessage = null;
    await refresh();
    await timelineView.open();
  } catch (e) {
    error("发送未确认，请重试：" + e.message);
  } finally {
    $("send").disabled = false;
    $("message").focus();
  }
};
$("message").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
};
$("attention-toggle").onclick = () => {
  $("attention").hidden = !$("attention").hidden;
  if (!$("attention").hidden) {
    void loadPanel("approvals");
    void loadPanel("decisions");
  }
};
$("close-attention").onclick = () => {
  $("attention").hidden = true;
};
$("close-details").onclick = () => $("details").close();
$("tasks-tab").onclick = () => command("/tasks");
$("conversation-tab").onclick = () => $("message").focus();
document.querySelectorAll("[data-command]").forEach((b) => {
  b.onclick = () => command(b.dataset.command);
});
document.querySelectorAll(".suggestions button").forEach((b) => {
  b.onclick = () => {
    $("message").value = b.textContent;
    $("message").focus();
  };
});
let instructionsRevision = null,
  instructionsDraftRevision = null;
function showInstructionsState(data) {
  $("instructions-version").textContent =
    `当前生效 r${data.settings.revision} · 最近使用 ${data.last_used_revision == null ? "尚无" : "r" + data.last_used_revision}；草稿需应用后生效`;
}
async function loadInstructions() {
  const data = await api("instructions?client=" + client);
  instructionsRevision = data.settings.revision;
  instructionsDraftRevision = data.management.draft.revision;
  $("instructions-content").value =
    data.management.draft.payload.instructions?.content ??
    data.settings.content;
  renderSettings(data.management);
  showInstructionsState(data);
  $("instructions-feedback").textContent = "";
}
$("instructions-tab").onclick = async () => {
  try {
    await loadInstructions();
    $("instructions-dialog").showModal();
  } catch (e) {
    error(e.message);
  }
};
$("instructions-close").onclick = () => $("instructions-dialog").close();
$("instructions-reload").onclick = async () => {
  try {
    await loadInstructions();
  } catch (e) {
    $("instructions-feedback").textContent = e.message;
  }
};
$("instructions-form").onsubmit = async (e) => {
  e.preventDefault();
  const content = $("instructions-content").value;
  if ([...content].length > 2000) {
    $("instructions-feedback").textContent = "说明超过 2000 字，请缩短后保存。";
    return;
  }
  $("instructions-save").disabled = true;
  try {
    const data = await api("instructions", {
      client,
      content,
      expected_revision: instructionsRevision,
      draft_revision: instructionsDraftRevision,
    });
    instructionsRevision = data.settings.revision;
    instructionsDraftRevision = data.management.draft.revision;
    renderSettings(data.management);
    showInstructionsState(data);
    $("instructions-feedback").textContent = "草稿已保存，点击应用后生效。";
  } catch (e) {
    $("instructions-feedback").textContent =
      "保存未确认，编辑内容已保留。" + e.message;
  } finally {
    $("instructions-save").disabled = false;
  }
};
let settingsState,
  worldData,
  worldCursor = null,
  editingFact = null,
  editingEntity = null,
  applyRequest = null;
const phaseNames = {
  QUEUED: "等待当前轮次结束",
  SUMMARIZING: "摘要工作上下文",
  COMMITTING: "提交变更",
  REBUILDING: "重建上下文",
  APPLIED: "已生效",
  FAILED: "失败 · 原设置保留",
  BLOCKED: "待恢复 · 主会话暂停",
};
function worldError(e) {
  $("world-feedback").textContent = e.message;
  error(e.message);
}
function button(text, action) {
  const b = element("button", text);
  b.type = "button";
  b.onclick = async () => {
    b.disabled = true;
    try {
      await action();
    } catch (e) {
      worldError(e);
    } finally {
      b.disabled = false;
    }
  };
  return b;
}
function renderSettings(data) {
  const previous = settingsState?.applications.at(-1);
  settingsState = data;
  if (data.effective_instructions && instructionsRevision !== null)
    $("instructions-version").textContent =
      `当前生效 r${data.effective_instructions.revision} · 编辑基于 r${instructionsRevision}；其他页面或应用已更新时请重新载入`;
  const latestApplied = data.applications.at(-1);
  if (
    worldData &&
    $("world-dialog").open &&
    latestApplied?.state === "APPLIED" &&
    (previous?.id !== latestApplied.id || previous?.state !== "APPLIED")
  )
    void loadWorld().catch(worldError);
  if (worldData) updateEntityOptions();
  const payload = data.draft.payload;
  const latest = data.applications.at(-1);
  const progress = latest
    ? `${phaseNames[latest.state]} · ${latest.id}${latest.error ? " · " + latest.error : ""}`
    : "尚无应用记录";
  $("settings-progress").textContent = progress;
  $("instructions-application").textContent = progress;
  const count = payload.edits.length + (payload.instructions ? 1 : 0);
  $("settings-apply").disabled = !count;
  $("instructions-apply").disabled = !count;
  $("settings-draft").replaceChildren();
  if (!count) $("settings-draft").append(element("p", "暂无待应用修改。"));
  if (payload.instructions)
    $("settings-draft").append(
      element("p", "Secretary 说明修改（与本批 World 修改一起应用）"),
    );
  for (const [index, edit] of payload.edits.entries()) {
    const row = element("div", null, "world-row");
    const subject =
      worldData?.entities.find((e) => e.entity_id === edit.subject_id)
        ?.display_name ??
      payload.edits.find((e) => e.entity_id === edit.subject_id)
        ?.display_name ??
      "所选实体";
    const description =
      edit.kind === "ENTITY"
        ? `${edit.retire ? "停用" : "保存"}实体：${edit.display_name}`
        : `${{ ASSERT: "新增", CORRECT: "更正", RETRACT: "撤回" }[edit.mode]}：${subject} · ${edit.predicate_key}${edit.mode === "RETRACT" ? "（保留历史）" : " → " + (edit.object_entity_id ? "所选关联实体" : JSON.stringify(edit.value))}`;
    row.append(
      element("p", description),
      button("移除草稿", async () => {
        const next = structuredClone(settingsState.draft.payload);
        next.edits.splice(index, 1);
        await saveDraft(next);
      }),
    );
    $("settings-draft").append(row);
  }
  if (payload.instructions)
    $("settings-draft").append(
      button("移除说明草稿", async () => {
        await saveDraft({ ...settingsState.draft.payload, instructions: null });
      }),
    );
  $("settings-history").replaceChildren();
  for (const application of [...data.applications].reverse().slice(0, 8)) {
    const row = element("div", null, "world-row");
    row.append(
      element("p", `${phaseNames[application.state]} · ${application.id}`),
    );
    if (application.error) row.append(element("p", application.error));
    if (["FAILED", "BLOCKED"].includes(application.state))
      row.append(
        button("重试应用", async () => {
          await api("settings/retry", {
            client,
            application_id: application.id,
          });
          await reloadSettings();
        }),
      );
    if (application.state === "FAILED")
      row.append(
        button("恢复为可编辑草稿", async () => {
          renderSettings(
            await api("settings/restore", {
              client,
              application_id: application.id,
              expected_revision: settingsState.draft.revision,
            }),
          );
        }),
      );
    $("settings-history").append(row);
  }
}
async function reloadSettings() {
  renderSettings(await api("settings?client=" + client));
}
async function saveDraft(payload) {
  renderSettings(
    await api("settings/draft", {
      client,
      payload,
      expected_revision: settingsState.draft.revision,
    }),
  );
  $("world-feedback").textContent = "草稿已保存，尚未生效。";
}
async function addEdit(edit) {
  const payload = structuredClone(settingsState.draft.payload);
  // One edit per fact slot/entity in each batch; avoids an ambiguous sequence of revisions.
  const key = (e) =>
    e.kind === "ENTITY"
      ? "entity:" + e.entity_id
      : JSON.stringify([e.subject_id, e.predicate_key, e.scope_key]);
  const old = payload.edits.findIndex((e) => key(e) === key(edit));
  if (old >= 0) payload.edits[old] = edit;
  else payload.edits.push(edit);
  await saveDraft(payload);
}
async function applySettings() {
  const revision = settingsState.draft.revision;
  if (!applyRequest || applyRequest.revision !== revision)
    applyRequest = { revision, request_id: crypto.randomUUID() };
  const result = await api("settings/apply", {
    client,
    expected_revision: revision,
    request_id: applyRequest.request_id,
  });
  applyRequest = null;
  await reloadSettings();
  $("instructions-feedback").textContent =
    result.state === "NO_CHANGES"
      ? "没有待应用修改。"
      : "应用请求已保存，可在进度中查看结果。";
}
$("settings-apply").onclick = () => applySettings().catch(worldError);
$("instructions-apply").onclick = () =>
  applySettings().catch((e) => {
    $("instructions-feedback").textContent = e.message;
  });
function options(select, rows, value, label, blank) {
  const previous = select.value;
  select.replaceChildren();
  if (blank) select.append(new Option(blank, ""));
  for (const row of rows) select.append(new Option(label(row), row[value]));
  if ([...select.options].some((o) => o.value === previous))
    select.value = previous;
}
function predicateLabel(predicate) {
  const meaning = predicate.description?.split(/[；;]/, 1)[0].trim();
  return meaning
    ? `${meaning}（${predicate.predicate_key}）`
    : predicate.predicate_key;
}
function updateEntityOptions() {
  if (!worldData) return;
  const entities = new Map(
    worldData.entities
      .filter((e) => !e.retired_at)
      .map((e) => [e.entity_id, e]),
  );
  for (const e of settingsState?.draft.payload.edits ?? [])
    if (e.kind === "ENTITY" && !e.retire)
      entities.set(e.entity_id, {
        ...e,
        display_name: e.display_name + "（待应用）",
      });
  options(
    $("world-subject"),
    [...entities.values()],
    "entity_id",
    (e) => e.display_name,
  );
  options(
    $("world-object"),
    [...entities.values()],
    "entity_id",
    (e) => e.display_name,
  );
  updatePredicateOptions();
}
function updatePredicateOptions() {
  if (!worldData) return;
  const key = $("world-subject").value;
  const entity =
    settingsState?.draft.payload.edits.find(
      (e) => e.kind === "ENTITY" && e.entity_id === key,
    ) ?? worldData.entities.find((e) => e.entity_id === key);
  const kind = entity?.entity_kind ?? entity?.kind;
  options(
    $("world-predicate"),
    worldData.predicates.filter((p) => !kind || p.subject_kinds.includes(kind)),
    "predicate_key",
    predicateLabel,
  );
  valueType();
}
$("world-subject").onchange = updatePredicateOptions;
function renderWorld(data) {
  worldData = data;
  worldCursor = data.next_cursor;
  $("world-next").hidden = !worldCursor;
  const active = data.entities.filter((e) => !e.retired_at);
  options(
    $("world-filter-subject"),
    data.entities,
    "entity_id",
    (e) => e.display_name,
    "全部实体",
  );
  options(
    $("world-filter-predicate"),
    data.predicates,
    "predicate_key",
    predicateLabel,
    "全部属性",
  );
  options($("world-subject"), active, "entity_id", (e) => e.display_name);
  options($("world-object"), active, "entity_id", (e) => e.display_name);
  options(
    $("world-predicate"),
    data.predicates,
    "predicate_key",
    predicateLabel,
  );
  updateEntityOptions();
  valueType();
  $("world-list").replaceChildren();
  if (!data.rows.length)
    $("world-list").append(
      element("p", "此筛选下暂无事实。先创建实体，再新增事实。"),
    );
  for (const fact of data.rows) {
    const row = element("div", null, "world-row");
    row.append(
      element(
        "strong",
        `${fact.subject_name} · ${fact.predicate_key} · ${fact.status}`,
      ),
      element("pre", fact.object_name ?? JSON.stringify(fact.value)),
      element(
        "p",
        `范围 ${fact.scope_key || "默认"} · 当前版本 ${fact.current_revision}`,
      ),
    );
    row.append(
      button("详情 / 来源 / 历史证据", () =>
        detail("World Model 事实", JSON.stringify(fact, null, 2)),
      ),
    );
    if (["ACTIVE", "SUPPORTING", "CONTESTED"].includes(fact.status)) {
      row.append(
        button("更正", () => editFact(fact)),
        button("撤回（保留历史）", () =>
          addEdit({
            kind: "FACT",
            mode: "RETRACT",
            subject_id: fact.subject_id,
            predicate_key: fact.predicate_key,
            scope_key: fact.scope_key,
            assertion_id: fact.assertion_id,
            expected_revision: Number(fact.current_revision),
          }),
        ),
      );
    }
    $("world-list").append(row);
  }
  $("world-entities").replaceChildren();
  for (const entity of data.entities) {
    const row = element("div", null, "world-row");
    row.append(
      element(
        "span",
        `${entity.display_name} · ${entity.kind}${entity.retired_at ? " · 已停用" : ""}`,
      ),
    );
    if (!entity.retired_at)
      row.append(
        button("编辑", () => {
          editingEntity = entity;
          $("entity-name").value = entity.display_name;
          $("entity-kind").value = entity.kind;
          $("entity-kind").disabled = true;
          $("entity-key").value = entity.external_key ?? "";
          $("entity-edit-status").textContent =
            "修改实体 · r" + entity.revision;
        }),
        button("停用", () =>
          addEdit({
            kind: "ENTITY",
            entity_id: entity.entity_id,
            entity_kind: entity.kind,
            display_name: entity.display_name,
            external_key: entity.external_key,
            expected_revision: Number(entity.revision),
            retire: true,
          }),
        ),
      );
    $("world-entities").append(row);
  }
}
async function loadWorld(next = false) {
  const query = new URLSearchParams({
    client,
    subject: $("world-filter-subject").value,
    predicate: $("world-filter-predicate").value,
    history: String($("world-history").checked),
  });
  if (next && worldCursor) query.set("cursor", worldCursor);
  const data = await api("world?" + query);
  renderWorld(data);
  $("world-feedback").textContent =
    `本页 ${data.rows.length} 条；${data.next_cursor ? "还有下一页" : "已到末页"}`;
}
$("world-tab").onclick = async () => {
  $("world-dialog").showModal();
  try {
    await reloadSettings();
    await loadWorld();
  } catch (e) {
    worldError(e);
  }
};
$("world-close").onclick = () => $("world-dialog").close();
$("world-reload").onclick = () => loadWorld().catch(worldError);
$("world-next").onclick = () => loadWorld(true).catch(worldError);
function valueType() {
  const predicate = worldData?.predicates.find(
    (p) => p.predicate_key === $("world-predicate").value,
  );
  $("world-object-label").hidden = predicate?.value_type !== "ENTITY";
  $("world-value-label").hidden = predicate?.value_type === "ENTITY";
  $("world-value-help").textContent = predicate
    ? `${predicate.description} · ${predicate.value_type}${predicate.unit ? " · " + predicate.unit : ""}；${predicate.value_type === "STRING" ? "直接填写文本" : predicate.value_type === "ENTITY" ? "选择关联实体" : "填写合法 JSON 值"}。约束：${JSON.stringify(predicate.value_schema)}`
    : "";
}
$("world-predicate").onchange = valueType;
function editFact(f) {
  editingFact = f;
  $("world-editor").open = true;
  $("world-subject").value = f.subject_id;
  updatePredicateOptions();
  $("world-predicate").value = f.predicate_key;
  $("world-scope").value = f.scope_key;
  $("world-subject").disabled =
    $("world-predicate").disabled =
    $("world-scope").disabled =
      true;
  $("world-value").value =
    typeof f.value === "string" ? f.value : JSON.stringify(f.value);
  $("world-object").value = f.object_entity_id ?? "";
  $("world-valid-from").value = f.valid_from;
  $("world-valid-to").value = f.valid_to ?? "";
  $("world-fresh-until").value = f.fresh_until ?? "";
  $("world-conflict").value = "";
  $("world-resolution").value = "";
  $("world-edit-status").textContent =
    `更正事实 · 预期版本 ${f.current_revision}`;
  valueType();
}
$("world-new").onclick = () => {
  editingFact = null;
  $("world-form").reset();
  $("world-subject").disabled =
    $("world-predicate").disabled =
    $("world-scope").disabled =
      false;
  $("world-edit-status").textContent = "新增事实";
  valueType();
};
$("world-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const predicate = worldData.predicates.find(
      (p) => p.predicate_key === $("world-predicate").value,
    );
    const subject = $("world-subject").value,
      scope = $("world-scope").value;
    // Query the exact slot so a new assertion on an existing slot uses its current revision.
    const exact = await api(
      "world?" +
        new URLSearchParams({
          client,
          subject,
          predicate: predicate.predicate_key,
          history: "true",
          limit: "100",
        }),
    );
    const slot = exact.rows.find((r) => r.scope_key === scope);
    if (exact.next_cursor && !slot)
      throw Error("此实体属性的范围过多，请先查询具体事实再更正。");
    const edit = {
      kind: "FACT",
      mode: editingFact ? "CORRECT" : "ASSERT",
      subject_id: subject,
      predicate_key: predicate.predicate_key,
      scope_key: scope,
      expected_revision: editingFact
        ? Number(editingFact.current_revision)
        : Number(slot?.current_revision ?? 0),
      value:
        predicate.value_type === "ENTITY"
          ? null
          : predicate.value_type === "STRING"
            ? $("world-value").value
            : JSON.parse($("world-value").value),
      object_entity_id:
        predicate.value_type === "ENTITY" ? $("world-object").value : null,
    };
    if (editingFact) edit.assertion_id = editingFact.assertion_id;
    for (const [field, control] of [
      ["valid_from", "world-valid-from"],
      ["valid_to", "world-valid-to"],
      ["fresh_until", "world-fresh-until"],
      ["resolve_conflict_id", "world-conflict"],
      ["resolution_note", "world-resolution"],
    ])
      if ($(control).value) edit[field] = $(control).value;
    await addEdit(edit);
  } catch (error) {
    worldError(error);
  }
};
$("entity-new").onclick = () => {
  editingEntity = null;
  $("entity-form").reset();
  $("entity-kind").disabled = false;
  $("entity-edit-status").textContent = "新增实体";
};
$("entity-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await addEdit({
      kind: "ENTITY",
      entity_id: editingEntity?.entity_id ?? crypto.randomUUID(),
      entity_kind: $("entity-kind").value,
      display_name: $("entity-name").value,
      external_key: $("entity-key").value || null,
      expected_revision: Number(editingEntity?.revision ?? 0),
    });
  } catch (error) {
    worldError(error);
  }
};
try {
  if (!token) throw Error("请通过 WebUI 启动器或 TUI 的 /web 打开此页面。");
  client = (await api("client", {})).client;
  await api("poll?client=" + client);
  await refresh();
  await timelineView.open();
  void loadPanel("tasks");
  setInterval(() => void refresh(), 5000);
} catch (e) {
  error(e.message);
  $("connection").textContent = "未连接";
}
