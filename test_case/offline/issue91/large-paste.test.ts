import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import { DraftEditor } from "../../../src/pi_secretary/src/tui/input.ts";
import { LocalFiles } from "../../../src/pi_secretary/src/tui/state.ts";
import {
  Delivery,
  type DeliveryClient,
} from "../../../src/pi_secretary/src/tui/delivery.ts";

test("1/16 MiB paste diagnostics preserve Main/Task data and reject oversized Main without POST", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "secretary-issue91-large-"),
  );
  const files = new LocalFiles(root),
    state = await files.open("domain", "fixture");
  const metrics: unknown[] = [];
  let posts = 0;
  const delivery = new Delivery(state, files);
  delivery.client = {
    endpoint: { instance_id: "i" },
    command: async () => {
      posts++;
      throw Error("UNEXPECTED_POST");
    },
  } as unknown as DeliveryClient;
  try {
    for (const page of ["Main", "Task"] as const)
      for (const bytes of [1024 * 1024, 16 * 1024 * 1024]) {
        const editor = new DraftEditor(
          new TuiAltScreen(new VirtualTerminal()),
          () => page,
        );
        const payload = "x".repeat(bytes);
        const before = performance.now();
        editor.handleInput(`\x1b[200~${payload}\x1b[201~`);
        editor.render(80);
        const visible = performance.now() - before;
        assert.equal(editor.getExpandedText(), payload);
        assert.match(editor.getText(), /^<pasted 1 line /);
        delivery.edit(page, payload, editor.snapshot());
        const saveStart = performance.now(),
          saving = files.save(state),
          serialize = performance.now() - saveStart;
        const editStart = performance.now();
        editor.handleInput("!");
        editor.render(80);
        const edit = performance.now() - editStart;
        await saving;
        const save = performance.now() - saveStart;
        if (page === "Main") {
          await delivery.submit(payload, payload, state.drafts.Main.snapshot);
          assert.equal(state.pending, undefined);
          assert.equal(state.drafts.Main.raw, payload);
        }
        metrics.push({
          page,
          bytes,
          input_to_render_ms: visible,
          serialize_ms: serialize,
          save_ms: save,
          edit_during_save_ms: edit,
        });
      }
    assert.equal(posts, 0);
    console.log(
      JSON.stringify({
        issue91_paste_diagnostics: metrics,
        node: process.version,
        icu: process.versions.icu,
        posts,
      }),
    );
  } finally {
    await delivery.close();
    await files.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
