"""Hash-guarded source upgrade for Station v0.12. Stop the broker first.
Source-only rollback must preserve experience enforcement and reviewed reflection history and audit enforcement. Collective and organizational dependency events must never be silently downgraded.
No automatic database restore, schema migration, browser edits or provider calls.
"""
import argparse, hashlib, json, os, sqlite3, tempfile
from pathlib import Path
HERE = Path(__file__).resolve().parent
FIXED = {'station.py':'088a268e6c29f0c83503d99e02d9cc06327d570e371edf3eab01f1fbcbb68229',
         'memory_port.py':'2c3d07ae9e6ee8a4f3aa61fc01a458a2536876dab1f497c8c9a4896cfc93193f'}
BASE03 = {'continuity.py':'c950eecf26f9566afb690ee522513a7c2930c0eb82be11309558ad3e55efe11b','client.py':'8f264ace60a48606b81958ea58beda3a6d0f7bf10fbf0f335681db12a0a53c46','associative.py':None,'experience.py':None}
BASE04 = {'continuity.py':'14167bc9d7055a1c130f15d6b945fe74f6ebe9b782842f4bea91b355ab995e9d','client.py':'e84e995d35473327482969135a60e55e7bda3f30a55c5ae9496d697aad123ad5','associative.py':'fde9f0841cb6eaf0b6af662b4f8f11ecaadfedd3cb16fdacc0f00163f14aac9b','experience.py':None}
BASE05 = {'continuity.py':'14167bc9d7055a1c130f15d6b945fe74f6ebe9b782842f4bea91b355ab995e9d','client.py':'d61127e521313595762be5be45d63c973af5218930498e0d75b39f4d754542bc','associative.py':'a23ed73c582f2fd5468fe260eea65db431120b7f41290ed07195437c7ee83179','experience.py':None}
FINAL = {'continuity.py':'b5cd944c8be6da4d5ccae25ea05fd4884e5c930b44c191ebdd197a83cb0a6bf0','client.py':'1c60b2c26dc795d606ba158d323ae42bee51fcccef2e80750c0bc98282173bee','associative.py':'a23ed73c582f2fd5468fe260eea65db431120b7f41290ed07195437c7ee83179','experience.py':'e56336380aad340242cce5d53d2a41e98c063be555cac777339ba9b4286bdc9d'}
BASE06 = FINAL
BASES = (BASE03, BASE04, BASE05, BASE06)
for base in BASES:base['reflection.py']=None
BASE07 = {'continuity.py': 'b64e4c4d0498d9206ca671ac5082bcd6ec93f032b42e331a40297fa0989f70c8', 'client.py': '682be49f0eb6e9bd4c1900b4552037e1af88109d6cef6368ef579227e3a5d16b', 'associative.py': 'a23ed73c582f2fd5468fe260eea65db431120b7f41290ed07195437c7ee83179', 'experience.py': 'e56336380aad340242cce5d53d2a41e98c063be555cac777339ba9b4286bdc9d', 'reflection.py': '76db4e7caeaf765d119c3b96b087bc40de7f23f5bbfcba705d56f50d53412d88', 'metacognition.py': None}
for base in BASES:base['metacognition.py']=None
BASES = (*BASES, BASE07)
BASE08 = {'continuity.py': 'a84e5edb3c4d9c424117fa63bcab8d2e8271c2ad846a00dc7f9080afa3a1e8fd', 'client.py': '264857526fab7a29eb82d05e2d1094491826b0fb4249af3cb10cfd81996295b6', 'associative.py': 'a23ed73c582f2fd5468fe260eea65db431120b7f41290ed07195437c7ee83179', 'experience.py': 'e56336380aad340242cce5d53d2a41e98c063be555cac777339ba9b4286bdc9d', 'reflection.py': '76db4e7caeaf765d119c3b96b087bc40de7f23f5bbfcba705d56f50d53412d88', 'metacognition.py': '2b7a5546fcd81d45f718d2167bd929265ffdfb3dbba6475fc932959418a98f66', 'adaptive.py': None}
for base in BASES:base['adaptive.py']=None
BASES = (*BASES, BASE08)
BASE09 = {'continuity.py': '674c614d6acd63d1a13ea193460103f06a5c3cbea814b962b1aa4adc85c6748a', 'client.py': '8fd7c42d87bc322d7224ae59fab87cd9bf500a8b1d94eac0e22f3ad3616e16ac', 'associative.py': 'a23ed73c582f2fd5468fe260eea65db431120b7f41290ed07195437c7ee83179', 'experience.py': 'e56336380aad340242cce5d53d2a41e98c063be555cac777339ba9b4286bdc9d', 'reflection.py': '76db4e7caeaf765d119c3b96b087bc40de7f23f5bbfcba705d56f50d53412d88', 'metacognition.py': '42b5e402acc240dbfb919c47361fe77be1f3e0d3310fdab0c69090ac72fd1591', 'adaptive.py': '9f16fd0cf1142ae26a3307f2aef62170c297ecca35b4d2f981c3960ba39dfaa1', 'collective.py': None}
for base in BASES:base['collective.py']=None
BASES = (*BASES, BASE09)
BASE010 = {'continuity.py': 'f043e427a92d14361bc16c51c7927bb278132f0a94f46e565a237895f70b0f9f', 'client.py': '44b856b2491f845cc7606e8dc3b1cc45f52f9428ca5a5f88785ae13978ab06d3', 'associative.py': 'a23ed73c582f2fd5468fe260eea65db431120b7f41290ed07195437c7ee83179', 'experience.py': 'e56336380aad340242cce5d53d2a41e98c063be555cac777339ba9b4286bdc9d', 'reflection.py': '76db4e7caeaf765d119c3b96b087bc40de7f23f5bbfcba705d56f50d53412d88', 'metacognition.py': '42b5e402acc240dbfb919c47361fe77be1f3e0d3310fdab0c69090ac72fd1591', 'adaptive.py': '5efd40b9176c5275e0d5583194a9320eb7e194246b2f31efc99a24ca346e44c4', 'collective.py': 'ce1adf9b1e2b419c11324af7c65915bb180c5fbbc0ebb659d0560e236eaa42c4'}
for base in BASES:base['organization.py']=None
BASE010['organization.py']=None
BASES=(*BASES,BASE010)
FINAL = {'continuity.py': '6d95976fff05a35c3d100b79c91a3761b732db626dcf857ccfb74fb5ebdcc10c', 'client.py': 'ac49368d695f3d12d043c43a001f65d92c13a743e88d59e7d08cd3c6c17fc12b', 'associative.py': 'a23ed73c582f2fd5468fe260eea65db431120b7f41290ed07195437c7ee83179', 'experience.py': 'e56336380aad340242cce5d53d2a41e98c063be555cac777339ba9b4286bdc9d', 'reflection.py': '76db4e7caeaf765d119c3b96b087bc40de7f23f5bbfcba705d56f50d53412d88', 'metacognition.py': '42b5e402acc240dbfb919c47361fe77be1f3e0d3310fdab0c69090ac72fd1591', 'adaptive.py': '5efd40b9176c5275e0d5583194a9320eb7e194246b2f31efc99a24ca346e44c4', 'collective.py': 'bf0cbb2a04a7415d389b0365ad8e59289f768bca1ef70177efe5f02287bf8707', 'organization.py': 'a704f635d2f636cc88979eb854dbd7990e1171cb7a029c82bd95c72cc47d611c'}
BASE011 = dict(FINAL, **{'strategy.py': None})
for base in BASES:base['strategy.py']=None
BASES=(*BASES,BASE011)
FINAL = dict(BASE011, **{'continuity.py': 'b44f83ad6cf5bd06dc701cdffd6567dd76e73be609e7c5a0d1808a21356f6596', 'strategy.py': '6a9eae562acad89986882a2bcb48748cd77dc8e5a54072246cd0f88ac506d82a'})
BACKUP = 'native01n-v012-rollback'

