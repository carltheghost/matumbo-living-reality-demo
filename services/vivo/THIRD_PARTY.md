# Third-party material

The local hand runtime is MediaPipe Tasks Vision 0.10.14, with the Hand Landmarker task supplied in the prior Viva source bundle. The original package manifest, NOTICE and Apache 2.0 license are preserved in `web/vendor/field-lab/`. Checksums for shipped runtime/model files are included in `integrity.json`. These model assets are not user photos.

The server depends on aiohttp and NumPy; they are installed from the pinned requirements, not redistributed as site scripts. Model training optionally uses Torch. Browser test automation uses Playwright/Chromium. Licenses for installed dependencies remain with their distributions.

The preserved Studio 0.7 and earlier numerical-reference code came from the user's existing project artifacts in this conversation. The new code is supplied as editable source to the user. No claim of exclusive rights in third-party components is made.

Shared mode makes no third-party requests for camera tracking. Original Studio head-pointer mode retains its explicit on-demand downloads of face tracking assets from its original providers. Camera frames are processed locally by this implementation.
