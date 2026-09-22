# Side Living Reality

The current Reality Lens already makes a cube an explorable place. This layer makes the **reality behind that place** a first-class local object.

```text
                    Reality A
                       |
                    fork/branch
                       |
                 Side Reality B
                  /          \
             Portal          Portal
               /                \
        Reality C            Reality D
```

A reality owns its own state snapshot. Forking copies that snapshot at a point in time; subsequent edits stay inside the chosen reality. Connections are explicit graph edges, so traveling is a graph operation rather than an implicit scene mutation.

## API

`createRealityGraph()` creates the root reality.

`fork(sourceId, options)` creates an independent side reality and a directional fork edge.

`connect(fromId, toId, options)` adds an explicit portal or fork edge.

`canTravel(fromId, toId)` and `travel(toId)` enforce explicit connectivity.

`updateState(id, nextState)` replaces only one reality's state.

`getSnapshot()` returns the graph for a renderer or test harness.

## Renderer direction

The graph is renderer-agnostic. The Reality Lens glass-cube scene can map each graph node to a cube, map edges to connection lines/portals, and make a double-click or explicit travel action change the active reality. That is the bridge from the current cube-world demo to the side-living-reality concept.

This first layer is local-only and does not add network synchronization, wallets, custody, blockchain writes, or external persistence.