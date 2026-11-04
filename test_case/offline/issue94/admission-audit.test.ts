import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { MESSAGE_ADMISSION_REJECTIONS } from "../../../src/pi_secretary/src/tui/delivery.ts";
// Audit owning admission functions independently of the UI classification table.
// Store corruption/IO throws stay UNKNOWN; REQUEST_CONFLICT freezes identity.
const owners: Record<string, string[]> = {
  "main-loop": ["accept"],
  attachments: ["attachmentLimits", "attachmentBindings"],
  "attachment-form": ["attachmentContent", "attachmentDigest"],
  vision: ["visionProfile", "imageLeaves", "dimensions", "visionEstimate"],
  budget: [
    "integer",
    "ratio",
    "budgetConfig",
    "validCapacity",
    "requestTokens",
    "requestBudget",
    "assertRequestBudget",
  ],
};
test("new pre-admission error literals require an explicit delivery classification", () => {
  const found = new Set<string>();
  for (const [file, names] of Object.entries(owners)) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(`src/pi_secretary/src/${file}.ts`, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const name of names) {
      const fn = source.statements.find(
        (s) => ts.isFunctionDeclaration(s) && s.name?.text === name,
      );
      assert(fn, `${file}:${name} admission audit must follow moved owners`);
      for (const match of fn
        .getText(source)
        .matchAll(/(?:Error|failure)\(\s*["'`]([A-Z][A-Z0-9_]+)/g))
        found.add(match[1]);
    }
  }
  for (const code of found)
    assert(
      MESSAGE_ADMISSION_REJECTIONS.includes(code) ||
        code === "REQUEST_CONFLICT",
      `Unclassified admission code ${code}`,
    );
  assert(found.has("ATTACHMENT_TOO_LARGE"));
  assert(found.has("BUDGET_CONFIG_INVALID"));
});
