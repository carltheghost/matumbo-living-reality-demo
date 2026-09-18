# Migration Snapshot Console

The Migration Snapshot Console is the safe handoff for bringing a small
fixture from an earlier Arena / Living Reality prototype into the current
Block World draft. It accepts a JSON object with an `entries` or `mappings`
array. Each row must identify one of the six known migration entries by its
canonical `id` or `legacyId`.

Example fixture:

```json
{
  "source": "block-migration-snapshot",
  "schemaVersion": 1,
  "entries": [
    { "id": "migration:world-scene-layout" },
    { "id": "migration:world-contracts" },
    { "id": "migration:arena-room" }
  ]
}
```

The console parses and validates that text, previews the matching canonical
rows, and can apply their safe block patches to the existing renderer-only
Block World draft. The host receives frozen `load`, `preview`, `apply-local-
draft`, `replay`, and `reset` snapshots so it can focus the world or hand the
draft to the existing block adapter. The canonical SIMFABRIC projection is
never mutated.

## Controls

The renderer exposes the following mount ids:

- `migration-snapshot-console` / `migration-snapshot-close`
- `migration-snapshot-input` / `migration-snapshot-load`
- `migration-snapshot-file` (one user-selected `.json` / `application/json` file)
- `migration-snapshot-preview` / `migration-snapshot-apply`
- `migration-snapshot-replay` / `migration-snapshot-reset`
- `migration-snapshot-merge4-review`
- `migration-snapshot-status`
- `migration-snapshot-mapping-count`, `migration-snapshot-safe-count`, and
  `migration-snapshot-draft-count`
- `migration-snapshot-selection`, `migration-snapshot-validation`,
  `migration-snapshot-list`, `migration-snapshot-trace`, and
  `migration-snapshot-boundary`
- `migration-snapshot-merge4-status`, `migration-snapshot-merge4-summary`,
  and `migration-snapshot-merge4-records`

`createMigrationSnapshotConsole` accepts a JSON string or a plain JSON-like
object through `loadSnapshot`. `validateMigrationSnapshot` is pure and can be
used before mounting the UI. The adapter rejects malformed JSON, unknown or
duplicate entries, cycles, non-JSON values, and executable-looking fields such
as `run`, `execute`, `code`, `module`, `import`, and `command`.

The **Import local JSON** control is an explicit browser gesture. It reads one
bounded user-selected file with `File.text()` in memory and sends the resulting
text through `loadSnapshot`; the adapter keeps only bounded byte/mime metadata,
not the filename or filesystem path. A file with an unapproved extension/MIME,
an oversized byte/text count, or a read failure is rejected visibly. This is a
data-only chooser, not arbitrary filesystem access, package import, upload,
script execution, or provider sync.

The **Review Merge 4 snapshot** control loads the bundled deterministic
fixture into the safe `merge4-snapshot-adapter`. It displays mapped fabric,
room, event, message, proof, and balanced-journal metadata plus deferred
server-only records. The adapter accepts JSON/object values in memory, never
calls the Merge 4 API, and never hands a record to the Block World apply path.

## Boundary

This is a local social-experiment projection. There is **no filesystem import
of arbitrary paths**: only the explicit one-file `.json` chooser above can be
read, and it is read in memory and discarded after validation. There is no imported-code
execution, persistence, network sync,
identity handoff, token issuance, wallet connection, transfer, custody,
signing, settlement, or publishing. A successful apply creates only an
in-memory Block World draft for the current page. Reset/replay are deterministic
page-session operations; they do not write a file or contact an external
project.
