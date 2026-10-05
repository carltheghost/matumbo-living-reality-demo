# Network connections and tools

The existing Network space retains Social Explorer, Bot Plaza, World Gateway
and Web + AI. Connections now brings their useful service states and entry
points together. Each action reaches its original feature owner.

## What works

- **My GPT:** separate ChatGPT and OpenAI API readiness rows, local status
  refresh, dependency/storage feedback, and direct handoffs into the correct
  provider mode. Shared `gpt-provider` links preserve that selection. The
  observation snapshot excludes account identifiers, account names, model
  catalogs, assistant notes, and chat history.
- **Local plugins:** Lens Guide and Plan Helper derive from the same trusted
  shipped factories as Bot Plaza. Their current enabled/resting states are
  read from its registry. Opening either helper selects that actual bot;
  preferences and author-created bots remain with Bot Plaza.
- **Public sources:** four fixed source checks, individual retries, attributed
  FX fallback, clear failures and a cancellable check. The existing authorized
  automatic startup batch runs once; no timer polls providers or sends prompts.
  Assistant-only refresh makes two local GETs and no public requests.
- **Reference currency calculator:** EUR/USD/GBP calculations use the exact
  fetched observation on this device. Amounts are never sent upstream. The
  engine rejects unsupported amounts/currencies, missing or invalid rates,
  impossible calendar dates, future/stale observations and mismatched source
  provenance. Estimates exclude fees and spreads and execute no transactions.
- **Request lifecycle:** Connections bounds both fetch and response decoding.
  Stop waiting restores controls, preserves earlier successful observations
  and suppresses late results. NVIDIA cancellation says that the provider may
  continue processing. My GPT has operation-specific deadlines and retains
  cancelled/timed-out prompts without claiming an upstream cancellation.
- **Presentation:** public controls collapse until requested. Clear status
  badges, labelled calculator inputs, phone-sized controls, scrolling and
  keyboard dismissal keep the existing Connections surface usable. The drawer
  clears the original feature's Text view layer, so it cannot cover the heading.
  Switching providers/helpers within the same owner preserves Text view,
  geometry and camera position; fallback-only objects still mount their owner.
- **Launcher:** read-only verification includes GPT dependencies, protected
  storage mode, configuration and actual previous reply evidence. It prints
  no private account metadata and performs no authorization or inference.

