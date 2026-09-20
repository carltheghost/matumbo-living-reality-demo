# Contract Integration Check — Reality Lens Ω

End-to-end connection map for maTumbo Living Reality.
All value is SIMULATED TUMBO POINTS ONLY.
No wallet, network, order, custody, settlement, or mainnet fields may appear in any payload.

## Flow Hops

### 1. Feed → Draft
Source: ESPN free public feed (today's games).
Sink: Automatic contract creation (drafts).

Exact data shape crossing the hop:

```ts
type EspnGameIn = {
  gameId: string;          // stable external id from feed
  league: string;          // e.g. "nba", "mlb", "nfl"
  homeTeam: string;
  awayTeam: string;
  startsAt: string;        // ISO-8601 UTC
  status: "scheduled" | "in_progress" | "final";
};

type DraftOut = {
  id: string;              // internal draft id (uuid)
  gameId: string;          // mirrors EspnGameIn.gameId
  teams: { home: string; away: string };
  league: string;
  startsAt: string;        // ISO-8601 UTC
  status: "draft";
  createdAt: string;       // ISO-8601 UTC
  source: "espn-auto";
};
```

Connection gaps:
- Feed may omit or rename team fields; mapping must normalize to `teams.home` / `teams.away`.
- `gameId` collisions across leagues require league-prefixed or namespaced keys.
- Feed latency: game may already be `in_progress` when draft is created; draft status must remain `"draft"` until explicit approval.

### 2. Draft → Odds
Source: Draft store.
Sink: Kalshi + Polymarket public read-only odds → simulated quotes.

Exact data shape crossing the hop:

```ts
type QuoteIn = {
  draftId: string;
  gameId: string;
  venue: "kalshi" | "polymarket" | "simulated";
  side: "yes" | "no" | "home" | "away" | "over" | "under";
  price: number;           // 0–1 probability or cents normalized to 0–1
  size: number;            // simulated volume in Tumbo points units
  fetchedAt: string;       // ISO-8601 UTC
};

type DraftWithQuotes = DraftOut & {
  quotes: QuoteIn[];
};
```

Connection gaps:
- Quote freshness: any quote with `Date.now() - Date.parse(fetchedAt) > 15 * 60 * 1000` MUST be rejected and never attached.
- Missing venue coverage: drafts may have zero quotes; queue must still accept them as unquoted drafts.
- Price units differ by venue; normalizer must output 0–1 only.

### 3. Odds → Queue
Source: Drafts that have (or lack) quotes.
Sink: Review-queue UI ("Contracts for your review").

Exact data shape crossing the hop:

```ts
type ReviewQueueEntry = {
  id: string;              // same as draft.id
  gameId: string;
  teams: { home: string; away: string };
  league: string;
  startsAt: string;
  status: "pending_review";
  quotes: QuoteIn[];      // may be empty
  queuedAt: string;        // ISO-8601 UTC
  source: "espn-auto";
};
```

Connection gaps:
- Draft shape uses `status: "draft"`; queue entry must rewrite to `"pending_review"`.
- Queue must not invent quote data; empty quotes array is valid.
- Idempotency: re-running auto-create for the same `gameId` must not produce a second queue entry.

### 4. Queue → Approve
Source: User action in review-queue UI.
Sink: Contract tracking ledger (lifecycle begins).

Exact data shape crossing the hop:

```ts
type ApprovedContract = {
  id: string;              // preserved from draft/queue
  gameId: string;
  teams: { home: string; away: string };
  league: string;
  startsAt: string;
  status: "active";
  quotes: QuoteIn[];      // snapshot at approval time
  approvedAt: string;      // ISO-8601 UTC
  approvedBy: "user";
  source: "espn-auto";
};
```

Connection gaps:
- Approval must freeze the quote snapshot; later quote updates must not mutate the approved contract.
- Status transition is one-way: `pending_review` → `active`. No reverse without explicit cancel path (out of scope for this map).

### 5. Track → Grade
Source: Contract tracking ledger.
Sink: Event lands (final score / outcome) → eternal-escrow grading.

Exact data shape crossing the hop:

```ts
type OutcomeEvent = {
  gameId: string;
  finalScore: { home: number; away: number };
  winner: "home" | "away" | "draw" | null;
  landedAt: string;        // ISO-8601 UTC
};

type GradedContract = ApprovedContract & {
  status: "graded";
  outcome: OutcomeEvent;
  grade: {
    result: "win" | "loss" | "push" | "void";
    pointsDelta: number;   // simulated Tumbo points
    gradedAt: string;       // ISO-8601 UTC
  };
};
```

Connection gaps:
- Grading time may be hours after last quote; freshness rule does not apply to grading (only to quote attachment).
- Missing outcome fields from feed must produce `result: "void"` and `pointsDelta: 0`.
- No real-money settlement path may be present.

### 6. Grade → Claim
Source: Graded contract.
Sink: Claimable forever (eternal-escrow view).

Exact data shape crossing the hop:

```ts
type ClaimableContract = GradedContract & {
  status: "claimable";
  claim: {
    available: true;
    expiresAt: null;            // MUST remain null
    pointsAwarded: number;      // simulated Tumbo points
    claimedAt: string | null;   // ISO-8601 UTC when claimed, null if unclaimed
  };
};
```

Connection gaps:
- Presence of any non-null `expiresAt` is a conformance failure.
- Claim action is idempotent: second claim must return the same `pointsAwarded` without double-counting.
- No wallet, network, or transfer fields allowed.

## Cross-Cutting Laws
1. Simulated-points-only: every numeric reward or size field is Tumbo points. Forbidden keys anywhere in any payload: `wallet`, `network`, `order`, `custody`, `settlement`, `mainnet` (and derivatives).
2. Idempotent auto-create: one `gameId` → at most one draft and one queue entry.
3. Claimable-forever: `claim.expiresAt` is always `null`.
4. Quote freshness: reject any quote older than 15 minutes at attachment time.
5. Status vocabulary is closed: `"draft"` | `"pending_review"` | `"active"` | `"graded"` | `"claimable"` | `"cancelled"`.

## Conformance Checklist (every lane must satisfy)
- [ ] Draft entry contains exactly: `id`, `gameId`, `teams`, `league`, `startsAt`, `status` (plus allowed metadata).
- [ ] Review queue entry uses `status: "pending_review"` and preserves `id`/`gameId`.
- [ ] Quotes carry `fetchedAt` and are rejected if age > 15 min.
- [ ] No forbidden real-money / wallet / network keys appear in any exported type or fixture.
- [ ] Auto-create is idempotent on `gameId`.
- [ ] Claimable contracts set `claim.expiresAt = null`.
- [ ] All timestamps are ISO-8601 UTC strings.
- [ ] Points fields are numbers representing simulated Tumbo points only.
