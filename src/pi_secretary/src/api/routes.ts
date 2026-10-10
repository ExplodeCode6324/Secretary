/** The only accepted write routes. Body schemas reject unknown authority fields. */
export const commands = [
  ["assistant/profile", "ProfileCommand"],
  ["clients", "ClientCommand"],
  ["messages", "MessageCommand"],
  ["task-requests", "TaskCommand"],
  ["task-requests/:id/cancel", "EmptyCommand"],
  ["executions/:id/cancel", "EmptyCommand"],
  ["executions/:id/viewed", "EmptyCommand"],
  ["decisions/:id/answer", "AnswerCommand"],
  ["authorizations/:id/decision", "ApprovalCommand"],
  ["settings/draft", "DraftCommand"],
  ["settings/apply", "RevisionCommand"],
  ["settings/applications/:id/retry", "EmptyCommand"],
  ["settings/applications/:id/restore-draft", "RevisionCommand"],
  ["session/compact", "EmptyCommand"],
  ["session/resume", "EmptyCommand"],
  ["memory/commitments/:id/resolve", "ResolveCommand"],
  ["memory/recovery", "RecoveryCommand"],
  ["operations/:id/verify-write", "EmptyCommand"],
  ["admin/world/migrate", "EmptyCommand"],
  ["admin/programs", "ProgramCommand"],
  ["admin/authorization-rules", "RuleCommand"],
  ["admin/authorization-rules/:id/disable", "RevisionCommand"],
  ["core/stop", "EmptyCommand"],
] as const;
export function commandRoute(path: string) {
  for (const [route, schema] of commands) {
    const match = new RegExp("^" + route.replace(":id", "([^/]+)") + "$").exec(
      path,
    );
    if (match) return { route, schema, target: match[1] };
  }
  return null;
}
