/** The only accepted write routes. Body schemas reject unknown authority fields. */
export const commands = [
  ["assistant/profile", "ProfileCommand"],
  ["clients", "ClientCommand"],
  ["notifications/:id/presented", "PresentedCommand"],
  ["notifications/:id/read", "EmptyCommand"],
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
  ["memory/extraction/retry", "EmptyCommand"],
  ["operations/:id/verify-write", "EmptyCommand"],
  ["operations/:id/resolve", "OperationResolveCommand"],
  ["admin/world/migrate", "EmptyCommand"],
  ["admin/programs", "ProgramCommand"],
  ["admin/authorization-rules", "RuleCommand"],
  ["admin/authorization-rules/:id/disable", "RevisionCommand"],
  ["core/stop", "EmptyCommand"],
  ["scopes", "ScopeCreateCommand"],
  ["scopes/:id", "ScopeUpdateCommand"],
  ["scopes/:id/archive", "RevisionCommand"],
  ["wakeups/:id/cancel", "EmptyCommand"],
  ["push-targets", "PushTargetCreateCommand"],
  ["push-targets/:id", "PushTargetUpdateCommand"],
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
