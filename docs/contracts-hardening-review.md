# Contract hardening lane — conformance review (lane/contracts-hardening-gpt)

Date: 2026-09-20. Reviewer: coordinator (integrator-side review of the GPT
hardening lane output against the canonical repository at
`work/reality-lens-person` head `aef56a94`).

## Verdict: DO NOT integrate the delivered rewrite as-is

The lane delivered wholesale rewrites of four canonical modules:

- `src/domains/outcome-contracts.js` (delivered ~500 lines vs canonical 1042)
- `src/domains/contract-atelier.js`
- `src/domains/frozen-relics.js` (delivered vs canonical 597 lines)
- `src/domains/contracts-markets.js` (delivered vs canonical 758 lines)
- `tests/contract-hardening.test.mjs` (30 tests)

Placing these files would CLOBBER hardened canonical implementations and
break the 85 existing canonical contract tests (all green). The delivered
files were verified to be incompatible, not merely stylistically different.

## Conflict map

1. **Status vocabulary — outcome-contracts.** Delivered:
   `draft/open/joined/locked/graded/paid/cancelled`. Canonical:
   `draft/open/locked/graded/settled/claimed/voided` (with eternal-escrow
   `settled → claimed` and pre-grading `voided`). The cross-review lane
   (`lane/contracts-review-grok`) documented yet another target vocabulary
   (`draft/pending_review/active/graded/claimable/cancelled`). Three
   vocabularies are now in play; reconciliation is still required before any
   contract merge.
2. **Payout kinds.** Delivered:
   `winner_takes_pool/split_pool/refund/no_payout`. Canonical:
   `award/refund/no_stakes`. Different design, not a strict superset.
3. **Contract atelier logic kinds.** Delivered:
   `equals/not_equals/greater_than/.../between/in/any/all`. Canonical:
   `condition/and/or/if_else`. Incompatible models; canonical tests pin the
   canonical kinds.
4. **Frozen relics.** Both use Proxy immutability + integrity hash; canonical
   additionally carries the full boundary/violation text, award-NFT minting,
   and the life-history envelope. Delivered adds nothing.
5. **Contracts markets.** Canonical already exports `ContractState`,
   `PositionSide`, `RiskBand` — the same surface the delivered file
   re-defines — plus draft route state, capabilities, and provenance hosts.

## Hardening goals: already satisfied by canonical

Checked each goal of the hardening brief against canonical; all are present
and covered by the 85 canonical tests (verified green in this lane tree):

- Illegal lifecycle transitions throw (canonical: "illegal lifecycle
  transition" guard).
- Accounting invariants: stake sum == pool, awards == pool, escrow == awards,
  eternal escrow `expiresAt: null` enforced.
- Anti-double-join (idempotency keys + duplicate checks), anti-double-grade
  (`planGrading`), anti-double-claim.
- Deterministic grading (FNV-1a over canonical JSON).
- Frozen-core immutability via throwing Proxy + integrity hash verification.
- Projection-only surfaces with no wallet/signing/custody/mainnet.

## Genuinely novel ideas worth considering (not yet in canonical)

- The delivered `SPLIT_POOL` remainder-distribution loop (give remainder +1
  to earliest winners) is a concrete algorithm canonical "award" does not
  spell out; if canonical award splitting needs a remainder rule, adopt the
  delivered one with a test.
- The delivered `planGrading` "graded contract cannot be graded against
  another event" error message is clearer than canonical's equivalent; copy
  the message wording only.

## Recommendation for the integrator

1. Skip the delivered rewrites entirely.
2. Reconcile the three status vocabularies BEFORE merging any contract lane
   (canonical vs review-lane target vs this lane's delivered set). Until then,
   no contract lane merges.
3. Port only the two micro-items above, each with its own test, as normal
   canonical-tree work — not as a lane.

Gates in this lane: canonical contract tests 85/85 green; delivered files
intentionally NOT placed, so no new tests were added by this lane.
