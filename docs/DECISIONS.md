# Decisions

1. The exact OneDrive Living Reality folder remains the canonical source; no replacement app is created.
2. Control 1 integrates worker commits only after branch, diff, handoff, and test verification.
3. Each domain owns its projection contribution; SIMFABRIC owns deterministic ordering and replay.
4. The renderer can inspect and emit intent events, but cannot perform authority-bearing side effects.
5. The unified runtime ZIP is treated as a separate server-backed package; it is not copied over the static Living Reality source during this bootstrap.
6. Mock/demo evidence is labeled as simulation and never promoted to live truth.