Frankfurter documents daily reference rates and local calculation rather than
a conversion endpoint: [primary documentation](https://frankfurter.dev/).
The fixed alternate requires attribution and permits local caching:
[ExchangeRate-API documentation](https://www.exchangerate-api.com/docs/free).
The attribution stays on the same source row as the calculator.

## Use it

1. Open the Network space and press **Connections** in the existing header.
2. Choose **Open My GPT** or **Open API setup**. These open Web + AI with the
   requested provider already selected. Account authorization and actual Send
   remain explicit actions in that owner.
3. Choose **Open in Bot Plaza** beside a helper to select it and send a local
   message. The helpers are scripted; their replies are not cloud inference.
4. Expand **Public sources**, check one source, or convert a reference amount
   after exchange rates load. **Stop waiting** cancels the local wait.

## Acceptance evidence

### Verified Windows HTTP reliability repair

The Python acceptance run exposed an existing response-delivery defect rather
than a one-off test interruption. Early POST rejection returned before reading
the request body. Closing that connection with unread bytes could cause the
Windows client to receive `ConnectionAbortedError: [WinError 10053]` before it
received the expected 403 response. The original origin/header/Host rejection
test reproduced the defect in 23 of 40 runs. A diagnostic intervention that
discarded only its two-byte fixture body passed all 40 runs, establishing the
cause before the source change.

The provider bridge now discards a framed rejected body before its early error
response. The maximum discard is 256 KiB, with one total deadline of 10 seconds;
a shorter existing socket timeout is honored and restored. Rejected bytes are
never decoded as JSON or passed to authorization or inference. Bodies whose
reading already began are not read twice. Invalid or ambiguous framing and
bodies above the discard bound are closed without draining. The existing
Host, Origin, custom-header, route and request-size rejection rules remain in
force, including the expected 403 responses.

The loopback server also has a pending connection queue of 128. A real socket
test pauses dispatch after the first connection, requires 32 local clients to
connect and send their asset requests before dispatch resumes, then checks that
all 32 receive the expected 200 response and exact asset bytes. The binding
remains `127.0.0.1`; increasing the pending queue grants no new request authority.
This proves the tested burst fits the accept queue. Browser behavior is assessed
separately by the UI acceptance script below.

| Verification | Result |
| --- | --- |
| Original rejection test, repeated 40 times | 23 errors in 69.090 seconds |
| Diagnostic two-byte discard, repeated 40 times | 40 passed in 27.417 seconds |
| Focused deadline/framing/delayed-body/queue checks | 7 passed in 1.681 seconds |
| Original rejection test against patched source, with no fixture intervention | 40 passed in 27.696 seconds |
| Full serial Python suite after the repair | 72 passed, zero failures or errors, in 125.166 seconds |
| Scoped `git diff --check` | Passed |

The full command was `python -m unittest discover -s tests -p 'test_*.py' -v`.
The added checks cover a synchronized delayed-body rejection, exact discarded
byte counts, invalid/oversized framing, sender timeout, a total deadline for
slow trickles, restored socket timeouts and the pending-client burst. Rejection
tests also assert that no authentication call, pending sign-in or inference is
created. These tests use disposable local servers and synthetic transports;
they do not use live credentials or cloud inference.

The complete failure/comparison/recheck output is saved in
`work/network-tools-python-recheck.txt`, with machine-readable results in
`work/network-tools-python-fix-summary.json`.

The reproducible browser script is `scripts/verify-network-tools.cjs`. Its
default target is localhost:8082; it uses separate, cold desktop and phone-sized
browser contexts with isolated storage. `PLAYWRIGHT_MODULE`,
`NETWORK_TOOLS_BASE_URL` and `NETWORK_TOOLS_OUTPUT` override the local dependency
path, endpoint and output directory. `NETWORK_TOOLS_ANGLE=d3d11` selects the
Windows hardware path; its default is software SwiftShader. The final run used
Chromium with ANGLE Direct3D11 and identified NVIDIA GeForce RTX 4060.
It verifies the served checkout fingerprint, exact four visible Network owners,
eight unchanged source fingerprints, public responses, owner/provider handoffs,
reference arithmetic, keyboard focus, layout, drawer occlusion and cancellation.
Only the cancellation check injects a delayed response, explicitly labelled
as a test fixture. A full-run request guard rejects authentication/inference
POSTs; no authenticated provider inference is attempted.

- **2,428 JavaScript tests across 104 suites:** zero failures or skips. The
  final run after the owner-navigation guard took 21.095 seconds.
- **72 Python tests:** zero failures or skips, including launcher, loopback,
  provider/GPT security and extracted-package checks.
- **20 browser workflow checks:** ten each at 1440×1000 and 390×844, in
  independently loaded contexts. No page errors or horizontal drawer overflow.
  This is a phone-sized desktop browser, not a physical touch-device test.
- **Four real public sources available:** weather, reference FX, earthquake
  observations and Aave TVL. The fetched October 2 ECB rate produced
  **100 EUR ≈ 112.25 USD** locally without an extra request. These are recorded
  observations, not promises of future provider availability.

Several earlier full-app software-WebGL startup waits timed out at 45 seconds;
they are not counted as successful acceptance. An isolated canvas profile
completed Agents in about 204 ms and Network in about 415 ms. A paused sample
inside torus painting did not establish a loop bug; that source was unchanged.
The final hardware runs verify full startup and workflows on this machine.
Software rendering of the complete app remains unverified in this pass.

To reproduce the final browser check in PowerShell with the local Playwright
dependency installed:

```powershell
$env:PLAYWRIGHT_MODULE = 'C:/path/to/node_modules/playwright'
$env:NETWORK_TOOLS_ANGLE = 'd3d11'
$env:NETWORK_TOOLS_OUTPUT = 'work/network-tools-browser'
node scripts/verify-network-tools.cjs
```

Final counts and live identity are recorded alongside the screenshots in
`network-tools-completion/acceptance.json` and `verification.json`.

The live bridge's account state is separate from UI readiness. ChatGPT sign-in
and API/NVIDIA credentials are still required before real cloud replies can
be verified. GitHub Pages hosts static UI; the protected account service runs
on the user's PC. This change does not merge or deploy the draft PR.
