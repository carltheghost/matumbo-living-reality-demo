# Universal Panel Layout

The shared panel-space manager treats feature consoles as independent local windows.

## Every managed panel

Desktop and XR panels can be:
- moved horizontally or vertically by dragging the panel grip;
- pushed forward or backward with SHIFT-drag or wheel;
- resized from all eight edges and corners;
- arranged LEFT, RIGHT, TOP, BOTTOM, FRONT, BACK, or FREE;
- brought to the front without changing its location;
- minimized and expanded without recentering;
- restored with its saved position, depth, size, compact state, and stacking order.

The manager also discovers panels created after boot, including lazy feature consoles.

## No-jump rule

Opening a different feature does not reset another panel. A hidden-to-visible transition reuses the existing saved layout instead of creating a new default location.

Existing v1 panel positions are migrated into the v2 layout store.

## Boundaries

This is presentation state only. It does not change feature authority, world state, identity, wallet, ledger, signing, settlement, provider access, or external execution.