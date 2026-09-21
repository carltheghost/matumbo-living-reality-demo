# maTumbo Living Reality

A 3D "living reality" demo: a world of translucent glass cubes you can drag anywhere in full 3D — with real 3D chess, plug-in bots, and a fluffy physics-driven Tumbo avatar.

## Try it

**Live demo:** https://carltheghost.github.io/matumbo-living-reality-demo/

Works on desktop and phone. Tested in browser viewports (desktop + 390×844 phone emulation): zero console errors, zero document overflow. Physical-device and XR-headset validation remain open work.

## What's inside

- **Glass-cube world** — one cube style everywhere: translucent blue glass cubes with connection lines. Everything small by default, everything draggable in full 3D, positions remembered. Double-click a cube to travel into its own world; single click selects, hover peeks.
- **Two chess modes** — normal chess stays on the table console; avatar chess is a full 3D board out in the world, played with Tumbo chibi pieces.
- **Fluffy Tumbo avatar rig** — fur-shell technique (opaque root + normal-displaced shells with strand alpha), spring-physics tail, squash-and-stretch landings, springy headphone cups. Same 13 joints as the chibi rig; all animations reused.
- **Simulation engine** — vendored jiggle-physics driving tail, body, and headphone springs from real acceleration; seeded deterministic builds (same seed = same Tumbo).

## Run locally

```
# from the repo root
python3 -m http.server 8080
# open http://localhost:8080
```

## Tech

three.js (pinned), vanilla JavaScript, no frameworks, GitHub Pages

## Design laws

- One cube style everywhere: translucent blue glass cubes with connection lines — no solid boxes
- Everything small by default, everything draggable in full 3D, positions remembered
- Double-click travels in; single click selects; hover peeks
- Panels: fewer tabs, every body scrolls, minimize collapses to small translucent chips
- Simulated points only — never real money or wagering

## Packets / changelog

See docs/ for the packet log (fur rig — Packet 235, simulation engine — Packet 236, …).



## Live launch layer

The static 3D experience can optionally connect to a separate HTTPS API for capabilities that GitHub Pages cannot own by itself:

- **Accounts** — registration, login/logout, salted password hashing, expiring sessions.
- **Multiplayer rooms** — presence, authenticated room events, live Server-Sent Events, and optimistic shared-world snapshots.
- **Live prediction-market data** — provider adapters for **Kalshi, Polymarket, and Manifold**, with source/provider/retrieval metadata. These are read-only observations; no wagering or trading execution is exposed.
- **Data collection** — explicit account-scoped application-event ingestion and a user export endpoint.
- **Shareable links** — add `?api=https%3A%2F%2FYOUR-API.example.com` to the hosted frontend to connect the Live Network console.

Start the API locally:

```bash
npm run start:live
# default: http://localhost:8091
```

The browser remains functional without the API. For a public launch, deploy the API behind HTTPS, set an appropriate CORS origin, and use the resulting API URL in the frontend link. Do **not** put provider secrets or database credentials in the frontend.

### People can do more

Once the live API is connected, visitors can create accounts, join shared rooms, see active participants, exchange room events, synchronize a world draft, inspect live public market observations, and export their own collected app events. The 3D renderer remains the experience layer; the API is the shared data layer.

### Release boundary

Prediction-market observations are informational data, not investment or betting recommendations. This branch does not add brokerage, order placement, wallet custody, signing, settlement, or real-money transfer.

