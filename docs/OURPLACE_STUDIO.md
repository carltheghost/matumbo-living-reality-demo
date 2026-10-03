# Ourplace Studio: sources to a production handoff

Ourplace Studio connects a small local reference library to creator production plans. It is an original implementation inspired by Jevbox's cited retrieval and Mixar's division of 3D production into roles. It runs inside the existing **Create & share** object surface. It adds no ledger, public identity registry, or external execution authority.

## Open it

Start this checkout with `run_local.bat`, then open **Value & contracts → Asset Token → Open Ourplace → Create & share → Sources & production studio**. For an isolated preview, use `scripts/launch-demo.ps1 -StaticPort 8084` in Windows PowerShell. Keep the same browser origin to retain this local library.

1. Add your own TXT or Markdown source, or try the original creator-room example. Give the source a useful title and optional folder/origin. The source stays private to the selected local participant initially.
2. Search with concrete terms such as `lighting` or `materials`. Results show source, folder, section and exact line range. Open a citation to inspect the original text. Search is local keyword matching; it does not call an answer model or pretend that a ranking score is confidence.
3. Select reference sources and create a project brief. The plan supplies direction, modeling, material, lighting and review tasks, with dependencies and deliverables. Completed tasks are recorded as user reports. They do not establish that an agent ran, a mesh exists, or a render passed review.
4. Share only sources you are entitled to share. Sources must be explicitly shared and have a supported permissive license before a production packet can be downloaded. A packet retains citations and declared provenance. This is a handoff artifact, not a creator-reward claim.
5. Inspect a returned `.glb` file before accepting it. The inspector checks a bounded subset of glTF 2.0 binary structure, reports asset counts and computes the file's SHA-256. Its receipt is evidence about those bytes; visual quality, rights, rigging behavior and target-device performance still require separate review.

## Local access and evidence lifetime

The participant selector is a same-browser rehearsal. It is not authentication or encrypted storage. Anyone who controls the browser profile can access its local storage. Actual multi-user authorization would require a server.

Every source read, search and export rechecks current local access. Removing or revoking a source invalidates existing dependent projects; derived excerpts are not independently retained as an answer cache. A source later shared again does not revive an invalidated project. Create a new project with its current sources. Previously downloaded packets cannot be recalled.

The library uses its own versioned storage key, separate from the economic owner. Imports are bounded text. Invalid persisted state is rejected rather than interpreted as executable instructions. Source text renders as text, never HTML or JavaScript. Source URLs are metadata; importing a note does not fetch a website or run an embedded instruction.

Captured design context is inert. Existing imported designs retain their origin. This new production packet cannot carry the full licensing authority of every imported design chain, so a project containing non-fresh design provenance cannot export through this path. Use the existing reviewed-derivative sharing flow for design lineage.

## Production adapters

This version prepares useful role briefs and inspects returned GLB files. It does not launch Blender, submit provider jobs, spend compute credits, or mark an AI task complete. A future adapter should bind a task to its input-source revisions, authorized tool invocation, actual output hash and independent review result. The existing creator economy remains the only owner of qualified local usage and funded TUMBO-SIM rewards.

## Research checked for this addition

- [Mixar desktop source](https://github.com/Mixar-AI/mixar-app/blob/3696b05bbcfc477ffb820f5f10375f35c263e0cb/README.md): Blender-based client, separate hosted AI backend, mixed GPL terms and separately governed brand assets. [Mixar documentation](https://www.mixar.app/docs) describes provider configuration and the distinction between agent chat and generation jobs.
- [Jevbox](https://github.com/extend-hq/jevbox/blob/7e4562124c49d0e6a527609e872b7627e00ef604/README.md): a document application with hierarchical retrieval, cited answers and provider/database dependencies. Its [retrieval](https://github.com/extend-hq/jevbox/blob/7e4562124c49d0e6a527609e872b7627e00ef604/docs/retrieval.md) and [security](https://github.com/extend-hq/jevbox/blob/7e4562124c49d0e6a527609e872b7627e00ef604/docs/security.md) documents informed the evidence-lifetime model. At the inspected commit, no project-level license was identified. No Jevbox implementation or brand asset was copied.

The screenshots were treated as leads for research, not proof that either external product was already connected to maTumbo.
