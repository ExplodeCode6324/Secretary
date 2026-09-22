import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const directory = path.resolve(process.env.SECRETARY_DATA ?? ".demo-data");
const token = fs
  .readFileSync(path.join(directory, "master.token"), "utf8")
  .trim();
const response = await fetch(
  `http://127.0.0.1:${process.env.PORT ?? 4317}/api/program`,
  {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Demo report generator",
      entrypoint: fileURLToPath(
        new URL("../examples/report.mjs", import.meta.url),
      ),
    }),
  },
);
if (!response.ok) throw Error(await response.text());
const result = (await response.json()) as { id: string };
console.log("Registered example program: " + result.id);