def sha(b):return hashlib.sha256(b).hexdigest() if b is not None else None

def read(p):
    if p.is_symlink() or (p.exists() and not p.is_file()):raise ValueError('Unsupported source path: '+p.name)
    return p.read_bytes() if p.is_file() else None

def snapshot(root):return {n:read(root/n) for n in FINAL}
def hashes(data):return {n:sha(b) for n,b in data.items()}

def replace(p,b):
    if b is None:
        if p.exists():p.unlink()
        return
    fd,tmp=tempfile.mkstemp(prefix=p.name+'.',dir=p.parent)
    try:
        with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
        os.replace(tmp,p)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def validate_fixed(root):
    for n,h in FIXED.items():
        if sha(read(root/n))!=h:raise ValueError('Unsupported Station base: '+n)

def backup_original(root,original,before):
    backup=root/BACKUP
    if backup.is_symlink():raise ValueError('Unexpected rollback location')
    backup.mkdir(exist_ok=False)
    for n,b in original.items():
        if b is not None:replace(backup/n,b)
    replace(backup/'manifest.json',(json.dumps({'schema':'matumbo.station.source-rollback/2','before':before,'after':FINAL},indent=2)+'\n').encode())
    return backup

def guard_downgrade(root, dbs, source_only, before):
    """Operator must identify every configured Station DB. Read-only inspection
    is deliberately refused for a nonempty WAL or a hot rollback journal.
    This is not a process lock or discovery of databases outside the directory.
    """
    known={p.resolve() for p in root.iterdir() if p.is_file() and p.suffix.lower() in ('.db','.sqlite','.sqlite3')}
    if source_only:
        if dbs or known:raise ValueError('Source-only rollback refused: database present')
        return
    if not dbs:raise ValueError('Rollback requires all configured --database paths, or --source-only for a never-run disposable source directory')
    if any(Path(p).is_symlink() for p in dbs):raise ValueError('Unsupported database symlink')
    paths={Path(p).resolve(strict=True) for p in dbs}
    if not known <= paths:raise ValueError('List every Station database in this directory before rollback')
    for path in paths:
        if not path.is_file() or path.is_symlink():raise ValueError('Unsupported database path')
        for suffix in ('-wal','-journal'):
            sidecar=Path(str(path)+suffix)
            if sidecar.exists() and sidecar.stat().st_size:raise ValueError('Stop and consistently checkpoint the database before downgrade review')
        # Only inspect a stopped, checkpointed database. immutable avoids writing
        # journal/shm files, and is safe only under the explicit stopped precondition.
        db=sqlite3.connect(path.as_uri()+'?mode=ro&immutable=1',uri=True)
        try:
            tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not {'continuity_events','continuity_missions','principals'}<=tables:raise ValueError('Not a recognized Station database; refuse downgrade')
            if before != BASE011 and db.execute("SELECT 1 FROM continuity_events WHERE substr(kind,1,13)='organization_' LIMIT 1").fetchone():
                raise ValueError('Organization journal entries exist; downgrade would remove dependency enforcement. Preserve the database and all graph history.')
            if before not in (BASE010,BASE011) and db.execute("SELECT 1 FROM continuity_events WHERE substr(kind,1,11)='collective_' LIMIT 1").fetchone():
                raise ValueError('Collective journal entries exist; downgrade would remove required peer review. Preserve the database; restore a consistent pre-upgrade backup separately only with explicit authorization.')
            if before not in (BASE08, BASE09, BASE010, BASE011) and db.execute("SELECT 1 FROM continuity_events WHERE substr(kind,1,6)='audit_' LIMIT 1").fetchone():
                raise ValueError('Audit journal entries exist; downgrade would remove required verification. Preserve the database and restore a consistent pre-upgrade backup only with explicit authorization.')
            if before not in (BASE07, BASE08, BASE09, BASE010, BASE011) and db.execute("SELECT 1 FROM continuity_events WHERE substr(kind,1,11)='reflection_' LIMIT 1").fetchone():
                raise ValueError('Reflection journal entries exist; downgrade would hide reviewed history. Preserve database; restore a consistent pre-upgrade backup separately if explicitly authorized.')
            if before not in (BASE06, BASE07, BASE08, BASE09, BASE010, BASE011) and db.execute("SELECT 1 FROM continuity_events WHERE substr(kind,1,11)='experience_' LIMIT 1").fetchone():
                raise ValueError('Experience journal entries exist; source-only downgrade would remove enforcement. Preserve this database; restore a consistent pre-upgrade backup separately if explicitly authorized.')
        finally:db.close()

