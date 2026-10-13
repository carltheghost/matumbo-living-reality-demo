#!/usr/bin/env python3
"""Verify the staged Vivo phone route and its local-only authority boundary."""

from pathlib import Path
import sys


def verify(web_root: Path) -> None:
    application_root = web_root / "application"
    phone_root = web_root / "phone"

    conversation_transport = application_root / "conversation-transport.mjs"
    remote_transport = application_root / "remote-transport.mjs"
    route = phone_root / "index.html"
    bootstrap = phone_root / "bootstrap.mjs"
    economy_entry = phone_root / "economy-entry.mjs"
    static_shared = phone_root / "static-shared.js"
    field_world = phone_root / "field-world.mjs"
    spatial_fabric = phone_root / "spatial-fabric.mjs"
    phone_render = phone_root / "phone-render.mjs"
    phone_css = phone_root / "phone-world.css"
    field_palette = phone_root / "field-palette.mjs"
    economy_manifest = phone_root / "vendor/economy/manifest.json"
    simulated_economy = phone_root / "vendor/economy/src/domains/simulated-economy.js"
    snapshot_graph = phone_root / "vendor/economy/src/domains/snapshot-graph.js"
    token = phone_root / "vendor/economy/src/domains/token.js"
    token_config = phone_root / "vendor/economy/src/domains/token-config.js"
    token_supply_policy = phone_root / "vendor/economy/src/domains/token-supply-policy.js"
    token_economy_overview = phone_root / "vendor/economy/src/domains/token-economy-overview.js"
    token_store = phone_root / "vendor/economy/src/domains/token-store.js"
    economy_panel = phone_root / "vendor/economy/src/render/simulated-economy-panel.js"
    overview_renderer = phone_root / "vendor/economy/src/render/token-economy-overview.js"
    service_worker = web_root / "vivo-sw.js"

    required = [
        conversation_transport,
        remote_transport,
        route,
        bootstrap,
        economy_entry,
        static_shared,
        field_world,
        spatial_fabric,
        phone_render,
        phone_css,
        field_palette,
        economy_manifest,
        simulated_economy,
        snapshot_graph,
        token,
        token_config,
        token_supply_policy,
        token_economy_overview,
        token_store,
        economy_panel,
        overview_renderer,
        service_worker,
    ]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise SystemExit("Missing static Vivo phone assets: " + ", ".join(missing))

    route_text = route.read_text(encoding="utf-8")
    if (
        "./static-shared.js" not in route_text
        or "./bootstrap.mjs" not in route_text
        or "../shared.css" not in route_text
    ):
        raise SystemExit("Static Vivo phone route does not use its self-contained relative assets")

    bootstrap_text = bootstrap.read_text(encoding="utf-8")
    static_shared_text = static_shared.read_text(encoding="utf-8")
    if "PAGES STATIC/OFFLINE" not in static_shared_text or "api('/readyz'" in static_shared_text:
        raise SystemExit("Static phone launcher still contains a backend readiness call")
    if "PAGES STATIC/OFFLINE" not in bootstrap_text or "canonical authority unavailable" not in bootstrap_text:
        raise SystemExit("Static route authority boundary is not explicit in the phone bootstrap")
    if "./economy-entry.mjs" not in bootstrap_text or "TUMBO-SIM" not in route_text:
        raise SystemExit("Static phone launcher did not retain the mounted simulated economy entry")

    service_worker_text = service_worker.read_text(encoding="utf-8")
    for asset in (
        "application/conversation-transport.mjs",
        "phone/index.html",
        "phone/static-shared.js",
        "phone/field-world.mjs",
        "phone/spatial-fabric.mjs",
        "phone/economy-entry.mjs",
        "phone/phone-render.mjs",
        "phone/phone-world.css",
        "phone/field-palette.mjs",
        "phone/vendor/economy/manifest.json",
        "phone/vendor/economy/src/domains/simulated-economy.js",
        "phone/vendor/economy/src/domains/snapshot-graph.js",
        "phone/vendor/economy/src/domains/token.js",
        "phone/vendor/economy/src/domains/token-config.js",
        "phone/vendor/economy/src/domains/token-supply-policy.js",
        "phone/vendor/economy/src/domains/token-economy-overview.js",
        "phone/vendor/economy/src/domains/token-store.js",
        "phone/vendor/economy/src/render/simulated-economy-panel.js",
        "phone/vendor/economy/src/render/token-economy-overview.js",
    ):
        if asset not in service_worker_text:
            raise SystemExit("Phone asset is absent from the offline shell: " + asset)

    print("Verified static Vivo phone route with local-only authority controls")


if __name__ == "__main__":
    staged_root = Path(sys.argv[1]) if len(sys.argv) == 2 else Path("dist/services/vivo/web")
    verify(staged_root)
