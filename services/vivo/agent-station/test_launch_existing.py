"""Disposable startup checks; never access the owner's real files or credentials."""
import contextlib
import os
import signal
import json
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.request import Request, urlopen

import launch_existing as launch
from station import Station

HERE = Path(__file__).resolve().parent

class GuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.src = self.root / 'installed'; self.src.mkdir()
        for name in launch.FIXED | launch.FINAL:
            shutil.copyfile(HERE / name, self.src / name)
        self.db = self.root / 'private.sqlite'
        s = Station(self.db)
        self.owner = s.enroll('owner','fixture owner')
        self.host = s.enroll('host','fixture host','fixture-world')
        self.agent = s.enroll('agent','fixture agent','fixture-world',['world.read','mission.continue'])
        s.db.execute('PRAGMA wal_checkpoint(TRUNCATE)'); s.db.close()
        self.backup = self.root / 'backup.sqlite'; shutil.copyfile(self.db,self.backup)
        self.args = SimpleNamespace(station_dir=self.src, db=self.db, world='fixture-world',
                                    origin=launch.PUBLIC_ORIGIN, confirm_stopped=True,
                                    memory=None,memory_scope=None,memory_owner=None,probe_task=None,
                                    db_backup=None,memory_backup=None,start=False)
    def run_check(self):
        with patch.object(launch, 'port_free'):
            return launch.preflight(self.args)
    def mutate_db(self, sql, params=()):
        c=sqlite3.connect(self.db)
        c.execute(sql,params); c.commit();c.execute('PRAGMA wal_checkpoint(TRUNCATE)');c.close()
    def test_readonly_and_exact_source(self):
        before=self.db.read_bytes(); state=self.run_check()
        self.assertEqual(state[-1],{'enrolled_agents':1,'managed_missions':0})
        self.assertEqual(self.db.read_bytes(),before)
        self.assertTrue(all(launch.sha((self.src/n).read_bytes())==h for n,h in (launch.FIXED|launch.FINAL).items()))
    def test_missing_db_does_not_create(self):
        self.args.db=self.root/'missing.sqlite'
        with self.assertRaisesRegex(ValueError,'existing regular file'):self.run_check()
        self.assertFalse(self.args.db.exists())
    def test_changed_source_refused(self):
        (self.src/'strategy.py').write_text('# edited',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'source mismatch'):self.run_check()
    def test_wrong_world(self):
        self.args.world='other-world'
        with self.assertRaisesRegex(ValueError,'exact native world'):self.run_check()
    def test_no_owner(self):
        self.mutate_db("UPDATE principals SET active=0 WHERE role='owner'")
        with self.assertRaisesRegex(ValueError,'active enrolled owner'):self.run_check()
    def test_exact_origin(self):
        for bad in ('*','https://evil.example','https://carltheghost.github.io/path','https://carltheghost.github.io/','http://localhost:8765','http://127.0.0.1:8765/path','http://user@127.0.0.1:8765'):
            self.args.origin=bad
            with self.subTest(origin=bad),self.assertRaises(ValueError):self.run_check()
        self.args.origin='http://127.0.0.1:8765';self.run_check()
    def test_stop_confirmation(self):
        self.args.confirm_stopped=False
        with self.assertRaisesRegex(ValueError,'Stop the original'):self.run_check()
    def test_wal_refusal(self):
        Path(str(self.db)+'-wal').write_bytes(b'pending')
        with self.assertRaisesRegex(ValueError,'WAL/journal'):self.run_check()
    def test_unknown_schema(self):
        self.args.db=self.root/'unrelated.sqlite';c=sqlite3.connect(self.args.db);c.execute('CREATE TABLE unrelated(x)');c.close()
        with self.assertRaisesRegex(ValueError,'schema not recognized'):self.run_check()
    def test_start_requires_backup(self):
        self.args.start=True
        with self.assertRaisesRegex(ValueError,'verified stopped database backup'):self.run_check()
        self.args.db_backup=self.backup;self.run_check()
    def test_backup_must_be_distinct_and_exact(self):
        self.args.db_backup=self.db
        with self.assertRaisesRegex(ValueError,'distinct'):self.run_check()
        self.args.db_backup=self.backup;self.backup.write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError,'does not match'):self.run_check()
    def test_partial_apollo_refused(self):
        self.args.memory_scope='some-scope'
        with self.assertRaisesRegex(ValueError,'Apollo requires'):self.run_check()
    def test_active_grant_requires_binding(self):
        self.mutate_db('INSERT INTO mission_memory_grants VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ('g',self.agent['id'],'fixture-world','original-binding','task','fact','a'*64,'b'*64,time.time(),time.time()+600,0,0,None))
        with self.assertRaisesRegex(ValueError,'original exact Apollo binding'):self.run_check()
    def test_apollo_exact_binding_and_probe(self):
        from types import SimpleNamespace
        self.args.memory=self.root/'apollo.json';self.args.memory.write_text('{}',encoding='utf-8')
        self.args.memory_scope='fixture-scope';self.args.memory_owner='fixture-owner';self.args.probe_task='fixture-task'
        import hashlib
        binding=hashlib.sha256(json.dumps([str(self.args.memory.resolve()),self.args.world,self.args.memory_scope,self.args.memory_owner],ensure_ascii=True,separators=(',',':')).encode()).hexdigest()
        self.mutate_db('INSERT INTO mission_memory_grants VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ('g',self.agent['id'],'fixture-world',binding,'task','fact','a'*64,'b'*64,time.time(),time.time()+600,0,0,None))
        with patch('memory_port.ApolloMissionPort',return_value=SimpleNamespace(binding=binding,read=lambda task:{'id':'fact'} if task=='fixture-task' else None)):
            self.run_check()
            self.args.probe_task='missing'
            with self.assertRaisesRegex(ValueError,'probe task unavailable'):self.run_check()
            self.args.probe_task='fixture-task';self.args.start=True;self.args.db_backup=self.db
            with self.assertRaisesRegex(ValueError,'Apollo requires its verified stopped backup'):self.run_check()
        self.args.memory_owner='wrong-owner'
        with self.assertRaisesRegex(ValueError,'original exact Apollo binding'):self.run_check()
    def test_pending_edit_refused(self):
        s=Station(self.db);args={'worldId':'fixture-world','branchId':'b','eyeId':'e','spaceId':'s','entityId':'relic','baseRevision':0,'delta':[0,0,0]}
        # Construct a bounded already-authorized fixture action; no actual edit.
        s.db.execute('INSERT INTO actions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',('a',self.agent['id'],'fixture-world','r','vivo.world.edit',json.dumps(args),'f','queued',None,None,None,time.time(),time.time()));s.db.execute('PRAGMA wal_checkpoint(TRUNCATE)');s.db.close()
        with self.assertRaisesRegex(ValueError,'owner reconciliation'):self.run_check()
    def test_port_in_use(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));sock.listen()
            with self.assertRaisesRegex(ValueError,'port 18761'):launch.port_free(sock.getsockname()[1])
    def test_actual_start_existing_and_confirm_info(self):
        launch.port_free()
        cmd=[sys.executable,str(HERE/'launch_existing.py'),'--station-dir',str(self.src),'--db',str(self.db),'--world','fixture-world','--origin','http://127.0.0.1:8765','--confirm-stopped','--db-backup',str(self.backup),'--start']
        if os.name == 'nt':self.skipTest('foreground process-group smoke runs on Linux CI')
        p=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
        try:
            end=time.monotonic()+8;info=None
            while time.monotonic()<end and p.poll() is None:
                try:
                    with urlopen(Request('http://127.0.0.1:18761/v1/info',headers={'Authorization':'Bearer '+self.host['token']}),timeout=.5) as r:info=json.load(r)
                    break
                except OSError:time.sleep(.05)
            self.assertIsNotNone(info,'existing broker did not start');self.assertEqual(info['world'],'fixture-world');self.assertEqual(info['id'],self.host['id'])
        finally:
            with contextlib.suppress(ProcessLookupError):os.killpg(p.pid,signal.SIGTERM)
            output,_=p.communicate(timeout=4)
            self.assertNotIn(self.host['token'],output)
            self.assertNotIn(self.owner['token'],output)

if __name__=='__main__':unittest.main()
