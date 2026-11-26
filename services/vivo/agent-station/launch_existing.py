"""Owner-operated startup guard for the canonical v0.12 private broker.
Default is a read-only preflight; never enroll, create a store, upgrade source,
start a second broker, expose a network listener or silently choose a world.
"""
import argparse
from contextlib import closing
import hashlib
import json
import os
import socket
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit
from upgrade_v012 import FIXED, FINAL, read, sha

TABLES = {'principals', 'actions', 'tasks', 'presence', 'mission_memory_grants',
          'continuity_missions', 'continuity_events', 'continuity_lease_history',
          'continuity_observations', 'continuity_requests'}
PUBLIC_ORIGIN = 'https://carltheghost.github.io'


def require(ok, message):
    if not ok:
        raise ValueError(message)


def existing_file(path):
    p = Path(path)
    require(not p.is_symlink() and p.is_file(), 'An explicit existing regular file is required')
    return p.resolve(strict=True)


def fingerprint(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def verified_copy(original, backup):
    copy = existing_file(backup)
    require(not original.samefile(copy), 'Backup must be a distinct file, not the original or a hardlink')
    require(fingerprint(original) == fingerprint(copy), 'Stopped-store backup does not match current bytes')


def check_origin(value):
    # Preserve the existing browser origin; an origin is not a path or wildcard.
    p = urlsplit(value)
    require(p.scheme in ('http', 'https') and not p.username and not p.password
            and not p.path and not p.query and not p.fragment and value == f'{p.scheme}://{p.netloc}',
            'Enter an exact trusted browser origin, without a path or trailing slash')
    require(value == PUBLIC_ORIGIN or (p.hostname == '127.0.0.1' and p.scheme == 'http' and p.port is not None),
            'Only the canonical published HTTPS origin or explicit local 127.0.0.1 origin is supported')
    return value


def check_quiescent(db):
    for suffix in ('-wal', '-journal'):
        side = Path(str(db) + suffix)
        require(not side.is_symlink() and (not side.exists() or side.is_file() and side.stat().st_size == 0),
                'Nonempty WAL/journal or unsupported sidecar; stop and consistently checkpoint the existing broker')


def port_free(port=18761):
    # Best-effort only; the actual broker independently binds the same loopback port.
    with socket.socket() as s:
        if os.name != 'nt':
            # Match ThreadingHTTPServer's POSIX reuse behavior for TIME_WAIT,
            # while still rejecting an active listening process.
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(('127.0.0.1', port))
        except OSError as exc:
            raise ValueError('Station port 18761 is unavailable; inspect the existing process, do not start another') from exc


def preflight(a):
    root = a.station_dir.resolve(strict=True)
    require(root.is_dir(), 'Existing Station directory required')
    for name, digest in (FIXED | FINAL).items():
        require(sha(read(root / name)) == digest, 'Installed v0.12 source mismatch: ' + name + '; run exact upgrade guard first')
    origin = check_origin(a.origin)
    require(a.world and len(a.world) <= 240 and all(32 <= ord(c) != 127 for c in a.world), 'Exact enrolled native world ID required')
    require(a.confirm_stopped, 'Stop the original Station and any other writers first; then explicitly confirm --confirm-stopped')
    db = existing_file(a.db)
    check_quiescent(db)
    memory_values = (a.memory, a.memory_scope, a.memory_owner)
    require(not any(memory_values) or all(memory_values), 'Apollo requires existing memory file, exact scope and exact owner together')
    memory = existing_file(a.memory) if a.memory else None
    if memory:
        require(not db.samefile(memory), 'Station and Apollo must be separate existing stores')
        require(all(0 < len(x) <= 240 and all(32 <= ord(c) != 127 for c in x) for x in (a.memory_scope, a.memory_owner)), 'Invalid Apollo binding')
        binding = hashlib.sha256(json.dumps([str(memory), a.world, a.memory_scope, a.memory_owner], ensure_ascii=True, separators=(',', ':')).encode()).hexdigest()
    else:
        binding = None
    with closing(sqlite3.connect(db.as_uri() + '?mode=ro&immutable=1', uri=True)) as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        require(TABLES <= tables, 'Existing Station database schema not recognized')
        require(conn.execute('PRAGMA quick_check').fetchall() == [('ok',)], 'Existing Station database integrity check failed')
        require(conn.execute("SELECT count(*) FROM principals WHERE role='owner' AND active=1").fetchone()[0] >= 1, 'No active enrolled owner')
        require(conn.execute("SELECT count(*) FROM principals WHERE role='host' AND active=1 AND world=?", (a.world,)).fetchone()[0] == 1, 'No unique active host for this exact native world')
        # The existing broker stores one memory binding. Do not silently strand active grants.
        grants = conn.execute('''SELECT DISTINCT g.world,g.binding FROM mission_memory_grants g
            JOIN principals p ON p.id=g.agent WHERE g.revoked=0 AND g.expires>? AND g.reads<256 AND p.active=1''', (time.time(),)).fetchall()
        require(all(w == a.world and b == binding for w, b in grants), 'Active evidence grants require the original exact Apollo binding; reconcile before startup')
        pending = conn.execute("SELECT count(*) FROM actions WHERE status='running' OR (status='queued' AND tool='vivo.world.edit')").fetchone()[0]
        require(pending == 0, 'Running actions or queued world edits need owner reconciliation before startup')
        counts = {'enrolled_agents': conn.execute("SELECT count(*) FROM principals WHERE role='agent' AND active=1 AND world=?", (a.world,)).fetchone()[0],
                  'managed_missions': conn.execute('SELECT count(*) FROM continuity_missions WHERE world=?', (a.world,)).fetchone()[0]}
    if memory:
        # Use the original reader, not a replacement JSON parser. Probe exact task
        # only if provided; this verifies the local reader, not a browser grant.
        from memory_port import ApolloMissionPort
        port = ApolloMissionPort(memory, world=a.world, scope=a.memory_scope, owner=a.memory_owner)
        require(port.binding == binding, 'Apollo binding mismatch')
        if a.probe_task:
            require(port.read(a.probe_task) is not None, 'Exact Apollo probe task unavailable')
    else:
        require(not a.probe_task and not a.memory_backup, 'Apollo probe/backup requires the existing memory binding')
    require(not a.start or a.db_backup, 'Starting requires a verified stopped database backup')
    require(not (a.start and memory) or a.memory_backup, 'Starting with Apollo requires its verified stopped backup')
    if a.db_backup:
        verified_copy(db, a.db_backup)
    if a.memory_backup:
        verified_copy(memory, a.memory_backup)
    check_quiescent(db)
    port_free()
    return root, db, memory, origin, counts


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for k in ('station-dir', 'db'):
        parser.add_argument('--' + k, type=Path, required=True)
    parser.add_argument('--world', required=True)
    parser.add_argument('--origin', required=True)
    parser.add_argument('--confirm-stopped', action='store_true')
    for k in ('memory', 'db-backup', 'memory-backup'):
        parser.add_argument('--' + k, type=Path)
    for k in ('memory-scope', 'memory-owner', 'probe-task'):
        parser.add_argument('--' + k)
    parser.add_argument('--start', action='store_true', help='Explicit foreground start after successful preflight and backups')
    a = parser.parse_args(argv)
    root, db, memory, origin, counts = preflight(a)
    print(json.dumps({'source': 'verified_v0.12', 'existing_database': True,
                      'exact_host_enrollment': True, 'apollo_reader_configured': bool(memory),
                      'apollo_exact_probe_passed': bool(a.probe_task),
                      'browser_origin': origin, **counts,
                      'runtime_started': False, 'live_browser_verified': False}, indent=2), flush=True)
    if not a.start:
        return 0
    # No key on command line, no network bind beyond the existing loopback broker.
    # A successful preflight is not a lock: operator must keep other writers stopped.
    cmd = [sys.executable, str(root / 'station.py'), '--db', str(db), 'serve', '--origin', origin]
    if memory:
        cmd += ['--memory', str(memory), '--memory-world', a.world, '--memory-scope', a.memory_scope, '--memory-owner', a.memory_owner]
    print('Starting existing broker in foreground. Connect the original browser world; no live receipt is claimed yet.', flush=True)
    return subprocess.call(cmd, cwd=root)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, sqlite3.Error, ImportError) as exc:
        # Avoid leaking private filenames or underlying Apollo content on import errors.
        if isinstance(exc, (OSError, sqlite3.Error, ImportError)):
            raise SystemExit('Preflight refused: local file, database or original Apollo reader unavailable. Inspect locally.') from None
        raise SystemExit(str(exc)) from None
