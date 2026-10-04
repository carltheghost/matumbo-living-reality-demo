# Reality Lens: the object is the interface

This engine implements Tumbo's request for information and controls across a complete physical body. A selected feature keeps one original controller and DOM owner. Its current content becomes texture ink on the actual body mesh. Pointer input uses the nearest triangle's material chart and UV coordinates to reach the original control.

The former flattened sphere/cylinder front and continuous camera-facing rotation are superseded. Whole objects can now be turned deliberately. The body remains the same entity during rotation, paging, editing and shape changes.

## Six recognizable families

| Home space | Body | What it holds |
| --- | --- | --- |
| Worlds | Cube | The existing world and spatial features |
| People | Sphere | Existing people, rooms and social features |
| Network | Diamond (octahedron) | Existing network and connection features |
| Value & contracts | Cylinder | Existing token, contract and value features |
| Agents | Torus | Existing agent features |
| Experiences | Triangular prism | Existing media, play and creative features |

Every Home space has its own volumetric family. Network's eight-faced diamond replaces the second Home cube. Its title spans the real triangular faces and the whole body enters the same Network space. Existing Network feature objects retain their saved/default shape. Phone, square, rectangle and wave remain supported alternate shapes, including old saved Ourplace descriptors. Selecting a shape changes presentation, never its feature identity or financial authority.

## Use it

1. Open a body on Home to enter its space. Its surface previews actual member features.
2. Choose a feature. Its own live information and controls cover its mesh charts.
3. Drag the body to turn it; tap a painted control to operate its original action.
4. Scroll over the body, or use its Previous/Next controls, to browse longer content. Arrow keys turn a focused body; Page Up/Page Down browse content.
5. Text entry uses the original native input so selection, typing, IME and browser pickers remain available. **Text view** exposes the original accessible feature when a conventional reading flow is useful.
   Text view hides the painted world and gives the original document a readable background. Its native YouTube player stays mounted once and is projected into a reserved reading slot, including during scrolling and phone resizing.
6. The breadcrumb path returns to the current space or Home. Space addresses can be reloaded and browser Back/Forward restores the hierarchy.

## Geometry and state ownership

`reality-surface-geometry.js` supplies closed bodies, material groups and local UV charts. Cube and sphere have six charts; the sphere projects subdivided box faces onto a true radius. The diamond has eight triangular facets, each with a chart. The cylinder has four continuous wall sectors plus its two circular caps. The prism has three sides and two triangular ends. The torus has eight connected curved charts and a real empty center. Every exterior triangle has a chart; no flat reading cap closes a curved body.

`reality-surface-document.js` reads live values, text and actions from the original visible feature tree. Hidden controls and closed details remain hidden. Stable action IDs refer to original nodes, with guards for disconnected, disabled and stale controls. No feature controller is cloned. Pointer-driven canvases forward UV-derived coordinates to the existing canvas handlers.

`reality-surface-atlas.js` flows that document across the charts, paints matching hit regions and paginates content that exceeds the body. Mesh materials use those canvases directly. Textures are reused; changed text or fields invalidate the ink. Live canvas content requires periodic repaint while its owner is selected.

`reality-surface-controller.js` resolves actual triangle hits, arbitrates turning against clicking or canvas gestures, preserves original native inputs, and disposes chart textures when the body changes or closes. The geometry owns picking: the empty torus hole and the outside of a triangular end are not rectangular click targets.

The older universal surface experiment is available only through the explicit `?feature=reality-lens&surface=universal` route. Reloading Home or a space does not start a second renderer over the canonical bodies. Home breadcrumbs also replace the old overlapping return button.

Chess retains its original game and artwork. Its source board uses a readable 4:3 capture area while projected, a raised camera, and alpha-aware sprite picking so transparent artwork margins do not steal clicks from visible pieces behind them. Bringing a chart into view aligns its reading direction with the camera.

## Browser and media limits

This is a semantic surface renderer, not a complete browser screenshot engine. Text, native controls and supported images/canvases are read from the current owner; arbitrary CSS effects are not reproduced on the mesh. Text view keeps the original feature available.

The body forwards one active pointer gesture at a time. Controls that require two simultaneous pointers, such as the gesture pad's two-hand spread, remain available through Text view. Single-pointer desktop and phone-viewport checks do not establish physical multitouch, AR or XR support.

YouTube's cross-origin iframe cannot be sampled into a CanvasTexture. Its search/results/actions remain surface content, while one real player remains an explicitly planar browser media area attached to the object. Rotation and shape changes must not create another player. Other inaccessible cross-origin media also remains browser content, rather than being presented as captured curved video. A permitted HTMLVideoElement can support VideoTexture, but that is a different media source.

The blank player enters its stable browser parent before first play. Selecting a video enables eager loading, including when the object is turned away. Text/Object switching changes the same player's projection rather than moving its iframe or changing its source. Native reading layout responds to scroll, edits and resize even if the expensive world loop is paused by its freeze guard. [Native media acceptance](reality-lens-review/NATIVE_MEDIA_ACCEPTANCE.md) records actual playback and original iframe/window continuity on desktop and phone viewports.

The renderer remains a projection. Existing public source checks and the optional server-side NVIDIA bridge keep their existing authority boundaries. Public connections are a bounded automatic batch. NVIDIA still requires a valid owner-provided credential; a configured route or a free prototype offering does not prove successful authenticated inference. This change neither merges the draft PR nor publishes GitHub Pages.

## Primary technical references

- [Three.js CanvasTexture](https://threejs.org/docs/pages/CanvasTexture.html): canvas-backed mesh materials.
- [Three.js Raycaster](https://threejs.org/docs/pages/Raycaster.html): nearest surface intersections, material faces and UV coordinates.
- [Three.js CSS3DRenderer](https://threejs.org/docs/pages/CSS3DRenderer.html): DOM transforms do not use mesh geometries/materials.
- [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference): one native embedded player and its supported controls.
- [Canvas drawImage sources](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage): iframe documents are not decoded video/image sources.
- [NVIDIA API quickstart](https://docs.api.nvidia.com/nim/docs/api-quickstart): provider setup and API credential requirements.

Rendered acceptance evidence and exact source identity are recorded in the delivery report. Pure geometry tests alone do not establish phone readability, physical-device GPU performance or working XR controllers.
