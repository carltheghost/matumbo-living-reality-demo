# TUMBO-SIM — Product UX: The Wallet Cube

**Simulation only.** Every number on screen is demo points. Nothing here touches
real money, wallets, chains, or custody. The ledger this UI talks to is the local
deterministic `TumboLedger` (`src/ledger.js`); the UI never invents balances —
it renders ledger state and submits actions through it.

## Design laws (held, not softened)

- **One cube style:** translucent blue glass cubes with connection lines, translucent
  from the first frame. Smaller cubes, real zoom-out. No solid boxes, no multicolor solids.
- **Small by default, opens on interaction.** The wallet is a chip until touched.
- **Double-click / double-tap** a cube to travel into its glass-block world;
  single click selects, hover peeks.
- **Fewer tabs; every panel body scrolls;** minimize collapses to small translucent chips.
- **Everything draggable** anywhere in full 3D; positions remembered.

## The Wallet Cube (hub)

- In the world: a small translucent blue glass cube with a "T" glyph, tethered by
  a connection line to the user's avatar. It shows one number: the spendable
  TUMBO-SIM balance (from `ledger.balance(me)`).
- **Single click:** selects; a peek chip shows `balance · sMIMAS · Burrow Score`.
- **Double-click:** travels into the Wallet World — a glass-block room containing
  one small cube per action (Send, Tip, Receive, Exchange, Deliver, Stake, Save,
  Vault, Lock, History, Void, Bots). Each action cube is small; clicking one opens
  its panel. Panels scroll; minimizing any panel collapses it to a chip that stays
  in the room.
- **History cube:** the EchoProof chain rendered as a ribbon of small glass shards,
  newest first. Each shard: `#seq · action · ±amount · hash…abcd`. Click a shard →
  full receipt (entries, prevHash, logical tick). A "verify chain" button re-runs
  `verifyChain()` and shows a green check or the broken link.

## Flows (one per action)

### 1. Send
Open Send cube → recipient picker (nearby avatars/bots as small glass chips; or
type a name) → amount pad (TUMBO, 3 decimals) → memo (optional) → **Slide to send**.
On commit: a glass shard flies from your cube to theirs along the connection line;
both balances update; receipt shard appears in History. If it fails (insufficient
funds) the cube shakes gently and the exact reason shows — no silent failure.
**Reverse:** inside the receipt shard, "Reverse" appears only while the window is
open (shows ticks remaining) and only for the sender. Tapping it asks for
confirmation, then issues the compensating receipt.

### 2. Receive (claims)
The Receive cube pulses softly when a PENDING inbound exists (payment request,
faucet drip, PoP reward). Open → each pending inbound is a card: from, amount,
expires-in (ticks). **Claim** settles it; **Decline** is not a thing — the issuer
cancels, not you (the card says so). Expired cards grey out; the sweeper's cancel
receipt appears in History.

### 3–5. Exchange / Buy / Sell (the Market cube)
One cube, three tabs (few tabs, allowed here). Shows the oracle rate
(`1 sMIMAS = 1,000 TUMBO`), your balances, and the **Void tithe preview**:
"10 bps → The Void (burned, visible)". Flow: pick direction → amount → **quote**
(quote card shows price + expiry in ticks) → review screen with slippage guard note
→ **Execute**. The tithe is animated as a small ember flying off to the Void cube.
No "reverse" button here — the panel states plainly: *"Market trades reverse only
by trading back at the live price."* Failed quotes (expired / oracle moved) show
why, with a one-tap re-quote.

### 6. Deliver (escrow for Arena contracts / commissions)
**Create:** recipient → amount → contract memo (e.g. "Arena bout #7") → expiry →
**Lock in escrow**. Funds visibly move into the Escrow glass box (a locked cube
inside the Wallet World). State chip on the card: `PENDING`.
**Recipient view:** their Deliver cube shows incoming escrows with **Confirm
receipt** (releases funds) — no confirm, no release, ever.
**Sender view:** **Cancel** available while PENDING (funds fly back).
Post-confirm disputes: no user button — an "appeal to arbiter" affordance that
routes to the AI autonomy gate (logged, never silent).

### 7. Tip
Like Send, but the panel is celebratory and instant: big amount presets
(1 / 5 / 25), a "fling it" gesture (flick the shard toward their cube). The panel
states once, quietly: *"Tips can't be taken back — that's what makes them tips."*
No reverse affordance for the sender, ever. (Fraud path exists via arbiter gate;
it is not a user button.)

