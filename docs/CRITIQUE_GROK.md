# External critique — Grok (2026-09-19)

Hostile review of `src/domains/multi-sport-events.js` queue/pacing/supersede + `tsdbSeasonString`.
Verbatim findings, most severe first. To be reconciled with the ChatGPT critique before revision.

## 1. Season resolution for TheSportsDB (critical)

The `tsdbSeasonString` hard-codes a northern-hemisphere flip at month >= 7 for `"european"`. This is wrong for multiple real leagues that TheSportsDB actually indexes.

Concrete breaks:

- Southern-hemisphere / calendar-year leagues that still carry `seasonType: "european"` (or are mis-probed): A-League (Australia), J1/J2 (Japan in some seasons), Chinese Super League, many CONMEBOL domestic leagues that start Feb/Mar. July is mid-season; the function returns the *next* season string while the requested date is still in the current one.
- Split seasons / Apertura-Clausura (Mexico Liga MX, many Central/South American leagues): TheSportsDB often stores distinct season labels or a single year; the July rule produces strings that never match the stored events.
- Leagues whose TheSportsDB season label is a single year even when play spans two calendar years, or that start in Aug/Sep but whose first match day is still tagged under the prior label in the API.
- Any league whose build-time probe set `seasonType: "european"` but whose actual season boundary is not 1 July (MLS used to be calendar; some European second divisions have irregular starts).

Trigger input: `dateParam = "20260715"` (15 July) for a southern league whose current season is still 2025-2026 or 2026. Function returns `"2026-2027"`. Fetch either 404s / empty events or returns the *next* season's (often sparse or future) fixtures. UI shows empty state or wrong-season scores; because only "ready" envelopes are cached, the empty result is not cached, so every subsequent turn for that key re-fetches the wrong season until the date rolls over or the probe is fixed. Stale data appears if a previous correct-season envelope is still in the cache and the UI prefers cache over empty.

Fix: Stop hard-coding the flip month. Make `seasonType` a richer descriptor (or a per-league `seasonStartMonth` + `seasonLabelStyle` from the build-time probe). For true European-style labels compute the boundary from the league's actual start month; for calendar / split-season leagues emit the exact string TheSportsDB uses (single year, "2026 Apertura", etc.). Add a runtime fallback that, on empty result for the computed season, retries the adjacent season and logs the mismatch so the probe can be corrected. Never treat a null/empty season string as a successful ready envelope.

## 2. Supersede-during-pacing / multi-id race that lets an older turn clobber the newer controller and publish stale data (critical)

Interleaving (single global slot, two turns for the same or different keys):

1. Turn A starts: `pendingCount++`, aborts any previous controller (none), enters `await paceNextCall()`.
2. Turn B is enqueued and starts while A is still inside the pacing `while` loop (or between sequential TheSportsDB league-id fetches). B does `if (inFlightController) inFlightController.abort()` — but A has not yet called `beginNetwork()`, so `inFlightController` is still null / previous. B's abort does nothing useful.
3. A finishes pacing, calls `releaseMyTurn()`, then enters `provider.fetchTurn`. Inside the first (or a later sequential) fetch it does `const net = beginNetwork()` → `inFlightController = A's controller`.
4. Meanwhile B has finished *its* pacing and is about to call `beginNetwork()`. Or B is still pacing. Either way:
   - If B calls `beginNetwork()` after A, B overwrites `inFlightController = B's controller`. A's controller is now orphaned; nothing will abort A's in-flight fetch when a still-newer turn arrives.
   - If a third turn C arrives, it aborts whatever is currently in `inFlightController` (B). A continues running, completes its fetch, and (because the code only checks `ctx.inFlight()` *before* additional multi-id calls, not after the await of the fetch itself) can still produce a ready envelope that gets rendered/cached.
5. Hole between the `ctx.inFlight()` check and `beginNetwork()`: a multi-id turn does `if (ctx.inFlight() !== myController) return;` then later `const net = beginNetwork()`. Between those two statements another turn can abort and replace the controller; the check is stale. The first fetch of a turn has no such check at all after pacing.

Consequence: older turn's data can be written after newer data (or after the user has already switched leagues), producing stale scores on screen. Cache receives a ready envelope for a superseded key. Newer turn loses its ability to be superseded because its abort handle was overwritten. Session budget is also wasted on the zombie.

