# Contract Review Queue — Integrator Wiring

## Mount point (Contract Atelier HUD)

Mount the review queue on the Contract Atelier HUD root (or a dedicated HUD slot).
Prefer a single floating-panel host so mobile can enforce one visible panel at a time.

```js
import { renderReviewQueue } from './render/contract-review-queue.js';
import { rankProposalsForReview } from './bot-plaza.js'; // adjust path to actual bot-plaza export
```

Suggested host element (create once inside Atelier HUD init):

```js
const queueHost = document.createElement('div');
queueHost.id = 'atelier-review-queue-host';
// Append to the same HUD container that holds other Atelier floating panels
atelierHudRoot.appendChild(queueHost);
```

## Feed ranked drafts

`rankProposalsForReview` returns frozen ranked proposal entries. Pass that array as `drafts`.
Refresh on plaza updates.

```js
function getRankedDrafts() {
  // Whatever the plaza state object is named in your bundle:
  return rankProposalsForReview(plazaState) || [];
}

let reviewQueueApi = null;

function mountReviewQueue() {
  if (reviewQueueApi) {
    reviewQueueApi.dispose();
    reviewQueueApi = null;
  }

  reviewQueueApi = renderReviewQueue({
    root: queueHost,
    drafts: getRankedDrafts(),
    notify: ({ title, body }) => {
      // Hook into existing toast / notification bus (Reality Lens Ω HUD)
      if (typeof window.notify === 'function') {
        window.notify({ title, body });
      } else if (typeof atelierNotify === 'function') {
        atelierNotify({ title, body });
      }
    },
    onOpenContract(entry) {
      // Open the draft in the Contract Atelier 3D / detail view
      // e.g. atelier.openProposal(entry.id || entry.proposalId)
      if (typeof atelier !== 'undefined' && atelier.openProposal) {
        atelier.openProposal(entry);
      }
    },
    onApprove(entry) {
      // Move draft toward open contract (plaza / atelier state transition only)
      // Simulated TUMBO points only — no wallet, signing, custody, or settlement
      if (typeof plazaApproveDraft === 'function') {
        plazaApproveDraft(entry.id || entry.proposalId);
      }
      // Refresh queue after state change
      if (reviewQueueApi) {
        reviewQueueApi.update(getRankedDrafts());
      }
    },
    onReject(entry, reason) {
      // Remove draft with reason
      if (typeof plazaRejectDraft === 'function') {
        plazaRejectDraft(entry.id || entry.proposalId, reason);
      }
      if (reviewQueueApi) {
        reviewQueueApi.update(getRankedDrafts());
      }
    },
  });
}

// Initial mount
mountReviewQueue();

// Re-feed when plaza rankings change
function onPlazaProposalsChanged() {
  if (reviewQueueApi) {
    reviewQueueApi.update(getRankedDrafts());
  }
}
```

## Mobile (viewports ≤700px)

- Only one floating panel visible at a time. Before showing the review queue, hide other Atelier floating panels (or let a HUD panel manager enforce exclusivity).
- Queue is bottom-docked, collapsible, max width 390px, safe within 390×844.
- Touch targets are ≥44px (buttons and collapse control).

Example exclusivity helper:

```js
function showOnlyReviewQueue() {
  document.querySelectorAll('.atelier-floating-panel').forEach((el) => {
    if (el.id !== 'contract-review-queue') {
      el.classList.add('crq-mobile-hidden'); // or your hide class
    }
  });
}
```

## Keyboard

- Escape collapses the queue panel.
- Tab / focus-visible styles on Approve, Reject, Open, and Collapse.

## Teardown

```js
function unmountReviewQueue() {
  if (reviewQueueApi) {
    reviewQueueApi.dispose();
    reviewQueueApi = null;
  }
}
```

## Iron law reminder

All TUMBO values shown are simulated / projection-only. No real money, wallet, signing, custody, settlement, or mainnet interaction from this UI.
