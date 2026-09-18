# ARENA / Game Lab

ARENA is now an openable local surface in the Living Reality demo rather than
an organ label only. Mission Control opens the Game Lab over the world field.
The console has three deterministic modes:

- **Nebula Rally** — boost, drift, or scan toward sector 7.
- **Chrono Grid** — move around a bounded 3×3 grid toward `(2, 2)`.
- **Orbital Duel** — charge, shield, and pulse against a fictional rival.

Each mode starts from a frozen local state. Choosing an action validates it,
updates the visible state, and appends a bounded event to a stable local hash
chain. Invalid actions are shown as rejected events without mutating the
accepted turn state. **Replay local match** reconstructs the same action trace;
**Reset match** returns the selected mode to its deterministic starting state.

The browser renderer exposes the surface through
`window.__TUMBO_ARENA_GAMES__` for local inspection. Useful methods are
`open()`, `selectMode(modeId)`, `action(actionId)`, `replay()`, `reset()`, and
`getSnapshot()`.

This is deliberately a rehearsal boundary. The Game Lab does not join a
network, run imported game code, create accounts, persist identities, issue a
reward, mint or distribute a token, connect a wallet, or settle value. Its
event hash is a deterministic display/replay aid, not cryptographic proof.
