import * as fs from "node:fs";
import * as path from "node:path";
import { api, type Endpoint } from "./ui-client.ts";
const dir = path.resolve(
  process.env.SECRETARY_DATA ?? ".demo-data/interactive-live",
);
const endpoint = JSON.parse(
  fs.readFileSync(path.join(dir, "ui-endpoint.json"), "utf8"),
) as Endpoint;
await api(endpoint, "/api/shutdown", {});
console.log("已请求共享后台安全退出；运行中的任务按既有中断规则处理。");
