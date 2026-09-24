import { getInstructions, saveInstructions } from "./instructions.ts";
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
};
export function conversation(app: App): UIMessage[] {
  const output: UIMessage[] = [];
  for (const e of app.store.logs) {
    let role: MessageTone = "system",
      text = "";
    if (e.event_type === "input.accepted") {
      const input = app.store.read<Input>(e.payload);
      role = input.producer === "MASTER" ? "master" : "system";
      text = app.store.bytes(input.payload).toString();
    } else if (e.event_type === "main.message") {
      const m = app.store.read<{
        role: string;
        content: { type: string; text?: string }[];
      }>(e.payload);
      if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
      role = "secretary";
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
    if (text) output.push({ id: e.event_id, role, text, at: e.occurred_at });
  }
  return output;
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
      if (url.pathname === "/api/instructions") {
        if (req.method === "POST") {
          try {
            saveInstructions(app.store, body.content, body.expected_revision);
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
          active_revision: active?.instructions_revision ?? null,
          last_used_revision: context?.instructions_revision ?? null,
          applies: "NEXT_TURN",
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
        const context = session.last_context_id
          ? app.store.get<Context>("Context", session.last_context_id)
          : null;
        return send(200, {
          session: session.id,
          state: session.state,
          model: app.host.model.id,
          mode: process.env.SECRETARY_MODE ?? "fixture",
          revision: app.store.sequence,
          memory: app.host.memoryStatus(),
          context: context
            ? {
                used: context.estimated_tokens,
                budget: context.token_budget,
                reserve: context.reserve_tokens,
              }
            : {
                used: null,
                budget: app.host.model.contextWindow,
                reserve: 4096,
              },
          messages: conversation(app),
          notification_ids: app.store
            .all<Notification>("Notification")
            .filter((n) => n.session_id === session.id && n.state === "QUEUED")
            .map((n) => n.id)
            .slice(0, 500),
          approvals: app.store
            .all<AuthorizationRequest>("AuthorizationRequest")
            .filter((a) => ["PENDING", "APPROVED"].includes(a.state))
            .map((a) => ({ ...a, display: app.store.read(a.display_ref) })),
          decisions: app.store
            .all<DecisionRequest>("DecisionRequest")
            .filter((d) => d.state === "OPEN"),
          tasks: app.store.all<TaskPlan>("TaskPlan").map((p) => ({
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
