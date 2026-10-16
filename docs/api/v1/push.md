# Core server push

Core sends new notifications to enabled NTFY, BARK or MACOS_NOTIFICATION targets. Delivery runs independently of the main model. `DISPATCHED` and `dispatched_at` mean the provider (or macOS notification interface) accepted the request. Client presentation and read receipts remain separate.

## Configure

All routes use the existing local-owner authentication and `/api/v1` prefix. Create with `POST /push-targets`:

```json
{
  "request_id": "11111111-1111-4111-8111-111111111111",
  "name": "Phone",
  "kind": "NTFY",
  "endpoint": "https://ntfy.sh",
  "enabled": false,
  "quiet_hours": {"timezone": "Asia/Hong_Kong", "start": "22:00", "end": "08:00"}
}
```

The accepted receipt identifies the target. Read it with `GET /push-targets/{id}`. Update with `POST /push-targets/{id}`, the same complete configuration, a new `request_id`, and `expected_revision` from the read DTO. Reusing a request with identical parameters returns its original receipt; different parameters return `REQUEST_CONFLICT`. A stale target revision returns `REVISION_CONFLICT`. The worker does not change target revision. Maximum 20 targets; disable targets that are not in use.

Endpoints must be exact HTTP(S) origins, such as `https://ntfy.example.com` or `https://api.day.app`, without a trailing slash, path prefix, query, fragment or userinfo. Reverse-proxy path prefixes are not supported. MACOS_NOTIFICATION requires `endpoint: null`. `quiet_hours: null` disables DND; otherwise specify an IANA timezone and distinct HH:mm start/end. Cross-midnight windows and daylight-saving changes follow local civil time.

Create disabled, install private configuration, then enable. Enabling starts a new generation at the configuration transaction sequence, excluding all older notifications. Disabling cancels pending deliveries. Re-enabling or changing kind/endpoint starts a new generation; name and quiet-hour changes retain pending deliveries. A request already in flight can still succeed after disable and is recorded as DISPATCHED; its failure is cancelled without retry.

## Private configuration

Secrets never enter API request bodies. A local administrator creates `push-secrets` under the Core data directory with mode 0700, and writes `<target UUID>.json` with mode 0600, owned by the Core user. Symlinks and insecure modes are rejected. Maximum file size is 8 KiB.

NTFY file content:

```json
{"topic":"replace-with-private-topic","token":"replace-with-access-token"}
```

The token is optional for servers that allow unauthenticated publishing. BARK content:

```json
{"device_key":"replace-with-device-key"}
```

Alternatively set `SECRETARY_PUSH_<UUID_IN_UPPERCASE_WITH_UNDERSCORES>` to the same JSON before starting Core. Environment configuration takes precedence over files. Credentials are read for every request. Rotate a file by atomically renaming a mode-0600 temporary file in the same directory; restart Core to refresh environment variables. **Disable the target before changing its topic/device key to a different destination, then enable it again.** This cancels old pending content instead of delivering it to the replacement destination.

Missing, malformed or unsafe credentials produce `SECRET_UNAVAILABLE`. Provider errors are fixed codes; response bodies, tokens and raw network exceptions are not saved. Endpoint/name/configuration are public owner-visible metadata, so keep keys out of these fields as well.

Push content travels through the configured server and may travel through Apple/Google delivery infrastructure. Public ntfy/Bark services receive the message preview. Prefer a self-hosted provider where suitable. HTTP sends credentials and preview in plaintext; use HTTPS for remote services. This implementation does not enable provider-specific content encryption.

Transport formats follow [ntfy JSON publishing](https://docs.ntfy.sh/publish/#publish-as-json) and [Bark POST /push](https://github.com/Finb/Bark/blob/master/docs/en-us/tutorial.md). ntfy sends topic/message/title plus optional Bearer token; Bark sends device_key/body/title. Only validated success responses count as acceptance. Redirects are rejected, responses are limited to 8 KiB, and attempts time out after 10 seconds. macOS uses the local osascript notification interface; system permissions and actual banner presentation remain OS behavior.

## Delivery and recovery

A notification committed before a process crash is reconciled on restart, even if its dispatch did not yet exist. Deterministic dispatch identity prevents duplicate records. Delivery is at least once: a crash after provider acceptance but before saving its result may cause a duplicate request.

Initial delivery plus three retries use delays of 30 seconds, 2 minutes and 10 minutes. The four-attempt budget includes interrupted attempts. If the fourth attempt is interrupted, FAILED/INTERRUPTED means delivery may have occurred but acceptance could not be persisted. Failed items remain queryable. Restart preserves the budget and rate accounting.

Each target permits at most three attempts per rolling minute, including failures. DND pauses attempts; once DND ends or a rate slot opens, queued items are merged in batches of up to 100. A retry retains its original batch membership. Each outbound summary contains at most 200 Unicode characters followed by a client-view hint. JSON notices expose only their text field, never metadata. Larger backlogs use subsequent rate slots. Core must be running; `settle` does not wait for future DND/retry deadlines.

## Read and synchronize

- `GET /push-targets` and `/push-targets/{id}` return configuration and revision.
- `GET /push-dispatches` supports `target_id`, `state`, `limit` (1–100, default 30), and `cursor`.
- `GET /push-dispatches/{id}` returns notification/target IDs, generation, batch ID, attempt history, next retry, fixed error code and acceptance time.
- Dispatch states: PENDING, SENDING, DISPATCHED, FAILED, CANCELLED. Filters bind pagination cursors.
- `sync/changes` and `sync/stream` include push-targets and push-dispatches resource changes and list invalidations.

Queries never send notifications or advance delivery. Failed dispatches can be displayed by a future frontend using this API. There is no automatic resend API for terminal failures.
