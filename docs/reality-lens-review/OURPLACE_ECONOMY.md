# Ourplace: reshape, share, use, attribute, settle

Ourplace adds a usable local economic rehearsal to the existing Reality Lens. It uses the same canonical TUMBO engine as balances, transfers, activity, quotes and vault tools. It does not introduce another token ledger. The user can describe a design, review its effects, apply it to the actual world, share a portable licensed design and inspect usage, attribution and funded rewards.

## Try the whole loop

1. Run the checkout with `run_local.bat` and keep the same browser origin. Open **Value & contracts → Asset Token → Open Ourplace**.
2. Expand **Fund local rehearsal balances**. Add demo TUMBO and compute credits explicitly, then transfer some of your TUMBO into the reward pool. TUMBO funding transfers from the finite existing faucet; it does not mint supply. Demo USD credits are a separately labeled simulation denomination.
3. In **Create & share**, enter `blue; background navy; compact; grid; reduced motion; selected object wave`. Preview the supported and unsupported clauses, then apply. Palette, body arrangement, density, motion and supported object forms change in the actual assembly. Undo restores the prior design. Operating-system reduced-motion preferences remain respected.
4. Give the design a name, category and attribution license. Publish it in the **local** catalog and download its JSON share package. Categories are layout, object, tool, agent, workflow and experience. These categories describe declarative designs; unknown object/tool references remain visible intents rather than installed executable code.
5. Switch to a separately named local test participant and apply the published design. A qualifying local observation creates an entitlement. Repeated sessions, self-use, ancestor self-use and repeated actor/design/day combinations do not create more rewards.
6. Select a licensed parent when publishing a remix. Use of that derivative credits the unique creators in its ancestry; the current rehearsal splits an exact integer budget equally, with deterministic remainder handling. Downloaded packets preserve version, descriptor, license and lineage.
7. Settle the entitlements explicitly. The canonical reward pool must cover the exact payout. Inspect its receipt and **Receipts & proof**. Pending, reserved, paid and reconciliation-required are different states.
8. Reload the same origin. The paired bundle restores the canonical journals and domain history together. A corrupt or inconsistent component is rejected before it can replace the active token owner.
9. To share an edit of an imported package, expand **Review a shared package**, paste and review the original JSON, and apply it. Make and apply an edit, choose its name, category, license and declared local author, then select **Review edited derivative** and **Download reviewed derivative**. The portable derivative keeps all licensed ancestors and remains unverified. Changing the descriptor or sharing details after review requires another review. The separate original-package download remains available.

Voice design is an optional user-triggered browser capability. Where speech recognition is unavailable, typed instructions remain usable. Neither a transcript nor a shared package applies itself or executes arbitrary code. The local grammar is bounded; it is not a general-purpose authenticated AI redesign engine.

## Economic channels

| Flow | Executable local behavior | Boundary |
|---|---|---|
| Creator designs | Review/apply/undo, versioned local publishing, portable sharing, adoption and derivative attribution, finite funded payouts | Test participant identities and local observations do not prove a public audience or prevent Sybil identities globally. |
| Compute | Explicit budget and reservation, installed deterministic text tool, execution commitment, simulated reconciliation, unused-credit release, cancellation/refund, funded usage claim | Provider responses and token counts are separate from authenticated billing; unavailable billing adapters cannot mark real bills verified. |
| Contribution consent | Metadata-only proposal, explicit scope/provider consent, retention, acceptance, revocation and capped funded claim | No raw conversation/file corpus is stored or uploaded by this vault. Local beneficiary roles do not establish legal identity ownership. |
| Services | Exact payer reserve; one-journal creator/provider/operations split after evidence; cancellation; recipient-approved compensating refund | Delivered payees may spend their balance. Refund exposure is visible and a refund requires available funds. |
| Order book | Exact rational limit prices, purpose reserves, compatible manual fills, partial fills and cancellation | A local fully reserved spot rehearsal over the two canonical demo assets; no external exchange, AMM or derivatives execution. |
| Collateral credit | Lender-owned capital, borrower collateral, fixed/APR interest, fresh two-source valuation gates, repayment, guarded default and in-kind liquidation | Local oracle roles are explicit fixtures. Seized collateral has a local valuation; it is not cash proceeds or guaranteed debt recovery. Residual debt remains visible. |
| Prediction contracts | Immutable question/evidence/deadlines, segregated stakes, evidence-bound proposal, challenge, two named approval roles, exact parimutuel payout or INVALID refunds | Local simulation; named roles are not verified independent humans, and no real-money wager is executed. |
| Purpose pools | Explicit rewards/reserve/insurance/operations funding and separately authorized irreversible reserve burn | Customer principal, held orders, loan collateral and prediction stakes cannot fund an unrelated reward or burn. No new supply decision is made. |
| Proof/world | Canonical journal linkage, SHA-256 event ancestry, amount-bearing Merkle-sum balances, liability commitments and read-only world projections | The canonical receipt chain uses FNV for local integrity. SHA-256 commitments have no external anchor, signature or custody authority. |

