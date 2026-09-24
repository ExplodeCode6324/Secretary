import { spawn } from "node:child_process";
import { connectBackend, api } from "./ui-client.ts";
const endpoint = await connectBackend();
if (process.argv.includes("--migrate")) await api(endpoint, "/api/migrate", {});
console.log(
  `Secretary WebUI · ${endpoint.url}\n与 TUI 共享同一个后台；关闭网页不会终止任务。`,
);
spawn("open", [`${endpoint.url}/#${endpoint.token}`], { stdio: "ignore" }).on(
  "error",
  () => console.error("无法自动打开浏览器。请在 TUI 输入 /web。"),
);
