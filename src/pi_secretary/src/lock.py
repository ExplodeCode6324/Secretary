"""Sole journal writer: keep flock across recovery, append, fsync, and ACK.

The per-open mailbox is a synchronous transport, never an ownership token.
Stdin EOF ends this owner's lifetime. A future owner uses a different mailbox.
"""
import base64
import fcntl
import hashlib
import json
import os
import select
import sys
import uuid
from pathlib import Path


def sync_dir(directory):
    fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def reply(channel, value):
    temp = channel / "response.tmp"
    temp.write_text(json.dumps(value))
    os.replace(temp, channel / "response")


def decode_frame(line, sequence, previous):
    try:
        frame = json.loads(line)
        if not isinstance(frame, dict) or set(frame) != {"payload_b64", "sha256"}:
            raise ValueError("CORRUPT_FRAME")
        payload = base64.b64decode(frame["payload_b64"], validate=True)
        if base64.b64encode(payload).decode("ascii") != frame["payload_b64"]:
            raise ValueError("CORRUPT_BASE64")
        digest = hashlib.sha256(payload).hexdigest()
        if digest != frame["sha256"]:
            raise ValueError("CORRUPT_JOURNAL")
        txn = json.loads(payload)
        if txn["sequence"] != sequence + 1 or txn["previous_digest"] != previous:
            raise ValueError("CORRUPT_CHAIN")
        return txn["sequence"], digest
    except (KeyError, TypeError, UnicodeError) as error:
        raise ValueError("CORRUPT_FRAME") from error


def recover(directory):
    journal = directory / "journal.jsonl"
    data = journal.read_bytes() if journal.exists() else b""
    end = data.rfind(b"\n") + 1
    if end != len(data):
        quarantine = directory / ("journal.jsonl.incomplete-" + str(uuid.uuid4()))
        with quarantine.open("xb") as tail:
            tail.write(data[end:])
            tail.flush()
            os.fsync(tail.fileno())
        # Preserve incomplete bytes durably before removing them.
        sync_dir(directory)
        with journal.open("r+b") as file:
            file.truncate(end)
            file.flush()
            os.fsync(file.fileno())
        sync_dir(directory)
    data = data[:end]
    sequence, digest = 0, "0" * 64
    for line in data.splitlines():
        sequence, digest = decode_frame(line, sequence, digest)
    return data, sequence, digest


def serve(directory, channel):
    # This descriptor remains open until the helper has stopped writing.
    with (directory / "owner.lock").open("a") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            reply(channel, {"id": "open", "error": "OWNER_BUSY"})
            return
        request_id = "open"
        try:
            replay, sequence, digest = recover(directory)
            (channel / "replay").write_bytes(replay)
            reply(channel, {"id": "open", "digest": digest})
            while True:
                # Parent lifetime signal; no journal writes after observed EOF.
                readable, _, _ = select.select([sys.stdin.buffer], [], [], 0.001)
                if readable and not os.read(sys.stdin.fileno(), 4096):
                    return
                request_file = channel / "request"
                if not request_file.exists():
                    continue
                request = json.loads(request_file.read_bytes())
                request_file.unlink()
                request_id = request["id"]
                frame = request["frame"].encode("utf-8")
                if not frame.endswith(b"\n") or frame.count(b"\n") != 1:
                    raise ValueError("CORRUPT_FRAME")
                next_sequence, next_digest = decode_frame(frame, sequence, digest)
                if request["digest"] != next_digest:
                    raise ValueError("CORRUPT_JOURNAL")
                fd = os.open(directory / "journal.jsonl", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
                with os.fdopen(fd, "ab") as journal:
                    journal.write(frame)
                    journal.flush()
                    os.fsync(journal.fileno())
                sync_dir(directory)
                sequence, digest = next_sequence, next_digest
                reply(channel, {"id": request_id, "digest": digest})
        except Exception as error:
            # Any uncertain append or protocol error permanently ends ownership.
            reply(channel, {"id": request_id, "error": "CORRUPT_JOURNAL: " + str(error)})


if __name__ == "__main__":
    serve(Path(sys.argv[1]), Path(sys.argv[2]))
