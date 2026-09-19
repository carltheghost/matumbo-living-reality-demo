# External critique — ChatGPT (2026-09-19)

Hostile review of `src/domains/multi-sport-events.js` queue/pacing/supersede + `tsdbSeasonString`.
Verbatim response. To be reconciled with the Grok critique (docs/CRITIQUE_GROK.md) before revision.

## 1. Season resolution is fundamentally under-modeled — Major/Critical depending on league coverage

### Trigger

`entry.seasonType === "european"`

forces:

`month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}``

That assumes:

- season starts exactly July 1
- season label is always `startYear-endYear`
- league follows northern-hemisphere winter scheduling

That is false for many real competitions.

### Broken cases

#### A. Southern hemisphere leagues

Examples:

- A-League Men
- Primera División de Chile
historically calendar-aligned competitions

A January 2026 match:

```js
dateParam = "20260115"
```

produces:

```
month = 1
season = "2025-2026"
```

But the actual TSDB season may be:

```
2026
```

or:

```
2025
```

depending on the competition.

Result:

- wrong season endpoint queried
- TSDB returns no events
- UI shows empty scoreboard despite games existing

#### B. Leagues starting August/September

- Premier League
- Bundesliga
- La Liga

Your July cutoff works accidentally.

However:

August 2026:

```
2026-2027
```

correct.

March 2027:

```
2026-2027
```

correct.

The bug is hidden because these leagues match the assumption.

#### C. Split-season leagues

Examples:

- Argentina historically used Apertura/Clausura structures
- many Latin American leagues use:

```
2026 Apertura
2026 Clausura
```

Your output:

```
2026
```

or:

```
2025-2026
```

does not identify the competition segment.

Failure mode:

- fetches first half when UI wants second half
- stale standings
- duplicate/wrong fixtures

#### D. TSDB naming mismatch

The most dangerous case is not calendar math.

It is:

`your generated season string !== TSDB season key`

Example:

Your code:

```
2025-2026
```

TSDB:

```
2026
```

or:

```
2025/26
```

or:

```
2025-26
```

Result:

```
HTTP 200
events: []
```

The cache layer sees:

`ready envelope`

and can preserve an empty result.

### Fix

Do not infer globally.

Store league metadata:

```js
{
  id: "league123",
  seasonResolver: "australia",
  tsdbSeasonFormat: "YYYY",
  seasonStartMonth: 10
}
```

Example:

```js
function resolveSeason(entry, date) {
  return entry.seasonResolver(date);
}
```

Better:

```js
{
  seasonLabelResolver(date) {
    return "2026";
  }
}
```

The build-time probe should discover the actual TSDB season keys, not just a broad type.

## 2. Supersede race — the architecture has a real race

### Severity: Critical

The claim:

`beginNetwork() is synchronous and runs before the provider's first await`

does not protect the pacing gap.

The vulnerable period is:

```
turn A:
  abort previous
  await paceNextCall()
             ^
             |
             still alive here

turn B:
  abort A controller
  pace
  beginNetwork()
```

### Concrete interleaving

Initial:

```
inFlightController = null
```

#### Turn A

```
A enters queue
pendingCount++

A aborts nothing

A awaits paceNextCall()
```

No controller exists yet.

#### User changes league

Turn B starts.

```
B enters queue

B:
 if(inFlightController)
    abort()
```

Nothing happens because:

```
inFlightController === null
```

B waits pacing.

#### A wakes first

```
paceNextCall finishes

releaseMyTurn()

provider.fetchTurn()
```

Inside provider:

```
beginNetwork()
```

Now:

```
inFlightController = controllerA
```

#### B continues

B reaches:

```
beginNetwork()
```

Now:

```
inFlightController = controllerB
```

The handle is correct at this instant.

The dangerous case:

A has multiple TSDB ids.

Example:

```
A:
 fetch league 1
 beginNetwork()
 await fetch()

B:
 abort controllerA
 beginNetwork()
 fetch()

A:
 checks ctx.inFlight()
```

This part is mostly okay.

But there is a smaller hole:

```
A:
 if(ctx.inFlight())
   continue

B:
 abort A
 beginNetwork()

A:
 beginNetwork()
```

The check and assignment are not atomic.

The sequence:

```
check
     |
     context switch
     |
beginNetwork()
```

allows a stale turn to resurrect itself.

### Can stale data render?

Yes.

```
A starts fetch
B supersedes A
A fetch ignores AbortSignal
A resolves
A caches ready envelope
B resolves later
```

The cache now contains:

`old league data`

unless rendering has an independent generation guard.

Abort is not a correctness boundary.

Abort is only cancellation.

### Fix

Introduce monotonically increasing request generations.

Example:

```js
let networkEpoch = 0;

function beginTurn() {
  return ++networkEpoch;
}
```

Then:

```js
const epoch = beginTurn();

const result = await fetch();

if (epoch !== networkEpoch) {
  return STALE;
}

cache.set(result);
render(result);
```

You need this around:

- cache writes
- UI commits
- envelope promotion

