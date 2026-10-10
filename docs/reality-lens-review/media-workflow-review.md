# Reality Lens media and Bot Plaza repairs

Verified locally on 2026-10-03. This report covers the media and proposal workflows repaired in the continuing draft PR; it is not a merge or deployment claim.

YouTube search now returns real results within the native Reality Lens object. The formerly configured public mirrors failed from the browser. A bounded probe of the current [official Piped instance list](https://github.com/TeamPiped/documentation/blob/main/content/docs/public-instances/index.md) found `pipedapi.ducks.party` and `api.piped.private.coffee` returning HTTP 200 with real metadata and browser CORS. The fixed three-provider failover list now starts with these two, followed by the official Kavin instance. Public instance availability can change. The app sends queries only when the user searches, without credentials or an authorization header; this follows the [Piped public API contract](https://docs.piped.video/docs/api-documentation/).

The final natural browser check searched for `three js tutorial`, received eight real results from Ducks Party, and selected video `Q7AOvWpIVHU` through the object's result control. The same object's single privacy-enhanced YouTube iframe played the video. Its actual HTML video element had `paused=false` and `readyState=4`; `currentTime` advanced from **18.770635 s to 20.777485 s** between samples. This is actual local Chromium playback evidence, not a fixture, a loaded-iframe claim, or a guarantee for every YouTube video.

Selection collapses the result list so the player is visible. Show results reopens the same list without changing the iframe URL or creating another player. A Cancel search control releases the submit button immediately. Every provider request and JSON body has a 4.5-second timeout, up to three providers. Closing, selecting a video, pasting a new target after cancellation, or destroying the controller aborts the earlier request; late results cannot overwrite the current selection. Titles, channel text, search length, result count, and failover count are bounded. Reopening preserves the selected video in one quiet iframe without requesting autoplay.

The final desktop/phone browser check also used controlled metadata for the race and cancellation cases. Those fixture checks are explicitly separate from natural search and playback. They verified visible Cancel → paste → Search/Play, a late old response, close cancellation, one iframe on reopen, one surface owned by the YouTube body, no horizontal phone overflow at 390 × 844, and no page exceptions.

Bot Plaza now uses the proposal queue's clock when showing time remaining. Its previous Date.now countdown contradicted an injected simulation clock. Queue writes check expiry before approving or editing, preventing overdue proposals from being approved or revived without a preceding read. An expiry notification during rendering no longer duplicates proposal rows.

Validation: **56 targeted Node tests passed, zero failed** (11 YouTube and 45 Bot Plaza); syntax checks for the three changed modules and the scoped Git whitespace check passed. The full repository suite and release state are assessed by the parent integration audit.

Changed repository paths:

- `src/render/youtube-surface.js`
- `src/domains/bot-plaza.js`
- `src/render/bot-plaza.js`
- `tests/youtube-surface.test.mjs`
- `tests/bot-plaza.test.mjs`

Evidence:

- [Final natural and controlled browser evidence](media-workflow-verification.json)
- [Reviewed public provider probe](youtube-provider-probe.json)
- [Actual search results](youtube-live-search.png)
- [Actual selected-result playback](youtube-real-result-embed.png)
- [Phone object surface](youtube-phone-native.png)
- [Focused test output](media-tests.tap)

The temporary media verification server used port 8091 and is separate from the parent's canonical preview. No commit, push, merge, or external account setup was performed by the media subtask.
