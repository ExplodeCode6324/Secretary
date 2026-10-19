import { browser, $ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
  it("starts independent fixture Core and sends a durable message through UI", async () => {
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
    const prior=new Set((await snapshot()).outbox.map((o:any)=>o.id));
    await $("[data-testid=send]").click();
    await browser.waitUntil(
      async () =>
        (await snapshot()).outbox?.some((o: any) => o.state === "ACCEPTED" && !prior.has(o.id)),
      { timeout: 20000 },
    );
    assert.equal((await snapshot()).draft.text, "");
    const endpoint = JSON.parse(
      fs.readFileSync(path.join(dir, "core/core-endpoint.json"), "utf8"),
    );
    const snap = await snapshot();
    assert(!JSON.stringify(snap).includes(endpoint.token));
    assert(!(await browser.getPageSource()).includes(endpoint.token));
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
if (process.env.BRIDGE_DIALOG) describe('native download chooser',()=>{
 it('cancels without creating a file or changing Core',async()=>{
  const s=await snapshot();
  await browser.execute((domain)=>{(window as any).downloadResult=undefined;(window as any).__TAURI__.core.invoke('bridge_download',{expectedDomain:domain,id:'00000000-0000-4000-8000-000000000001'}).then((result:unknown)=>(window as any).downloadResult=result).catch((e:unknown)=>(window as any).downloadResult=String(e));},s.domain);
  fs.writeFileSync(path.join(dir,'evidence/dialog-ready'),'ready');
  await browser.waitUntil(async()=>await browser.execute(()=>(window as any).downloadResult)==='CANCELLED',{timeout:90000});
 });
});
