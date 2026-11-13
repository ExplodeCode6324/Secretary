import { fail } from "./io.mjs";
export function requireFresh(preflight, now = Date.now()) {
  if (
    !preflight.capture_id ||
    !Number.isFinite(Date.parse(preflight.at)) ||
    now - Date.parse(preflight.at) < 0 ||
    now - Date.parse(preflight.at) > 300000
  )
    fail("STALE_PREFLIGHT");
}
export function classify(entries, inventory) {
  const allowed = new Set([
    "frozen",
    "operational",
    "logical_postgres",
    "socket_metadata",
  ]);
  for (const [root, names] of Object.entries(entries)) {
    if (!inventory[root] || names.some((n) => !allowed.has(inventory[root][n])))
      fail("UNCLASSIFIED_ENTRY");
    if (Object.keys(inventory[root]).some((n) => !names.includes(n)))
      fail("STALE_INVENTORY");
  }
  if (
    inventory.data.core !== "frozen" ||
    inventory.data.tui !== "frozen" ||
    inventory.data.postgres !== "logical_postgres" ||
    inventory.data.pgsocket !== "socket_metadata"
  )
    fail("UNSAFE_CLASSIFICATION");
  for (const [n, k] of Object.entries(inventory.data))
    if (k === "logical_postgres" && n !== "postgres")
      fail("UNSAFE_CLASSIFICATION");
}
export function assertIdle(g, now = Date.now()) {
  if (
    g.core?.mode !== "live" ||
    g.core?.state !== "IDLE" ||
    g.session?.state !== "IDLE" ||
    g.session?.recovery_error ||
    g.core.session_id !== g.session.id
  )
    fail("SESSION_NOT_IDLE");
  for (const name of ["tasks", "wakeups", "push-dispatches", "scopes"])
    if (!Array.isArray(g[name])) fail("INCOMPLETE_QUIESCENCE");
  if (
    g.tasks.some(
      (t) =>
        !Array.isArray(t.active_execution_ids) ||
        t.active_execution_ids.length ||
        !Array.isArray(t.active_executions) ||
        t.active_executions.length ||
        t.pending_request_count,
    )
  )
    fail("ACTIVE_TASKS");
  const imminent = (v) =>
    !v || !Number.isFinite(Date.parse(v)) || Date.parse(v) <= now + 300000;
  if (
    g.wakeups.some(
      (w) =>
        !["PENDING", "FIRED", "CANCELLED"].includes(w.state) ||
        (w.state === "PENDING" && imminent(w.at)),
    )
  )
    fail("IMMINENT_WAKEUP");
  if (
    g["push-dispatches"].some(
      (p) =>
        !["PENDING", "SENDING", "DISPATCHED", "FAILED", "CANCELLED"].includes(
          p.state,
        ) ||
        p.state === "SENDING" ||
        (["PENDING", "FAILED"].includes(p.state) &&
          imminent(p.next_attempt_at)),
    )
  )
    fail("ACTIVE_PUSH");
  if (g.scopes.length) fail("SCOPE_EXTERNAL_WRITERS_REQUIRE_REVIEW"); // Conservative: this version supports no registered external Scope roots.
  if (
    !g.settings ||
    g.settings.blocked !== false ||
    !Array.isArray(g.settings.applications) ||
    g.settings.applications.some(
      (a) =>
        !["APPLIED", "FAILED", "CANCELLED", "SUPERSEDED"].includes(a.state),
    )
  )
    fail("ACTIVE_SETTINGS");
  const m = g.memory;
  if (
    !m ||
    !["NOT_NEEDED", "COMMITTED", "SETTINGS_APPLIED", "FAILED"].includes(
      m.state,
    ) ||
    m.extraction_pending_count !== 0 ||
    (m.next_attempt_at && imminent(m.next_attempt_at))
  )
    fail("ACTIVE_MEMORY");
}
export function sameIdentity(before, after, restarted = false) {
  if (
    after.data_domain_id !== before.data_domain_id ||
    after.session_id !== before.session_id ||
    after.mode !== before.mode ||
    after.capabilities?.world?.state !== before.capabilities?.world?.state ||
    (restarted && after.instance_id === before.instance_id)
  )
    fail("RESTART_IDENTITY_MISMATCH");
}

export function startupCanMutate(command, started, markerTime) {
  if (
    /start-live\.ts|core-cli\.ts start|agile\.mjs start|npm (?:run )?start/.test(
      command,
    )
  )
    return true;
  return (
    /agile\.mjs ensure/.test(command) &&
    (markerTime === undefined ||
      !Number.isFinite(started) ||
      started <= Math.floor(markerTime / 1000) * 1000)
  );
}
export function assertNoFrozenWriters(listing, roots) {
  let pid = null,
    access = null;
  for (const line of listing.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    if (line.startsWith("f")) access = null;
    if (line.startsWith("a")) access = line.slice(1);
    if (
      line.startsWith("n") &&
      ["w", "u"].includes(access) &&
      roots.some(
        (root) =>
          line.slice(1) === root || line.slice(1).startsWith(root + "/"),
      )
    )
      fail("UNEXPECTED_FROZEN_WRITER");
  }
}
