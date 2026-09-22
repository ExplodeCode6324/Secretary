import http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { App } from "./app.ts";
import { id } from "./store.ts";
import type {
  ApprovalCommand,
  AuthorizationRequest,
  TaskPlan,
  TaskProposal,
} from "./contracts.ts";
export function createServer(app: App, token: string) {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          fs.readFileSync(
            fileURLToPath(new URL("../web/index.html", import.meta.url)),
          ),
        );
        return;
      }
      const provided = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      if (
        Buffer.byteLength(provided) !== Buffer.byteLength(token) ||
        !timingSafeEqual(Buffer.from(provided), Buffer.from(token))
      ) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: "Master authentication required" }));
        return;
      }
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: "Origin rejected" }));
        return;
      }
      const parts: Buffer[] = [];
      let size = 0;
      for await (const part of req) {
        size += part.length;
        if (size > 1024 * 1024) throw Error("INPUT_TOO_LARGE");
        parts.push(part);
      }
      const body = parts.length
        ? JSON.parse(Buffer.concat(parts).toString())
        : {};
      let value: unknown;
      if (req.method === "GET" && url.pathname === "/api/state")
        value = {
          session: app.host.session,
          inputs: app.store.all("Input"),
          tasks: app.store.all<TaskPlan>("TaskPlan").map((p) => ({
            ...p,
            goal: app.store.read<TaskProposal>(p.proposal_ref).goal,
          })),
          executions: app.store.all("Execution"),
          approvals: app.store.all("AuthorizationRequest"),
          operations: app.store.all("Operation"),
          decisions: app.store.all("DecisionRequest"),
          programs: app.store.all("ProgramRegistration"),
          notifications: app.store.all("Notification"),
          messages: app.store.logs
            .filter((l) => l.event_type === "main.message")
            .slice(-40)
            .map((l) => app.store.read(l.payload)),
          models: { main: app.host.model.id, task: app.scheduler.model.id },
          mode:
            process.env.SECRETARY_MODE === "live"
              ? "LIVE_MODEL"
              : "OFFLINE_FIXTURE",
        };
      else if (req.method === "GET" && url.pathname === "/api/detail")
        value = app.scheduler.detail(
          url.searchParams.get("execution_id") ?? "",
        );
      else if (req.method === "GET" && url.pathname === "/api/approval") {
        const approval = app.store
          .all<AuthorizationRequest>("AuthorizationRequest")
          .find((a) => a.id === url.searchParams.get("id"));
        value =
          approval && "display_ref" in approval
            ? app.store.read(approval.display_ref)
            : null;
      } else if (req.method === "POST" && url.pathname === "/api/input") {
        value = app.host.accept(
          String(body.text ?? ""),
          body.request_id ?? id(),
        );
        res.statusCode = 202;
      } else if (req.method === "POST" && url.pathname === "/api/task")
        value = app.scheduler.propose(
          String(body.goal ?? ""),
          body.request_id ?? id(),
          app.host.sessionID,
          {
            programID: body.program_id,
            at: body.at,
            interval: body.interval,
            parent: body.parent,
            constraints: body.constraints,
            acceptance: body.acceptance_criteria,
            deadline: body.deadline,
          },
        );
      else if (req.method === "POST" && url.pathname === "/api/approve") {
        if (!["APPROVE", "REJECT", "REVOKE"].includes(body.decision))
          throw Error("INVALID_DECISION");
        value = app.authorization.decide({
          ...body,
          record_type: "ApprovalCommand",
          schema_version: 1,
        } as ApprovalCommand);
      } else if (req.method === "POST" && url.pathname === "/api/decision") {
        app.scheduler.answer(body.id, body.answer, body.request_id ?? id());
        value = { accepted: true };
      } else if (req.method === "POST" && url.pathname === "/api/verify") {
        value = app.scheduler.verifyWrite(body.operation_id);
      } else if (req.method === "POST" && url.pathname === "/api/cancel") {
        app.scheduler.cancel(body.id);
        value = { requested: true };
      } else if (req.method === "POST" && url.pathname === "/api/resume") {
        void app.host.resume().catch(console.error);
        value = { requested: true };
      } else if (req.method === "POST" && url.pathname === "/api/compact") {
        void app.host.compact().catch(console.error);
        value = { requested: true };
      } else if (req.method === "POST" && url.pathname === "/api/rule")
        value = app.authorization.rule(
          body.action,
          body.resource,
          body.parameters,
        );
      else if (req.method === "POST" && url.pathname === "/api/program")
        value = app.scheduler.registerProgram(body.entrypoint, body.name);
      else if (req.method === "POST" && url.pathname === "/api/world") {
        if (!app.world) throw Error("WORLD_UNAVAILABLE");
        value = app.world.propose(body, {
          session_id: app.host.sessionID,
          task_id: null,
          execution_id: null,
        });
      } else if (req.method === "GET" && url.pathname === "/api/world") {
        if (!app.world) throw Error("WORLD_UNAVAILABLE");
        value = await app.world.read(url.searchParams.get("subject_id"));
      } else {
        res.writeHead(404);
        res.end("{}");
        return;
      }
      res.end(JSON.stringify(value));
    } catch (error) {
      res.statusCode = 409;
      res.end(JSON.stringify({ error: String(error) }));
    }
  });
  return server;
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
  if (process.argv.includes("--migrate")) await app.world?.migrate();
  const tokenFile = path.join(directory, "master.token");
  if (!fs.existsSync(tokenFile))
    fs.writeFileSync(tokenFile, randomBytes(32).toString("hex"), {
      mode: 0o600,
    });
  const token = fs.readFileSync(tokenFile, "utf8").trim();
  const server = createServer(app, token);
  const port = Number(process.env.PORT ?? 4317);
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `Secretary: http://127.0.0.1:${port}\nMaster access key: ${tokenFile}\nMode: ${process.env.SECRETARY_MODE ?? "offline fixture"}`,
    ),
  );
  let pumping = false;
  const timer = setInterval(() => {
    if (pumping) return;
    pumping = true;
    app
      .pump()
      .catch((error) => console.error(String(error)))
      .finally(() => {
        pumping = false;
      });
  }, 300);
  const stop = async () => {
    clearInterval(timer);
    server.close();
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
