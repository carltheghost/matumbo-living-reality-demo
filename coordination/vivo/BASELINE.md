# Vivo: five-window implementation baseline

Status: recovery + interface freeze, not a product release. Chat 1 is design and
integration authority for this work. Only Tumbo may authorize a merge.

## Repository baseline

- Repository: `carltheghost/matumbo-living-reality-demo`.
- Inspected main: `b0a59ab4233cb5daa4ea63d43cd73fabc61842f6`.
- Root tree: `7b926a35483025c2ac2de8c4f4cc4ee69b2b7e01`.
- Feature branch: `vivo/chat1-integration-2026-10-10`.
- Freeze workers at the full PR HEAD SHA in the coordination handoff, not a moving
  `main` or an earlier PR #73 tip. Supporting work is PR-only; no force-push/merge.
- The untouched root `field-lab-studio.html` is comparison only. Its blob is
  `39292cd61c6c62168652e133fd5e6b9b35fea886` (Studio 0.7 launcher).
- Root `index.html`, `src/main.js`, `src/field-lab/`, existing domain modules and
  Pages workflow remain untouched. The new branch must not auto-publish Pages.

## Actual recovered inputs

1. `matumbo-viva-build-081-source.zip`, 13,151,985 bytes.
   SHA-256 `6c5b0338f413385fd34934ce290fcc3459a33788c1de7f763316a89061d34a72`.
   Extract `matumbo-viva-build-081/` into `services/vivo/`.
2. `viva-phase-fabric-research.zip`, 8,391,115 bytes.
   SHA-256 `adcda4383e98903a12711ceeaf6fef48ddfb60214e206a9f502339bdea50f278`.
   Extract `viva-phase-fabric/` into `research/vivo-phase-fabric/`.

The archives were mounted and inspected, not reconstructed from conversation prose.
`recovered-files.json` records all 140 source/asset members with byte hashes.
The source archive has 109 members; the research archive has 31. Generated images,
previous evidence, trained weights and licences retain their original provenance.
Old claims inside them are historical reports, not fresh validation.

The PR publishes recovery tooling, contracts and the checked solver/scheduler.
The larger recovered 0.8.1 tree/assets are an **artifact-backed overlay** at this
initial coordination checkpoint, supplied in the baseline ZIP. They are not all
Git-tracked yet. This distinction is deliberate and must not be described as a
fully imported runtime or a deployable release. Before any parallel edits:

```
python scripts/vivo/recover.py --artifacts /path/to/original-zips --workspace .
python scripts/vivo/recover.py --artifacts /path/to/original-zips --workspace . --verify-only
```

Alternatively use the supplied baseline ZIP, whose directory layout is identical.
Do not overwrite existing modified files to recover. Script fails on any conflict.
No network access or source rewriting is used. Chat 1 alone owns later Git import
of these original files; other workers commit ONLY new files in their assigned
subdirectories. Do not use `git add -A` on the overlay.

## Inspected current source and discrepancies

Read GitHub's root tree, `AGENTS.md`, the `.tumbo` tree, `src` tree, the exact Studio
launcher and `.github/workflows/deploy-pages.yml` at the pinned main SHA.
`AGENTS.md` refers to continuity/ownership/interface files not present in this tree;
`.tumbo` contains two earlier field tasks. This packet supplies the scoped Vivo
ownership; it does not replace the existing landing/dock contracts.

The new 0.8.1 shared runtime is not a main-branch root directory. Its `server/app.py`
advances learned route guidance, not the phase solver. `web/shared.js` drops movement
while awaiting acknowledgements and has a separate rendering throttle. Its field
mesh samples a two-parameter surface even when entities have more coordinates.
`/readyz` still gates personal use. Preserve the original code while adapting these
paths; see recovered `research/vivo-phase-fabric/docs/AUDIT.md`.

## Design contract

One persistent adaptive field/world, native independent spatial axes (2-11 in the
new protocol; old runtime supports 3-11), and a separate simulation clock. Memory,
phase, branch IDs and time are not extra spatial coordinates. Explicit field domain
and intrinsic dimension; no 2D mesh advertised as full 11D matter. Interaction drives
material laws. Learned material, intent and room responses are distinct versioned
models, evaluated against stronger baselines before promotion.

Nested spaces preserve entity/world identity. Each participant retains independent
Eyes, chart/frame, slice and return stack. Accepted history, provisional motion,
recorded past and predicted futures are distinct. Local use does not need a server;
remote use adds one accepted authority. Offline shared edits require an explicit fork.
Camera/video/gaze data stays local unless a separate explicit action authorizes it.
Glare/dark display rules never fabricate tracking. Touch must survive hand loss.

The end-to-end gate is TWO participants shaping ONE persistent object, moving it
through actual extra coordinates, entering its inner space, changing it, returning,
reconnecting/restarting, and recovering the same accepted changes independently of
views. Tests of a schema or local socket are not that completed product gate.

## Verification at recovery

Fresh runs: 97 original server/geometry/TLS/network tests, 26 phase tests and 9
mailbox tests. Logs are attached in the baseline evidence. Pinned 0.8.1 dependency
versions are preserved; the current execution environment is recorded separately.
No new physical-phone, actual webcam, public-network, AR, GPU or end-to-end learning
acceptance is claimed. No repository merge, deployment or new subscription.
