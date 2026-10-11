#!/usr/bin/env python3
"""Verify every original runtime/research member without network or Git writes."""
from __future__ import annotations
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path, PurePosixPath

EXPECTED_ARCHIVES = {
    'matumbo-viva-build-081-source.zip': {
        'sha256': '6c5b0338f413385fd34934ce290fcc3459a33788c1de7f763316a89061d34a72',
        'members': 109, 'destination': 'services/vivo/',
    },
    'viva-phase-fabric-research.zip': {
        'sha256': 'adcda4383e98903a12711ceeaf6fef48ddfb60214e206a9f502339bdea50f278',
        'members': 31, 'destination': 'research/vivo-phase-fabric/',
    },
}


def verify(workspace, manifest, expected_archives=None):
    root = Path(workspace).resolve()
    expected = EXPECTED_ARCHIVES if expected_archives is None else expected_archives
    if manifest.get('schema') != 'vivo.source-import/1':
        raise ValueError('Unsupported import manifest schema')
    if manifest.get('archives') != expected:
        raise ValueError('Archive identity/count/destination mismatch')
    files = manifest.get('files', [])
    if not isinstance(files, list):
        raise ValueError('Invalid member list')
    seen, counts, failures, verified = set(), Counter(), [], []
    for item in files:
        name, archive = item['path'], item['archive']
        p = PurePosixPath(name)
        if (archive not in expected or p.is_absolute() or '..' in p.parts
                or '\\' in name or str(p) != name
                or not name.startswith(expected[archive]['destination'])):
            raise ValueError('Unsafe or misplaced member: ' + name)
        if name in seen:
            raise ValueError('Duplicate member: ' + name)
        seen.add(name)
        counts[archive] += 1
        target = root / name
        if (target.is_symlink() or any(parent.is_symlink() for parent in target.parents
                                      if parent != root) or root not in target.resolve().parents):
            raise ValueError('Symlink or escaped member: ' + name)
        if not target.is_file():
            failures.append(name + ': missing')
            continue
        data = target.read_bytes()
        actual = {
            'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'gitBlob': hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest(),
        }
        if any(item.get(key) != value for key, value in actual.items()):
            failures.append(name + ': byte/hash mismatch')
        else:
            verified.append({'path': name, **actual})
    if counts != Counter({name: value['members'] for name, value in expected.items()}):
        raise ValueError('Incomplete archive member inventory: ' + str(dict(counts)))
    if failures:
        raise ValueError('Original source integrity failed: ' + '; '.join(failures))
    return {'schema': 'vivo.source-import-verification/1', 'ok': True,
            'count': len(verified), 'counts': dict(counts), 'files': verified,
            'scope': 'Original source bytes only; not mounted application or device acceptance'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    path = args.manifest or args.workspace / 'services/vivo/source-import.json'
    try:
        result = verify(args.workspace, json.loads(path.read_text()))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.exit(1, str(exc) + '\n')
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, indent=2) + '\n')
    print(f"Verified {result['count']} exact original members (109 runtime + 31 research)")


if __name__ == '__main__':
    main()
