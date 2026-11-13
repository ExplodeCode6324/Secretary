"""Validate inert source archive against pre-capture file hashes and link metadata."""
import hashlib
import json
import sys
import tarfile

with open(sys.argv[2]) as f:
    expected = json.load(f)
seen = set()
with tarfile.open(sys.argv[1], 'r:') as archive:
    for member in archive:
        name = member.name.removeprefix('./').rstrip('/')
        if name in ('', '.'):
            continue
        if name in seen or name not in expected['tree']:
            raise RuntimeError('ARCHIVE_UNEXPECTED_MEMBER')
        seen.add(name)
        meta = expected['tree'][name]
        if member.isfile() or member.islnk():
            h = hashlib.sha256()
            with archive.extractfile(member) as source:
                for b in iter(lambda: source.read(1024 * 1024), b''):
                    h.update(b)
            file = expected['files'][name]
            if (h.hexdigest(), member.size, member.mode & 0o777) != (file['sha256'], file['bytes'], file['mode']):
                raise RuntimeError('ARCHIVE_FILE_MISMATCH')
        elif member.issym():
            if meta['kind'] != 'symlink' or member.linkname != meta['target']:
                raise RuntimeError('ARCHIVE_LINK_MISMATCH')
        elif not member.isdir() or meta['kind'] != 'directory':
            raise RuntimeError('ARCHIVE_TYPE_MISMATCH')
if seen != set(expected['tree']):
    raise RuntimeError('ARCHIVE_MISSING_MEMBER')
print('ARCHIVE_VERIFIED')