`releaseMyTurn()` after pacing but before `fetchTurn` makes the race window larger: the next waiter can start while the current turn is still allocating its controller.

Fix:

- Make the global in-flight slot a generation or token, not a bare controller reference. Each turn obtains a unique `turnId` / `AbortController` *before* pacing (or at the very top of the turn) and registers it under a mutex/queue. Supersede always aborts the *previous* turn's token; a turn only proceeds to fetch if its token is still the current one after pacing.
- Move `beginNetwork()` (or at least the registration of the controller) to the top of the turn, before any await, exactly as the architecture comment claims for `beginNetwork` itself. The comment is not matched by the code.
- After every `await` (pacing sleep *and* each sequential fetch) re-check that the turn's token is still current; if not, bail without writing cache or UI.
- `ctx.inFlight()` must return the *token*, not the raw controller, and the check must be immediately before every network start *and* after every await that could have been superseded.

## 3. Pacing loop, livelock, and budget accounting for superseded turns (major)

- Livelock / clock regression: `while (leagueNowMs(now) < deadline) await leagueSleep(deadline - leagueNowMs(now))`. If the clock is frozen (`leagueNowMs` returns a constant) the sleep duration is always positive and the loop never exits. If the clock goes backwards (NTP step, test double, paused tab with throttled timers) the computed sleep can be huge or the condition stays true forever. The `+1` guard does not protect against a non-monotonic clock.
- Budget: a turn that spends the full pace interval, then discovers it has been superseded and bails, still counted against the 90-call session budget (fail-closed reservation). Rapid league switching (user flicking through many leagues) therefore burns the entire budget on turns that never issued a network call. After 90 such turns the scoreboard stops updating until the session resets.
- Ordering with `releaseMyTurn()`: because release happens after pacing but before the fetch, the next turn's top-of-turn abort runs while the previous turn may not yet have installed its controller. Combined with finding 2 this creates a window where neither turn's fetch can be aborted by a subsequent supersede.

Fix:

- Replace the open `while` with a single computed sleep (or a capped loop that also checks a cancelled flag / generation). Use `Math.max(0, deadline - now)` and exit if the sleep would be zero or the turn is already superseded. Guard against non-monotonic clocks by recording the observed `now` at entry and treating a backwards jump as "deadline already passed".
- Budget accounting must distinguish "paced but never fetched" from "fetch attempted". Only charge the session counter when `beginNetwork` is actually called (or when the request leaves the client). Superseded turns that never reached the network should release their reservation.
- Keep the queue's "my turn" token until the entire `fetchTurn` (including all sequential ids) has either completed or been explicitly cancelled; do not release early.

## Additional issues (major / minor)

- Timeout-abort vs supersede-abort interaction (major): `beginNetwork` installs a `setTimeout` that calls `controller.abort()`. A supersede also calls `abort()`. Abort is idempotent, but the timeout is only cleared in `done()`. If the turn is superseded and never reaches `done()` (or the finally path is skipped by an unhandled rejection), the timeout still fires later and aborts a *different* turn's controller that has since been installed under the same variable. Combined with the clobber race above this can abort the wrong request.
- `done()` only clears `inFlightController` when it is still the same reference. Correct for the happy path, but after a clobber the older turn's `done()` becomes a no-op for the global slot, leaving the newer controller permanently installed until something else clears it.
- Unhandled rejection on aborted fetch (major): `fetch` with an aborted signal rejects. The shown queue turn has a `try/finally` but no `catch`. If `provider.fetchTurn` does not swallow the abort error, the rejection escapes the queue microtask, can surface as an unhandled rejection, and may skip the `pendingCount` decrement or the cache-write guard depending on how the provider is written. Always catch `AbortError` (and only AbortError) inside the turn and treat it as a clean cancel that does not produce a ready envelope.
- Sequential multi-id TheSportsDB path inherits every race above for each additional fetch; the single `ctx.inFlight()` check before the *next* id is insufficient once the first id's await has returned.

All three areas contain real, triggerable correctness bugs under normal user behaviour (league switching, date changes, southern leagues). The architecture comment that "beginNetwork is synchronous and runs before the provider's first await" is not true of the code as written; that is the root of the supersede race.
