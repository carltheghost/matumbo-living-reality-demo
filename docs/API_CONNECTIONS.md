# Reality Lens API connections

**My GPT:** Web + AI now includes a separate local ChatGPT-plan/OpenAI conversation service, assistant profiles and selected history import/export. It shares this loopback server while retaining distinct authentication and explicit Send controls. [My GPT setup, limits and privacy](MY_GPT.md). The NVIDIA-specific status and endpoints below retain their existing contract.

The Connections control groups bounded public reads and an optional NVIDIA assistant. Reality Lens explicitly enables **one automatic public connection check on page load**, matching the request for automatic connections. That bounded batch checks four source groups and discovers the local bridge's configuration. FX tries one fixed alternate only if Frankfurter fails, so a batch makes four or five public reads. **Check connections** runs another batch on request. There are no repeating polls. The bridge's status read does not call NVIDIA; **Send to NVIDIA** is the only inference trigger.

The reusable `mountApiConnections()` library keeps `autoCheck:false` by default. On loopback it can discover same-origin configuration once without public reads; on public Pages it sends no request until the visitor checks. The site's bootstrap enables `autoCheck:true` deliberately. Automatic connection checks do not change the older seven source surfaces' own refresh rules.

The public GitHub Pages app is a static site. It cannot keep a server API key secret or run Python. The included local bridge serves the same Reality Lens source and adds a server-side NVIDIA route. The Connections batch checks for that fixed loopback bridge; browser local-network policy or permissions can block that request. Opening the bridge's own page avoids the cross-origin path.

## Start the local site

From the repository folder:

```powershell
py -3 scripts/provider_bridge.py
```

