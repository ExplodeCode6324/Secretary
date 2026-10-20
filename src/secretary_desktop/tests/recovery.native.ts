import { browser, $ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = process.env.SECRETARY_DESKTOP_TEST_DATA!;
const read = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const setup = read("setup.json");
const invoke = (name: string, args: unknown = {}) =>
  browser.executeAsync(
    (n, a, done) => {
      (window as any).__TAURI__.core
        .invoke(n, a)
        .then((value: unknown) => done({ value }))
        .catch((e: unknown) => done({ error: String(e) }));
    },
    name,
    args,
  ) as Promise<any>;
describe("real task completed without desktop, original profile reopens", () => {
  it("converges one approved effect and renders original task result", async () => {
    const closed = read("closed-client-evidence.json");
    assert.equal(closed.desktop_processes.length, 0);
    assert(["RUNNING", "DISPATCHING"].includes(closed.state));
    process.kill(setup.pid, 0);
    await $("[data-testid=attach]").waitForClickable({ timeout: 20000 });
    await $("[data-testid=attach]").click();
    await $("[data-testid=draft]").waitForDisplayed({ timeout: 20000 });
    await browser.waitUntil(
      async () =>
        read("state.json").executions.find(
          (x: any) => x.id === closed.execution,
        )?.state === "SUCCEEDED",
      { timeout: 180000, interval: 500 },
    );
    const s = read("state.json"),
      e = s.executions.find((x: any) => x.id === closed.execution);
    assert.equal(
      fs.readFileSync(
        path.join(setup.scratch, "fe02-approved-marker.txt"),
        "utf8",
      ),
      "approved\n",
    );
    assert.equal(
      s.authorizations.filter((a: any) => a.state === "CONSUMED").length,
      1,
    );
    await browser.execute(() => {
      const internals = (window as any).__TAURI_INTERNALS__;
      const original = internals.invoke;
      (window as any).detailQueries = 0;
      internals.invoke = function(name:string, args:unknown, ...rest:unknown[]) {
        if(name === 'bridge_query') (window as any).detailQueries++;
        return original.call(this,name,args,...rest);
      };
    });
    await $(`[data-task-id="${e.task_id}"]`).waitForClickable({
      timeout: 15000,
    });
    await $(`[data-task-id="${e.task_id}"]`).click();
    await $("[data-testid=result]").waitForDisplayed({ timeout: 20000 });
    await $("[data-testid=artifact]").waitForDisplayed({ timeout: 20000 });
    assert((await $("[data-testid=task-detail]").getText()).includes(e.id));
    let stable = false;
    for(let attempt=0;attempt<4;attempt++) {
      const cursor=(await invoke('bridge_profiles')).value.cursor;
      const before=await browser.execute(()=>(window as any).detailQueries);
      await new Promise(r=>setTimeout(r,3500));
      if(cursor===(await invoke('bridge_profiles')).value.cursor) {
        assert.equal(await browser.execute(()=>(window as any).detailQueries),before,'idle detail must not refetch itself'); stable=true;break;
      }
    }
    assert(stable,'a stable cursor observation window is required');
    const snapshot = (await invoke("bridge_profiles")).value;
    const timings = [];
    for (let i = 0; i < 30; i++) {
      const t = Date.now();
      await invoke("bridge_transient", {
        expectedDomain: snapshot.domain,
        expectedInstance: snapshot.core.instance_id,
      });
      timings.push(Date.now() - t);
    }
    timings.sort((a, b) => a - b);
    assert(timings[28] <= 250);
    await browser.saveScreenshot(path.join(root, "reopened-result.png"));
    fs.writeFileSync(
      path.join(root, "recovery-evidence.json"),
      JSON.stringify({
        execution: e.id,
        task: e.task_id,
        state: e.state,
        marker_lines: 1,
        consumed_authorizations: 1,
        core_pid: setup.pid,
        lightweight_ipc_p95_ms: timings[28],
      }),
    );
  });
});
