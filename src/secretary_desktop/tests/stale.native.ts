import { browser, $ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
class CoreClient {
  constructor(private endpoint: { url: string; token: string }) {}
  async request<T>(method: string, route: string, body?: unknown): Promise<T> {
    const r = await fetch(this.endpoint.url + "/api/v1/" + route, {
      method,
      headers: {
        Authorization: "Bearer " + this.endpoint.token,
        "X-Secretary-API-Version": "1",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error.code);
    return data.data;
  }
  query<T = unknown>(route: string) {
    return this.request<T>("GET", route);
  }
  command(route: string, body: unknown) {
    return this.request("POST", route, body);
  }
}
const root = process.env.SECRETARY_DESKTOP_TEST_DATA!;
const read = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const state = () => read("state.json");
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
describe("real authorization stale and hash conflicts", () => {
  it("rejects via a second public client and keeps stale intent from executing", async () => {
    await $("[data-testid=attach]").waitForClickable({ timeout: 20000 });
    await $("[data-testid=attach]").click();
    await $("[data-testid=draft]").waitForDisplayed({ timeout: 20000 });
    fs.writeFileSync(
      path.join(root, "scenario.json"),
      JSON.stringify({ name: "stale" }),
    );
    const command = `python3 -I -S -B -c "from pathlib import Path; Path('fe02-stale-marker.txt').write_text('forbidden\\n')"`;
    const before = new Set(state().authorizations.map((a: any) => a.id));
    await $("[data-testid=draft]").setValue(
      `请创建立即执行任务，Scope FE02 scratch（${setup.scope_id}）。只能通过模型工具 bash 提交一次以下精确命令（bash会触发宿主正常shell.run审批），不需要 ask_user 澄清，不要探索目录或其他命令：${command} 。等待桌面的正常批准，绝不绕过授权。完成后仅read验证文件。`,
    );
    await $("[data-testid=send]").click();
    await browser.waitUntil(
      async () =>
        state().authorizations.some(
          (a: any) => a.state === "PENDING" && !before.has(a.id),
        ),
      { timeout: 180000, interval: 500 },
    );
    const a = state().authorizations.find(
      (a: any) => a.state === "PENDING" && !before.has(a.id),
    );
    await $(`[data-auth-id="${a.id}"]`).waitForClickable({ timeout: 15000 });
    await $(`[data-auth-id="${a.id}"]`).click();
    await $("[data-testid=approval-parameters]").waitForDisplayed({
      timeout: 15000,
    });
    const snap = (await invoke("bridge_profiles")).value;
    const client = new CoreClient(read("core/core-endpoint.json"));
    const detail: any = await client.query(`authorizations/${a.id}`);
    const envelope = {
      expectedDomain: snap.domain,
      expectedInstance: snap.core.instance_id,
    };
    const epoch = (await invoke("bridge_transient", envelope)).value?.epoch;
    process.kill(setup.pid, "SIGUSR1");
    await browser.waitUntil(
      async () => {
        const v = (await invoke("bridge_transient", envelope)).value;
        return v?.connected && v.epoch !== epoch;
      },
      { timeout: 15000, interval: 250 },
    );
    fs.writeFileSync(
      path.join(root, "sse-recovery-evidence.json"),
      JSON.stringify({
        old_epoch: epoch,
        new_epoch: (await invoke("bridge_transient", envelope)).value.epoch,
        execution: a.scope.execution_id,
        core_pid: setup.pid,
      }),
    );
    const q = { operation: "authorizations/{id}/decision", id: a.id };
    const hash = await invoke("bridge_submit", {
      expectedDomain: snap.domain,
      query: q,
      body: {
        expected_revision: detail.revision,
        display_hash: "0".repeat(64),
        decision: "APPROVE",
      },
    });
    assert(!hash.error);
    await browser.waitUntil(
      async () =>
        (await invoke("bridge_profiles")).value.outbox.some(
          (r: any) => r.id === hash.value && r.state === "APPROVAL_CONFLICT",
        ),
      { timeout: 20000 },
    );
    await client.command(`authorizations/${a.id}/decision`, {
      request_id: crypto.randomUUID(),
      expected_revision: detail.revision,
      display_hash: detail.display_hash,
      decision: "REJECT",
    });
    const stale = await invoke("bridge_submit", {
      expectedDomain: snap.domain,
      query: q,
      body: {
        expected_revision: detail.revision,
        display_hash: detail.display_hash,
        decision: "APPROVE",
      },
    });
    assert(!stale.error);
    await browser.waitUntil(
      async () =>
        (await invoke("bridge_profiles")).value.outbox.some(
          (r: any) => r.id === stale.value && r.state === "APPROVAL_CONFLICT",
        ),
      { timeout: 20000 },
    );
    await assert.rejects(client.query(`requests/${stale.value}`), /NOT_FOUND/);
    assert.equal(
      (await client.query<any>(`authorizations/${a.id}`)).state,
      "REJECTED",
    );
    assert(!fs.existsSync(path.join(setup.scratch, "fe02-stale-marker.txt")));
    fs.writeFileSync(
      path.join(root, "stale-evidence.json"),
      JSON.stringify({
        authorization: a.id,
        hash_request: hash.value,
        stale_request: stale.value,
        state: "APPROVAL_CONFLICT",
        public_receipt: "NOT_FOUND",
        marker_absent: true,
      }),
    );
  });
});
