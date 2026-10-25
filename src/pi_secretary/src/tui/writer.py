#!/usr/bin/python3
"""Sole TUI writer. Fixed owned subtree, immutable blobs, fsync then ACK.

No Core lock/journal access; EOF completes the current operation before exit.
Protocol uses base64 for bounded opaque payloads, not executable paths or code.
"""
import base64
import datetime
import fcntl
import hashlib
import heapq
import json
import os
import re
import signal
import stat
import sys

for sig in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM, signal.SIGTSTP):
    signal.signal(sig, signal.SIG_IGN)
os.umask(0o077)
MAX_LINE = 48 * 1024 * 1024
MAX_MANIFEST = 2 * 1024 * 1024
MAX_BLOB = 8 * 1024 * 1024
CACHE_LIMIT = 8 * 1024 * 1024
ID = re.compile(r"^[a-f0-9-]{36}$")
HEX = re.compile(r"^[a-f0-9]{64}$")
root = sys.argv[1]
quota = int(sys.argv[2])
if not os.path.isabs(root) or os.path.basename(root) != "tui-v1" or not 8 * 1024 * 1024 <= quota <= 1024 * 1024 * 1024:
    raise RuntimeError("INVALID_STATE_ROOT")
# Walk without following links. Ancestors may be system-owned, state itself may not.
part = os.path.sep
for component in root.split(os.path.sep)[1:-1]:
    part = os.path.join(part, component)
    info = os.lstat(part)
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise RuntimeError("UNSAFE_PARENT")
try:
    os.mkdir(root, 0o700)
    parent = os.open(os.path.dirname(root), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    os.fsync(parent)
    os.close(parent)
except FileExistsError:
    pass
info = os.lstat(root)
if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
    raise RuntimeError("UNSAFE_STATE_ROOT")
directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)


def regular(name, limit=None):
    info = os.stat(name, dir_fd=directory, follow_symlinks=False)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
        raise RuntimeError("UNSAFE_STATE_FILE")
    if limit is not None and info.st_size > limit:
        raise RuntimeError("STATE_FILE_TOO_LARGE")
    return info.st_size