### Is ctx.inFlight() sufficient?

No. It helps reduce wasted calls, but it cannot prevent:

```
check()
...
beginNetwork()
```

from racing.

`await acquireNetworkSlot(turnId)`

where acquisition itself validates ownership.

Example:

```js
async function beginNetwork(turnId) {
  if (turnId !== currentTurn)
    throw Superseded();

  inFlightController = new AbortController();

  if (turnId !== currentTurn) {
    inFlightController.abort();
    throw Superseded();
  }

  return controller;
}
```

## 3. Pacing loop — possible livelock and budget abuse

### Severity: Major

```js
while (leagueNowMs(now) < deadline) {
  await leagueSleep(deadline - leagueNowMs(now));
}
```

Assumes:

`clock advances`

That assumption is unsafe.

### Failure case A: frozen clock

Test environment:

```js
leagueNowMs() => 1000
```

Forever.

```
2001
```

```
1000 < 2001
sleep(1001)

clock still 1000

sleep(1001)

...
```

Infinite loop.

### Failure case B: backwards clock

```
1000
900
800
700
```

```
2001
```

The difference grows.

### Fix

Use monotonic time.

Browser:

`performance.now()`

Node:

`process.hrtime.bigint()`

Never wall clock.

Also add a cap:

```js
const maxIterations = 100;

while (now < deadline && iterations++ < maxIterations)
```

## 4. Budget reservation after supersede

### Severity: Major

You said:

`fail-closed: reservation kept`

This prevents abuse from retries, but creates another abuse vector.

Scenario:

User rapidly switches:

```
League A
League B
League C
League D
...
```

Each turn:

```
reserve budget
wait 2 seconds
discover superseded
exit
```

After 90 switches:

`budget exhausted`

with almost zero network traffic.

Is that wrong?

Depends on your threat model.

For an interactive scoreboard:

I would not burn budget on superseded work.

Better:

Reserve at actual network start:

```
after pacing
before fetch
```

not queue entry.

But protect against:

```
pace completed
budget unavailable
```

with:

```js
if (!consumeBudget())
  abort before beginNetwork()
```

## 5. releaseMyTurn() ordering — there is an ordering hole

### Severity: Critical

Current:

```js
await paceNextCall();

releaseMyTurn();

return await provider.fetchTurn();
```

Problem:

Between:

`releaseMyTurn()`

and:

`provider.fetchTurn()`

there is no controller.

Example:

```
A:
releaseMyTurn()

scheduler starts B

B:
abort previous inFlightController

(no controller exists)

B starts

A:
provider.fetchTurn()
beginNetwork()
```

Now A has inserted itself after B.

This violates:

`newer turn always owns the slot`

Fix:

Move slot acquisition before release:

```js
await paceNextCall();

const network = beginNetwork();

releaseMyTurn();

return provider.fetchTurn({
  signal: network.signal
});
```

The controller must exist before another turn can observe ownership.

## 6. Timeout abort vs supersede abort

### Severity: Minor/Major

This part is mostly safe:

`controller.abort()`

is idempotent.

Both:

`timeout`

and:

`supersede`

can abort.

The issue is distinguishing why.

Currently:

`AbortError`

means everything.

You lose telemetry:

- user switched leagues?
- provider hung?
- timeout?
- browser cancellation?

```js
controller.abort(new DOMException("superseded", "AbortError"));
```

and:

```js
controller.abort(new DOMException("timeout", "TimeoutError"));
```

## 7. done() behavior

### Severity: Correct

This is actually good:

```js
if (inFlightController === controller)
  inFlightController = null;
```

Without identity checking:

```
A finishes late
A.done()
clears B's controller
```

That would be catastrophic.

Keep this.

## 8. Aborted fetch unhandled rejection

### Severity: Major if provider code lacks handling

`return await provider.fetchTurn()`

means an abort becomes a rejected promise.

If the queue consumer does:

`queueTurn().then(render)`

without:

`.catch()`

you get:

`UnhandledPromiseRejection`

Potential effects:

- noisy telemetry
- broken UI state
- stuck loading indicator

Fix:

Normalize:

```js
try {
  return await fetch();
}
catch (e) {
  if (e.name === "AbortError")
    return { status: "superseded" };
  throw e;
}
```

## Priority order

| Priority | Bug | Impact |
|----------|-----|--------|
| 1 | releaseMyTurn() before beginNetwork() | stale turn can sneak behind newer turn |
| 2 | no generation check on cache/render | old data can overwrite new data |
| 3 | season resolver assumption | wrong league seasons / empty scoreboard |
| 4 | non-atomic ctx.inFlight() check | stale multi-fetch resurrection |
| 5 | pacing loop wall-clock dependency | livelock |
| 6 | budget reservation strategy | league switching burns quota |
| 7 | abort reason loss | observability/debugging |
| 8 | abort rejection handling | runtime noise/failure |

The architecture is close, but the central flaw is treating **AbortController ownership as equivalent to request ownership**. It is not. Ownership needs an explicit generation/token model; abort is only a best-effort interruption mechanism.