The default creator rehearsal grants **10 fluff (0.010 TUMBO-SIM) per qualifying use**, subject to 20 actor uses per period, 1,000 fluff per creator per period and 10,000 fluff total per period. The runtime uses UTC days. These are explicit local policy defaults, not promised token compensation or a final production monetization policy. Compute/contribution incentives have a separate daily funded cap. A cost-based loyalty calculation is an eligibility basis; only a canonical pool debit is a payment.

Compute economic allocation operates on **positive margin after provider and payment/operations costs**. Integer basis points and exact remainders prevent allocating more than the available margin. The local credit calculation does not automatically convert demo USD into TUMBO or acquire customer funds.

## Shared ownership and persistence

`economic-runtime.js` assembles creator records, finance state, compute credits/jobs, consent and timelines around `economic-kernel.js` and the existing `QuoteEngine`. One economic command has a full-payload idempotency binding and at most one atomic token journal. Domain handlers validate before settlement. Guarded payout and incentive callbacks prevent ledger observers from cancelling, revoking or refunding the source while its payment commits.

Purpose accounts beginning `b:econ-` or `b:economic-` require a private owner-issued debit handle in `TokenLedger`. Ordinary transfer, wallet, activity, quote and vault adapters cannot sweep these balances, including through their existing internal-system authority. The capability is rebuilt by the runtime after validated replay; it is not serialized into a share package or receipt. This is in-process application ownership, not a secure boundary against a person who controls browser JavaScript or storage.

Generic token lifecycle reversal also rejects economic-domain journals, including payments that have already released their escrow. Their owning domain must authorize compensation and record the matching state transition. This preserves service refund approvals and keeps paid creator, compute, trade, loan and prediction records aligned with their canonical receipts; ordinary token transfer reversals retain their existing behavior.

Restoration resolves each reversal to the same original receipt by both ID and key, validates its lifecycle window and exact compensating legs, and rejects economic payouts reversed outside their domain. A checksum alone cannot turn unrelated value movements into a valid compensation. Contradictory historical bundles are rejected before adoption rather than silently reconciled.

The bundle at `matumbo.ourplace.economic-runtime.v1` contains the paired canonical token snapshot, sealed economic commands, credits, usage, consent, creator history, reviewed design session, observations and rehearsal-clock offset. Restore validates each stream, canonical journal ownership and cross-stream obligations/claims before adoption. A valid older prefix cannot erase a payout's refund protection while preserving its newer canonical journal. An already active canonical owner is never silently replaced. `restoreStatus` describes load validation separately from later autosave status.

Browser origins have separate data. Export before deliberately clearing site data. Portable design import validates structure, license constraints, acyclic lineage and integrity. Its declared creator remains unverified; an imported author claim cannot become a funded local payout authority. Unregistered imported lineage is not silently relabeled as a fresh locally owned design.

Design sessions preserve their origin through ordinary edits, undo and reload. A changed legacy session without origin evidence remains usable but is quarantined from publishing; **Start fresh design** explicitly creates a new local origin. **Download reviewed original package** re-exports the original licensed packet. **Download reviewed derivative** exports the current applied edit as `matumbo-unverified-derivative-v1`, attaching complete unchanged licensed ancestry, a new design ID and a declared local author. It requires a matching reviewed source and explicit current-design review; share-alike terms, bounded packet size, node count and longest ancestry depth still apply. Reimporting and editing a derivative preserves that chain. Its checksum checks packet integrity; its source hash and author claims do not attest external identity or publication. Export does not change session origin, create a local catalog entry, entitlement or payout authority. Rewarded remixes currently use parents already published in this browser's local catalog. Cross-browser creator registration and reward settlement require the unavailable verified registry and identity adapters.

The shared owner stops before 3,000 canonical journals or 1,000 issued quotes. Their combined receipt registries remain within the bundle's row limits, including quote cancellations. Existing exact retries remain available at capacity. Failed adoption validation removes its provisional observation, and observations are bounded before insertion. Reload verifies that the rehearsal-clock offset equals the sum of recorded clock commands. A full timeline displays a projection notice while preserving the paired compute debit and usage receipt.

## Supply and public rollout

The repository's existing configuration remains authoritative for the local demo. The recovered 40-trillion genesis / 3-trillion launch figures were an earlier assistant proposal with no visible human supply approval. They do not replace the current internal fluff configuration, allocation fixtures or historical alternatives. `publicSupplyDecision` remains `undecided`.

External production work requires concrete adapters and governance: authenticated identities and anti-Sybil adoption evidence, a public design registry, accountable provider execution/billing, public data consent governance, trusted valuation/resolution evidence, signing/custody/settlement and an approved public supply/economic policy. The UI states those unavailable boundaries. This branch makes the local mechanisms reviewable; it does not claim that those services are deployed.

## Reproduce validation

```powershell
py -3 scripts/run_tests.py
py -3 -m unittest discover -s tests -p "test_*.py"
node --test tests/economic-kernel.test.mjs tests/economic-runtime.test.mjs tests/creator-economy.test.mjs tests/compute-jobs.test.mjs tests/economic-finance.test.mjs tests/economic-primitives-safety.test.mjs
```

The review artifacts include real Chromium software-WebGL desktop/phone interactions, route/native-body inspection, economic invariant tests, paired-restore probes and extracted-package replay. Hardware GPU, microphone permissions, real phones, WebXR and authenticated NVIDIA billing require distinct evidence. A local test or successful HTTP response is not a public deployment.