### 8. Stake (Arena)
Pick a contract (Arena bout card) → amount → unlock horizon (ticks) → slash %
shown up front ("lose X% if your side loses — burned to the Void") → **Stake**.
The stake appears as a glowing cube inside the Vault room with a countdown ring.
**Unstake** unlocks only after the ring completes. **Slash** is not a user action;
when the Arena resolves against you, the slash animation burns the cut to the Void
cube and the rest flies home — each step its own receipt.

### 9. Save (pockets)
"New pocket" → name a goal ("moon-trip") → amount → **Save**. Pockets are small
glass jars on a shelf in the Wallet World, each labelled, each its own balance.
Tap a jar → **Withdraw** (full amount back, instantly — the reverse receipt).
Guidance copy: *"Saving in chunks lets you withdraw in chunks."*

### 10. Deposit (Hibernation Vault)
The Vault is the heaviest-looking glass in the room — slow, cold, serious.
Amount → term (ticks; presets) → the panel shows the maturity tick and projected
Burrow Score, then the hard line, impossible to miss: **"No early exit. Not by
you, not by anyone, until the tick."** → **Seal it**. The deposit becomes a frozen
cube with a frost ring counting down. At maturity it thaws; **Withdraw** releases
funds + credits Burrow Score (a small badge flies to your profile).

### 11. Lock (generic)
"Lock amount until tick N" → **Lock**. A plain sealed cube with a countdown.
**Unlock** appears only at/after the tick. Copy: *"Locks don't cancel. That's the
point."*

### 12. Reverse (inside receipts, not a cube)
Reverse is never a standalone cube — it lives inside eligible receipt shards
(send-by-you within window; save anytime by you; everything else via arbiter).
Each shows: what reverses, what stays burned ("the Void tithe stays burned"),
and the window countdown. One tap, one confirmation, one compensating receipt
linked to the original (`reverses: #seq`).

### 13. Cancel (inside pending cards, not a cube)
Pending intents (deliver escrows, payment requests) show **Cancel** to their
creator only. One tap → escrow flies home → card flips to `CANCELLED` with its
receipt. Settled cards never show Cancel (they show Reverse rules instead).

## Infinite Burrow surfaces

- **Hunger Meter:** a thin ring around the Wallet Cube fills as sinks accrue;
  tap → breakdown (Void tithes, bot fees, slashes) with receipt links.
- **The Void cube:** a dark glass cube at the edge of the Wallet World. Inside:
  cumulative burned per asset + the burn receipt ribbon — *"permanent world
  history."* Nothing in it is clickable except receipts.
- **Burrow Score:** a small badge on the avatar peek chip; tap → score history
  (deposit id, ticks held, score granted — each tied to its withdraw receipt).
- **Proof of Presence:** achievement toasts ("First district visited") carry a
  **Claim** button → creates the pending reward → lands in the Receive cube.

## Bot x402 surfaces (Bot Plaza tie-in)

- Service bots show a tiny `402` glyph when a resource costs. Tapping it opens the
  **challenge card**: resource, price, pay-to, expiry ticks → **Pay** (one ledger
  tip, memo-bound) → card flips to `200 OK` and the resource renders.
- Bot owners get a **pricing panel**: per-resource price list (fluff), editable;
  and a velocity meter showing the 10-tick spend cap.
- Every bot payment is a normal receipt shard — bots' tips follow the same
  no-sender-reverse rule, visible in copy.

## States, empty states, failure copy

- Every async step shows: `working… → settled (#seq) | failed (reason)`.
- Reasons are the ledger's own error codes translated once, plainly:
  `INSUFFICIENT_FUNDS` → "Not enough TUMBO-SIM."; `WINDOW_CLOSED` → "The reverse
  window has passed."; `VAULT_SEALED` → "The Vault doesn't open early. Ever.";
  `QUOTE_EXPIRED` → "Quote expired — tap to re-quote."; `SPEND_CAP` → "Bot spend
  limit hit — wait a few ticks."
- Empty states: "No pending claims." / "The Void is empty. For now." /
  "No locks. The Vault is bored."

## What the UI must NEVER do

- Never show a dollar/fiat value next to TUMBO-SIM. No prices in USD, ever.
- Never imply the points are withdrawable, transferable off-world, or "real".
- Never hide the Void tithe or slash % — sinks are always previewed before commit.
- Never offer reverse/cancel where the ledger forbids it (the UI reads the same
  policy table; a disabled button cites the rule).
- Never silently use the arbiter gate — gate actions are explicit, logged, and
  labelled "arbiter (logged)".
