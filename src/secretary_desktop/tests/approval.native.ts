import { browser, $ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = process.env.SECRETARY_DESKTOP_TEST_DATA!;
const read = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const write = (name: string, value: unknown) =>
  fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2));
const state = () => read("state.json");
const setup = read("setup.json");
describe("FE-02 real native approval and recovery barrier", () => {
  it("inspects and approves a bounded marker operation", async () => {
    await $("button=连接").click();
    await $("[data-testid=attach]").waitForClickable({ timeout: 20000 });
    await $("[data-testid=attach]").click();
    await $("[data-testid=draft]").waitForDisplayed({ timeout: 20000 });
    write("scenario.json", { name: process.env.ISSUE60_SCENARIO ?? "approve" });
    const command = `python3 -I -S -B -c "import time; from pathlib import Path; time.sleep(20); p=Path('fe02-approved-marker.txt'); p.write_text(p.read_text()+'approved\\n' if p.exists() else 'approved\\n')"`;
    write("approved-command.json", { command });
    await $("[data-testid=draft]").setValue(
      `请创建并立即执行新任务，Scope FE02 scratch（${setup.scope_id}）。任务只能在绑定根目录执行一次以下精确命令，通过模型工具 bash 提交（将触发宿主 shell.run 正常授权）；禁止提前执行，禁止探索目录，禁止添加其他shell命令。命令：${command} 。完成条件：读取 fe02-approved-marker.txt，确认只有一行 approved，然后登记为artifact。除这次shell外只可read文件和登记artifact。`,
    );
    await $("[data-testid=send]").click();
    const existing = new Set(state().authorizations.map((a: any) => a.id));
    await browser.waitUntil(
      async () =>
        state().authorizations.some(
          (a: any) => a.state === "PENDING" && !existing.has(a.id),
        ),
      { timeout: 180000, interval: 1000 },
    );
    const a = state().authorizations.find(
      (a: any) => a.state === "PENDING" && !existing.has(a.id),
    );
    await $("[data-page=attention]").click();
    await $(`[data-auth-id="${a.id}"]`).waitForClickable({ timeout: 20000 });
    await $(`[data-auth-id="${a.id}"]`).click();
    await $("[data-testid=approval-parameters]").waitForDisplayed({
      timeout: 15000,
    });
    const display = JSON.parse(
      await $("[data-testid=approval-parameters]").getText(),
    );
    assert.equal(display.parameters.command, command);
    assert.equal(display.parameters.cwd, setup.scratch);
    assert(
      !fs.existsSync(path.join(setup.scratch, "fe02-approved-marker.txt")),
    );
    await $("[data-testid=approval-detail] input").click();
    await $("[data-testid=approve]").click();
    await browser.waitUntil(
      async () =>
        state().authorizations.find((x: any) => x.id === a.id)?.state ===
        "CONSUMED",
      { timeout: 20000, interval: 250 },
    );
    const execution = state().executions.find(
      (e: any) => e.id === a.scope.execution_id,
    );
    assert(["RUNNING", "DISPATCHING"].includes(execution.state));
    write("recovery-barrier.json", {
      authorization: a.id,
      execution: execution.id,
      core_pid: setup.pid,
      at: new Date().toISOString(),
      marker_absent: !fs.existsSync(
        path.join(setup.scratch, "fe02-approved-marker.txt"),
      ),
    });
  });
});
