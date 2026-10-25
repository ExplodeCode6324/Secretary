"use strict";
(() => {
  const $ = (id) => document.getElementById(id),
    sink = $("sink"),
    draft = $("draft"),
    runs = $("runs"),
    transcript = $("transcript");
  const encoder = new TextEncoder(),
    segmenter = globalThis.Intl?.Segmenter
      ? new Intl.Segmenter("und", { granularity: "grapheme" })
      : null;
  const safe = (text) =>
    String(text).replace(
      /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
      (c) => `⟨${c.codePointAt(0).toString(16).padStart(4, "0")}⟩`,
    );
  const storageKey = "secretary-tui-reconnect";
  let credential = location.hash.slice(1),
    ws,
    generation = 0,
    seq = 0,
    state,
    ready = false,
    replaced = false,
    composing = false,
    composition = null,
    justEnded = false,
    small = false;
  let queue = [],
    inFlight = null,
    pendingBytes = 0,
    reconnectTimer,
    clipboard = null,
    refusal = "",
    lockReason = "";
  history.replaceState(null, "", "/");
  const supported =
    /(?:Chrome|Chromium)\/(\d+)/.test(navigator.userAgent) &&
    Number(RegExp.$1) >= 153 &&
    !!globalThis.Intl?.Segmenter &&
    !!navigator.clipboard?.writeText;
  try {
    credential ||= sessionStorage.getItem(storageKey) || "";
  } catch {
    lock("Session storage unavailable; restart TUI for a new URL.");
  }
  function status(text) {
    $("status").textContent =
      lockReason ||
      (ready && state?.largeConfirmation
        ? "Apply or Cancel before continuing. New input is not accepted while this prompt is open; earlier queued input resumes after the decision."
        : refusal || text);
  }
  function refuse(text) {
    refusal = text;
    status(text);
  }
  function lock(reason) {
    ready = false;
    lockReason = reason + " · local pending edits retained below";
    status(lockReason);
    $("resync").hidden = replaced;
    controls();
    renderPending();
  }
  function controls() {
    const modal = !!state?.largeConfirmation;
    // An existing composition preview stays available until its end/copy;
    // the lock path retains it rather than clearing the input sink.
    sink.readOnly = (!ready || !supported || modal) && !composing;
    for (const button of document.querySelectorAll("[data-action]"))
      button.disabled = !ready || !supported || small || composing || modal;
    const deciding =
      inFlight?.event.type === "confirm-large" ||
      queue.some((job) => job.event.type === "confirm-large");
    for (const id of ["large-yes", "large-no"]) {
      $(id).hidden = !modal || !ready;
      $(id).disabled = !ready || composing || deciding;
    }
  }
  function wire(value) {
    if (ws?.readyState !== WebSocket.OPEN) throw Error("Channel disconnected");
    ws.send(JSON.stringify(value));
  }
  function enqueue(event, preview = "", frozenRevision) {
    if (
      !ready ||
      !supported ||
      composing ||
      (small && event.type === "action" && event.action === "submit")
    ) {
      status(
        "Input locked; new input was not accepted. Previously queued edits remain below.",
      );
      return false;
    }
    if (state?.largeConfirmation && event.type !== "confirm-large") {
      status("Apply or Cancel before continuing; new input was not accepted.");
      return false;
    }
    if (
      event.type === "confirm-large" &&
      (!state?.largeConfirmation ||
        inFlight?.event.type === "confirm-large" ||
        queue.some((job) => job.event.type === "confirm-large"))
    )
      return false;
    const cost = encoder.encode(JSON.stringify(event)).length;
    // Keep one decision within the existing byte/slot limits even when the
    // paused queue is full of valid earlier intentions.
    const decision = event.type === "confirm-large";
    if (
      pendingBytes + cost > 8 * 1024 * 1024 - (decision ? 0 : 256) ||
      queue.length >= 2048 - (decision ? 0 : 1)
    ) {
      lock("Input queue full; copy pending text before reconnect");
      return false;
    }
    const job = { event, preview, cost, frozenRevision };
    if (event.type === "confirm-large") queue.unshift(job);
    else queue.push(job);
    pendingBytes += cost;
    renderPending();
    pump();
    return true;
  }
  function pump() {
    if (!ready || inFlight || !queue.length || composing) return;
    if (state?.largeConfirmation && queue[0].event.type !== "confirm-large")
      return;
    const job = queue.shift();
    if (
      job.frozenRevision !== undefined &&
      job.frozenRevision !== state.revision
    ) {
      queue.unshift(job);
      lock("Composition range changed; preserve pending text and reconnect");
      return;
    }
    const event = { ...job.event };
    if (
      ![
        "clipboard-ack",
        "row-select",
        "record-action",
        "viewport-anchor",
      ].includes(event.type)
    )
      event.revision = state.revision;
    inFlight = { ...job, sentRevision: state.revision, seq: ++seq };
    controls();
    wire({ type: "event", generation, seq, event });
  }
  function renderPending() {
    const jobs = [...(inFlight ? [inFlight] : []), ...queue];
    const text =
      jobs.map((j) => j.preview).join("") + (composing ? sink.value : "");
    $("pending-copy").hidden = !jobs.length && !composing;
    $("pending").textContent = text
      ? "UNACKNOWLEDGED: " + safe(text).slice(-2000)
      : jobs.length
        ? `${jobs.length} pending editor operation(s)`
        : "";
  }
  $("pending-copy").addEventListener("click", async (e) => {
    if (!e.isTrusted) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          [
            ...(inFlight ? [inFlight] : []),
            ...queue,
            ...(composing
              ? [
                  {
                    event: { type: "composition-preview" },
                    preview: sink.value,
                  },
                ]
              : []),
          ].map((job) => ({
            event: job.event,
            text: job.preview,
          })),
          null,
          2,
        ),
      );
      status("Copied unacknowledged local data; this did not resend it.");
    } catch {
      status("Pending-data clipboard write failed; data remains in this tab.");
    }
  });
  function transaction(text, source, frozenRevision) {
    if (source === "paste" && !text) return;
    if (encoder.encode(text).length > 4 * 1024 * 1024) {
      refuse("Paste exceeds 4 MiB; draft unchanged.");
      return;
    }
    const id = crypto.randomUUID();
    if (!enqueue({ type: "begin", id, source }, "", frozenRevision)) return;
    let index = 0;
    // 8k UTF-16 units keep even fully escaped JSON chunks under 64 KiB.
    for (let start = 0; start < text.length;) {
      let end = Math.min(text.length, start + 8000);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      const chunk = text.slice(start, end);
      if (!enqueue({ type: "chunk", id, index: index++, text: chunk }, chunk))
        return;
      start = end;
    }
    enqueue({ type: "commit", id });
  }
  function connect() {
    if (replaced || !credential) {
      lock(
        "Credential unavailable. Wait for TUI exit, then relaunch for a fresh URL.",
      );
      return;
    }
    clearTimeout(reconnectTimer);
    ready = false;
    seq = 0;
    controls();
    ws = new WebSocket(location.origin.replace("http:", "ws:") + "/channel");
    ws.onopen = () => wire({ type: "hello", credential });
    ws.onmessage = async (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        lock("Invalid server frame");
        ws.close();
        return;
      }
      if (message.type === "hello") {
        credential = message.reconnect;
        generation = message.generation;
        try {
          sessionStorage.setItem(storageKey, credential);
        } catch {
          lock("Could not retain reconnect secret; restart required");
          ws.close();
          return;
        }
        wire({ type: "hello-ack", generation });
      } else if (message.type === "sync") {
        // A reconnect never silently replays unacknowledged local intentions.
        if (inFlight || queue.length) {
          lock(
            "Reconnect received canonical state; unacknowledged local edits retained. Reload only after copying them.",
          );
          ws.close();
          return;
        }
        state = message.state;
        render();
        wire({ type: "sync-ack", generation });
      } else if (message.type === "ready") {
        ready = supported;
        lockReason = "";
        state = message.state;
        $("resync").hidden = true;
        render();
        if (!supported)
          status(
            "Unsupported browser: read-only. Use installed Chrome/Chromium 153+ with clipboard/sessionStorage support.",
          );
        else {
          sink.focus();
          pump();
        }
      } else if (message.type === "ack" || message.type === "rejected") {
        if (
          message.generation !== generation ||
          !inFlight ||
          message.seq !== inFlight.seq
        ) {
          lock("Unexpected input acknowledgement");
          ws.close();
          return;
        }
        const rejected = message.type === "rejected";
        const confirmation =
          rejected && message.error === "NON_UNDOABLE_CONFIRMATION_REQUIRED";
        if (rejected) refusal = message.error + " — draft preserved";
        else if (
          inFlight.event.type === "confirm-large" ||
          (![
            "begin",
            "chunk",
            "cancel",
            "viewport-anchor",
            "row-select",
          ].includes(inFlight.event.type) &&
            message.state?.revision !== undefined &&
            message.state.revision !== inFlight.sentRevision)
        )
          refusal = "";
        pendingBytes -= inFlight.cost;
        inFlight = null;
        if (message.state !== undefined) {
          state = message.state;
          render();
        }
        renderPending();
        if (rejected) {
          status(message.error + " — draft preserved");
          if (queue.length && !confirmation) {
            lock(
              "Input refused; later queued edits retained for inspection: " +
                message.error,
            );
            return;
          }
        }
        pump();
      } else if (message.type === "state") {
        if (message.generation === generation) {
          state = message.state;
          render();
        }
      } else if (message.type === "replaced") {
        replaced = true;
        lock(
          message.reason +
            ": this tab is read-only; copy any pending local text before closing.",
        );
      } else if (
        message.type === "invalid-credential" ||
        message.type === "quit"
      ) {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {}
        credential = "";
        replaced = true;
        lock(message.recovery || "TUI closed");
      } else if (message.type === "scroll-up" || message.type === "scroll-down")
        transcript.scrollBy({
          top:
            (transcript.clientHeight / 2) *
            (message.type === "scroll-up" ? -1 : 1),
        });
      else if (message.type === "clipboard") {
        if (!clipboard || clipboard.id !== message.id)
          clipboard = { id: message.id, text: "" };
        clipboard.text += message.text;
        if (encoder.encode(clipboard.text).length > 4 * 1024 * 1024) {
          lock("Clipboard bound exceeded");
          return;
        }
        let success = true;
        if (message.final) {
          try {
            await navigator.clipboard.writeText(clipboard.text);
          } catch {
            success = false;
          }
          clipboard = null;
        }
        enqueue({
          type: "clipboard-ack",
          id: message.id,
          offset: message.offset,
          done: message.final,
          success,
        });
      }
    };
    ws.onclose = () => {
      ready = false;
      controls();
      if (!replaced) {
        lock(
          "Disconnected. Saved state retained; Resume required after reconnect.",
        );
        $("resync").hidden = false;
        if (!inFlight && !queue.length && credential)
          reconnectTimer = setTimeout(connect, 1000);
      }
      renderPending();
    };
    ws.onerror = () =>
      status("Local connection unavailable; keep this tab's pending edits.");
  }
  function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  let transcriptSignature = "";
  function render() {
    if (!state) return;
    if (state.largeConfirmation && composing && ready)
      lock(
        "Large edit confirmation interrupted a composition preview; copy pending data before reloading. New input was not accepted",
      );
    $("header").textContent =
      `Secretary · ${state.view} · ${state.coreMode} · ${state.domain.slice(-12)} · ${state.stale ? "STALE / " : ""}${state.connection} · Session ${state.sessionState}\n${state.data}`;
    $("mode").textContent =
      `${state.view} · ${state.quarantine ? "QUARANTINED / " : ""}${state.mode} · target: ${state.target} · ${state.error ? "ERROR" : state.saved ? "SAVED" : "UNSAVED / SAVING"}`;
    status(
      `${state.outbox} · ${state.notice} · ${Math.ceil(state.usage / 1024)} / ${Math.floor(state.quota / 1024)} KiB`,
    );
    controls();
    $("record-copy").hidden = !state.record;
    $("record-restore").hidden = !state.record?.editable;
    $("record-restore").textContent = state.record?.restoreConfirmation
      ? "Confirm restore"
      : "Restore rejected body";
    if (!composing) renderDraft();
    const signature = JSON.stringify([
      state.rows,
      state.previews,
      state.pending,
      state.panel,
      state.selected,
      state.expansion,
    ]);
    if (signature !== transcriptSignature) {
      const oldTop = transcript.scrollTop,
        oldHeight = transcript.scrollHeight,
        atEnd = oldHeight - oldTop - transcript.clientHeight < 8;
      const anchorMatch = (el) =>
        state.anchor &&
        (el.dataset.id === state.anchor.message_id ||
          (state.anchor.event_id &&
            el.dataset.eventId === state.anchor.event_id));
      const oldAnchor = [...transcript.querySelectorAll("article")].find(
        anchorMatch,
      );
      const anchorDelta = oldAnchor
        ? oldAnchor.getBoundingClientRect().top -
          transcript.getBoundingClientRect().top
        : -(state.anchor?.offset ?? 0) * 20;
      const fragment = document.createDocumentFragment();
      for (const row of state.rows) {
        const article = element(
          "article",
          undefined,
          row.id === state.selected ? "selected" : "",
        );
        article.dataset.id = row.id;
        if (row.event_id) article.dataset.eventId = row.event_id;
        const label = element(
          "button",
          `${row.role || row.kind} · ${row.id} ${row.input_state ? " · Input " + row.input_state : ""}${row.outcome ? " · outcome " + row.outcome : ""}`,
          "label",
        );
        label.addEventListener("click", (e) => {
          if (e.isTrusted) enqueue({ type: "row-select", id: row.id });
        });
        article.append(label, element("div", row.text));
        if (row.preview)
          article.append(
            element("div", "Thinking preview: " + row.preview, "preview"),
          );
        if (row.clipped || row.incomplete)
          article.append(
            element(
              "div",
              "Bounded segment · use /more or /copy <id> for explicit loading",
              "label",
            ),
          );
        fragment.append(article);
      }
      for (const row of state.previews)
        fragment.append(
          element(
            "article",
            `${row.id} · preview ${row.status}\n${row.text}\n${row.preview}`,
          ),
        );
      for (const row of state.pending)
        fragment.append(
          element(
            "article",
            `Local request ${row.id} · ${row.state} · receipt pending`,
          ),
        );
      if (state.expansion)
        fragment.append(
          element(
            "article",
            `Loaded ${state.expansion.id}\n${state.expansion.text}\nThinking (explicit):\n${state.expansion.thinking}${state.expansion.more ? "\n[more available]" : ""}`,
          ),
        );
      if (state.panel) fragment.append(element("section", state.panel));
      transcript.replaceChildren(fragment);
      transcriptSignature = signature;
      const anchorRow = [...transcript.querySelectorAll("article")].find(
        anchorMatch,
      );
      if (anchorRow && !state.following)
        transcript.scrollTop +=
          anchorRow.getBoundingClientRect().top -
          transcript.getBoundingClientRect().top -
          anchorDelta;
      else if (state.selected) {
        const row = [...transcript.querySelectorAll("article")].find(
          (el) => el.dataset.id === state.selected,
        );
        if (row && oldTop === 0) row.scrollIntoView({ block: "nearest" });
        else transcript.scrollTop = oldTop;
      } else transcript.scrollTop = atEnd ? transcript.scrollHeight : oldTop;
    }
  }
  let draftSignature = "";
  function renderDraft() {
    const signature = JSON.stringify([
      state.revision,
      state.selection,
      state.runs,
      state.mode,
    ]);
    if (signature === draftSignature) return;
    draftSignature = signature;
    const fragment = document.createDocumentFragment(),
      lo = Math.min(state.selection.anchor, state.selection.head),
      hi = Math.max(state.selection.anchor, state.selection.head);
    let caret = false;
    const addCaret = (pos) => {
      if (!caret && pos === state.selection.head) {
        const c = element("span", "");
        c.id = "caret";
        fragment.append(c);
        caret = true;
      }
    };
    if (state.before) fragment.append(element("span", "… ", "label"));
    for (const run of state.runs) {
      addCaret(run.start);
      if (!run.expanded) {
        const span = element(
          "span",
          run.label,
          "chip" + (run.start >= lo && run.end <= hi ? " selection" : ""),
        );
        span.dataset.start = run.start;
        span.dataset.end = run.end;
        span.dataset.paste = run.id;
        span.addEventListener("dblclick", (e) => {
          if (e.isTrusted && run.kind === "paste")
            enqueue({ type: "paste-display", id: run.id, expanded: true });
        });
        fragment.append(span);
        addCaret(run.end);
      } else {
        for (const part of segmenter
          ? segmenter.segment(run.text)
          : [{ index: 0, segment: run.text }]) {
          const start = run.start + part.index,
            end = start + part.segment.length;
          addCaret(start);
          const span = element(
            "span",
            safe(part.segment),
            start >= lo && end <= hi ? "selection" : "",
          );
          span.dataset.start = start;
          span.dataset.end = end;
          fragment.append(span);
          addCaret(end);
        }
      }
    }
    addCaret(0);
    if (!caret) addCaret(state.length);
    if (state.after) fragment.append(element("span", " …", "label"));
    runs.replaceChildren(fragment);
    const c = $("caret");
    if (c) {
      sink.style.left = c.offsetLeft + "px";
      sink.style.top = c.offsetTop + "px";
      if (document.activeElement === sink)
        c.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  runs.addEventListener("pointerdown", (e) => {
    if (!e.isTrusted || !ready || composing || e.button !== 0) return;
    const span = e.target.closest("[data-start]");
    if (!span) return;
    e.preventDefault();
    const r = span.getBoundingClientRect(),
      offset =
        e.clientX < r.left + r.width / 2
          ? Number(span.dataset.start)
          : Number(span.dataset.end);
    enqueue({
      type: "select",
      anchor: e.shiftKey ? state.selection.anchor : offset,
      head: offset,
    });
    sink.focus();
  });
  for (const button of document.querySelectorAll("[data-action]"))
    button.addEventListener("click", (e) => {
      if (e.isTrusted && !composing) {
        enqueue({ type: "action", action: button.dataset.action });
        sink.focus();
      }
    });
  for (const [id, action] of [
    ["record-copy", "copy"],
    ["record-restore", "restore"],
  ])
    $(id).addEventListener("click", (e) => {
      if (e.isTrusted && state.record)
        enqueue({ type: "record-action", id: state.record.id, action });
    });
  $("resync").addEventListener("click", (e) => {
    if (e.isTrusted && !inFlight && !queue.length) connect();
    else
      status(
        "Copy pending local edits before reloading; reconnect cannot silently reapply them.",
      );
  });
  for (const [id, accept] of [
    ["large-yes", true],
    ["large-no", false],
  ])
    $(id).addEventListener("click", (e) => {
      if (e.isTrusted) {
        if (enqueue({ type: "confirm-large", accept })) controls();
        if (!state?.largeConfirmation) sink.focus();
      }
    });
  let userScroll = false,
    anchorTimer;
  transcript.addEventListener("wheel", (e) => {
    if (e.isTrusted) userScroll = true;
  });
  transcript.addEventListener("pointerdown", (e) => {
    if (e.isTrusted) userScroll = true;
  });
  transcript.addEventListener("scroll", () => {
    if (!userScroll || !ready || composing) return;
    clearTimeout(anchorTimer);
    anchorTimer = setTimeout(() => {
      userScroll = false;
      const top = transcript.getBoundingClientRect().top;
      const row = [...transcript.querySelectorAll("article[data-id]")].find(
        (el) => el.getBoundingClientRect().bottom > top,
      );
      if (row)
        enqueue({
          type: "viewport-anchor",
          id: row.dataset.id,
          offset: Math.max(
            0,
            Math.floor((top - row.getBoundingClientRect().top) / 20),
          ),
        });
    }, 200);
  });
  sink.addEventListener("keydown", (e) => {
    if (state?.largeConfirmation && !composing) {
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyC") return;
      e.preventDefault();
      status("Apply or Cancel before continuing; new input was not accepted.");
      return;
    }
    if (!e.isTrusted) return;
    if (composing || e.isComposing || e.keyCode === 229) return;
    const ctrl = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const action = ctrl
      ? {
          KeyS: "submit",
          KeyG: "commands",
          KeyP: "literal",
          KeyO: "copy",
          KeyU: "scroll-up",
          KeyD: "scroll-down",
        }[e.code]
      : undefined;
    if (action) {
      e.preventDefault();
      if (!e.repeat) enqueue({ type: "action", action });
      return;
    }
    const platform = e.ctrlKey !== e.metaKey && !e.altKey;
    if (platform && ["KeyC", "KeyV"].includes(e.code) && !e.shiftKey) {
      if (e.code === "KeyC" && !window.getSelection()?.toString()) {
        e.preventDefault();
        if (!e.repeat) enqueue({ type: "action", action: "copy" });
      }
      return;
    }
    if (platform && e.code === "KeyX" && !e.shiftKey) {
      e.preventDefault();
      if (!e.repeat) enqueue({ type: "action", action: "cut" });
      return;
    }
    if (platform && (e.code === "KeyZ" || e.code === "KeyY")) {
      e.preventDefault();
      enqueue({ type: "undo", redo: e.code === "KeyY" || e.shiftKey });
      return;
    }
    if (
      e.code === "Insert" &&
      e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    )
      return;
    if (platform && e.code === "KeyA" && !e.shiftKey) {
      e.preventDefault();
      enqueue({ type: "select", anchor: 0, head: state.length });
      return;
    }
    const moves = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      Home: "home",
      End: "end",
    };
    if (moves[e.code] && !e.metaKey && !(e.ctrlKey && e.altKey)) {
      e.preventDefault();
      enqueue({
        type: "move",
        direction: moves[e.code],
        extend: e.shiftKey,
        word: e.ctrlKey || e.altKey,
      });
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.code === "Enter") {
        e.preventDefault();
        enqueue({ type: "insert", text: "\n" }, "\n");
        return;
      }
      if (e.code === "Tab") {
        e.preventDefault();
        enqueue({ type: "complete" });
        return;
      }
      if (e.code === "Escape") {
        e.preventDefault();
        enqueue({ type: "dismiss" });
        return;
      }
      if (e.code === "Backspace" || e.code === "Delete") {
        e.preventDefault();
        enqueue({
          type: "delete",
          direction: e.code === "Backspace" ? "backward" : "forward",
        });
        return;
      }
    }
    if (e.ctrlKey && /^Key[A-Z]$/.test(e.code)) {
      e.preventDefault();
      refuse("Unsupported control editing gesture; draft unchanged.");
    }
  });
  sink.addEventListener("beforeinput", (e) => {
    if (!e.isTrusted) {
      e.preventDefault();
      return;
    }
    if (state?.largeConfirmation && !composing) {
      e.preventDefault();
      status("Apply or Cancel before continuing; new input was not accepted.");
      return;
    }
    if (composing || e.isComposing || e.inputType === "insertCompositionText") {
      if (!composing) {
        e.preventDefault();
        lock("Composition event without a trusted start");
      }
      return;
    }
    e.preventDefault();
    if (
      justEnded &&
      ["insertFromComposition", "insertText"].includes(e.inputType)
    )
      return;
    if (e.inputType === "insertText" && typeof e.data === "string")
      enqueue({ type: "insert", text: e.data }, e.data);
    else if (["insertLineBreak", "insertParagraph"].includes(e.inputType))
      enqueue({ type: "insert", text: "\n" }, "\n");
    else if (["historyUndo", "historyRedo"].includes(e.inputType))
      enqueue({ type: "undo", redo: e.inputType === "historyRedo" });
    else if (
      [
        "insertFromPaste",
        "insertFromPasteAsQuotation",
        "insertFromDrop",
        "deleteByCut",
      ].includes(e.inputType)
    )
      lock(
        "Insertion lacked its trusted paste/drop/cut transaction; reconnect required",
      );
    else lock("Unsupported replacement/dictation range: " + e.inputType);
    if (!composing) sink.value = "";
  });
  sink.addEventListener("input", (e) => {
    if (!e.isTrusted) return;
    if (!composing && !justEnded && sink.value) {
      lock("Untracked sink mutation; canonical draft retained");
      sink.value = "";
    }
  });
  sink.addEventListener("compositionstart", (e) => {
    if (!e.isTrusted || !ready) return;
    if (state?.largeConfirmation) {
      status(
        "Apply or Cancel before starting composition; new input was not accepted.",
      );
      return;
    }
    if (inFlight || queue.length) {
      lock(
        "Composition started before prior edits were acknowledged; canonical draft retained",
      );
      return;
    }
    composing = true;
    composition = { revision: state.revision };
    sink.classList.add("composing");
    controls();
  });
  sink.addEventListener("compositionend", (e) => {
    if (!e.isTrusted || !composing || !composition) return;
    const frozen = composition.revision,
      text = e.data;
    composing = false;
    composition = null;
    justEnded = true;
    sink.classList.remove("composing");
    sink.value = "";
    controls();
    if (typeof text === "string") {
      if (ready) transaction(text, "composition", frozen);
      else {
        const event = { type: "retained-composition", text };
        queue.push({
          event,
          preview: text,
          cost: encoder.encode(text).length,
          frozenRevision: frozen,
        });
        renderPending();
      }
    } else lock("Unreconciled composition; canonical draft preserved");
    queueMicrotask(() => {
      justEnded = false;
      sink.value = "";
      renderDraft();
    });
  });
  sink.addEventListener("paste", (e) => {
    e.preventDefault();
    if (!e.isTrusted || composing) return;
    if (!e.clipboardData || e.clipboardData.files.length) {
      lock("Unsupported clipboard source; text draft unchanged");
      return;
    }
    transaction(e.clipboardData.getData("text/plain"), "paste");
  });
  for (const target of [sink, draft, document.body]) {
    target.addEventListener("dragover", (e) => e.preventDefault());
    target.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (
        !e.isTrusted ||
        composing ||
        !e.dataTransfer ||
        e.dataTransfer.files.length
      ) {
        refuse("Only plain-text drop is supported");
        return;
      }
      transaction(e.dataTransfer.getData("text/plain"), "paste");
    });
  }
  sink.addEventListener("cut", (e) => {
    e.preventDefault();
    if (e.isTrusted && !composing) enqueue({ type: "action", action: "cut" });
  });
  sink.addEventListener("auxclick", (e) => {
    if (e.button === 1) e.preventDefault();
  });
  function resize() {
    draftSignature = "";
    small = innerWidth < 40 * 8.5 || innerHeight < 12 * 20;
    $("small").hidden = !small;
    controls();
    if (!composing && state) renderDraft();
  }
  addEventListener("resize", resize);
  resize();
  connect();
})();