def restore(root,backup,current):
    if backup.is_symlink() or not backup.is_dir():raise ValueError('Rollback directory unavailable')
    manifest=json.loads(read(backup/'manifest.json'));before=manifest.get('before')
    if manifest.get('schema')!='matumbo.station.source-rollback/2' or before not in BASES or manifest.get('after')!=FINAL:raise ValueError('Unrecognized rollback manifest')
    original=snapshot(backup)
    if hashes(original)!=before:raise ValueError('Rollback source hash mismatch')
    now=hashes(current)
    if any(now[n] not in (before[n],FINAL[n]) for n in FINAL):raise ValueError('Unknown modified file; refuse rollback')
    if hashes(snapshot(root))!=now:raise ValueError('Source changed during rollback review')
    for n in FINAL:
        if now[n]!=before[n]:replace(root/n,original[n])
    if hashes(snapshot(root))!=before:raise RuntimeError('Rollback incomplete; preserve backup and inspect')
    print('Exact prior broker source restored. Rollback backup retained.')

def main(argv=None):
    parser=argparse.ArgumentParser();parser.add_argument('station_dir',type=Path);g=parser.add_mutually_exclusive_group();g.add_argument('--apply',action='store_true');g.add_argument('--rollback',action='store_true');parser.add_argument('--database',action='append',type=Path,default=[]);parser.add_argument('--source-only',action='store_true',help='Never-run disposable source directory only; not a live Station');a=parser.parse_args(argv)
    root=a.station_dir.resolve(strict=True)
    if root==HERE:raise ValueError('Choose installed Station directory, not this upgrade package')
    validate_fixed(root);original=snapshot(root);current=hashes(original)
    if a.rollback:
        backup=root/BACKUP
        if backup.is_symlink() or not backup.is_dir():raise ValueError('Rollback directory unavailable')
        manifest=json.loads(read(backup/'manifest.json'));before=manifest.get('before')
        if manifest.get('schema')!='matumbo.station.source-rollback/2' or before not in BASES or manifest.get('after')!=FINAL:raise ValueError('Unrecognized rollback manifest')
        guard_downgrade(root,a.database,a.source_only,before)
        return restore(root,backup,original)
    if a.database or a.source_only:raise ValueError('Database options are for rollback inspection only')
    payload=snapshot(HERE)
    if hashes(payload)!=FINAL:raise ValueError('Package source hash mismatch')
    for n,b in payload.items():compile(b,n,'exec')
    if current==FINAL:print('Exact v0.12 source already present; no changes.');return
    if current not in BASES:raise ValueError('Unknown or mixed source versions. No changes; inspect before upgrading.')
    print('Exact supported '+('v0.3' if current==BASE03 else 'v0.4' if current==BASE04 else 'v0.5' if current==BASE05 else 'v0.6' if current==BASE06 else 'v0.7' if current==BASE07 else 'v0.8' if current==BASE08 else 'v0.9' if current==BASE09 else 'v0.10' if current==BASE010 else 'v0.11')+' source confirmed. No UI or database migration.')
    if not a.apply:print('Dry run; no files changed.');return
    backup=backup_original(root,original,current)
    if hashes(snapshot(root))!=current:raise ValueError('Source changed during upgrade; backups retained')
    try:
        for n,b in payload.items():
            if current[n]!=FINAL[n]:replace(root/n,b)
        if hashes(snapshot(root))!=FINAL:raise RuntimeError('Installed source hash mismatch')
    except BaseException:
        # Broker must be stopped throughout this source-only apply. No new DB
        # events can be produced; restoring the original bytes is safe here.
        restore(root,backup,snapshot(root));raise
    print('v0.12 broker source installed and hash-verified. Rollback backup retained.')
if __name__=='__main__':
    try:main()
    except (OSError,ValueError,TypeError,RuntimeError,sqlite3.Error) as exc:raise SystemExit(str(exc)) from None
