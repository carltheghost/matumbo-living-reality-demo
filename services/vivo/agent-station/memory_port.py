"""Agent-native exact recall: individual, expiring evidence grants.

One explicitly configured single-owner Apollo store, one native world binding.
Never give a caller a path, free-text search, owner/scope selection or a raw
store handle. No memory contents are copied into Station's SQLite database.
"""
from pathlib import Path
import hashlib
import json
import secrets
import time

CAP = 'memory.mission.read'
MAX_GRANTS = 64
MAX_TTL = 24 * 60 * 60
MAX_READS = 256


def _id(value, limit=240):
    if (not isinstance(value, str) or not value.strip() or len(value) > limit
            or any(ord(c) < 32 or ord(c) == 127 for c in value)):
        raise ValueError('invalid memory reference')
    return value


def _sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


class ApolloMissionPort:
    """Resolve via the existing NATIVE-01 Apollo reader (not another store)."""
    def __init__(self, path, *, world, scope, owner):
        from apollo.hermes.vivo_mission import read_vivo_mission
        self.path = Path(path).resolve(strict=True)
        if not self.path.is_file():
            raise ValueError('existing Apollo memory file required')
        self.world, self.scope, self.owner = map(_id, (world, scope, owner))
        self.binding = _sha(json.dumps([str(self.path), self.world, self.scope, self.owner],
                                       ensure_ascii=True, separators=(',', ':')))
        self._reader = read_vivo_mission

    def read(self, task_id):
        task_id = _id(task_id)
        # Reader checks stored identity and exact digest, and refuses stale state.
        # Do not accept scope, owner, destination, or a Python module from an agent.
        record = self._reader(self.path, scope=self.scope, owner=self.owner, task_id=task_id)
        if record is None:
            return None
        body = record['evidenceJson']
        if (not isinstance(body, str) or len(body.encode('utf-8')) > 500_000
                or _sha(body) != record['evidenceSha256']
                or record['scope'] != self.scope or record['owner'] != self.owner
                or record['taskId'] != task_id or record['authentication'] != 'unverified'):
            raise ValueError('Apollo returned inconsistent evidence')
        p = record['provenance']
        if set(p) != {'source', 'artifact_sha256'}:
            raise ValueError('unexpected Apollo provenance')
        for value in (record['evidenceSha256'], p['artifact_sha256']):
            if not isinstance(value, str) or len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
                raise ValueError('invalid Apollo digest')
        return {k: record[k] for k in ('id', 'scope', 'owner', 'taskId', 'evidenceJson',
                                      'evidenceSha256', 'provenance', 'integrity', 'authentication')}


