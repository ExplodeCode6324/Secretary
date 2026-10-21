import { browser, $ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const dir = process.env.SECRETARY_DESKTOP_TEST_DATA!;
const invoke = async (name: string, args: unknown = {}) =>
  browser.executeAsync(
    (name, args, done) => {
      (window as any).__TAURI__.core
        .invoke(name, args)
        .then((v: unknown) => done({ value: v }))
        .catch((e: unknown) => done({ failure: String(e) }));
    },
    name,
    args,
  ) as Promise<any>;
const snapshot = async () => {
  const r = await invoke("bridge_profiles");
  assert.equal(r.failure, undefined);
  return r.value;
};
describe("FE-01 real WKWebView native bridge", () => {
  it("rejects diagnostic window mutation in an ordinary launch", async () => {
    assert.equal(
      (await invoke("phaseui_view", { width: 600, zoom: 1 })).failure,
      "DIAGNOSTIC_ONLY",
    );
  });
  it("starts independent fixture Core and sends a durable message through UI", async () => {
    await $("button=连接").click();
    await $("[data-testid=start]").waitForClickable({ timeout: 20000 });
    await $("[data-testid=start]").click();
    await browser.waitUntil(async () => !!(await snapshot()).domain, {
      timeout: 30000,
    });
    if (process.env.BRIDGE_REOPEN)
      assert.equal(
        await $("[data-testid=draft]").getValue(),
        "重开后保留的草稿",
      );
    await $("[data-testid=draft]").setValue("真实 WKWebView 原生发送 😀");
    await browser.waitUntil(
      async () =>
        (await snapshot()).draft?.text === "真实 WKWebView 原生发送 😀",
      { timeout: 15000 },
    );
    const prior = new Set((await snapshot()).outbox.map((o: any) => o.id));
    await $("[data-testid=send]").click();
    await browser.waitUntil(
      async () =>
        (await snapshot()).outbox?.some(
          (o: any) => o.state === "ACCEPTED" && !prior.has(o.id),
        ),
      { timeout: 20000 },
    );
    assert.equal((await snapshot()).draft.text, "");
    assert(
      (await $(".phase-send-status").getText()).startsWith(
        "已保存到本机发送队列：",
      ),
    );
    assert(
      await browser.execute(
        () =>
          document.querySelector(".phase-send-status")!.getBoundingClientRect()
            .top >
          document.querySelector("#composer-boundary")!.getBoundingClientRect()
            .bottom,
      ),
    );
    const endpoint = JSON.parse(
      fs.readFileSync(path.join(dir, "core/core-endpoint.json"), "utf8"),
    );
    const snap = await snapshot();
    assert(!JSON.stringify(snap).includes(endpoint.token));
    assert(!(await browser.getPageSource()).includes(endpoint.token));
    assert(
      !fs
        .readFileSync(path.join(dir, "core/core.log"), "utf8")
        .includes(endpoint.token),
    );
    assert(
      (
        await invoke("bridge_query", {
          expectedDomain: snap.domain,
          query: { operation: "admin/programs" },
        })
      ).failure,
    );
    assert.equal(
      (
        await invoke("bridge_draft", {
          expectedDomain: "wrong-domain",
          version: 0,
          text: "bad",
        })
      ).failure,
      "DATA_DOMAIN_CONFLICT",
    );
    await $("[data-testid=draft]").setValue("重开后保留的草稿");
    await browser.waitUntil(
      async () => (await snapshot()).draft?.text === "重开后保留的草稿",
      { timeout: 15000 },
    );
    fs.mkdirSync(path.join(dir, "evidence"), { recursive: true });
    await browser.saveScreenshot(path.join(dir, "evidence/bridge.png"));
  });
  it("reopens the WebView, reattaches and retains the draft and receipt", async () => {
    await browser.refresh();
    await $("button=连接").click();
    await $("[data-testid=attach]").waitForClickable({ timeout: 15000 });
    await $("[data-testid=attach]").click();
    await browser.waitUntil(
      async () =>
        (await $("[data-testid=draft]").getValue()) === "重开后保留的草稿",
      { timeout: 15000 },
    );
    const s = await snapshot();
    assert(s.outbox.some((o: any) => o.state === "ACCEPTED"));
    assert(s.cursor);
    fs.writeFileSync(
      path.join(dir, "evidence/native-result.json"),
      JSON.stringify(
        {
          passed: true,
          tests: [
            "native start",
            "UI durable send",
            "receipt confirmed",
            "draft survives WebView reload",
            "JS/snapshot token absence",
            "admin command denied",
            "domain conflict blocked",
          ],
          runtime: "macOS WKWebView",
          date: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  });
});
describe("recoverable editor save failure", () => {
  it("retries the next edit after a rejected save without reconnecting", async () => {
    const sql = (statement: string) =>
      execFileSync("python3", [
        "-c",
        "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.commit()",
        path.join(dir, "fixture/client.sqlite"),
        statement,
      ]);
    sql(
      "CREATE TRIGGER reject_draft BEFORE INSERT ON drafts BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END;",
    );
    try {
      await $("[data-testid=draft]").setValue("失败后仍保留的编辑内容");
      await browser.waitUntil(
        async () =>
          (await $("[role=alert]").getText()).includes("STORAGE_UNAVAILABLE"),
        { timeout: 5000 },
      );
      assert.equal(
        await $("[data-testid=draft]").getValue(),
        "失败后仍保留的编辑内容",
      );
    } finally {
      sql("DROP TRIGGER reject_draft;");
    }
    await $("[data-testid=draft]").setValue("重开后保留的草稿");
    await browser.waitUntil(
      async () => (await snapshot()).draft.text === "重开后保留的草稿",
      { timeout: 10000 },
    );
    // Saving a distinct value proves success rather than matching the old persisted draft.
    await $("[data-testid=draft]").setValue("保存链已恢复");
    await browser.waitUntil(
      async () => (await snapshot()).draft.text === "保存链已恢复",
      { timeout: 10000 },
    );
    await $("[data-testid=draft]").setValue("重开后保留的草稿");
    await browser.waitUntil(
      async () => (await snapshot()).draft.text === "重开后保留的草稿",
      { timeout: 10000 },
    );
  });
});
describe("local persistence while Core is unresponsive", () => {
  it("saves the editor while the network worker waits", async () => {
    const endpoint = JSON.parse(
      fs.readFileSync(path.join(dir, "core/core-endpoint.json"), "utf8"),
    );
    process.kill(endpoint.pid, "SIGSTOP");
    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const started = Date.now();
      await $("[data-testid=draft]").setValue("Core 暂停时保存的草稿");
      await browser.waitUntil(
        async () =>
          execFileSync(
            "python3",
            [
              "-c",
              "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute(\"SELECT text FROM drafts WHERE key='message'\").fetchone()[0])",
              path.join(dir, "fixture/client.sqlite"),
            ],
            { encoding: "utf8" },
          ).trim() === "Core 暂停时保存的草稿",
        { timeout: 3000, interval: 100 },
      );
      fs.writeFileSync(
        path.join(dir, "evidence/slow-core-draft.json"),
        JSON.stringify({
          passed: true,
          save_ms: Date.now() - started,
          core: "SIGSTOP",
          transport_timeout_ms: 10000,
        }),
      );
    } finally {
      process.kill(endpoint.pid, "SIGCONT");
    }
    await $("[data-testid=draft]").setValue("重开后保留的草稿");
    await browser.waitUntil(
      async () => (await snapshot()).draft.text === "重开后保留的草稿",
      { timeout: 15000 },
    );
  });
});
if (process.env.BRIDGE_DIALOG)
  describe("native download chooser", () => {
    it("cancels without creating a file or changing Core", async () => {
      const s = await snapshot();
      await browser.execute((domain) => {
        (window as any).downloadResult = undefined;
        (window as any).__TAURI__.core
          .invoke("bridge_download", {
            expectedDomain: domain,
            id: "00000000-0000-4000-8000-000000000001",
          })
          .then((result: unknown) => ((window as any).downloadResult = result))
          .catch((e: unknown) => ((window as any).downloadResult = String(e)));
      }, s.domain);
      fs.writeFileSync(path.join(dir, "evidence/dialog-ready"), "ready");
      await browser.waitUntil(
        async () =>
          (await browser.execute(() => (window as any).downloadResult)) ===
          "CANCELLED",
        { timeout: 90000 },
      );
    });
  });
if (process.env.BRIDGE_STOP)
  describe("explicit lifecycle management", () => {
    it("rejects stale instance confirmation and stops only by explicit UI confirmation", async () => {
      const s = await snapshot();
      assert.equal(
        (
          await invoke("bridge_stop", {
            expectedDomain: s.domain,
            expectedInstance: "stale-instance",
          })
        ).failure,
        "INSTANCE_CHANGED",
      );
      await $("button=连接").click();
      await $("button=停止当前 Core…").click();
      await $("button=确认停止").click();
      await browser.waitUntil(
        async () => !fs.existsSync(path.join(dir, "core/core-endpoint.json")),
        { timeout: 10000 },
      );
      assert.equal((await snapshot()).error, "STOP_DISCONNECTED");
    });
  });
