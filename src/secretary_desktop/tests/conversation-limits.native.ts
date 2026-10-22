import { browser, $, $$ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const root = process.env.SECRETARY_DESKTOP_TEST_DATA!;
assert(root.includes("/.demo-data/issue63/"));
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, "fixture.json"), "utf8"),
);
const invoke = (name: string, args: unknown = {}) =>
  browser.executeAsync(
    (n, a, done) => {
      (window as any).__TAURI__.core
        .invoke(n, a)
        .then((value: unknown) => done({ value }))
        .catch((e: unknown) => done({ failure: String(e) }));
    },
    name,
    args,
  ) as Promise<any>;
async function locate(id: string) {
  await $("label=定位 ID").$("input").setValue(id);
  await $("button=定位").click();
  await $(`[data-message-id="${id}"]`).waitForExist({ timeout: 20000 });
}
async function load(index: number, limit = false) {
  await locate(fixture.ids[index].id);
  const selector = `[data-message-id="${fixture.ids[index].id}"]`;
  const reads = 1;
  await $(selector).$("button=读取并复制完整正文").click();
  await browser.waitUntil(
    async () => {
      const text = await $(selector).getText();
      return text.includes("已复制") || text.includes("未复制完整正文：");
    },
    { timeout: 120000 },
  );
  if (limit) {
    assert((await $(selector).getText()).includes("CONTENT_LIMIT"));
    assert(await $(selector).$("button=复制已加载部分").isExisting());
    assert(!(await $(selector).$("button=复制完整正文").isExisting()));
  } else {
    assert(await $(selector).$("button=复制完整正文").isExisting());
    await $(selector).$("button=复制完整正文").click();
    await browser.waitUntil(async () =>
      (await $(selector).getText()).includes("已复制"),
    );
    assert.equal(
      execFileSync("/usr/bin/pbpaste", [], {
        encoding: "utf8",
        env: { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
      }),
      fixture.ids[index].text,
    );
  }
  return reads;
}
describe("Issue63 large content and recovery", () => {
  it("handles 10000 code lines, a 2MiB limit and complete unresolved local bodies", async () => {
    await $("button=连接").click();
    await $("[data-testid=start]").waitForClickable({ timeout: 20000 });
    await $("[data-testid=start]").click();
    await $("[data-testid=draft]").waitForDisplayed({ timeout: 20000 });
    const snap = (await invoke("bridge_profiles")).value;
    const timings = await browser.executeAsync(async (done) => {
      const values = [];
      for (let i = 0; i < 30; i++) {
        const t = performance.now();
        const result = await (window as any).__TAURI__.core.invoke(
          "bridge_profiles",
        );
        values.push({
          ms: performance.now() - t,
          bytes: new TextEncoder().encode(JSON.stringify(result)).length,
          ...result.native_measure,
        });
      }
      done(values);
    });
    const endpoint = JSON.parse(
      fs.readFileSync(path.join(root, "core/core-endpoint.json"), "utf8"),
    );
    assert.equal(endpoint.instance_id, snap.core.instance_id);
    assert(
      execFileSync("ps", ["-p", String(endpoint.pid), "-o", "command="], {
        encoding: "utf8",
      }).includes("/src/pi_secretary/src/backend.ts"),
    );
    process.kill(endpoint.pid, "SIGSTOP");
    let contended: any;
    const resume = setTimeout(
      () => process.kill(endpoint.pid, "SIGCONT"),
      2300,
    );
    try {
      contended = await browser.executeAsync(async (domain, done) => {
        const invoke = (window as any).__TAURI__.core.invoke;
        await invoke("bridge_subscribe", {
          expectedDomain: domain,
          queries: [
            { operation: "assistant" },
            { operation: "session" },
            { operation: "timeline" },
            { operation: "attention" },
            { operation: "tasks" },
          ],
        });
        // The actual background tick now waits for the paused Core while holding
        // the Bridge mutex. Wait past its one-second scheduling cadence.
        await new Promise((r) => setTimeout(r, 1200));
        const started = performance.now();
        const snapshot = await invoke("bridge_profiles");
        done({ ms: performance.now() - started, ...snapshot.native_measure });
      }, snap.domain);
    } finally {
      clearTimeout(resume);
      process.kill(endpoint.pid, "SIGCONT");
    }
    assert(contended.mutex_wait_us >= 200000, JSON.stringify(contended));
    const codeReads = await load(981);
    const limitReads = await load(982, true);
    // Inject an UNKNOWN synthetic local intent into this isolated fixture only.
    // It is deliberately outside delivery's retry states and cannot send a POST.
    const request = randomUUID();
    const body = "完整待核对原文 中文👩‍💻\n".repeat(1000);
    execFileSync("python3", [
      "-c",
      `import sqlite3,json,sys\nc=sqlite3.connect(sys.argv[1]);c.execute("INSERT INTO outbox(id,domain,instance,query,body,state) VALUES(?,?,?,?,?,'UNKNOWN')",(sys.argv[2],sys.argv[3],sys.argv[4],json.dumps({'operation':'messages'}),json.dumps({'text':sys.argv[5]},ensure_ascii=False)));c.commit()`,
      path.join(root, "issue63-fixture/client.sqlite"),
      request,
      snap.domain,
      snap.core.instance_id,
      body,
    ]);
    await $("[data-testid=draft]").setValue(" \n ");
    await $("[data-page=attention]").click();
    await $("section[aria-label='消息恢复']")
      .$("button=查看完整原文")
      .waitForExist({ timeout: 10000 });
    await $("section[aria-label='消息恢复']").$("button=查看完整原文").click();
    await $("button=我已核对，恢复到空编辑器").click();
    await browser.waitUntil(async () =>
      (await $("section[aria-label='消息恢复']").getText()).includes(
        "编辑器已有草稿",
      ),
    );
    assert(
      (await $("section[aria-label='消息恢复']").getText()).includes(
        "可能重复原操作",
      ),
    );
    await $("button=复制完整原文").click();
    await browser.waitUntil(async () =>
      (await $("section[aria-label='消息恢复']").getText()).includes(
        "已复制完整原文",
      ),
    );
    assert.equal(
      execFileSync("/usr/bin/pbpaste", [], {
        encoding: "utf8",
        env: { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
      }),
      body,
    );
    assert(!(await $("button=丢弃已恢复的失败记录…").isExisting()));
    await $("[data-page=conversation]").click();
    assert.equal(await $("[data-testid=draft]").getValue(), " \n ");
    await $("[data-testid=draft]").setValue("");
    await $("[data-page=attention]").click();
    await $("button=查看完整原文").click();
    await $("button=我已核对，恢复到空编辑器").click();
    await browser.waitUntil(
      async () => await $("[data-testid=draft]").isDisplayed(),
    );
    assert.equal(await $("[data-testid=draft]").getValue(), body);
    const pending = (
      await invoke("bridge_message_outbox", { expectedDomain: snap.domain })
    ).value;
    assert(
      pending.items.some((r: any) => r.id === request && r.state === "UNKNOWN"),
    );
    fs.writeFileSync(
      path.join(root, "limits-result.json"),
      JSON.stringify(
        {
          codeReads,
          limitReads,
          code_full_copy: true,
          limit_labelled_partial: true,
          unknown_body_recovered: true,
          whitespace_draft_protected: true,
          snapshot_ipc: timings,
          contended_snapshot: contended,
        },
        null,
        2,
      ),
    );
    await browser.saveScreenshot(path.join(root, "recovery.png"));
    await invoke("bridge_stop", {
      expectedDomain: snap.domain,
      expectedInstance: snap.core.instance_id,
    });
  });
});