Open [local Reality Lens](http://127.0.0.1:8082/). Python's standard library is sufficient; there is no package installation. The page still works with no NVIDIA key. Connections then reports **Key needed** for NVIDIA and can check public sources independently.

The bridge binds to `127.0.0.1` only. Its static-file allowlist covers the deployment entry points and supported assets under `src/`, `vendor/three-r179.1/`, `assets/`, and `public/`. Dotfiles, repository metadata, package/configuration files, Python scripts, traversal paths, symlinks outside the repository, and arbitrary filesystem paths are not served.

## Connect NVIDIA securely

1. Sign in at [NVIDIA Build](https://build.nvidia.com/) and create your developer API key. Account creation and the key must be completed by the owner.
2. Put the key in the **server process environment**, never in the page, source files, a URL, or browser storage. This PowerShell prompt keeps the value out of command history and masks entry:

```powershell
$nvidiaKeyInput = Read-Host 'NVIDIA developer API key' -AsSecureString
$nvidiaKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($nvidiaKeyInput)
try {
    $env:NVIDIA_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($nvidiaKeyPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($nvidiaKeyPointer)
    Remove-Variable nvidiaKeyInput, nvidiaKeyPointer
}
py -3 scripts/provider_bridge.py
```

3. Open the local site and Connections. **Configured · untested** means the bridge found a nonempty environment key. It has not verified NVIDIA authentication, account entitlement, quotas, or availability.
4. Enter a short prompt and press **Send to NVIDIA**. Only that prompt and a fixed advisory system instruction leave the device. A returned answer changes the state to **Answer verified** and records the response time for this bridge process.
5. After stopping the server, remove the key from that shell if it is no longer needed:

```powershell
Remove-Item Env:\NVIDIA_API_KEY
```

The default model is `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`, whose official catalog page listed a free endpoint as available when reviewed on October 3, 2026. Catalog availability does not prove the owner's key or entitlement works. Several older Nemotron pages now list their free endpoint as deprecated, so a copied historical model name can fail. [Current model and API example](https://build.nvidia.com/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning), [older Nano 30B availability](https://build.nvidia.com/nvidia/nemotron-3-nano-30b-a3b).

An owner may choose another current catalog model before starting the server:

```powershell
$env:NVIDIA_MODEL = 'vendor/current-catalog-model'
py -3 scripts/provider_bridge.py
```

Replace the model placeholder with a real catalog id. The browser cannot choose an upstream URL, insert a key, override a model, request tools, or execute actions. All NVIDIA requests go to the fixed `https://integrate.api.nvidia.com/v1/chat/completions` endpoint. Redirects are rejected so the bearer key cannot be forwarded to another host.

The bridge permits one inference in flight and six requests per minute locally, with a 4000-character prompt, a 2048-token output budget, a 45-second timeout, and a bounded upstream response. The default reasoning model also uses a 256-token reasoning budget. These are local limits, not a claim about NVIDIA's account quota. Rate-limited responses trigger a cooldown; there are no retries, autonomous inference loops, browser keys, tool calls, account actions, wallet actions, or financial writes. Upstream errors are mapped to bounded messages rather than relaying arbitrary response bodies.

NVIDIA's current documentation describes free hosted API access for members of its Developer Program for **prototyping**. It requires a developer account and API key; it does not establish unlimited production access or a universal numerical quota. The app therefore reports provider limits without inventing a credit count. [NVIDIA access and pricing](https://docs.api.nvidia.com/nim/docs/run-anywhere), [API key setup](https://docs.api.nvidia.com/nim/docs/api-quickstart), [chat endpoint reference](https://docs.api.nvidia.com/nim/reference/llm-apis).

## Public reads with no key

One Connections check reads the following four source groups at fixed endpoints. Each row reports the returned observation, availability and the check time. FX has one documented alternate: the original Frankfurter failure remains in the result and UI, and the successful source changes to ExchangeRate-API. The alternate is never described as an ECB response. If both fail, the row remains unavailable, with no fabricated value.

| Connection | Read | Boundaries and official source |
|---|---|---|
| Open-Meteo | New York example temperature and weather code | Model output, not a sensor reading. No device geolocation. Free API is for noncommercial use, with less than 10000 calls per day, 5000 per hour and 600 per minute; attribution applies. [Terms](https://open-meteo.com/en/terms), [forecast docs](https://open-meteo.com/en/docs). |
| Frankfurter / ECB | Daily EUR reference rates for USD and GBP | Daily reference observations, not executable prices. No API key or daily/monthly quota; abuse rate limits apply. [Official API docs](https://frankfurter.dev/). |
| ExchangeRate-API, conditional FX alternate | EUR conversion rates for USD and GBP | One no-key open-access request only after Frankfurter fails. Daily provider rates, not ECB reference data or executable prices. Attribution is displayed as “Rates By Exchange Rate API”; the provider permits caching and personal/commercial conversion, with rate limits and a prohibition on redistributing its dataset. [Official open-access docs](https://www.exchangerate-api.com/docs/free). |
| USGS | Past-day earthquake GeoJSON feed | Public provider observations with variable coverage. USGS recommends real-time GeoJSON feeds for automated displays. [Feed docs](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php), [catalog guidance](https://earthquake.usgs.gov/fdsnws/event/1/). |
| DeFiLlama | Aave current TVL | Research observation dependent on provider methodology, not a quote or solvency attestation. The `api.llama.fi` free API requires no authentication; its paid Pro API is separate. [Official API docs](https://api-docs.defillama.com/). |

The FX fallback validates `result:success`, the fixed provider identity, EUR base, positive numeric USD/GBP rates and the provider's update timestamp. Its snapshot includes `sourceUrl`, `provider`, `observedAt`, `checkedAt`, `fallbackUsed`, `primarySourceUrl`, `primaryState`, and separate immutable attempt records. Cancelling or destroying a primary check prevents the alternate from starting; failed alternates receive no retry. The UI preserves the primary failure and displays the required alternate attribution link. Daily data benefits from caching; repeating checks rapidly does not create more current data and can hit the provider's HTTP 429 limit.

During the initial October 3, 2026 direct-host check, Frankfurter's documented routes returned HTTP 403; a subsequent browser check returned HTTP 200 from the same primary route and all four source groups appeared available. These are different access contexts and times, so the app relies on the current response rather than treating either result as a universal provider failure. The fixed ExchangeRate-API alternate also returned HTTP 200 with browser CORS enabled, `result:success`, EUR base, and provider update `2026-10-03T00:02:32Z`.

The final full-world phone-sized browser check confirmed one automatic batch, all four public groups available, local NVIDIA status **Key needed**, no page errors, and no additional reads after reopening Connections. A separate mounted-component check simulated only the primary Frankfurter HTTP 403; its alternate ExchangeRate-API call was live and returned HTTP 200. That test confirmed the alternate's returned rates, source timestamp, required attribution, and retained primary failure. The simulated primary failure is test evidence, not a claim about the final natural browser response.

Reality Lens already has seven source surfaces: World Pulse, tennis, asset market, protocol TVL, multisport scoreboards, Bluesky public social posts, and Wikimedia image metadata. Connections links to those spaces, while their existing refresh behavior and provenance remain in their own surfaces. World Pulse uses GDELT, NYT World RSS, USGS and NASA EONET, with a separate UNHCR annual population rail. Browser CORS and provider availability can prevent a source from returning data; no universal provider coverage is claimed.

Public Bluesky AppView reads require no token, while account-private reads and writes require authentication. Wikimedia supports anonymous browser CORS requests with `origin=*`; metadata reuse must retain attribution and license context. [Bluesky public routing](https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed), [Wikimedia CORS](https://www.mediawiki.org/wiki/API:Cross-site_requests).

“All free APIs” is an open-ended catalog, with different terms, authentication, CORS and rate limits. The implemented approach is a reviewable list that can grow through separate adapters and explicit source attribution. It does not silently activate arbitrary endpoints, paid plans, owner accounts, or credentials.

## Routes and verification

`GET /api/providers` returns configuration, model id, last successful response time, and bounded failure status. It never performs an inference or returns a key. `POST /api/nvidia/chat` accepts only `{"prompt":"..."}`. A valid response includes `provider`, `model`, `content`, permitted usage counters, `verifiedAt`, and `advisory:true`.

Bridge status discovery has a nine-second timeout, matching the public reads, so initial 3-D renderer work can finish without falsely hiding a healthy local bridge. Failed discovery retains a bounded diagnosis in the UI and snapshot. Key presence and a healthy status reply still do not verify a NVIDIA cloud response.

CORS accepts the project's exact public Pages origin and local `http://localhost` / `http://127.0.0.1` origins. Host checks reject DNS-rebinding names. Cross-origin requests receive no credentials allowance; private-network preflight permission is provided only for those trusted origins. Client cancellation stops waiting and removes the UI's pending work; once NVIDIA has accepted a request, its provider processing cannot be recalled by closing a browser panel.

Run the focused checks:

```powershell
py -3 -m unittest discover -s tests -p test_provider_bridge.py
node --test tests/api-connections.test.mjs
```

The Python checks exercise HTTP requests against an ephemeral real loopback server with a fake NVIDIA requester. The JavaScript checks cover public payload parsing, honest status distinctions, explicit inference, safe text rendering, network-free public mounting, and panel lifecycle. A real NVIDIA answer requires the owner's valid key and entitlement; passing these tests alone is not evidence of an authenticated live NVIDIA response.
