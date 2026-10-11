"""Exact baseline/phase HTTP flows reused with explicit SQLite selection.

These are synthetic loopback checks on the running OS, not native Windows proof.
"""
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import test_entrypoint as baseline
import test_phase_entrypoint as phase


class SQLiteApplicationTests(baseline.MountedApplicationTests):
    store = 'sqlite'

    async def test_sqlite_metadata_private_files_and_volatile_legacy(self):
        async with self.http.get(self.base + '/readyz') as response:
            data = await response.json()
            self.assertEqual(data['capabilities']['persistence'], 'SQLite WAL/FULL exclusive checkpoint')
            self.assertEqual(data['legacyComparisonPersistence'], 'volatile memory')
            self.assertNotIn(str(self.directory), json.dumps(data))
        self.assertTrue(self.checkpoint_path().is_file())
        for name in ('comparison.sqlite', 'canonical-world.json', 'canonical-phase.sqlite'):
            self.assertFalse((self.directory / 'data' / name).exists())
        for suffix in ('', '-wal', '-shm', '-journal'):
            async with self.http.get(self.base + '/data/canonical-world.sqlite' + suffix) as response:
                self.assertEqual(response.status, 404)
        await self.stop()
        app = self.factory('memory-proof')
        self.assertEqual(app['hub'].store.db.execute('PRAGMA database_list').fetchall()[0][2], '')
        self.assertEqual(list((self.directory / 'memory-proof').iterdir()), [])
        app['hub'].store.db.close()


    async def test_actual_sql_commit_ambiguity_latches_http_readiness_503_and_restart_recovers(self):
        await self.stop()
        preload = self.directory / 'commit-fault.mjs'
        preload.write_text("""import {DatabaseSync} from 'node:sqlite';
const prepare=DatabaseSync.prototype.prepare, exec=DatabaseSync.prototype.exec;let armed=false;
DatabaseSync.prototype.prepare=function(sql){const statement=prepare.call(this,sql);
 if(sql.startsWith('UPDATE authority_checkpoint')){const run=statement.run;statement.run=function(...args){
  const result=run.apply(this,args);const record=JSON.parse(Buffer.from(args[1]).toString());
  armed=Object.values(record.state.eyes).some(e=>e.q[3]===.731);return result;};}return statement;};
DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);
 if(armed&&sql==='COMMIT'){armed=false;throw Object.assign(Error('ambiguous commit'),{errcode:10});}return result;};
""")
        from aiohttp import web
        with mock.patch.dict(os.environ, {'NODE_OPTIONS': '--import=' + preload.as_uri()}):
            app = self.factory('fault-latch')
            runner = web.AppRunner(app)
            await runner.setup()
        try:
            site = web.TCPSite(runner, '127.0.0.1', 0)
            await site.start()
            self.base = 'http://127.0.0.1:' + str(site._server.sockets[0].getsockname()[1])
            one = await self.open('one')
            eye = one['state']['eye']; eye['q'][3] = .731
            fault = await self.rpc(one, 'moveEye', {'view': eye, 'expectedRevision': eye['revision']}, expected=409)
            self.assertEqual(fault['error'], 'STORE_IO_UNCERTAIN')
            for _ in range(3):
                await asyncio.sleep(.3)
                async with self.http.get(self.base + '/readyz') as response:
                    self.assertEqual(response.status, 503)
                    status = await response.json()
                    self.assertFalse(status['ok'])
                    self.assertFalse(status['node'])
                    self.assertTrue(status['journal']['readOnly'])
                    self.assertEqual(status['journal']['fault'], 'STORE_IO_UNCERTAIN')
                denied = await self.rpc(one, 'state', expected=409)
                self.assertEqual(denied['error'], 'STORE_FAILED_CLOSED')
        finally:
            await runner.cleanup()
        # New process, no fault injector: recover the committed Eye exactly.
        app = self.factory('fault-latch')
        runner = web.AppRunner(app)
        await runner.setup()
        try:
            site = web.TCPSite(runner, '127.0.0.1', 0)
            await site.start()
            self.base = 'http://127.0.0.1:' + str(site._server.sockets[0].getsockname()[1])
            restored = await self.open('one')
            self.assertEqual(restored['state']['eye']['q'][3], .731)
        finally:
            await runner.cleanup()


class SQLitePhaseApplicationTests(phase.PhaseMountedApplicationTests):
    store = 'sqlite'

    async def test_phase_backend_metadata_and_separation(self):
        one = await self.open('one')
        self.assertEqual(one['state']['capabilities']['persistence'], 'SQLite WAL/FULL exclusive checkpoint')
        self.assertTrue(self.checkpoint_path(phase=True).is_file())
        for name in ('comparison.sqlite', 'canonical-world.sqlite', 'canonical-phase.json'):
            self.assertFalse((self.directory / 'data' / name).exists())


class SQLiteStartupPrivacyTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_directory_is_never_created_and_default_windows_still_refuses_before_writes(self):
        sys.path.insert(0, str(baseline.ROOT))
        from server.local_application import make_local_app
        with tempfile.TemporaryDirectory() as parent:
            missing = Path(parent) / 'missing'
            with self.assertRaisesRegex(ValueError, 'existing absolute private directory'):
                make_local_app(missing, store='sqlite')
            self.assertFalse(missing.exists())
            with mock.patch('server.local_application.sys.platform', 'win32'):
                with self.assertRaisesRegex(RuntimeError, 'no writes were started'):
                    make_local_app(missing)
            self.assertFalse(missing.exists())

    async def test_insecure_directory_rejected_by_node_before_canonical_or_comparison_writes(self):
        sys.path.insert(0, str(baseline.ROOT))
        from server.local_application import make_local_app
        with tempfile.TemporaryDirectory() as parent:
            directory = Path(parent) / 'public'
            directory.mkdir(mode=0o755)
            app = make_local_app(directory, store='sqlite')
            self.assertEqual(list(directory.iterdir()), [])
            self.assertEqual(app['hub'].store.db.execute('PRAGMA database_list').fetchall()[0][2], '')
            with self.assertRaises((ValueError, RuntimeError)):
                await app['local_bridge'].start()
            self.assertIsNotNone(app['local_bridge'].process.returncode)
            self.assertEqual(list(directory.iterdir()), [])
            app['hub'].store.db.close()

    async def test_checkout_directory_is_rejected_before_legacy_setup(self):
        sys.path.insert(0, str(baseline.ROOT))
        from server.local_application import make_local_app
        with mock.patch('server.local_application.make_app') as original:
            with self.assertRaisesRegex(ValueError, 'entire checkout'):
                make_local_app(baseline.ROOT, store='sqlite')
            original.assert_not_called()
