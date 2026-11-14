"""Archive/verify an already stopped, controller-owned benchmark facility.

Never extracts, executes a checkpoint, follows a link, or starts PostgreSQL.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tarfile


def require(value, message):
    if not value:
        raise RuntimeError(message)


def regular_fd(filename):
    fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
    value = os.fstat(fd)
    if not stat.S_ISREG(value.st_mode) or value.st_nlink != 1:
        os.close(fd)
        raise RuntimeError("UNSAFE_ARCHIVE_FILE")
    return fd


def digest_file(stream):
    digest = hashlib.sha256()
    size = 0
    while True:
        block = stream.read(1024 * 1024)
        if not block:
            break
        digest.update(block)
        size += len(block)
    return size, digest.hexdigest()


def manifest(filename):
    with os.fdopen(regular_fd(filename), "r") as source:
        value = json.load(source)
    require(value["schema"] == "secretary-facility-archive-v1", "INVALID_ARCHIVE_MANIFEST")
    entries = value["entries"]
    names = set()
    for entry in entries:
        relative = entry["path"]
        require(relative and relative != "." and not relative.startswith("/") and ".." not in Path(relative).parts, "INVALID_ARCHIVE_PATH")
        require(relative not in names and entry["kind"] in ("file", "directory"), "INVALID_ARCHIVE_ENTRY")
        names.add(relative)
    return value


def create(value, filename):
    root = Path(value["source"])
    # Exclusive create: a failed attempt remains evidence and cannot overwrite an archive.
    fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(os.dup(fd), "wb") as output:
            with tarfile.open(fileobj=output, mode="w:gz", format=tarfile.PAX_FORMAT, compresslevel=6) as archive:
                info = tarfile.TarInfo("facility")
                info.type = tarfile.DIRTYPE
                info.mode = value["root_mode"]
                archive.addfile(info)
                for entry in value["entries"]:
                    source = root / entry["path"]
                    observed = os.lstat(source)
                    require(stat.S_IMODE(observed.st_mode) == entry["mode"], "ARCHIVE_SOURCE_MODE_CHANGED")
                    info = tarfile.TarInfo("facility/" + entry["path"])
                    info.mode = entry["mode"]
                    info.mtime = observed.st_mtime
                    if entry["kind"] == "directory":
                        require(stat.S_ISDIR(observed.st_mode), "ARCHIVE_SOURCE_TYPE_CHANGED")
                        info.type = tarfile.DIRTYPE
                        archive.addfile(info)
                    else:
                        with os.fdopen(regular_fd(source), "rb") as content:
                            require(os.fstat(content.fileno()).st_size == entry["bytes"], "ARCHIVE_SOURCE_SIZE_CHANGED")
                            info.size = entry["bytes"]
                            archive.addfile(info, content)
        os.fsync(fd)
    finally:
        os.close(fd)


def verify(value, filename):
    expected = {"facility/" + entry["path"]: entry for entry in value["entries"]}
    seen = set()
    root_seen = False
    with os.fdopen(regular_fd(filename), "rb") as source:
        with tarfile.open(fileobj=source, mode="r:gz") as archive:
            for info in archive:
                require(info.name not in seen, "DUPLICATE_ARCHIVE_ENTRY")
                seen.add(info.name)
                if info.name == "facility":
                    require(info.isdir() and info.mode == value["root_mode"], "INVALID_ARCHIVE_ROOT")
                    root_seen = True
                    continue
                require(info.name in expected, "EXTRA_ARCHIVE_ENTRY")
                entry = expected[info.name]
                require(info.mode == entry["mode"], "ARCHIVE_MODE_MISMATCH")
                if entry["kind"] == "directory":
                    require(info.isdir(), "ARCHIVE_TYPE_MISMATCH")
                else:
                    require(info.isfile() and info.size == entry["bytes"], "ARCHIVE_TYPE_OR_SIZE_MISMATCH")
                    stream = archive.extractfile(info)
                    require(stream is not None, "ARCHIVE_CONTENT_MISSING")
                    with stream:
                        size, digest = digest_file(stream)
                    require(size == entry["bytes"] and digest == entry["sha256"], "ARCHIVE_CONTENT_MISMATCH")
    require(root_seen and seen == set(expected) | {"facility"}, "ARCHIVE_INCOMPLETE")


if __name__ == "__main__":
    os.umask(0o077)
    command, manifest_path, archive_path = sys.argv[1:]
    value = manifest(manifest_path)
    if command == "create":
        create(value, archive_path)
    elif command != "verify":
        raise RuntimeError("INVALID_ARCHIVE_COMMAND")
    verify(value, archive_path)
    with os.fdopen(regular_fd(archive_path), "rb") as stream:
        archive_bytes, archive_sha256 = digest_file(stream)
    print(json.dumps({"verified": True, "entries": len(value["entries"]), "archive_sha256": archive_sha256, "archive_bytes": archive_bytes}))
