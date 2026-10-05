import { ActivityTerminal } from "./activity-terminal.ts";
import * as readline from "node:readline";
import { connectBackend, api, readRunningBackend } from "./ui-client.ts";
import { renderMessage, type MessageTone } from "./tui.ts";
let endpoint = await connectBackend();
if (process.argv.includes("--migrate")) await api(endpoint, "/api/migrate", {});
let { client } = await api(endpoint, "/api/client", {});
const tty = !!process.stdout.isTTY;
const color =
  tty &&
  (process.env.SECRETARY_COLOR === "256" ||
    (process.env.NO_COLOR === undefined && process.env.TERM !== "dumb"));
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: tty && !!process.stdin.isTTY,
});
const activityTerminal = new ActivityTerminal(rl);
let activityBusy = false;
async function pollActivity() {
  if (activityBusy || closed) return;
  activityBusy = true;
  try {
    activityTerminal.accept(
      await api(endpoint, `/api/activity?client=${client}`),
    );
  } catch {
    activityTerminal.disconnect();
    const replacement = await readRunningBackend();
    if (replacement && !closed) {
      try {
        const next = await api(replacement, "/api/client", {});
        endpoint = replacement;
        client = next.client;
      } catch {}
    }
  } finally {
    activityBusy = false;
  }
}
const activityTimer = setInterval(() => void pollActivity(), 350);
let closed = false,
  busy = false,
  prompt = "Master › ";
function print(text: string, tone: MessageTone = "system") {
  if (tty) {
    activityTerminal.clear();
  }
  process.stdout.write(renderMessage(text, tone, color) + "\n");
}
async function poll() {
  if (busy || closed) return false;
  busy = true;
  try {
    const state = await api(endpoint, `/api/poll?client=${client}`);
    prompt = state.prompt;
    for (const item of state.output) print(item.text, item.tone);
    if (state.output.length) {
      activityTerminal.setPrompt(renderMessage(prompt, "master", color));
    }
    return state.output.length > 0;
  } catch (error) {
    print(String(error));
  } finally {
    busy = false;
  }
}
print(
  `WebUI 与本终端共用主会话 · ${endpoint.url}\n/web 打开网页 · /quit 仅关闭终端，后台继续工作`,
);
await poll();
let commands = Promise.resolve();
rl.on("line", (line) => {
  commands = commands.then(async () => {
    if (line.trim() === "/quit") {
      rl.close();
      return;
    }
    if (line.trim() === "/web") {
      const { spawn } = await import("node:child_process");
      spawn("open", [`${endpoint.url}/#${endpoint.token}`], {
        stdio: "ignore",
      });
      rl.prompt();
      return;
    }
    try {
      await api(endpoint, "/api/command", { client, line });
      if (await poll()) return;
    } catch (error) {
      print(String(error));
    }
    activityTerminal.setPrompt(renderMessage(prompt, "master", color));
  });
});
rl.on("SIGINT", () => rl.close());
const timer = setInterval(() => void poll(), 350);
await new Promise<void>((r) => rl.on("close", r));
closed = true;
clearInterval(timer);
clearInterval(activityTimer);
activityTerminal.close();
await commands;
process.stdout.write("终端已关闭；共享后台仍在运行。\n");
