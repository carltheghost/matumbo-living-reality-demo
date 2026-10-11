"""Real Chromium checks for the post-merge Studio route review findings.

This probe never grants or requests camera permission. It verifies same-origin
vendored asset resolution and that the accepted preview opens without replacing
an active Studio history session.
"""
import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8877"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("evidence/postmerge")
OUT.mkdir(parents=True, exist_ok=True)
checks = []
page_errors = []
network = []


def check(name, value, details=None):
    row = {"name": name, "passed": bool(value)}
    if details is not None:
        row["details"] = details
    checks.append(row)
    if not value:
        raise AssertionError(f"{name}: {details}")


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path="/usr/bin/chromium",
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader"],
        )
        context = await browser.new_context(
            viewport={"width": 1440, "height": 1000},
            device_scale_factor=1,
            permissions=[],
        )
        await context.add_init_script(
            """window.__vivoCameraCalls=0;
            if (navigator.mediaDevices?.getUserMedia) {
              const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
              navigator.mediaDevices.getUserMedia=(...args)=>{
                window.__vivoCameraCalls++;
                return original(...args);
              };
            }"""
        )
        page = await context.new_page()
        page.on("pageerror", lambda error: page_errors.append({"type": "pageerror", "message": str(error)}))
        page.on(
            "console",
            lambda message: page_errors.append({"type": "console", "level": message.type, "message": message.text})
            if message.type == "error" and not message.text.startswith("INFO:") else None,
        )
        page.on("request", lambda request: network.append({"kind": "request", "url": request.url, "resourceType": request.resource_type}))
        page.on("response", lambda response: network.append({"kind": "response", "url": response.url, "status": response.status, "resourceType": response.request.resource_type}))

        response = await page.goto(BASE + "/local/", wait_until="domcontentloaded")
        await page.wait_for_timeout(900)
        check("Primary Studio route opens", response.status == 200)
        csp = response.headers.get("content-security-policy", "")
        check("Primary route keeps same-origin CSP", "connect-src 'self' ws: wss:" in csp and "cdn.jsdelivr.net" not in csp)
        source = await page.evaluate(
            """()=>({
                href:document.querySelector('#vivoLocalEntry a')?.getAttribute('href'),
                target:document.querySelector('#vivoLocalEntry a')?.getAttribute('target'),
                rel:document.querySelector('#vivoLocalEntry a')?.getAttribute('rel'),
                bridgeScripts:[...document.scripts].map(script=>script.src).filter(Boolean),
                handAssets:window.FieldHandAssets||null,
                cameraAssetTrace:window.__vivoCameraAssetTrace||null,
                legacyBridge:!!document.querySelector('#sharedBridge'),
                bridgeSessionKeys:Object.keys(sessionStorage).filter(key=>key.startsWith('viva-bridge-')),
                headButton:(()=>{const button=document.querySelector('#trackHead');return button?{disabled:button.disabled,text:button.textContent,title:button.title,ariaLabel:button.getAttribute('aria-label')}:null;})(),
                centerHead:(()=>{const button=document.querySelector('#centerHead');return button?{disabled:button.disabled,text:button.textContent,title:button.title,ariaLabel:button.getAttribute('aria-label')}:null;})(),
                cameraStream:!!window.FieldApp?.presence?.stream,
                cameraCalls:window.__vivoCameraCalls,
            })"""
        )
        head_lifecycle = await page.evaluate(
            """()=>{
              const presence=window.FieldApp.presence,states=[],read=()=>({trackHead:document.querySelector('#trackHead').disabled,centerHead:document.querySelector('#centerHead').disabled,text:document.querySelector('#trackHead').textContent,title:document.querySelector('#trackHead').title});
              presence.stream={getTracks:()=>[]};presence.running=false;presence.loading=false;presence.kind='none';presence.updateButtons();states.push({state:'camera-only',...read()});
              presence.facing='user';presence.running=true;presence.updateButtons();states.push({state:'flip',...read()});
              presence.stop('camera-free lifecycle probe');states.push({state:'stop',...read()});return states;
            }"""
        )
        check("Local camera asset adapter is present", source["cameraAssetTrace"] and source["cameraAssetTrace"]["cameraPresencePatched"] and not source["bridgeScripts"] and not source["legacyBridge"] and not source["bridgeSessionKeys"] and source["headButton"]["disabled"] and source["centerHead"]["disabled"] and "Head unavailable" in source["headButton"]["text"] and "Center unavailable" in source["centerHead"]["text"] and all(state["trackHead"] and state["centerHead"] and "no face landmarker model" in state["title"] for state in head_lifecycle), {"source":source,"headLifecycle":head_lifecycle})
        check("Local hand assets resolve under /vendor/field-lab", source["handAssets"] and all(
            value.startswith(BASE + "/vendor/field-lab/") for value in source["handAssets"].values()
        ), source["handAssets"])
        check("Preview link is safe new-tab navigation", source["href"] == "/local/accepted/" and source["target"] == "_blank" and source["rel"] == "noopener noreferrer", source)
        check("Camera remains untouched", not source["cameraStream"] and source["cameraCalls"] == 0)

        tracking_initialization = await page.evaluate(
            """async()=>{
              const presence=window.FieldApp.presence,trace=window.__vivoCameraAssetTrace;
              try {
                const loaded=await presence.loadVision();
                const bytes=await presence.modelBytes('hand',loaded.local,new AbortController().signal);
                const files=await loaded.vision.FilesetResolver.forVisionTasks(loaded.wasm);
                const detector=await loaded.vision.HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetBuffer:bytes,delegate:'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.5});
                detector.close();
                let head={gated:false};
                try { await presence.modelBytes('head',loaded.local,new AbortController().signal); }
                catch(error) { head={gated:true,name:error?.name||'Error',error:String(error)}; }
                return {ok:true,assetSource:presence.assetSource,local:loaded.local,wasm:loaded.wasm,modelBytes:bytes.byteLength,head,trace:{loadVisionCalls:trace.loadVisionCalls,modelBytesCalls:[...trace.modelBytesCalls]}};
              } catch(error) {
                return {ok:false,name:error?.name||'Error',error:String(error),trace:{loadVisionCalls:trace?.loadVisionCalls||0,modelBytesCalls:[...(trace?.modelBytesCalls||[])]}};
              }
            }"""
        )
        check("Original CameraPresence hand loader uses vendored assets and gates head honestly", tracking_initialization["ok"] and tracking_initialization["assetSource"] == "vendored field-lab" and tracking_initialization["local"] == "field-lab" and tracking_initialization["modelBytes"] == 7819105 and tracking_initialization["head"]["gated"] and tracking_initialization["trace"]["loadVisionCalls"] == 1 and tracking_initialization["trace"]["modelBytesCalls"] == ["hand", "head"], tracking_initialization)
        check("No external tracking asset request occurs on the primary route", not any(
            item["url"].startswith(("https://cdn.jsdelivr.net/", "https://storage.googleapis.com/")) for item in network
        ), [item for item in network if item["url"].startswith(("https://cdn.jsdelivr.net/", "https://storage.googleapis.com/"))])

        before = await page.evaluate(
            """()=>{
                FieldApp.studio.startHistory();
                return {url:location.href,recording:FieldApp.studio.tape.recording,frames:FieldApp.studio.tape.frames.length};
            }"""
        )
        preview = None
        async with context.expect_page(timeout=5000) as popup_info:
            await page.locator("#vivoLocalEntry a").click()
        preview = await popup_info.value
        await preview.wait_for_load_state("domcontentloaded")
        await preview.wait_for_timeout(500)
        after = await page.evaluate(
            """()=>({url:location.href,recording:FieldApp.studio.tape.recording,frames:FieldApp.studio.tape.frames.length,camera:!!FieldApp.presence.stream})"""
        )
        check("Accepted preview opens in a separate page", preview.url.endswith("/local/accepted/"), preview.url)
        check("Original Studio remains live with unsaved history", page.url.endswith("/local/") and after["recording"] and after["frames"] >= before["frames"] and not after["camera"], {"before": before, "after": after})
        await preview.close()

        check("No uncaught browser errors", not page_errors, page_errors)
        report = {
            "schema": "vivo.postmerge-browser-review/2",
            "base": BASE,
            "viewport": [1440, 1000],
            "cameraPermissions": [],
            "cameraRequested": source["cameraCalls"] != 0,
            "passed": sum(row["passed"] for row in checks),
            "failed": sum(not row["passed"] for row in checks),
            "checks": checks,
            "pageErrors": page_errors,
            "network": network,
            "csp": csp,
            "headLifecycle": head_lifecycle,
            "trackingInitialization": tracking_initialization,
        }
        (OUT / "postmerge-browser-review.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"passed": report["passed"], "failed": report["failed"], "pageErrors": len(page_errors), "cameraRequested": report["cameraRequested"]}))
        await browser.close()


asyncio.run(main())
