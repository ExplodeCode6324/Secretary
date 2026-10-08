import { contextStatus } from "./context.ts";
import { getInstructions } from "./instructions.ts";
import { activityHistoryFor } from "./activity-history.ts";
import { timelineFor, type TimelineOptions } from "./timeline.ts";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { App } from "./app.ts";
import { TerminalController, type MessageTone } from "./tui.ts";
import type {
  AuthorizationRequest,
  DecisionRequest,
  Context,
  Feedback,
  Input,
  Notification,
  OperationLogRecord,
  TaskPlan,
  TaskProposal,
  Execution,
  MainPromptSnapshot,
} from "./contracts.ts";
import { id, revise } from "./store.ts";

export type UIMessage = {
  id: string;
  role: MessageTone;
  text: string;
  at: string;
  thinking?: string;
  call_id?: string;
  incomplete?: boolean;
  order?: number;
};
const conversations = new WeakMap<
  App["store"],
  Map<string, { position: number; output: UIMessage[] }>
>();
export function conversation(app: App, showThinking = false): UIMessage[] {
  let caches = conversations.get(app.store);
  if (!caches) {
    caches = new Map();
    conversations.set(app.store, caches);
  }
  const key = `${app.host.sessionID}:${showThinking}`;
  let cache = caches.get(key);
  if (!cache) {
    cache = { position: 0, output: [] };
    caches.set(key, cache);
  }
  const output = cache.output;
  const history = activityHistoryFor(app.store);
  for (const e of app.store.logs.slice(cache.position)) {
    let role: MessageTone = "system",
      text = "";
    let thinking: string | undefined,
      call_id: string | undefined,
      incomplete = false;
    if (e.event_type === "input.accepted") {
      const input = app.store.read<Input>(e.payload);
      role = input.producer === "MASTER" ? "master" : "system";
      text = app.store.bytes(input.payload).toString();
    } else if (e.event_type === "main.message") {
      if (e.scope.session_id !== app.host.sessionID) continue;
      const m = app.store.read<{
        role: string;
        content: {
          type: string;
          text?: string;
          thinking?: string;
          redacted?: boolean;
        }[];
        display_call_id?: string;
        stopReason?: string;
      }>(e.payload);
      if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
      role = "secretary";
      call_id = m.display_call_id;
      incomplete = m.stopReason === "error" || m.stopReason === "aborted";
      if (showThinking)
        thinking = m.content
          .filter((c) => c.type === "thinking" && !c.redacted)
          .map((c) => c.thinking ?? "")
          .join("\n");
      text = m.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
    } else if (e.event_type === "feedback.delivered") {
      const f = app.store.read<Feedback>(e.payload);
      text = `任务反馈 · ${f.summary}\n执行 ${f.execution_id}`;
    } else if (e.event_type === "notification.queued") {
      const n = app.store.read<Notification>(e.payload);
      role = "secretary";
      text = app.store.bytes(n.message).toString();
    }
    if (text || thinking || call_id)
      output.push({
        id: e.event_id,
        role,
        text,
        at: e.occurred_at,
        order: history.messageOrder(e.event_id),
        ...(showThinking && role === "secretary"
          ? { thinking: thinking ?? "" }
          : {}),
        ...(call_id ? { call_id } : {}),
        ...(incomplete ? { incomplete } : {}),
      });
  }
  cache.position = app.store.logs.length;
  return output.map((message) => ({ ...message }));
}
export async function serve(app: App, port = 0, onShutdown?: () => void) {
  const token = randomBytes(32).toString("hex");
  const clients = new Map<
    string,
    {
      ui: TerminalController;
      output: { text: string; tone: MessageTone }[];
      touched: number;
      busy: Promise<unknown>;
    }
  >();
  let pumping = false;
  const timer = setInterval(() => {
    if (pumping) return;
    pumping = true;
    void app
      .pump()
      .finally(() => {
        pumping = false;
      })
      .catch(() => {});
    for (const [key, c] of clients)
      if (Date.now() - c.touched > 3600000) clients.delete(key);
  }, 300);
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
    );
    const send = (code: number, body: unknown) => {
      res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const expectedHost = `127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
      if (
        req.headers.host !== expectedHost ||
        (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)
      )
        return send(403, { error: "LOCAL_ORIGIN_REQUIRED" });
      if (!url.pathname.startsWith("/api/")) {
        const names: Record<string, string> = {
          "/": "index.html",
          "/app.js": "app.js",
          "/markdown.js": "markdown.js",
          "/activity.js": "activity.js",
          "/timeline-window.js": "timeline-window.js",
          "/timeline-view.js": "timeline-view.js",
          "/style.css": "style.css",
        };
        const name = names[url.pathname];
        if (!name || req.method !== "GET")
          return send(404, { error: "NOT_FOUND" });
        res.setHeader(
          "Content-Type",
          name.endsWith("css")
            ? "text/css"
            : name.endsWith("js")
              ? "text/javascript"
              : "text/html; charset=utf-8",
        );
        res.end(
          fs.readFileSync(
            fileURLToPath(new URL(`../web/${name}`, import.meta.url)),
          ),
        );
        return;
      }
      if (req.headers.authorization !== `Bearer ${token}`)
        return send(401, { error: "LOCAL_TOKEN_REQUIRED" });
      let body: Record<string, any> = {};
      if (req.method === "POST") {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 1024 * 1024)
            throw Error("REQUEST_TOO_LARGE");
        }
        body = JSON.parse(raw || "{}");
      }
      if (url.pathname === "/api/health")
        return send(200, {
          session: app.host.sessionID,
          mode: process.env.SECRETARY_MODE ?? "fixture",
        });
      if (
        url.pathname === "/api/shutdown" &&
        req.method === "POST" &&
        onShutdown
      ) {
        send(200, { stopping: true });
        setImmediate(onShutdown);
        return;
      }
      if (url.pathname === "/api/migrate" && req.method === "POST") {
        if (!app.world)
          throw Error("WORLD_UNAVAILABLE: PostgreSQL not configured");
        await app.world.migrate();
        return send(200, { migrated: true });
      }
      if (url.pathname === "/api/client" && req.method === "POST") {
        const client = id();
        const output: { text: string; tone: MessageTone }[] = [];
        const ui = new TerminalController(app, (text, tone) =>
          output.push({ text, tone }),
        );
        clients.set(client, {
          ui,
          output,
          touched: Date.now(),
          busy: Promise.resolve(),
        });
        ui.status();
        ui.menu();
        return send(200, { client });
      }
      const client = clients.get(
        String(body.client ?? url.searchParams.get("client")),
      );
      if (!client) return send(409, { error: "CLIENT_EXPIRED" });
      client.touched = Date.now();
      if (url.pathname === "/api/timeline" && req.method === "POST") {
        const options = body.options as TimelineOptions;
        if (!options || typeof options !== "object" || Array.isArray(options))
          return send(400, { error: "INVALID_TIMELINE_OPTIONS" });
        return send(200, timelineFor(app).query(app.host.sessionID, options));
      }
      if (url.pathname === "/api/panels" && req.method === "GET") {
        const kind = url.searchParams.get("kind"),
          offset = Number(url.searchParams.get("offset") ?? 0);
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          !["tasks", "approvals", "decisions"].includes(kind ?? "")
        )
          return send(400, { error: "INVALID_PANEL_PAGE" });
        const session = app.host.sessionID,
          history = activityHistoryFor(app.store);
        let records: any[];
        if (kind === "tasks")
          records = history
            .sessionTasks(session)
            .reverse()
            .slice(offset, offset + 21)
            .map((id) => app.store.get<TaskPlan>("TaskPlan", id));
        else if (kind === "approvals")
          records = app.store.select<AuthorizationRequest>(
            "AuthorizationRequest",
            (a) =>
              (a.scope.session_id === session ||
                (!!a.scope.task_id &&
                  history.taskSession(a.scope.task_id) === session)) &&
              ["PENDING", "APPROVED"].includes(a.state),
            21,
            offset,
          );
        else
          records = app.store.select<DecisionRequest>(
            "DecisionRequest",
            (d) =>
              history.taskSession(d.task_id) === session && d.state === "OPEN",
            21,
            offset,
          );
        const items = records.slice(0, 20).map((r) =>
          kind === "tasks"
            ? {
                id: r.id,
                state: r.state,
                goal: app.store.read<TaskProposal>(r.proposal_ref).goal,
                executions: app.store.select<Execution>(
                  "Execution",
                  (e) => e.task_id === r.id,
                  1,
                  0,
                  { latest: true },
                ),
              }
            : kind === "approvals"
              ? { ...r, display: app.store.read(r.display_ref) }
              : r,
        );
        return send(200, {
          items,
          next: records.length > 20 ? offset + 20 : null,
        });
      }
      const activitySnapshot = () => {
        const snapshot = app.activitySnapshot();
        if (url.searchParams.get("timeline") !== "1") return snapshot;
        const history = activityHistoryFor(app.store);
        return {
          ...snapshot,
          timeline: {
            ...history.page(app.host.sessionID),
            live: history.live(snapshot),
            updates: history.updates(snapshot),
          },
        };
      };
      if (url.pathname === "/api/activity/history" && req.method === "GET") {
        try {
          if (url.searchParams.has("ids")) {
            let ids: unknown;
            try {
              ids = JSON.parse(url.searchParams.get("ids")!);
            } catch {
              return send(400, { error: "INVALID_ACTIVITY_IDS" });
            }
            return send(200, {
              items: activityHistoryFor(app.store).selected(
                app.host.sessionID,
                ids,
              ),
              store_revision: app.store.sequence,
            });
          }
          return send(
            200,
            activityHistoryFor(app.store).page(
              app.host.sessionID,
              url.searchParams.get("cursor") ?? undefined,
              Number(url.searchParams.get("limit") ?? 50),
            ),
          );
        } catch (error) {
          if (/^INVALID_ACTIVITY_/.test(String((error as Error).message)))
            return send(400, { error: (error as Error).message });
          throw error;
        }
      }
      if (url.pathname === "/api/activity" && req.method === "GET") {
        const snapshot = activitySnapshot();
        if (
          url.searchParams.get("instance") === snapshot.server_instance_id &&
          url.searchParams.get("since") ===
            String(snapshot.activity_revision) &&
          url.searchParams.get("timeline") !== "1"
        )
          return send(200, {
            unchanged: true,
            server_instance_id: snapshot.server_instance_id,
            activity_revision: snapshot.activity_revision,
            observed_at: snapshot.observed_at,
          });
        return send(200, snapshot);
      }
      if (url.pathname === "/api/stream" && req.method === "GET") {
        const thinking = url.searchParams.get("thinking") === "1";
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          Connection: "keep-alive",
        });
        let revision = -1,
          activityRevision = "",
          heartbeat = 0;
        const includeActivity = url.searchParams.get("activity") === "1";
        const includePreview = url.searchParams.get("preview") !== "0";
        const sendSnapshot = () => {
          client.touched = Date.now();
          if (res.writableLength > 512 * 1024) {
            res.destroy();
            return;
          }
          const current = app.host.previews.revision;
          if (includePreview && revision !== current) {
            revision = current;
            res.write(
              `event: preview\ndata: ${JSON.stringify({ revision, previews: app.host.previews.snapshot(app.host.sessionID, thinking) })}\n\n`,
            );
          }
          if (includeActivity) {
            const snapshot = activitySnapshot();
            const version = `${snapshot.activity_revision}:${url.searchParams.get("timeline") === "1" ? snapshot.store_revision : ""}`;
            if (activityRevision !== version) {
              activityRevision = version;
              res.write(
                `event: activity\ndata: ${JSON.stringify(snapshot)}\n\n`,
              );
            }
          }
          if (++heartbeat % 50 === 0) res.write(": heartbeat\n\n");
        };
        sendSnapshot();
        const updates = setInterval(sendSnapshot, 100);
        res.on("close", () => clearInterval(updates));
        return;
      }
      if (url.pathname === "/api/memory/recovery") {
        if (req.method === "GET")
          return send(
            200,
            app.host.memoryRecoveryPreflight(
              url.searchParams.get("group") ?? undefined,
            ),
          );
        if (req.method !== "POST")
          return send(405, { error: "METHOD_NOT_ALLOWED" });
        try {
          return send(
            200,
            await app.host.recoverMemory({
              request_id: body.request_id,
              group_key: body.group_key,
              attempt_id: body.attempt_id,
              expected_revision: body.expected_revision,
              policy: body.policy,
              implementation_version: body.implementation_version,
              config_hash: body.config_hash,
              source_hash: body.source_hash,
              model_call_id: body.model_call_id,
              model_request_hash: body.model_request_hash,
              actual_payload_hash: body.actual_payload_hash,
              ...(body.authorization_id === undefined
                ? {}
                : { authorization_id: body.authorization_id }),
              ...(body.issued_at === undefined
                ? {}
                : { issued_at: body.issued_at }),
              ...(body.expires_at === undefined
                ? {}
                : { expires_at: body.expires_at }),
            }),
          );
        } catch (error) {
          return send(409, { error: String(error) });
        }
      }
      if (url.pathname.startsWith("/api/settings")) {
        if (url.pathname === "/api/settings" && req.method === "GET")
          return send(200, app.settings.status());
        if (req.method !== "POST")
          return send(405, { error: "METHOD_NOT_ALLOWED" });
        try {
          if (url.pathname === "/api/settings/draft") {
            app.settings.save(body.payload, body.expected_revision);
            return send(200, app.settings.status());
          }
          if (url.pathname === "/api/settings/apply")
            return send(
              202,
              app.settings.request(body.expected_revision, body.request_id),
            );
          if (url.pathname === "/api/settings/retry")
            return send(202, app.settings.retry(body.application_id));
          if (url.pathname === "/api/settings/restore") {
            app.settings.restoreDraft(
              body.application_id,
              body.expected_revision,
            );
            return send(200, app.settings.status());
          }
        } catch (error) {
          return send(String(error).includes("CONFLICT") ? 409 : 400, {
            error: String(error),
          });
        }
        return send(404, { error: "NOT_FOUND" });
      }
      if (url.pathname === "/api/world") {
        if (req.method !== "GET")
          return send(405, { error: "METHOD_NOT_ALLOWED" });
        if (!app.world)
          return send(503, { error: "WORLD_UNAVAILABLE: PostgreSQL 未配置" });
        try {
          const page = await app.world.browse({
            subject: url.searchParams.get("subject") || undefined,
            predicate: url.searchParams.get("predicate") || undefined,
            history: url.searchParams.get("history") === "true",
            cursor: url.searchParams.get("cursor") || undefined,
            limit: Number(url.searchParams.get("limit") ?? 30),
          });
          return send(200, { ...page, ...(await app.world.catalogList()) });
        } catch (error) {
          return send(String(error).includes("STALE") ? 409 : 400, {
            error: String(error),
          });
        }
      }
      if (url.pathname === "/api/instructions") {
        if (req.method === "POST") {
          try {
            const draft = app.settings.draft();
            const payload = app.store.read<
              import("./settings-payload.ts").SettingsPayload
            >(draft.payload_ref);
            app.settings.save(
              {
                ...payload,
                instructions: {
                  content: body.content,
                  expected_revision: body.expected_revision,
                },
              },
              body.draft_revision,
            );
          } catch (error) {
            return send(
              String(error).includes("INSTRUCTIONS_CONFLICT") ? 409 : 400,
              { error: String(error) },
            );
          }
        } else if (req.method !== "GET")
          return send(405, { error: "METHOD_NOT_ALLOWED" });
        const session = app.host.session;
        const context = session.last_context_id
          ? app.store.get<Context>("Context", session.last_context_id)
          : null;
        const active = session.active_loop_id
          ? app.store.find<MainPromptSnapshot>(
              "MainPromptSnapshot",
              session.active_loop_id,
            )
          : null;
        return send(200, {
          settings: getInstructions(app.store),
          management: app.settings.status(),
          active_revision: active?.instructions_revision ?? null,
          last_used_revision: context?.instructions_revision ?? null,
          applies: "SUMMARY_AND_REBUILD",
        });
      }
      if (url.pathname === "/api/command" && req.method === "POST") {
        if (typeof body.line !== "string") throw Error("INVALID_COMMAND");
        const work = client.busy.then(() => client.ui.command(body.line));
        client.busy = work.catch(() => {});
        return send(200, { keepOpen: await work });
      }
      if (url.pathname === "/api/message" && req.method === "POST") {
        if (
          typeof body.text !== "string" ||
          !body.text.trim() ||
          typeof body.request_id !== "string"
        )
          throw Error("INVALID_MESSAGE");
        const input = app.host.accept(body.text, body.request_id);
        return send(200, { id: input.id });
      }
      if (url.pathname === "/api/approval" && req.method === "POST") {
        const result = app.authorization.decide({
          record_type: "ApprovalCommand",
          schema_version: 1,
          request_id: body.request_id,
          authorization_id: body.id,
          expected_revision: body.revision,
          display_hash: body.display_hash,
          decision: body.decision,
        });
        return send(200, result);
      }
      if (url.pathname === "/api/presented" && req.method === "POST") {
        if (
          !Array.isArray(body.ids) ||
          body.ids.length > 500 ||
          body.ids.some((v: unknown) => typeof v !== "string")
        )
          throw Error("INVALID_NOTIFICATION_IDS");
        const records = [...new Set<string>(body.ids)]
          .map((key) => app.store.get<Notification>("Notification", key))
          .filter(
            (n) => n.session_id === app.host.sessionID && n.state === "QUEUED",
          )
          .map((n) =>
            revise(n, {
              state: "SENT",
              receipt: app.store.put({
                channel: "web-ui",
                delivery_key: n.delivery_key,
                presented: true,
              }),
            }),
          );
        if (records.length)
          app.store.commit(
            records,
            records.map((n) => app.store.event("notification.result", n)),
          );
        return send(200, { presented: records.length });
      }
      if (url.pathname === "/api/poll") {
        await client.busy;
        client.ui.refresh();
        const output = client.output.splice(0);
        return send(200, { output, prompt: client.ui.prompt() });
      }
      if (url.pathname === "/api/state") {
        if (url.searchParams.get("since") === String(app.store.sequence))
          return send(200, { unchanged: true, revision: app.store.sequence });
        const session = app.host.session;
        const windowed = url.searchParams.get("window") === "1";
        const timeline = windowed ? timelineFor(app) : null;
        return send(200, {
          session: session.id,
          state: session.state,
          model: app.host.model.id,
          mode: process.env.SECRETARY_MODE ?? "fixture",
          revision: app.store.sequence,
          memory: app.host.memoryStatus(),
          settings: app.settings.status(),
          context: contextStatus(app.store, session, app.host.model),
          ...(windowed
            ? { timeline_summary: timeline!.summary(session.id) }
            : {
                messages: conversation(
                  app,
                  url.searchParams.get("thinking") === "1",
                ),
              }),
          notification_ids: app.store
            .select<Notification>(
              "Notification",
              (n) => n.session_id === session.id && n.state === "QUEUED",
              500,
            )
            .map((n) => n.id),
          approvals: windowed
            ? []
            : app.store
                .all<AuthorizationRequest>("AuthorizationRequest")
                .filter((a) => ["PENDING", "APPROVED"].includes(a.state))
                .map((a) => ({ ...a, display: app.store.read(a.display_ref) })),
          decisions: windowed
            ? []
            : app.store
                .all<DecisionRequest>("DecisionRequest")
                .filter((d) => d.state === "OPEN"),
          tasks: windowed
            ? []
            : app.store.all<TaskPlan>("TaskPlan").map((p) => ({
                id: p.id,
                state: p.state,
                goal: app.store.read<TaskProposal>(p.proposal_ref).goal,
                executions: app.store
                  .all<Execution>("Execution")
                  .filter((e) => e.task_id === p.id),
              })),
        });
      }
      send(404, { error: "NOT_FOUND" });
    } catch (error) {
      if (!res.headersSent) send(400, { error: String(error) });
      else res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const endpoint = {
    url: `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`,
    token,
    pid: process.pid,
  };
  return {
    endpoint,
    close: async () => {
      clearInterval(timer);
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await app.close();
    },
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const directory = path.resolve(process.env.SECRETARY_DATA ?? ".demo-data");
  const app = await App.open(
    directory,
    undefined,
    process.env.SECRETARY_DATABASE_URL,
  );
  const backend = await serve(app, 0, () => {
    void stop();
  });
  const endpointFile = path.join(directory, "ui-endpoint.json");
  const temp = endpointFile + `.${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(backend.endpoint), { mode: 0o600 });
  fs.renameSync(temp, endpointFile);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    fs.unlinkSync(endpointFile);
    await backend.close();
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
}
