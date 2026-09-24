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
let displayedMessages = "",
  polling = false;
const error = (message) => {
  $("error").textContent = message;
  $("error").hidden = !message;
};
async function api(route, body) {
  const response = await fetch("/api/" + route, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
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
function inline(node, text) {
  for (const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
    if (part.startsWith("**") && part.endsWith("**"))
      node.append(element("strong", part.slice(2, -2)));
    else if (part.startsWith("`") && part.endsWith("`"))
      node.append(element("code", part.slice(1, -1)));
    else node.append(document.createTextNode(part));
  }
}
function markdown(node, text) {
  let code = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      if (code) {
        node.append(element("pre", code.join("\n")));
        code = null;
      } else code = [];
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (!line.trim()) continue;
    const heading = /^#{1,6}\s+/.test(line);
    const row = element(heading ? "h3" : "p");
    inline(row, line.replace(/^#{1,6}\s+/, ""));
    node.append(row);
  }
  if (code) node.append(element("pre", code.join("\n")));
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
function render(state) {
  $("connection").textContent = "● 已同步";
  $("runtime-state").textContent =
    state.state === "IDLE" ? "待命" : state.state;
  $("model").textContent =
    `${state.mode === "live" ? "LIVE" : "DEMO"} · ${state.model}`;
  if (state.memory) {
    $("memory-state").textContent =
      `记忆 ${state.memory.state} · r${state.memory.revision}`;
    $("memory-state").title =
      `最近成功：${state.memory.last_success_at ?? "尚无"}；尝试 ${state.memory.attempt}/2；${state.memory.errors.join("; ")}`;
  }
  const c = state.context,
    ratio = c.used == null ? 0 : (c.used / c.budget) * 100;
  $("context-bar").style.width = Math.min(100, ratio) + "%";
  $("context-text").textContent =
    c.used == null
      ? `尚无快照 / ${c.budget.toLocaleString()} tokens`
      : `≈ ${c.used.toLocaleString()} / ${c.budget.toLocaleString()} · ${ratio.toFixed(1)}%`;
  $("context-text").title =
    `最近 Context 快照的估算值；预留 ${c.reserve} tokens，不是供应商实际计量。`;
  $("thinking").hidden = !["RUNNING", "PREPARING"].includes(state.state);
  const messageSignature = state.messages.map((m) => m.id).join(",");
  if (displayedMessages !== messageSignature) {
    const timeline = $("timeline");
    const bottom =
      timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 120;
    displayedMessages = messageSignature;
    $("welcome").hidden = !!state.messages.length;
    $("messages").replaceChildren();
    for (const m of state.messages) {
      const article = element("article", null, `message ${m.role}`);
      const label = element(
        "div",
        {
          master: "Master",
          secretary: "Secretary",
          system: "系统 · 任务交接",
          authorization: "授权",
        }[m.role],
        "author",
      );
      label.append(
        element(
          "time",
          new Date(m.at).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        ),
      );
      article.append(label);
      markdown(article, m.text);
      $("messages").append(article);
    }
    if (bottom) timeline.scrollTop = timeline.scrollHeight;
  }
  $("task-count").textContent = state.tasks.length;
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
      };
      section.append(answer, button);
      $("decisions").append(section);
    }
  }
}
async function refresh() {
  if (!client || polling) return;
  polling = true;
  try {
    const state = await api(
      "state?client=" + client + "&since=" + lastRevision,
    );
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
    $("timeline").scrollTop = $("timeline").scrollHeight;
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
let instructionsRevision = null;
function showInstructionsState(data) {
  $("instructions-version").textContent =
    `已保存 r${data.settings.revision} · 当前轮 ${data.active_revision == null ? "无" : "r" + data.active_revision} · 最近使用 ${data.last_used_revision == null ? "尚无" : "r" + data.last_used_revision}；下一轮使用 r${data.settings.revision}`;
}
async function loadInstructions() {
  const data = await api("instructions?client=" + client);
  instructionsRevision = data.settings.revision;
  $("instructions-content").value = data.settings.content;
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
    });
    instructionsRevision = data.settings.revision;
    showInstructionsState(data);
    $("instructions-feedback").textContent = "已保存，下一轮主会话生效。";
  } catch (e) {
    $("instructions-feedback").textContent =
      "保存未确认，编辑内容已保留。" + e.message;
  } finally {
    $("instructions-save").disabled = false;
  }
};
try {
  if (!token) throw Error("请通过 WebUI 启动器或 TUI 的 /web 打开此页面。");
  client = (await api("client", {})).client;
  await api("poll?client=" + client);
  await refresh();
  setInterval(() => void refresh(), 700);
} catch (e) {
  error(e.message);
  $("connection").textContent = "未连接";
}
