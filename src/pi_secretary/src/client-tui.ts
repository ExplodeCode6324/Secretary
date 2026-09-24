import * as readline from "node:readline";
import { connectBackend, api } from "./ui-client.ts";
import { renderMessage, type MessageTone } from "./tui.ts";
const endpoint = await connectBackend();
if (process.argv.includes("--migrate")) await api(endpoint, "/api/migrate", {});
const { client } = await api(endpoint, "/api/client", {});
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
let closed = false,
  busy = false,
  prompt = "Master › ";
function print(text: string, tone: MessageTone = "system") {
  if (tty) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
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
      rl.setPrompt(renderMessage(prompt, "master", color));
      rl.prompt(true);
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
    rl.setPrompt(renderMessage(prompt, "master", color));
    rl.prompt(true);
  });
});
rl.on("SIGINT", () => rl.close());
const timer = setInterval(() => void poll(), 350);
await new Promise<void>((r) => rl.on("close", r));
closed = true;
clearInterval(timer);
await commands;
process.stdout.write("终端已关闭；共享后台仍在运行。\n");
