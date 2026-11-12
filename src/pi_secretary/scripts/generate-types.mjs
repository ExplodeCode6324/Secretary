import { compile } from "json-schema-to-typescript";
import fs from "node:fs";
import { format } from "prettier";
const schema = JSON.parse(
  fs.readFileSync(
    new URL("../../../src/contracts/contracts.schema.json", import.meta.url),
  ),
);
// The canonical value schemas deliberately accept every JSON primitive as well as objects.
for (const name of ["WorldChange", "WorldFact"])
  schema.$defs[name].properties.value = {
    type: ["string", "number", "boolean", "null", "object", "array"],
  };
const scopeImports = await compile(
  {
    ...structuredClone(schema.$defs.ScopeImportParameters),
    title: "ScopeImportParameters",
    $defs: {
      ScopeImportProposal: structuredClone(schema.$defs.ScopeImportProposal),
    },
  },
  "ScopeImportParameters",
  { bannerComment: "", ignoreMinAndMaxItems: true },
);
fs.writeFileSync(
  new URL("../src/contracts.ts", import.meta.url),
  await format(
    (await compile(schema, "Contract", {
      bannerComment:
        "/* Generated from src/contracts/contracts.schema.json. Do not hand-edit. */",
      unreachableDefinitions: true,
      ignoreMinAndMaxItems: true,
    })) +
      "\n" +
      scopeImports +
      "\nexport type Contract = SecretaryDemoV1;\n",
    { parser: "typescript" },
  ),
);
