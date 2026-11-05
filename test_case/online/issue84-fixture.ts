import { randomUUID } from "node:crypto";

type Call = { name: string; args: object };

export function fixtureResponse(
  text: string,
  calls: Call[] = [],
  reasoning = "",
) {
  const id = "issue84-fixture-" + randomUUID();
  const chunk = (delta: object, finish_reason: string | null = null) => ({
    id,
    object: "chat.completion.chunk",
    model: "deepseek-flash",
    created: 1,
    choices: [{ index: 0, delta, finish_reason }],
  });
  const rows = [
    chunk({
      role: "assistant",
      content: text,
      reasoning_content: reasoning,
      ...(calls.length
        ? {
            tool_calls: calls.map(({ name, args }, index) => ({
              index,
              id: "call_" + randomUUID(),
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            })),
          }
        : {}),
    }),
    chunk({}, calls.length ? "tool_calls" : "stop"),
    {
      id,
      object: "chat.completion.chunk",
      choices: [],
      usage: { prompt_tokens: 500, completion_tokens: 60 },
    },
  ];
  return new Response(
    rows.map((row) => "data: " + JSON.stringify(row) + "\n\n").join("") +
      "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

type WireMessage = {
  role: string;
  content?: string | { text?: string }[];
  tool_calls?: { function: { name: string } }[];
};
const textOf = (message: WireMessage) =>
  typeof message.content === "string"
    ? message.content
    : (message.content?.map((part) => part.text ?? "").join(" ") ?? "");
const tool = (name: string, args: object): Call => ({ name, args });

export function scriptedFixture(
  role: "main" | "task",
  body: string,
  approvalScope?: string,
  redo?: object,
) {
  const { messages } = JSON.parse(body) as { messages: WireMessage[] };
  const system = messages
    .filter((message) => message.role === "system")
    .map(textOf)
    .join("\n");
  if (system.startsWith("COMMITMENT_EXTRACTION:"))
    return fixtureResponse('{"quotes":[]}');
  if (system.startsWith("CONSCIOUSNESS:"))
    return fixtureResponse(
      JSON.stringify({
        items: [
          {
            tier: "ACTIVE",
            summary: "Issue #84 synthetic rehearsal",
            goals: [],
            constraints: [],
            decisions: [],
            open_questions: [],
            unfulfilled_commitments: [],
            task_refs: [],
            pending_owner: null,
          },
        ],
      }),
    );
  const conversation = messages.filter((message) => message.role === "user");
  const prompt = conversation.map(textOf).join("\n");
  const last = messages.at(-1);
  if (role === "main") {
    if (redo) return fixtureResponse("", [tool("task_propose", redo)]);
    const label = textOf(conversation.at(-1) ?? { role: "" }).match(
      /84 (shared|question|approval|failure)/,
    )?.[1];
    if (last?.role === "user" && label) {
      const goals =
        label === "shared" ? ["SHARED-A", "SHARED-B"] : [label.toUpperCase()];
      return fixtureResponse(
        "",
        goals.map((goal) =>
          tool("task_propose", {
            scope_id: goal === "APPROVAL" ? approvalScope : null,
            goal: "ISSUE84-" + goal,
          }),
        ),
      );
    }
    return fixtureResponse("彩排回执。", [], "rehearsal context");
  }
  const label = prompt.match(
    /ISSUE84-(SHARED-A|SHARED-B|QUESTION|APPROVAL|FAILURE)/,
  )?.[1];
  const previousCalls = messages.flatMap(
    (message) => message.tool_calls?.map((call) => call.function.name) ?? [],
  );
  if (label === "QUESTION" && !previousCalls.includes("request_decision"))
    return fixtureResponse("", [
      tool("request_decision", { question: "彩排：请选择蓝色或绿色。" }),
    ]);
  const filename = label === "APPROVAL" ? "approval.txt" : "report.txt";
  if (label === "FAILURE" && !previousCalls.includes("read"))
    return fixtureResponse("", [tool("read", { path: "source.txt" })]);
  if (
    label &&
    label !== "QUESTION" &&
    label !== "FAILURE" &&
    !previousCalls.includes("write")
  )
    return fixtureResponse("", [
      tool("write", { path: filename, content: label + "\n" }),
    ]);
  const failureRead =
    label === "FAILURE" &&
    /error|ENOENT|no such file/i.test(textOf(last ?? { role: "" }));
  if (label === "FAILURE" && !failureRead && !previousCalls.includes("write"))
    return fixtureResponse("", [
      tool("write", { path: filename, content: "ISSUE84-REDO\n" }),
    ]);
  const failed =
    failureRead ||
    /"state"\s*:\s*"(REJECTED|FAILED)"/.test(textOf(last ?? { role: "" }));
  const artifacts =
    !failed && previousCalls.includes("write") ? [filename] : [];
  return fixtureResponse("", [
    tool("submit_result", {
      outcome: failed ? "FAILED" : "SUCCEEDED",
      summary: "彩排任务 " + label,
      criteria: [{ id: "C1", met: !failed, evidence: "彩排工具回执" }],
      artifacts,
      artifact_descriptions: artifacts.map((path) => ({
        path,
        description: "彩排产物",
      })),
      limitations: [],
    }),
  ]);
}
