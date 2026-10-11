# Vivo adaptive graph material

This stage adds a learned material law that works in **3 through 11 spatial
dimensions** while time remains separate. It uses the exact recovered
`services/vivo/models/neural-edge-law.npz` model, SHA-256
`9ab89f46361e397fe41845d86ecc23e38f75561032fd65ae9f8389e9780afdb0`.

The learned network supplies bounded edge stiffness. It does not own identity,
permissions, Eyes, nested worlds, persistence, or accepted history. Those remain
authority responsibilities. Multiple accepted grips may contribute bounded forces
to one entity, which is the numerical prerequisite for later cooperative gripping.

This is a deterministic software material model, not a claim about physical
matter or a replacement for the existing 4D phase-field mode.

Run:

```sh
python -m unittest discover -s services/vivo_adaptive/tests -v
```

Current boundary: driver + tests only. Canonical authority persistence and browser
controls are the next integration stage.
