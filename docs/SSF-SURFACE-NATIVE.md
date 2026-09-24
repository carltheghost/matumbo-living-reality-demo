# maTumbo Surface Semantic Field Ω

Status: additive implementation lane. The current canonical Reality Assembly remains unchanged until this branch is reviewed/merged.

## Invariant

Information belongs to the object's own render material and hit surface. The primary SSF path does **not** create a floating information card, plane, sprite, CSS3D panel, or decal mesh. Removing all HUD/card meshes must not remove the object's semantic information.

## What this branch implements

- `src/domains/surface-semantic-field.js`
  - deterministic semantic-region generation for sphere, cylinder/capsule, torus, cube, irregular, open, and disconnected bodies;
  - UV-to-semantic-region resolution;
  - surface fitness scoring;
  - semantic LOD from projected size/focus/priority/budget;
  - barycentric surface addressing helpers;
  - no-UV fallback chart generation;
  - deterministic object-object contact field;
  - deterministic trait breeding with provenance;
  - versioned semantic-skin persistence.
- `src/render/surface-semantic-field-three.js`
  - `SurfaceObject` binds semantic regions directly to a Three.js mesh;
  - information is drawn into the mesh's own `map` and material channels;
  - focused/contact regions affect emissive, roughness, bump and optional displacement;
  - cube geometry can own six different semantic wall slots;
  - hostile meshes without UVs receive a deterministic planar fallback chart;
  - raycast hit -> mesh -> face/material slot -> UV -> semantic region;
  - pointer and XR-ray adapters share the same hit path;
  - off-screen accessibility mirror exposes semantic actions without visible UI overlays.
- `surface-field.html`
  - runnable WebGL2/Three.js lab with sphere, cylinder, torus, six-wall cube, hostile no-UV mesh, open surface and disconnected body;
  - no floating information cards;
  - two objects demonstrate surface-native proximity/contact reaction;
  - clicking a region changes the information **in that same object's skin**.

## Browser-first design

The first milestone intentionally stays on the repository's pinned Three.js r179.1 WebGL renderer so GitHub Pages can run it without a build server or WebGPU requirement. The semantic core is renderer-neutral. A WebGPU adapter can reuse the same region/persistence/hit contracts later.

Text is currently rasterized into a `CanvasTexture` that is assigned to the object's **base material map**. That is still intrinsic material information, not a second mesh pasted above the object. For production-quality glyph continuity, replace the canvas painter with an MSDF atlas while retaining the exact same SSF address/region contracts.

## Hostile meshes

Fallback order:

1. Use authored UVs if present.
2. Use six material slots for cube-like grouped geometry.
3. Generate a deterministic global planar chart when UVs are missing.
4. If a production mesh needs seamless all-side text, add chart segmentation/parameterization hints or an offline unwrap. The semantic state does not change.

This means the system never fails just because a mesh has no UVs; it degrades in layout quality rather than losing information.

## Interaction contract

Primary hit path:

`Ray -> triangle -> intersection.uv/materialIndex -> semantic region -> action`

The pure core also exposes barycentric coordinate helpers for renderers or geometry pipelines that need to reconstruct UVs from triangle vertices explicitly.

## LOD

- LOD 0: pulse/signal only.
- LOD 1: compact symbol/value.
- LOD 2: label + value.
- LOD 3: full text/action.

LOD uses projected size, focus, region priority and budget. Mobile can reduce the budget while preserving the same object identity and semantic regions.

## Contact and breeding

`surfaceContact(a,b)` computes a bounded deterministic proximity field. The field changes both objects' own emissive/roughness/bump/displacement channels. No third overlay is required.

`breedTraits(a,b,{seed})` combines numeric, categorical, set and nested traits deterministically and returns provenance for each result. This is the first stable contract for future object-object visual/information breeding.

## Run

From repository root:

```bash
python -m http.server 8080
```

Open:

`http://127.0.0.1:8080/surface-field.html`

Tests:

```bash
node --test tests/surface-semantic-field.test.mjs tests/surface-semantic-field-three.test.mjs
```

## Next integration step after review

Wire `SurfaceObject` into Reality Assembly's selected object body and progressively retire its CSS3D reading surface. The existing canonical root, cube spacing, Block World volume contract and right-side minimized-tab rail must stay intact while the object's own skin takes over the readable information role.


## Topology-native extension

This branch now includes `src/domains/topology-semantic-field.js` and
`src/render/topology-surface-object.js`.

The analyzer derives welded adjacency/local neighborhoods, connected
components, boundary/non-manifold edges, dihedral seams, approximate signed
curvature, ridge/valley/cavity classification, open/closed shells and semantic
cells separated by natural mesh seams.

`TopologySurfaceObject` converts those cells into semantic patches. Where UVs
exist (or the SSF fallback generated them), each patch carries its actual
triangle UVs and the material painter fills those triangles rather than a
detached rectangular panel. Hit resolution prefers the triangle face's topology
cell before falling back to UV rectangle lookup.

The topology descriptor is immutable and safe to share among multiple lens
projections. Mutable Three.js meshes/materials, camera state, focus state and
navigation must remain per-lens.
