# Semantic Block Fabric

A semantic block is a local projection entity with a stable `id`, a domain-owned `kind`, provenance/evidence, and an explicit simulation boundary. Blocks are assembled into a deterministic world state and projected into the scene as organs, semantic objects, relationships, rooms, and readouts.

Required contribution fields:

- `schemaVersion`
- `source`
- `simulation: true`
- `updatedAt`
- `entities`
- `evidence`
- `capabilities`

The renderer consumes blocks; it does not become their source of truth. Any user interaction becomes a simulation-only intent and must return to the owning domain for future authorization work.
