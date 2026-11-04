import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseInput,
  parseDraft,
} from "../../../src/pi_secretary/src/tui/input.ts";
import { plainSnapshot } from "../../../src/pi_secretary/src/tui/draft.ts";
import {
  openArgument,
  resolveOpen,
  checkOpenFile,
} from "../../../src/pi_secretary/src/tui/open.ts";
import {
  parseProbe,
  clipboardKind,
  readClipboard,
} from "../../../src/pi_secretary/src/tui/clipboard-read.ts";
import {
  freshState,
  LocalFiles,
  exportLegacyState,
} from "../../../src/pi_secretary/src/tui/state.ts";
import {
  Delivery,
  MESSAGE_ADMISSION_REJECTIONS,
} from "../../../src/pi_secretary/src/tui/delivery.ts";
import { ATTACHMENT_DEFAULTS } from "../../../src/pi_secretary/src/attachments.ts";

test("literal open, whole paste, image-only send and page scope", () => {
  assert.deepEqual(parseInput("/OpEn /中文 目录/Report.txt", "Main"), {
    kind: "open",
    path: "/中文 目录/Report.txt",
  });
  for (const c of ["/paste arg", "/paste\n", "/open\tfile", "/open "])
    assert.equal(parseInput(c, "Main").kind, "error");
  for (const c of ["/paste", "/open /a.txt", "/send"])
    assert.equal(parseInput(c, "Task", false, true).kind, "error");
  for (const c of ["", "/send", "/send "])
    assert.deepEqual(parseInput(c, "Main", false, true), {
      kind: "send",
      text: "",
    });
  assert.equal(parseInput("/send  ", "Main", false, true).kind, "error");
  assert.deepEqual(
    parseDraft(plainSnapshot("/send", "typed"), "Main", false, true),
    { kind: "send", text: "" },
  );
  assert.equal(
    openArgument("--execution aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa report.txt")
      .filename,
    "report.txt",
  );
});
test("document opening rejects executables, launchers, links, and ambiguous registered roots", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "issue94-open-")),
  );
  try {
    const good = path.join(root, "中文 Report.TXT");
    await fs.writeFile(good, "current");
    await checkOpenFile(good);
    await fs.chmod(good, 0o700);
    await assert.rejects(checkOpenFile(good), /EXECUTABLE/);
    const launcher = path.join(root, "run.command");
    await fs.writeFile(launcher, "echo no");
    await assert.rejects(checkOpenFile(launcher), /TYPE/);
    const link = path.join(root, "link.txt");
    await fs.symlink(good, link);
    await assert.rejects(checkOpenFile(link), /SYMLINK/);
    await assert.rejects(
      resolveOpen("report.txt", {
        query: async () =>
          ({
            items: [
              { current_path: "/one/report.txt", source_root: "/one" },
              { current_path: "/two/report.txt", source_root: "/two" },
            ],
            next_cursor: null,
          }) as any,
      }),
      /AMBIGUOUS/,
    );
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
test("probe is strict and Finder file references beat TIFF icons", () => {
  assert.equal(
    clipboardKind({ types: ["public.tiff"], changeCount: 1 }),
    "image",
  );
  for (const t of ["public.file-url", "NSFilenamesPboardType"])
    assert.throws(
      () => clipboardKind({ types: [t, "public.tiff"], changeCount: 1 }),
      /FILE_REFERENCE/,
    );
  assert.throws(() => parseProbe('{"types":[],"changeCount":1,"extra":true}'));
});
test(
  "text-only paste requires no capability; clipboard race refuses bytes",
  { skip: process.platform !== "darwin" },
  async () => {
    let authorize = 0,
      images = 0;
    const probe = { types: ["public.utf8-plain-text"], changeCount: 1 };
    const clipboard = () => ({
      getText: async () => "/open literal",
      getImage: async () => {
        images++;
        return new Uint8Array([1]);
      },
      setText: async () => {},
    });
    assert.deepEqual(
      await readClipboard(
        false,
        async () => {
          authorize++;
        },
        { probe: async () => probe, clipboard },
      ),
      { kind: "text", text: "/open literal" },
    );
    assert.equal(authorize, 0);
    assert.equal(images, 0);
    for (const failedImage of [null, undefined, new Uint8Array()]) {
      await assert.rejects(
        readClipboard(false, async () => {}, {
          probe: async () => ({ types: ["public.png"], changeCount: 1 }),
          clipboard: () => ({
            getImage: async () => failedImage,
            getText: async () => {
              throw Error("MUST_NOT_FALL_BACK_TO_TEXT");
            },
            setText: async () => {},
          }),
        }),
        /CLIPBOARD_IMAGE_UNAVAILABLE/,
      );
    }
    let n = 0;
    await assert.rejects(
      readClipboard(
        true,
        async () => {
          authorize++;
        },
        {
          probe: async () => ({ types: ["public.png"], changeCount: ++n }),
          clipboard,
        },
      ),
      /CHANGED/,
    );
  },
);
test("v3 immutable images persist and v2 migrates with backup; downgrade refuses", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "issue94-state-"));
  await fs.chmod(root, 0o700);
  const files = new LocalFiles(root);
  try {
    const state = freshState("d", "fixture");
    state.version = 2;
    await fs.writeFile(path.join(root, "state.json"), JSON.stringify(state), {
      mode: 0o600,
    });
    const loaded = await files.open("d", "fixture");
    assert.equal(loaded.version, 3);
    assert(
      (await fs.readdir(root)).some((f) => f.startsWith("v2-before-upgrade")),
    );
    loaded.drafts.Main.materials = [
      {
        id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        name: "a.png",
        created_at: new Date().toISOString(),
        status: "READY",
        attachment_id: "a",
      },
    ];
    const save = files.save(loaded);
    loaded.drafts.Main.materials[0].name = "mutated";
    await save;
    assert.equal(
      JSON.parse(await fs.readFile(path.join(root, "state.json"), "utf8"))
        .drafts.Main.materials[0].name,
      "a.png",
    );
    assert.throws(() => exportLegacyState(loaded), /HAS_IMAGES/);
  } finally {
    await files.close();
    await fs.rm(root, { recursive: true });
  }
});
for (const code of [
  ...MESSAGE_ADMISSION_REJECTIONS,
  "NETWORK_TIMEOUT",
  "REQUEST_CONFLICT",
])
  test("image send preserves materials on " + code, async () => {
    const state = freshState("d", "fixture");
    const recovered: any[] = [];
    const delivery = new Delivery(state, {
      save: async () => {},
      recover: async (p) => {
        recovered.push(structuredClone(p));
        return "recovery-test.json";
      },
    });
    const material = {
      id: "local-image",
      name: "a.png",
      created_at: new Date().toISOString(),
      status: "READY" as const,
      attachment_id: "attachment-a",
    };
    state.drafts.Main.materials = [material];
    let body: any;
    delivery.client = {
      endpoint: { instance_id: "instance" } as any,
      core: async () => ({}) as any,
      query: async (route: string) => {
        if (route === "core")
          return {
            capabilities: {
              attachments: {
                allowed: true,
                import_allowed: true,
                formats: ["image/png"],
                limits: ATTACHMENT_DEFAULTS,
              },
            },
          } as any;
        throw Error("NOT_FOUND");
      },
      command: async (_route, b) => {
        body = structuredClone(b);
        throw Error(code);
      },
      syncCursor: async () => ({ cursor: "c" }) as any,
      changes: async () => ({}) as any,
    };
    await delivery.submit("", "");
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(body.attachment_ids, ["attachment-a"]);
    assert.equal(body.text, "");
    if (MESSAGE_ADMISSION_REJECTIONS.includes(code)) {
      assert.equal(state.pending, undefined);
      assert.deepEqual(state.drafts.Main.materials, [material]);
      assert.equal(recovered.length, 1);
    } else {
      assert.equal(state.pending?.body.request_id, body.request_id);
      assert.deepEqual(state.pending?.materials, [material]);
    }
    await delivery.close();
  });
