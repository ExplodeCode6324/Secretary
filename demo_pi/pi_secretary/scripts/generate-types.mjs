import { compile } from "json-schema-to-typescript";
import fs from "node:fs";
const schema = JSON.parse(
  fs.readFileSync(
    new URL("../../../json/contracts.schema.json", import.meta.url),
  ),
);
// The canonical value schemas deliberately accept every JSON primitive as well as objects.
for (const name of ["WorldChange", "WorldFact"])
  schema.$defs[name].properties.value = {
    type: ["string", "number", "boolean", "null", "object", "array"],
  };
fs.writeFileSync(
  new URL("../src/contracts.ts", import.meta.url),
  (await compile(schema, "Contract", {
    bannerComment:
      "/* Generated from json/contracts.schema.json. Do not hand-edit. */",
    unreachableDefinitions: true,
    ignoreMinAndMaxItems: true,
  })) + "\nexport type Contract = SecretaryDemoV1;\n",
);
