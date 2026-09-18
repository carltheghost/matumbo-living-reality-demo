# Merge 4 snapshot adapter

The adapter is the next migration seam after the block snapshot console. It
accepts a caller-supplied Merge 4 world object (or JSON text) in memory and
reduces safe metadata into a frozen SIMFABRIC-compatible projection envelope.
It does not call the Merge 4 API, read a file, write PostgreSQL, or mutate the
renderer’s canonical world.

## Accepted shape

```json
{
  "worldId": "demo",
  "version": 3,
  "updatedAt": "2025-01-01T00:00:00.000Z",
  "state": {
    "usedEvidence": [],
    "events": [],
    "fabric": { "entities": {}, "relations": [] },
    "rooms": [],
    "messages": [],
    "ledger": [],
    "proofs": []
  }
}
```

The validator makes a descriptor-safe JSON copy, rejects getters, functions,
cycles, executable-looking keys, non-finite values, invalid world IDs, missing
collections, duplicate consumed evidence, unbalanced journals, and oversized
collections. It never invokes a caller-owned getter.

## Mapping and deferred records

Fabric entities, relations, rooms, event records, sealed-message metadata,
proof metadata, and balanced journal summaries become local simulated entities.
Consumed evidence and event references become simulated evidence records. The
envelope always has `simulation: true` and `authority: "none"`. Messages keep
metadata only; ciphertext/content is not opened. Ledger legs are summarized
after balance validation; no settlement occurs. Proofs are declared metadata,
not production cryptographic verification. The result lists those boundaries
as deferred review records and exposes an explicit denied server-write
capability.

This adapter is therefore suitable for a future Migration Bridge preview or a
test fixture import. A live Merge 4 integration would still require separate
credentials, consent, threat modeling, persistence review, optimistic-version
handling, and deployment authority.
