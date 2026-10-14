# Vevo Agents repository preservation

Status: isolated experimental source preservation only. This directory does
not replace the canonical Living Reality application, change its deployment,
or accept the Vevo experimental results.

## Provenance

- Source project: separate `/workspace/vevo-agents` checkout.
- Copied source commit: `1868189eb0306d7a68dfd1eec26203cdea90f73f`.
- Target repository: `carltheghost/matumbo-living-reality-demo`.
- Target base commit: `4f3c43ccfb8abfdc14422dfddc2b55c8f1660b5c`.
- Preservation branch: `experiments/vevo-agents-preservation-2026-10-14`.
- Scope: only the new `experiments/vevo-agents/` subtree.

No Vivo/Site runtime files, deployment workflows, private notes, user data,
credentials, or proprietary notes-application code were copied or modified.
The reports are synthetic local experiment outputs and are labelled as
historical/imported evidence. NumPy remains a declared environment dependency;
its source is not vendored.

## Included files

- `src/vevo_agents/`: Vevo source, including the frozen v0.1/v0.2 material and
  the corrected, not-yet-trained v0.3 protocol.
- `tests/`: the copied unit tests, including the v0.3 protocol tests.
- `pyproject.toml`: the minimal Python package/dependency declaration.
- `docs/`: architecture, v0.2/v0.3 correction, provenance, progress, and this
  preservation record.
- `reports/imported/`: `v01-proof-report.json`, `v02-proof-report.json`, and
  the two clearly labelled v0.2 smoke reports copied from the source checkout.
- `storage/` and `reports/generated/`: ignored locations for future local
  state and newly generated reports; no user data is included.

## Storage contract

From `experiments/vevo-agents/`, use the exact workspace path
`storage/notes.sqlite3` when a persistent SQLite workspace is desired:

```python
from vevo_agents.workspace import NoteWorkspace

workspace = NoteWorkspace("storage/notes.sqlite3")
```

The current proof code intentionally uses in-memory workspaces for episodes
and temporary files for its persistence checks. It does not create the
persistent file unless a caller supplies this path. Checkpoint JSON belongs in
`storage/checkpoints/`, for example by passing
`storage/checkpoints/state.json` to `SimFabricStore.save(...)`.

## Commands

Non-training checks:

```sh
cd experiments/vevo-agents
PYTHONPATH=src python -m unittest discover -s tests -v
PYTHONPATH=src python -m unittest tests.test_v03_protocol -v
```

Optional v0.1/v0.2 reproduction commands perform optimization work and write
new reports; they are not required to use the preserved source and are not an
acceptance run:

```sh
PYTHONPATH=src python -m vevo_agents.proof --output reports/generated/v01-proof-report.json
PYTHONPATH=src python -c 'from vevo_agents.v02_proof import run_proof; run_proof(output_path="reports/generated/v02-proof-report.json")'
```

## Backup

From the repository root, back up mutable SQLite/checkpoint state with:

```sh
tar -C experiments/vevo-agents -czf /tmp/vevo-agents-storage-backup.tgz storage
```

Copy the archive to a user-controlled backup location after checking its
contents. Do not commit private notes or generated personal state.
