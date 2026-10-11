"""Opt-in, allowlisted ESM routes for the canonical authority and PR #75 input.

Integration must call install_module_routes explicitly. This does not expose the
repository as a static directory, start a server, or change the old 0.8.1 app.
"""
from pathlib import Path
import hashlib
from aiohttp import web

MODULES = (
    "services/vivo/contracts/validate.mjs",
    "research/vivo-phase-fabric/web/target-mailbox.mjs",
    "services/vivo/web/input/controller.mjs",
    "services/vivo/web/authority/lease-authority.mjs",
    "services/vivo/web/authority/grip-host.mjs",
)


def install_module_routes(app: web.Application, repository: Path) -> None:
    root = Path(repository).resolve(strict=True)
    checked = []
    # All paths validated before any routes are installed.
    for relative in MODULES:
        path = (root / relative).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("Module escapes repository: " + relative)
        checked.append((relative, path))
    for relative, path in checked:
        async def serve(request: web.Request, source=path) -> web.Response:
            data = source.read_bytes()
            return web.Response(body=data, content_type="text/javascript", headers={
                "Cache-Control": "no-cache",
                "X-Content-Type-Options": "nosniff",
                "ETag": '"' + hashlib.sha256(data).hexdigest() + '"',
            })
        app.router.add_get("/" + relative, serve)