class MemoryGrants:
    """Persist grants, not a second copy of the evidence. Use Station's DB lock.

    Each route uses BEGIN IMMEDIATE and reauthenticates inside the transaction,
    so another cooperating broker cannot revoke between validation and read.
    Already delivered bytes cannot be recalled from an agent's context.
    """
    def __init__(self, station, source):
        self.station, self.source = station, source
        station.db.executescript('''
        CREATE TABLE IF NOT EXISTS mission_memory_grants(
          id TEXT PRIMARY KEY, agent TEXT NOT NULL REFERENCES principals(id),
          world TEXT NOT NULL, binding TEXT NOT NULL, task TEXT NOT NULL,
          fact TEXT NOT NULL, evidence_sha TEXT NOT NULL, artifact_sha TEXT NOT NULL,
          issued REAL NOT NULL, expires REAL NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
          reads INTEGER NOT NULL DEFAULT 0, last_read REAL);
        CREATE INDEX IF NOT EXISTS mission_memory_agent_idx
          ON mission_memory_grants(agent, world, binding, expires, revoked);
        ''')

    def available(self, principal):
        s = self.source
        return bool(s and (principal['role'] == 'owner' or (
            principal['role'] == 'agent' and principal['world'] == s.world
            and CAP in json.loads(principal['caps']))))

    def _eligible(self, row):
        return bool(row and row['role'] == 'agent' and row['active'] == 1 and self.available(row))

    def _summary(self, grant):
        return {k: grant[k] for k in ('id', 'agent', 'world', 'task', 'fact',
                 'evidence_sha', 'artifact_sha', 'issued', 'expires', 'revoked', 'reads', 'last_read')}

    def _read(self, task):
        try:
            return self.source.read(task)
        except (OSError, ValueError, KeyError, TypeError):
            # Never relay paths, arbitrary evidence or backend details to agents.
            raise PermissionError('mission evidence unavailable or changed') from None

    def _fields(self, body, expected):
        if set(body) != set(expected):
            raise ValueError('unexpected memory request fields')

    def _target(self, agent):
        p = self.station.db.execute('SELECT * FROM principals WHERE id=?', (_id(agent,64),)).fetchone()
        if not self._eligible(p):
            raise PermissionError('agent not eligible for this memory binding')
        return p

    @staticmethod
    def _pin(record):
        return {'fact': record['id'], 'evidence_sha': record['evidenceSha256'],
                'artifact_sha': record['provenance']['artifact_sha256']}

    def _active(self, grant, p, now):
        s = self.source
        return bool(grant and self._eligible(p) and grant['agent'] == p['id']
                    and grant['world'] == p['world'] == s.world and grant['binding'] == s.binding
                    and not grant['revoked'] and grant['expires'] > now and grant['reads'] < MAX_READS)

    def route(self, key, method, path, body):
        db = self.station.db
        db.execute('BEGIN IMMEDIATE')
        try:
            p = self.station.auth(key)
            result = self._route(p, method, path, body)
            db.execute('COMMIT')
            return result
        except BaseException:
            db.execute('ROLLBACK')
            raise

    def _route(self, p, method, path, body):
        db, s = self.station.db, self.source
        if not self.available(p):
            raise PermissionError('memory capability unavailable')
        now = time.time()
        role = p['role']
        if role == 'owner' and path == '/v1/owner/memory/preview' and method == 'POST':
            self._fields(body, ('agent', 'task'))
            agent = self._target(body['agent'])
            record = self._read(_id(body['task']))
            if not record:
                raise PermissionError('mission evidence unavailable or changed')
            return {'agent': agent['id'], 'world': s.world, 'task': record['taskId'],
                    **self._pin(record), 'evidenceJson': record['evidenceJson'],
                    'authentication': 'unverified'}
        if role == 'owner' and path == '/v1/owner/memory/grant' and method == 'POST':
            self._fields(body, ('agent', 'task', 'fact', 'evidence_sha', 'artifact_sha', 'ttl_seconds'))
            agent = self._target(body['agent'])
            ttl = body['ttl_seconds']
            if type(ttl) is not int or not 1 <= ttl <= MAX_TTL:
                raise ValueError('memory grant duration must be 1–86400 seconds')
            task = _id(body['task'])
            record = self._read(task)
            if not record or self._pin(record) != {k: body[k] for k in ('fact', 'evidence_sha', 'artifact_sha')}:
                raise PermissionError('preview is stale; review evidence again')
            existing = db.execute('''SELECT * FROM mission_memory_grants WHERE agent=? AND binding=?
                  AND task=? AND revoked=0 AND expires>? AND reads<? ORDER BY issued DESC''',
                  (agent['id'], s.binding, task, now, MAX_READS)).fetchall()
            for g in existing:
                if all(g[k] == body[k] for k in ('fact','evidence_sha','artifact_sha')):
                    return self._summary(g)  # no silent renewal or new disclosure
            count = db.execute('''SELECT count(*) FROM mission_memory_grants WHERE agent=?
                   AND binding=? AND revoked=0 AND expires>? AND reads<?''',
                   (agent['id'], s.binding, now, MAX_READS)).fetchone()[0]
            if count >= MAX_GRANTS:
                raise ValueError('active memory grant limit')
            gid = secrets.token_hex(16)
            now = time.time()
            db.execute('''INSERT INTO mission_memory_grants
                (id,agent,world,binding,task,fact,evidence_sha,artifact_sha,issued,expires)
                VALUES (?,?,?,?,?,?,?,?,?,?)''',
                (gid, agent['id'], s.world, s.binding, task, body['fact'], body['evidence_sha'],
                 body['artifact_sha'], now, now+ttl))
            return self._summary(db.execute('SELECT * FROM mission_memory_grants WHERE id=?', (gid,)).fetchone())
        if role == 'owner' and path == '/v1/owner/memory/grants' and method == 'GET':
            self._fields(body, ())
            return [self._summary(g) for g in db.execute('''SELECT * FROM mission_memory_grants
                     WHERE binding=? ORDER BY issued DESC LIMIT 256''', (s.binding,))]
        if role == 'owner' and path == '/v1/owner/memory/revoke' and method == 'POST':
            self._fields(body, ('id',))
            g = db.execute('SELECT * FROM mission_memory_grants WHERE id=? AND binding=?',
                           (_id(body['id'],64), s.binding)).fetchone()
            if not g:
                raise PermissionError('memory grant unavailable')
            db.execute('UPDATE mission_memory_grants SET revoked=1 WHERE id=?', (g['id'],))
            return {'id':g['id'], 'revoked':True}
        if role == 'agent' and path == '/v1/memory/list' and method == 'GET':
            self._fields(body, ())
            rows = db.execute('''SELECT * FROM mission_memory_grants WHERE agent=? AND world=?
                  AND binding=? AND revoked=0 AND expires>? AND reads<? ORDER BY issued DESC LIMIT 64''',
                  (p['id'], p['world'], s.binding, now, MAX_READS))
            return [self._summary(g) for g in rows]
        if role == 'agent' and path == '/v1/memory/read' and method == 'POST':
            self._fields(body, ('id',))
            g = db.execute('SELECT * FROM mission_memory_grants WHERE id=?', (_id(body['id'],64),)).fetchone()
            if not self._active(g,p,now):
                raise PermissionError('memory grant unavailable')
            record = self._read(g['task'])
            if not record or self._pin(record) != {k:g[k] for k in ('fact','evidence_sha','artifact_sha')}:
                raise PermissionError('mission evidence unavailable or changed')
            now = time.time()
            if not self._active(g,p,now):
                raise PermissionError('memory grant unavailable')
            db.execute('UPDATE mission_memory_grants SET reads=reads+1,last_read=? WHERE id=?', (now,g['id']))
            return {'grantId':g['id'], 'world':s.world, 'expiresAt':g['expires'],
                    'historical':True, 'authority':'evidence-only', 'fact':record}
        raise PermissionError('memory route not available to credential')