lock = os.open("writer.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600, dir_fd=directory)
regular("writer.lock")
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.stderr.write("TUI_ALREADY_RUNNING: close/recover the existing client; no takeover\n")
    sys.exit(73)


def read(name, limit):
    regular(name, limit)
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    with os.fdopen(fd, "rb") as source:
        return source.read(limit + 1)


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf8")


def atomic(name, data, seq):
    temp = ".pending-%d-%d-%s" % (os.getpid(), seq, name)
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
    with os.fdopen(fd, "wb") as target:
        target.write(data)
        target.flush()
        os.fsync(target.fileno())
    os.rename(temp, name, src_dir_fd=directory, dst_dir_fd=directory)
    os.fsync(directory)


def names():
    return os.listdir(directory)


def usage():
    total = 0
    cache = 0
    for name in names():
        amount = regular(name)
        if name.startswith("cache-") or name == "view-checkpoint.json":
            cache += amount
        else:
            total += amount
    return total, cache


def references(value):
    found = {}
    def walk(item):
        if isinstance(item, dict):
            if "blob" in item:
                ident = item.get("blob")
                if not isinstance(ident, str) or not ID.fullmatch(ident) or not isinstance(item.get("sha256"), str) or not HEX.fullmatch(item["sha256"]) or not isinstance(item.get("bytes"), int):
                    raise RuntimeError("INVALID_BLOB_REFERENCE")
                if ident in found and found[ident] != item:
                    raise RuntimeError("CONFLICTING_BLOB_REFERENCE")
                found[ident] = item
            else:
                for child in item.values():
                    walk(child)
        elif isinstance(item, list):
            for child in item:
                walk(child)
    walk(value)
    return found


def blob_read(ref):
    raw = read("blob-" + ref["blob"], MAX_BLOB + 2048)
    header, payload = raw.split(b"\n", 1)
    meta = json.loads(header)
    if meta != ref or len(payload) != ref["bytes"] or hashlib.sha256(payload).hexdigest() != ref["sha256"]:
        raise RuntimeError("CORRUPT_BLOB")
    payload.decode("utf8", "strict")
    return payload


def expired(created, now):
    # Calendar years in Asia/Hong_Kong (fixed UTC+8), Feb 29 clamps to Feb 28.
    local = datetime.timezone(datetime.timedelta(hours=8))
    date = datetime.datetime.fromisoformat(created.replace("Z", "+00:00")).astimezone(local)
    try:
        deadline = date.replace(year=date.year + 3)
    except ValueError:
        deadline = date.replace(year=date.year + 3, day=28)
    return now.astimezone(local) >= deadline


def cleanup(manifest):
    active = references(manifest["data"])
    changed = False
    for ident in manifest.get("retired", []):
        if ident not in active and "blob-" + ident in names():
            regular("blob-" + ident, MAX_BLOB + 2048)
            os.unlink("blob-" + ident, dir_fd=directory)
            changed = True
    if changed:
        os.fsync(directory)


manifest = {"version": 1, "sequence": 0, "data": None, "retired": []}
verified = {}
if "manifest.json" in names():
    manifest = json.loads(read("manifest.json", MAX_MANIFEST))
    if manifest.get("version") != 1 or not isinstance(manifest.get("sequence"), int) or not isinstance(manifest.get("retired"), list) or any(not isinstance(i, str) or not ID.fullmatch(i) for i in manifest["retired"]):
        raise RuntimeError("CORRUPT_MANIFEST")
    for ref in references(manifest["data"]).values():
        blob_read(ref)
        verified[ref["blob"]] = ref
    cleanup(manifest)
usage()  # Reject unexpected links/files rather than following them.


def reply(value):
    try:
        sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
        sys.stdout.flush()
        return True
    except BrokenPipeError:
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        return False


if reply({"ready": True, "pid": os.getpid(), "manifest": manifest, "usage": usage()[0]}):
    while True:
        raw = sys.stdin.buffer.readline(MAX_LINE + 1)
        if not raw:
            break
        if len(raw) > MAX_LINE or not raw.endswith(b"\n"):
            reply({"error": "WRITER_PROTOCOL_BOUND"})
            break
        seq = None
        try:
            request = json.loads(raw)
            seq = request["id"]
            if not isinstance(seq, int) or seq < 1:
                raise RuntimeError("INVALID_REQUEST_ID")
            op = request["op"]
            if op == "read":
                payload = blob_read(request["ref"])
                response = {"id": seq, "base64": base64.b64encode(payload).decode("ascii")}
            elif op == "commit":
                if request["expected"] != manifest["sequence"]:
                    raise RuntimeError("STALE_MANIFEST")
                active = references(request["data"])
                old = references(manifest["data"])
                tickets = request.get("retire", {})
                if not isinstance(tickets, dict) or any(ident not in old or reason not in ("superseded", "discard", "handoff") for ident, reason in tickets.items()):
                    raise RuntimeError("INVALID_RETIREMENT")
                retired = list(set(manifest["retired"]) | set(tickets))
                # A reference returned by undo is live, so its old ticket cannot delete it.
                retired = [ident for ident in retired if ident not in active and "blob-" + ident in names()]
                next_manifest = {"version": 1, "sequence": manifest["sequence"] + 1, "data": request["data"], "retired": retired}
                body = json_bytes(next_manifest)
                if len(body) > MAX_MANIFEST:
                    raise RuntimeError("MANIFEST_TOO_LARGE")
                prepared = []
                supplied = {}
                for item in request.get("blobs", []):
                    ref = item["ref"]
                    references(ref)
                    if ref["blob"] in supplied or (ref["blob"] in active and active[ref["blob"]] != ref):
                        raise RuntimeError("CONFLICTING_BLOB_REFERENCE")
                    supplied[ref["blob"]] = ref
                    payload = base64.b64decode(item["base64"], validate=True)
                    if len(payload) > MAX_BLOB or len(payload) != ref["bytes"] or hashlib.sha256(payload).hexdigest() != ref["sha256"]:
                        raise RuntimeError("INVALID_BLOB")
                    payload.decode("utf8", "strict")
                    datetime.datetime.fromisoformat(ref["created_at"].replace("Z", "+00:00"))
                    name = "blob-" + ref["blob"]
                    if name in names():
                        blob_read(ref)
                    else:
                        prepared.append((name, json_bytes(ref) + b"\n" + payload))
                new_names = {name for name, _ in prepared}
                for ref in active.values():
                    if "blob-" + ref["blob"] not in new_names:
                        if verified.get(ref["blob"]) != ref:
                            blob_read(ref)
                            verified[ref["blob"]] = ref
                        else:
                            regular("blob-" + ref["blob"], MAX_BLOB + 2048)
                # Reserve old+new physical copies and handoff space; no quota eviction.
                if usage()[0] + sum(len(data) for _, data in prepared) + len(body) + MAX_MANIFEST + 65536 > quota:
                    raise RuntimeError("STAGING_QUOTA")
                for name, payload in prepared:
                    atomic(name, payload, seq)
                    verified[name[5:]] = supplied[name[5:]]
                atomic("manifest.json", body, seq)
                manifest = next_manifest
                cleanup(manifest)
                response = {"id": seq, "sequence": manifest["sequence"], "usage": usage()[0]}
            elif op == "checkpoint":
                body = json_bytes(request["value"])
                if len(body) > 65536:
                    raise RuntimeError("CHECKPOINT_TOO_LARGE")
                snapshot = base64.b64decode(request.get("snapshot", ""), validate=True)
                if len(snapshot) > 2 * 1024 * 1024:
                    raise RuntimeError("SNAPSHOT_TOO_LARGE")
                _, cache = usage()
                if cache + len(snapshot) + len(body) > CACHE_LIMIT:
                    raise RuntimeError("CACHE_QUOTA")
                # Two fixed slots: record is swapped only after the new snapshot is durable.
                current = json.loads(read("view-checkpoint.json", 65536)) if "view-checkpoint.json" in names() else {}
                slot = "cache-b" if current.get("snapshot") == "cache-a" else "cache-a"
                atomic(slot, snapshot, seq)
                value = dict(request["value"], snapshot=slot, snapshot_sha256=hashlib.sha256(snapshot).hexdigest())
                if len(json_bytes(value)) > 65536:
                    raise RuntimeError("CHECKPOINT_TOO_LARGE")
                atomic("view-checkpoint.json", json_bytes(value), seq)
                response = {"id": seq, "saved": True}
            elif op == "checkpoint-read":
                value = json.loads(read("view-checkpoint.json", 65536)) if "view-checkpoint.json" in names() else None
                snapshot = b""
                if value:
                    if value.get("snapshot") not in ("cache-a", "cache-b"):
                        raise RuntimeError("CORRUPT_CHECKPOINT")
                    snapshot = read(value["snapshot"], 2 * 1024 * 1024)
                    if hashlib.sha256(snapshot).hexdigest() != value["snapshot_sha256"]:
                        raise RuntimeError("CORRUPT_CHECKPOINT")
                response = {"id": seq, "value": value, "snapshot": base64.b64encode(snapshot).decode("ascii")}
            elif op == "receipts":
                after = request.get("after", "")
                if not isinstance(after, str) or (after and not ID.fullmatch(after)):
                    raise RuntimeError("INVALID_RECEIPT_CURSOR")
                def archived():
                    with os.scandir(directory) as entries:
                        for entry in entries:
                            name = entry.name
                            if not name.startswith("blob-") or not ID.fullmatch(name[5:]) or name[5:] <= after:
                                continue
                            regular(name, MAX_BLOB + 2048)
                            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
                            try:
                                with os.fdopen(fd, "rb") as source:
                                    header = source.readline(2048)
                                ref = json.loads(header)
                                if ref.get("kind") == "receipt":
                                    references(ref)
                                    yield ref
                            except (ValueError, KeyError):
                                continue  # Corrupt provenance is preserved, never deleted here.
                items = heapq.nsmallest(51, archived(), key=lambda ref: ref["blob"])
                response = {"id": seq, "items": items[:50], "next": items[49]["blob"] if len(items) > 50 else None}
            elif op == "collect":
                active = references(manifest["data"])
                now = datetime.datetime.now(datetime.timezone.utc)
                removed = 0
                for name in names():
                    if not name.startswith("blob-") or name[5:] in active:
                        continue
                    try:
                        raw_blob = read(name, MAX_BLOB + 2048)
                        meta = json.loads(raw_blob.split(b"\n", 1)[0])
                        blob_read(meta)
                        if not expired(meta["created_at"], now):
                            continue
                    except Exception:
                        continue  # Missing/corrupt provenance is protected, never guessed.
                    os.unlink(name, dir_fd=directory)
                    removed += 1
                if removed:
                    os.fsync(directory)
                response = {"id": seq, "removed": removed, "usage": usage()[0]}
            else:
                raise RuntimeError("UNKNOWN_WRITER_OPERATION")
        except Exception as error:
            response = {"id": seq, "error": str(error)[:200]}
        if not reply(response):
            break
os.close(lock)
os.close(directory)
