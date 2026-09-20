# Matumbo Living Reality Ω — STATUS

## What it is

Matumbo Living Reality Ω is a local interactive demo of the Living Reality vision.
It shows Reality Lens Ω everywhere: a way to explore the whole system by
zooming from big ideas down into individual details.

This is a working vision demo, not a public financial system.

## Current state

Branch: work/reality-lens-person
Build: f2c069a3 — ledger-core (+ 36 tests)

The demo has:
- 31 connected features
- 1020 out of 1020 tests passing
- 9 out of 9 release boundaries green

New since the last STATUS update: TypeSafe judgment integration
(`src/ai/judgments.js`, `docs/AI_JUDGMENTS.md`) — deterministic local
intent routing for Bot Plaza (`createIntentRouter`) and readiness-ranked
display order for "Contracts for your review" (`rankProposalsForReview`);
default provider is the local deterministic heuristic, live Jev is never
active in the demo.

## What is live

The demo includes:
- Reality Lens Ω
- Floating Person Studio Profile (no floor, hologram rings, glass lens interface)
- Cinematic Avatar Chess Arena using your saved Person appearance
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
- Neural Mesh
- Picture Matter

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

These boundaries are permanent.

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
