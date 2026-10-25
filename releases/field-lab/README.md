# Consolidated Field Lab browser release

Tumbo requested an updated Field Lab file/package containing the implemented browser work, rather than the legacy Viva 0.7 file-picker launcher.

This additive release builder packages the reviewed runtime at `1da8a2f81aaebd529e1129d4cfd147d7a98ab157`. It does not alter existing source modules, merge branches, edit live pages, or deploy. It does not claim every server/native/research module is integrated into the phone-local engine.

The new `services/vivo/web/phone/field-lab-unified.html` is the actual current phone application markup with a release title and provenance metadata. It loads the same modules as the canonical phone entry; it is not an iframe or a new demo engine. All selected browser modules are included in the ZIP. The generated copy of the service worker caches the alias under a new shell version. `Field-Lab.html` at the package root is only a convenience entry. No original v0.4 HTML file is needed.

Use HTTPS hosting or `python serve.py` from the extracted package. Local HTTP binds only to loopback; a phone's Downloads preview is not a supported host for this multi-file app. Do not claim the new build is live before an authorized deployment.

Run `python -m unittest discover -s releases/field-lab -p 'test_*.py' -v`, then `python releases/field-lab/build.py --source . --out /tmp/Vivo-Field-Lab-2026.10.22 --commit "$(git rev-parse HEAD)"`. The dedicated read-only Actions job runs existing phone/input tests, synthetic Chromium checks, and publishes the package plus evidence. Test failures must be reported, not reclassified as success.

The manifest distinguishes unchanged runtime bytes from release-assembled files. No saved world or browser database is overwritten or migrated. Origin changes cannot transfer old saves. Preserve legacy originals. Server authority, Android companion permissions, live camera tracking, AR/VR/casting, and external agents still require their actual environment; TUMBO-SIM remains simulated.
