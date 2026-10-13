#!/usr/bin/env python3
"""Keep staged economy assets covered by the phone shell and CI workflows.

The economy manifest is the authoritative list of canonical-to-phone mirrors.
This check deliberately fails when a future manifest entry is added without
also being added to the service-worker shell, public Pages hash verification,
the built-artifact checks, or both phone workflow path filters.
"""

from __future__ import annotations

import fnmatch
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "services/vivo/web/phone/vendor/economy/manifest.json"
SERVICE_WORKER = ROOT / "services/vivo/web/vivo-sw.js"
PAGES_WORKFLOW = ROOT / ".github/workflows/deploy-pages.yml"
PHONE_WORKFLOW = ROOT / ".github/workflows/vivo-phone.yml"
STAGED_PREFIX = "services/vivo/web/"


def quoted_list(text: str, pattern: str, label: str) -> list[str]:
    match = re.search(pattern, text, flags=re.MULTILINE | re.DOTALL)
    if not match:
        raise SystemExit(f"could not find {label} in workflow")
    return re.findall(r"'([^']+)'", match.group(1))


def workflow_event_block(text: str, event: str) -> str:
    match = re.search(
        rf"^  {re.escape(event)}:\s*$\n(?P<body>.*?)(?=^  [A-Za-z0-9_-]+:\s*$|\Z)",
        text,
        flags=re.MULTILINE | re.DOTALL,
    )
    if not match:
        raise SystemExit(f"could not find {event} trigger block in phone workflow")
    return match.group("body")


def event_paths(text: str, event: str) -> list[str]:
    block = workflow_event_block(text, event)
    paths = re.search(r"^    paths:\s*$\n(?P<body>.*?)(?=^    [A-Za-z0-9_-]+:|\Z)", block, flags=re.MULTILINE | re.DOTALL)
    if not paths:
        raise SystemExit(f"could not find {event}.paths in phone workflow")
    return re.findall(r"^\s+- '([^']+)'\s*$", paths.group("body"), flags=re.MULTILINE)


def verify() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entries = manifest.get("files")
    if manifest.get("schema") != "vivo.phone.simulated-economy-stage/1" or not isinstance(entries, list):
        raise SystemExit("economy manifest has an unsupported shape")

    sources: list[str] = []
    staged: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("source"), str) or not isinstance(entry.get("staged"), str):
            raise SystemExit("economy manifest contains a malformed file entry")
        source = entry["source"]
        staged_path = entry["staged"]
        if not staged_path.startswith(STAGED_PREFIX):
            raise SystemExit(f"economy staged path escapes the Vivo web root: {staged_path}")
        if source in sources or staged_path in staged:
            raise SystemExit(f"economy manifest contains a duplicate entry: {source} / {staged_path}")
        sources.append(source)
        staged.append(staged_path)

    service_worker = SERVICE_WORKER.read_text(encoding="utf-8")
    pages_workflow = PAGES_WORKFLOW.read_text(encoding="utf-8")
    phone_workflow = PHONE_WORKFLOW.read_text(encoding="utf-8")
    phone_paths = [path[len(STAGED_PREFIX):] for path in staged]

    for path in phone_paths:
        if path not in service_worker:
            raise SystemExit(f"economy manifest asset is absent from the service-worker shell: {path}")

    public_hash_assets = quoted_list(pages_workflow, r"for name in \[(.*?)\]:", "Pages public hash list")
    for path in staged:
        if path not in public_hash_assets:
            raise SystemExit(f"economy manifest asset is absent from Pages public hash verification: {path}")

    required_built_assets = {f"browser-static/{path}" for path in staged}
    missing_built = sorted(path for path in required_built_assets if path not in phone_workflow)
    if missing_built:
        raise SystemExit("economy manifest assets are absent from built-artifact checks: " + ", ".join(missing_built))

    built_shell_assets = quoted_list(phone_workflow, r"for asset in \((.*?)\):", "built-artifact shell list")
    for path in phone_paths:
        if path not in built_shell_assets:
            raise SystemExit(f"economy manifest asset is absent from built-artifact shell checks: {path}")

    for event in ("pull_request", "push"):
        filters = event_paths(phone_workflow, event)
        missing_sources = [source for source in sources if not any(fnmatch.fnmatchcase(source, pattern) for pattern in filters)]
        if missing_sources:
            raise SystemExit(f"economy manifest sources are absent from {event} path filters: " + ", ".join(missing_sources))
        if "scripts/vivo/verify_economy_asset_coverage.py" not in filters:
            raise SystemExit(f"{event} path filters do not rerun the economy asset coverage guard")

    print(f"Verified economy asset coverage for {len(entries)} manifest entries")


if __name__ == "__main__":
    verify()
