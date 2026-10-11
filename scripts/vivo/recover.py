#!/usr/bin/env python3
"""Restore exact conversation artifacts additively. Never overwrites changed files.

Run from a checkout of the frozen Vivo coordination branch. No network, git write,
credential request, application launch, or deployment is performed.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

SOURCES = {
    'build081': ('matumbo-viva-build-081-source.zip',
        '6c5b0338f413385fd34934ce290fcc3459a33788c1de7f763316a89061d34a72',
        'matumbo-viva-build-081', 'services/vivo'),
    'phase': ('viva-phase-fabric-research.zip',
        'adcda4383e98903a12711ceeaf6fef48ddfb60214e206a9f502339bdea50f278',
        'viva-phase-fabric', 'research/vivo-phase-fabric'),
}
MAX_TOTAL = 256 * 1024 * 1024


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def recover(workspace: Path, inputs: dict[str, Path], verify_only: bool = False):
    workspace = workspace.resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    inventory = []
    with tempfile.TemporaryDirectory(prefix='vivo-intake-') as temp:
        staging = Path(temp)
        for key, path in inputs.items():
            if key not in SOURCES:
                raise ValueError('Unknown source: ' + key)
            name, expected, prefix, destination = SOURCES[key]
            if sha256(path) != expected:
                raise ValueError('Artifact SHA-256 mismatch: ' + name)
            with zipfile.ZipFile(path) as z:
                if sum(i.file_size for i in z.infolist()) > MAX_TOTAL:
                    raise ValueError('Artifact exceeds uncompressed budget')
                seen = set()
                for info in z.infolist():
                    p = PurePosixPath(info.filename)
                    if (p.is_absolute() or '..' in p.parts or '\\' in info.filename
                            or not p.parts or p.parts[0] != prefix):
                        raise ValueError('Unsafe artifact member')
                    if info.is_dir():
                        continue
                    if len(p.parts) < 2 or stat.S_ISLNK(info.external_attr >> 16):
                        raise ValueError('Invalid artifact member')
                    relative = PurePosixPath(destination, *p.parts[1:]).as_posix()
                    if relative in seen:
                        raise ValueError('Duplicate artifact member')
                    seen.add(relative)
                    target = workspace / relative
                    if target.is_symlink() or any(parent.is_symlink() for parent in target.parents if parent != workspace):
                        raise ValueError('Refusing symlink destination')
                    if workspace not in target.resolve().parents:
                        raise ValueError('Destination escaped workspace')
                    data = z.read(info)
                    digest = hashlib.sha256(data).hexdigest()
                    if target.exists() and (not target.is_file() or sha256(target) != digest):
                        raise ValueError('Refusing to overwrite changed file: ' + relative)
                    if verify_only and not target.is_file():
                        raise ValueError('Missing recovered file: ' + relative)
                    staged = staging / relative
                    staged.parent.mkdir(parents=True, exist_ok=True)
                    staged.write_bytes(data)
                    inventory.append({'source': key, 'path': relative, 'sha256': digest, 'bytes': len(data)})
        # Both inputs validated before any destination source file is written.
        if not verify_only:
            for item in inventory:
                target = workspace / item['path']
                if not target.exists():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(staging / item['path'], target)
        return sorted(inventory, key=lambda item: item['path'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--workspace', type=Path, default=Path.cwd())
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    try:
        files = recover(args.workspace, {k: args.artifacts / value[0] for k, value in SOURCES.items()}, args.verify_only)
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        parser.exit(1, str(exc) + '\n')
    report = {'schema': 'vivo.recovery/1', 'files': files, 'count': len(files),
              'verified_archives': {k: value[1] for k, value in SOURCES.items()},
              'scope': 'Exact recovered inputs; no claim of integration or deployment'}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(('Verified' if args.verify_only else 'Recovered') + f' {len(files)} exact source/asset files; existing edits were not overwritten.')


if __name__ == '__main__':
    main()
