import fs from "node:fs";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const report = {
  goal: request.parameters.goal,
  execution_id: request.execution_id,
  created_at: new Date().toISOString(),
  evidence: "This output was produced by the manually registered demo program.",
};
fs.writeFileSync("report.json", JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    summary: "Created report.json in the task workspace",
    report,
  }),
);
