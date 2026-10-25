"""Assemble the existing Vivo browser runtime without replacing its engines.

This is release assembly, not a claim that server/native features work on Pages.
Run only from a reviewed repository checkout. Nothing is merged or deployed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path

RUNTIME_BASE = "1da8a2f81aaebd529e1129d4cfd147d7a98ab157"
RELEASE = "2026.10.22"
PHONE = Path("services/vivo/web/phone")
SCOPES = (Path("services/vivo/web"), Path("services/vivo/contracts"),
          Path("research/vivo-phase-fabric/web"))
EXCLUDED_SUFFIXES = {".ttf", ".otf", ".woff", ".woff2", ".pyc", ".pyo", ".pem", ".key", ".env", ".p12", ".pfx"}
EXCLUDED_PARTS = {".git", "__pycache__", "node_modules", ".venv", ".env"}
REQUIRED = ("index.html", "bootstrap.mjs", "static-shared.js", "companion.mjs",
            "engine-worker.mjs", "engine.mjs", "storage.mjs", "field-world.mjs",
            "material-input-runtime.mjs", "two-hand-camera.mjs", "economy-entry.mjs")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def assemble(source: Path, out: Path, commit: str) -> dict:
    source, out = source.resolve(), out.resolve()
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("A full source commit SHA is required")
    if source == out or out.is_relative_to(source) or source.is_relative_to(out):
        raise ValueError("Output must be separate from the source checkout")
    if out.exists():
        raise FileExistsError("Refusing to overwrite an existing release directory")
    for filename in REQUIRED:
        if not (source / PHONE / filename).is_file():
            raise FileNotFoundError(str(PHONE / filename))
    original = (source / PHONE / "index.html").read_text(encoding="utf-8")
    if any(value not in original for value in ("./static-shared.js", "./bootstrap.mjs", "./companion.mjs")):
        raise ValueError("Canonical phone entry imports have changed; review the builder")
    if "Choose original Field Lab" in original:
        raise ValueError("Refusing to package the legacy file-picker launcher as the new app")
    inventory, omitted = {}, []
    selected = []
    for scope in SCOPES:
        folder = source / scope
        if not folder.is_dir():
            raise FileNotFoundError(str(scope))
        for path in sorted(folder.rglob("*")):
            relative = path.relative_to(source)
            if path.is_symlink():
                raise ValueError("Refusing runtime symlink: " + str(relative))
            if not path.is_file():
                continue
            if EXCLUDED_PARTS.intersection(relative.parts) or path.suffix.lower() in EXCLUDED_SUFFIXES or path.name.startswith(".env"):
                omitted.append(relative.as_posix())
                continue
            selected.append((path, relative))
    if (source / "LICENSE").is_file():
        selected.append((source / "LICENSE", Path("LICENSE")))
    out.mkdir(parents=True)
    for path, relative in selected:
        data = path.read_bytes()
        target = out / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        inventory[relative.as_posix()] = {"bytes": len(data), "sha256": sha(data), "provenance": "unchanged-source"}
    # Alias contains the actual canonical application markup, not an iframe or new engine.
    alias = original.replace("<title>Vivo World · Local field</title>",
                             "<title>maTumbo Field Lab · Unified " + RELEASE + "</title>")
    alias = alias.replace("</head>", '<meta name="vivo-release" content="' + RELEASE +
                          '"><meta name="vivo-source-commit" content="' + commit + '">\n</head>', 1)
    alias_path = out / PHONE / "field-lab-unified.html"
    alias_path.write_text(alias, encoding="utf-8")
    # Cache the new alias while keeping the same scope/storage and the original entry bytes.
    sw_path = out / "services/vivo/web/vivo-sw.js"
    sw = sw_path.read_text(encoding="utf-8")
    sw, cache_count = re.subn(r"const SHELL_CACHE = '[^']+';",
                            "const SHELL_CACHE = 'vivo-phone-shell-unified-" + commit[:12] + "';", sw, count=1)
    if cache_count != 1 or "'phone/index.html'" not in sw:
        raise ValueError("Service-worker shell contract changed; review the builder")
    sw = sw.replace("'phone/index.html'", "'phone/field-lab-unified.html', 'phone/index.html'", 1)
    sw_path.write_text(sw, encoding="utf-8")
    for relative in (PHONE / "field-lab-unified.html", Path("services/vivo/web/vivo-sw.js")):
        data = (out / relative).read_bytes()
        entry = {"bytes": len(data), "sha256": sha(data), "provenance": "release-assembly"}
        if relative.as_posix() in inventory:
            entry["sourceSha256"] = inventory[relative.as_posix()]["sha256"]
        inventory[relative.as_posix()] = entry
    # Root convenience entry is deliberately separate from the actual app file.
    route = "services/vivo/web/phone/field-lab-unified.html"
    entry = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open maTumbo Field Lab</title><style>body{font:17px/1.6 system-ui;max-width:680px;margin:8vh auto;padding:24px;background:#07121d;color:#e4f5ee}a{color:#90e7d4}code{overflow-wrap:anywhere}</style><h1>maTumbo Field Lab</h1><p id="message">Open the complete local browser build. No old Field Lab HTML is required.</p><p><a id="open" href="ROUTE">Enter the packaged Field Lab</a></p><div id="fileHelp" hidden><p>A downloaded file preview cannot run this multi-file Worker application reliably. Extract the package and run <code>python serve.py</code> on a computer, or use the already hosted phone app below. Camera and device features require a supported secure browser.</p><a href="https://carltheghost.github.io/matumbo-living-reality-demo/services/vivo/web/phone/">Open the existing hosted Vivo phone app</a><p>This link opens the existing deployment, not an unpublished replacement.</p></div><script>if(location.protocol==='http:'||location.protocol==='https:'){location.replace(new URL('ROUTE',location.href).href+location.search+location.hash);}else{document.getElementById('fileHelp').hidden=false;document.getElementById('open').hidden=true;}</script></html>'''.replace("ROUTE", route)
    (out / "Field-Lab.html").write_text(entry, encoding="utf-8")
    (out / "serve.py").write_text('''"""Serve this static browser package locally; no shared authority is started."""\nfrom http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler\nfrom functools import partial\nfrom pathlib import Path\nimport webbrowser\nROOT = Path(__file__).resolve().parent\nif __name__ == "__main__":\n    url = "http://127.0.0.1:8768/Field-Lab.html"\n    with ThreadingHTTPServer(("127.0.0.1", 8768), partial(SimpleHTTPRequestHandler, directory=str(ROOT))) as server:\n        print(url, flush=True)\n        webbrowser.open(url)\n        try: server.serve_forever()\n        except KeyboardInterrupt: pass\n''', encoding="utf-8")
    (out / "START-WINDOWS.bat").write_text('@echo off\r\ncd /d "%~dp0"\r\npy -3 serve.py\r\npause\r\n', encoding="utf-8")
    (out / "README.txt").write_text(f'''maTumbo Field Lab Unified {RELEASE}\nSource checkout: {commit}\nRuntime base: {RUNTIME_BASE}\n\nThis package assembles the existing browser implementation; it does not invent a new authority, material solver, AI model, or shared-state migration. The real app is {route}. The root Field-Lab.html is only its convenience entry. No original v0.4 HTML file is needed.\n\nUse HTTPS hosting, or extract the ZIP and run python serve.py. On Windows use START-WINDOWS.bat with Python 3 installed. The helper binds only to 127.0.0.1. A phone file preview is not a supported installation. The existing hosted phone app is https://carltheghost.github.io/matumbo-living-reality-demo/services/vivo/web/phone/ . That remains the existing deployment until an authorized release is made.\n\nIncluded: all selected browser runtime files, phone-local worker engine, field/atlas/material controls, nested worlds, Eyes, touch/hand modules, recording controls, offline shell and local TUMBO-SIM economy modules. Existing source code and tests are retained. The manifest identifies copied versus release-generated bytes.\n\nLimits: file presence is not end-to-end verification. Shared authority/server, Android-native permissions, AR/VR/casting and external agents require their actual backend/device/permissions. TUMBO-SIM is a local simulation, not real funds. No live market or wallet is connected by this package. Raw camera frames are not uploaded by the packaging process.\n\nSaves: this release does not clear storage, import or overwrite your legacy worlds. Browser storage is tied to its origin. A different host/port cannot read the old host's saves. Keep originals/backups. Legacy v0.4/v0.7 state is not automatically migrated.\n\nChanges made by assembly: adds a canonical-markup alias, caches it in a new shell version, and supplies root entry, local server, inventory and this document. Existing runtime engines are not rewritten. No merge or deployment is performed by building.\n''', encoding="utf-8")
    manifest = {"schema": "vivo.field-release/1", "release": RELEASE,
                "sourceCommit": commit, "runtimeBase": RUNTIME_BASE,
                "entry": route, "requiresOriginalHtml": False,
                "scope": "existing-browser-runtime-only", "files": inventory,
                "excluded": omitted, "verification": "See the separate build/test evidence; assembly alone is not a pass."}
    (out / "release-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (out / ".nojekyll").touch()
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path.cwd())
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    report = assemble(args.source, args.out, args.commit)
    archive = args.out.parent / (args.out.name + ".zip")
    if archive.exists():
        raise FileExistsError("Refusing archive overwrite")
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(args.out.rglob("*")):
            if path.is_file():
                z.write(path, str(Path(args.out.name) / path.relative_to(args.out)))
    print(json.dumps({"archive": str(archive), "files": len(report["files"]), "sourceCommit": args.commit, "scope": report["scope"]}))


if __name__ == "__main__":
    main()
