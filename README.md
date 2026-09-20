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

