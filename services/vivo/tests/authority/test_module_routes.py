"""Real loopback HTTP module loading, not browser, camera, or public networking."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from aiohttp import web, ClientSession

ROOT = Path(__file__).resolve().parents[4]
SPEC = importlib.util.spec_from_file_location("vivo_module_routes", ROOT / "services/vivo/server/authority/module_routes.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ModuleRoutesTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.app = web.Application()
        MODULE.install_module_routes(self.app, ROOT)
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.base = "http://127.0.0.1:" + str(site._server.sockets[0].getsockname()[1])
        self.client = ClientSession()

    async def asyncTearDown(self):
        await self.client.close()
        await self.runner.cleanup()

    async def test_exact_bytes_and_mime_for_all_allowlisted_modules(self):
        for path in MODULE.MODULES:
            async with self.client.get(self.base + "/" + path) as r:
                self.assertEqual(r.status, 200)
                self.assertEqual(await r.read(), (ROOT / path).read_bytes())
                self.assertEqual(r.content_type, "text/javascript")
                self.assertEqual(r.headers["X-Content-Type-Options"], "nosniff")

    async def test_unlisted_sources_and_research_data_not_exposed(self):
        for path in ["services/vivo/server/app.py", "research/vivo-phase-fabric/data", ".git/config", "services/vivo/contracts/interfaces.d.ts"]:
            async with self.client.get(self.base + "/" + path) as r:
                self.assertEqual(r.status, 404)

    async def test_missing_dependency_fails_before_installing_any_route(self):
        with tempfile.TemporaryDirectory() as temp:
            app = web.Application()
            with self.assertRaises(FileNotFoundError):
                MODULE.install_module_routes(app, Path(temp))
            self.assertEqual(len(list(app.router.routes())), 0)

    async def test_external_symlink_refused(self):
        with tempfile.TemporaryDirectory() as temp, tempfile.TemporaryDirectory() as outside:
            root = Path(temp)
            for name in MODULE.MODULES:
                p = root / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text("export {};\n")
            p = root / MODULE.MODULES[0]
            p.unlink()
            external = Path(outside) / "secret"
            external.write_text("secret")
            p.symlink_to(external)
            app = web.Application()
            with self.assertRaisesRegex(ValueError, "escapes"):
                MODULE.install_module_routes(app, root)
            self.assertEqual(len(list(app.router.routes())), 0)


if __name__ == "__main__":
    unittest.main()
