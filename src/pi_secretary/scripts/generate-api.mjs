import fs from "node:fs";
import { format } from "prettier";
import { compile } from "json-schema-to-typescript";
const schema = JSON.parse(
  fs.readFileSync(new URL("../../../docs/api/v1/schema.json", import.meta.url)),
);
// unreachableDefinitions is only visited for object schemas by the generator;
// the wire schema's oneOf root silently dropped most public DTOs. Compile an
// object namespace containing every definition and the unchanged ApiV1 root.
// This wrapper exists only during code generation, never in the wire schema.
const { $defs, ...apiV1 } = schema;
const namespace = {
  type: "object",
  additionalProperties: false,
  $defs: { ApiV1: apiV1, ...$defs },
};
fs.writeFileSync(
  new URL("../src/api/contracts.ts", import.meta.url),
  await format(
    await compile(namespace, "ApiV1Definitions", {
      unreachableDefinitions: true,
      ignoreMinAndMaxItems: true,
      bannerComment:
        "/* Generated from docs/api/v1/schema.json. Do not hand-edit. */",
    }),
    { parser: "typescript" },
  ),
);
const operations = JSON.parse(
  fs.readFileSync(
    new URL("../../../docs/api/v1/operations.json", import.meta.url),
  ),
);
const paths = {};
for (const operation of operations) {
  const response =
    operation.response === "binary"
      ? { type: "string", format: "binary" }
      : {
          type: "object",
          required: ["api_version", "data"],
          properties: {
            api_version: { const: "1" },
            data: { $ref: "./schema.json#/$defs/" + operation.response },
          },
        };
  (paths[operation.path] ??= {})[operation.method.toLowerCase()] = {
    operationId:
      operation.method.toLowerCase() +
      "_" +
      operation.path.replace(/[^a-z0-9]/gi, "_"),
    security: [{ localOwner: [] }],
    parameters: [
      ...(operation.path.includes("{id}")
        ? [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ]
        : []),
      ...(operation.parameters ?? []),
    ],
    ...(operation.request
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "./schema.json#/$defs/" + operation.request },
              },
            },
          },
        }
      : {}),
    responses: {
      [operation.status]: {
        description: "Accepted command receipt or read model",
        content: {
          [operation.response === "binary"
            ? "application/octet-stream"
            : "application/json"]: { schema: response },
        },
      },
      default: {
        description: "Stable error code; see README",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                api_version: { const: "1" },
                error: { $ref: "./schema.json#/$defs/Error" },
              },
            },
          },
        },
      },
    },
  };
}
fs.writeFileSync(
  new URL("../../../docs/api/v1/openapi.json", import.meta.url),
  JSON.stringify(
    {
      openapi: "3.1.0",
      info: { title: "Secretary Core local owner API", version: "1.0.0" },
      servers: [
        {
          url: "http://127.0.0.1:{port}",
          variables: { port: { default: "0" } },
        },
      ],
      components: {
        securitySchemes: { localOwner: { type: "http", scheme: "bearer" } },
      },
      paths,
    },
    null,
    2,
  ) + "\n",
);
