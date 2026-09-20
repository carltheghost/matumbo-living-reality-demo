# Matumbo Living Reality Ω — STATUS

## What it is

Matumbo Living Reality Ω is a local interactive demo of the Living Reality vision.
It shows Reality Lens Ω everywhere: a way to explore the whole system by
zooming from big ideas down into individual details.

This is a working vision demo, not a public financial system.

## Current state

Primary branch: `main`

Current `main` tip: `67d5b3083b639a677c6f1f2f4360561cf5821b89` —
merge of pull request #17 (`gpt/token-ledger-core`) on 2026-09-20.

The current repository also contains subsequent integrated work around:
- the canonical TUMBO-SIM token contract (`docs/TOKEN-CONTRACT.md`)
- the local token-ledger core
- consolidated Agent / Bot Plaza routing
- Hand Lens camera-hand interaction
- the comic photo mascot
- constellation-first Reality Lens presentation and mobile-performance work

### Verification state

The most recent explicitly recorded full-suite result in commit history is
1235/1235 at commit `2e514446c8911ce0404bde7f94d297683385f1ce`.

That result predates the later merge and documentation/integration changes.
A fresh full-suite run against the current `main` tip should be treated as
required before this file is used as release verification evidence.

Historical browser receipts in `work/` and the detailed implementation history
in `docs/` remain evidence for the specific revisions and checks that produced
them; they are not automatically evidence for every later revision.

## What is live

The demo includes:
- Reality Lens Ω
- Floating Person Studio Profile
- Cinematic Avatar Chess Arena
- Luna Companion
- Wardrobe Atelier
- NFT Atelier
- Contract Atelier (fictional rehearsal credits only)
- Rooms
- PayCore simulation
- Ledger
- t402
- Academy
- Sports events
- Agent / Bot Plaza
- Picture Matter
- Hand Lens
- comic photo mascot

In Avatar Chess:
- Pawn = foot soldier
- Knight = rider
- Bishop = herald
- Rook = tower guardian
- Queen and King = crowned monarchs

## Important boundaries

This is a local demo only.

There is:
- No wallet
- No blockchain connection
- No custody of assets
- No mainnet
- No real money
- No external financial execution

These boundaries are permanent unless a separately authorized backend and
security review explicitly change the architecture.

## How to run

Open a terminal inside the project folder.

Run:

python -m http.server 8080

Then open:

http://localhost:8080

Other doors:
- NFT Atelier: http://localhost:8282
- Person Studio: http://localhost:8383
- Luna Companion: http://localhost:8484
- Contract Atelier: http://localhost:8585

## Mission

The goal is to make the Living Reality vision understandable,
playable, and testable through a safe local experience.
