"""Build a portable, reproducible browser voice kit from an explicit file allowlist.

The archive contains source modules and controlled tests, never project data,
credentials, provider bridges, browser storage, or a recipient messaging service.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_NAME = "matumbo-browser-voice-0.1.0.zip"
SOURCE_FILES = (
    "LICENSE",
    "docs/VOICE.md",
    "src/render/voice-session.js",
    "src/render/voice-text-target.js",
    "src/render/voice-dictation.js",
    "src/render/voice-dictation.css",
    "src/domains/voice-message.js",
    "tests/voice-session.test.mjs",
    "tests/voice-text-target.test.mjs",
    "tests/voice-dictation.test.mjs",
)

README = """# maTumbo browser voice kit 0.1.0

Portable ES modules for reviewed dictation, local audio recording, optional
audio-envelope encryption, and speech playback. This is a source package for
browser projects, with no runtime package dependencies. Installation in another
project remains an explicit integration task.

## Try the adoption example

Extract this ZIP into a new folder. From that folder run:

```sh
python -m http.server 8090 --bind 127.0.0.1
```

Open `http://127.0.0.1:8090/examples/` in your browser. Focus an example field,
open Voice, start dictation, stop, review, and insert. Search and form submission
remain separate. The example keeps drafts only in memory; it supplies no AI
provider and delivers no messages to another person. Starting recognition may
send audio to the browser's speech service, as disclosed before the start button.

## Adopt the modules

For an existing static browser app, copy this package as a directory and import
from its `index.js`. Bundled projects can install the extracted directory with
`npm install --save file:../matumbo-browser-voice`. No registry publication is
required. The package is marked private to prevent accidental publication.

```js
import { mountVoiceDictation } from './voice-kit/index.js';

const voice = mountVoiceDictation({
  documentRoot: document,
  windowRoot: window,
  // Change only when the actual destination/owner changes. Exclude message text.
  getContext: () => JSON.stringify([activeSpaceId, activeDocumentId]),
  onNavigate: feature => openExistingFeature(feature),
});
// At final app teardown:
// voice.destroy();
```

Supply the variables/functions in the example from the host's existing state.
Keep one global dictation panel. Preserve module-relative paths so its stylesheet
loads beside the module. Mark private controls/ancestors with `data-voice-exclude`.
Existing provider authentication, Send/Cancel, storage, and navigation remain
owned by the host. A native Python program or a cloud chat interface needs its
own integration; this package does not modify either automatically.

Exports include `createSpeechInput`, `createVoiceRecorder`, `createVoiceOutput`,
`claimVoiceActivity`, `watchVoiceOwnerVisibility`, the text-target helpers,
`mountVoiceDictation`, and the local audio-envelope functions. Use the shared
activity claim for other audio playback to prevent microphone feedback. Speech
and recording factories remain inactive until explicitly started. See
[the full usage and module guide](docs/VOICE.md) for lifecycle contracts.

## Processing and storage boundaries

Recognition support and language availability vary by browser. Recognition may
use an online browser service. Recording needs a microphone, permission, and a
secure context such as HTTPS or localhost. A matching local playback voice is
preferred; some voices are online services. The host must show these boundaries
before capture or playback is enabled.

Recording produces a local Blob with a 60-second/384,000-byte limit. Readable
attachments contain playable audio. Encrypted attachments use AES-GCM with a
separate randomly generated unlock code. Encryption protects the audio; captions
and routing metadata are outside that protection. Never persist/export the
unlock code with the envelope. Recording and unlocked playback use plaintext
audio in memory. The package supplies neither remote delivery nor identity,
recipient authentication, or an end-to-end messaging protocol.

## Test and verify

Node 20 or later is required for the included tests; no dependency installation
is needed. Run `npm test` or `node --test tests/*.test.mjs` after extraction.
These tests use controlled browser doubles and real local Web Crypto. They do
not access a microphone, authenticate, invoke a provider, or prove physical
device/browser rendering behavior.

`manifest.json` records the byte length and SHA-256 of every payload file. It
does not hash itself; the separate archive checksum covers the complete ZIP,
including its manifest. Source files are copied verbatim from the current
working copy. A recorded Git revision identifies the base revision, while the
file hashes identify the actual packaged content, including uncommitted changes.
The MIT license is included. No credentials or project history are required.
"""

EXAMPLE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Voice kit adoption example</title>
<style>body{margin:2rem auto;max-width:44rem;padding:0 1rem;font:17px/1.5 system-ui;background:#101925;color:#edf6ff}label{display:grid;gap:.4rem;margin:1rem 0}input,textarea,select,button{font:inherit;padding:.65rem;border-radius:.5rem}textarea{min-height:8rem}p{color:#bdd1e6}:focus-visible{outline:3px solid #80c9ff;outline-offset:3px}</style>
</head><body>
<h1>Speak, review, then insert</h1>
<p>This example keeps drafts in memory. Choose a field and open Voice. Starting dictation may send microphone audio to your browser's speech service.</p>
<label>Active document<select id="document"><option value="notes">Notes</option><option value="planning">Planning</option></select></label>
<form id="editor"><label>Search draft<input id="search" type="search" aria-label="Search draft"></label>
<label>Document text<textarea id="draft" aria-label="Document text"></textarea></label>
<button type="submit">Review local draft</button></form>
<label data-voice-exclude>Excluded password field (disabled demonstration)<input type="password" disabled placeholder="Voice cannot select this field"></label>
<p id="status" role="status">Focus a text field, then open Voice or press Alt + Shift + V.</p>
<script type="module">
import { mountVoiceDictation } from '../index.js';
const chooser = document.querySelector('#document');
const draft = document.querySelector('#draft');
const search = document.querySelector('#search');
const status = document.querySelector('#status');
const drafts = new Map();
let activeDocument = chooser.value;
chooser.addEventListener('change', () => {
  drafts.set(activeDocument, { text: draft.value, search: search.value });
  activeDocument = chooser.value;
  const saved = drafts.get(activeDocument);
  draft.value = saved?.text || ''; search.value = saved?.search || '';
  status.textContent = 'Document changed. Select your intended dictation destination again.';
});
document.querySelector('#editor').addEventListener('submit', event => {
  event.preventDefault();
  status.textContent = 'Reviewed locally. No search, AI request, or message delivery was performed.';
});
const voice = mountVoiceDictation({
  documentRoot: document, windowRoot: window,
  getContext: () => JSON.stringify(['example', activeDocument]),
  onNavigate: feature => { status.textContent = `Your host would open its existing ${feature} feature here. This example supplies no AI or messaging service.`; },
});
window.addEventListener('pagehide', event => { if (event.persisted) voice.close({ restoreFocus: false }); else voice.destroy(); });
</script></body></html>
"""

PACKAGE_TEST = """import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import * as voice from '../index.js';

test('portable entry point exposes host-independent modules without starting capture', () => {
  for (const name of ['createSpeechInput', 'createVoiceRecorder', 'createVoiceOutput', 'claimVoiceActivity', 'watchVoiceOwnerVisibility', 'captureVoiceTarget', 'insertVoiceTranscript', 'mountVoiceDictation', 'encryptVoice', 'decryptVoice']) assert.equal(typeof voice[name], 'function', name);
  const input = voice.createSpeechInput({ windowRoot: {} });
  assert.equal(input.getSnapshot().active, false);
  assert.equal(input.start(), false);
  input.destroy();
});

test('portable encrypted envelope round trips and rejects wrong keys or changed metadata', async () => {
  const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
  const source = { blob: new Blob([bytes], { type: 'audio/webm' }), durationMs: 1000 };
  const { attachment, unlockCode } = await voice.encryptVoice(source, { cryptoRoot: webcrypto });
  const serialized = voice.serializeVoiceAttachment(attachment);
  assert.equal(serialized.includes(unlockCode), false);
  const restored = voice.parseVoiceEnvelope(serialized);
  const blob = await voice.decryptVoice(restored, unlockCode, { cryptoRoot: webcrypto });
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  const wrong = (unlockCode[0] === 'A' ? 'B' : 'A') + unlockCode.slice(1);
  await assert.rejects(voice.decryptVoice(restored, wrong, { cryptoRoot: webcrypto }), /Cannot unlock/);
  await assert.rejects(voice.decryptVoice({ ...restored, durationMs: 999 }, unlockCode, { cryptoRoot: webcrypto }), /Cannot unlock/);
});
"""


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")


def generated_files() -> dict[str, bytes]:
    package = {
        "name": "@matumbo/browser-voice", "version": "0.1.0", "private": True,
        "type": "module", "license": "MIT", "engines": {"node": ">=20"},
        "exports": {".": "./index.js", "./session": "./src/render/voice-session.js",
                    "./text-target": "./src/render/voice-text-target.js",
                    "./dictation": "./src/render/voice-dictation.js",
                    "./messages": "./src/domains/voice-message.js",
                    "./dictation.css": "./src/render/voice-dictation.css"},
        "scripts": {"test": "node --test tests/*.test.mjs"},
    }
    entry = "\n".join(f"export * from './{path}';" for path in (
        "src/render/voice-session.js", "src/render/voice-text-target.js",
        "src/render/voice-dictation.js", "src/domains/voice-message.js")) + "\n"
    return {"package.json": json_bytes(package), "index.js": entry.encode(),
            "README.md": README.encode(), "examples/index.html": EXAMPLE.encode(),
            "tests/package.test.mjs": PACKAGE_TEST.encode()}


def build(output: Path) -> dict[str, object]:
    output = output.resolve()
    archive_path = output / ARCHIVE_NAME
    destinations = (archive_path, output / "manifest.json", output / "SHA256.txt")
    if any(path.exists() for path in destinations):
        raise ValueError("An existing archive or manifest will not be replaced; choose a new --output directory.")
    payload = generated_files()
    for relative in SOURCE_FILES:
        source = (ROOT / relative).resolve(strict=True)
        if not source.is_relative_to(ROOT) or not source.is_file():
            raise ValueError(f"Source is outside the package allowlist boundary: {relative}")
        payload[relative] = source.read_bytes()
    try:
        revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        revision = None
    manifest = {
        "schemaVersion": 1, "package": "@matumbo/browser-voice", "version": "0.1.0",
        "sourceRevision": revision, "sourceTree": "working-copy", "credentialsIncluded": False,
        "serverIncluded": False, "remoteDeliveryIncluded": False, "published": False,
        "fileCount": len(payload), "manifestExcludedFromOwnHashes": True,
        "files": [{"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                   "origin": "source" if name in SOURCE_FILES else "generated"}
                  for name, data in sorted(payload.items())],
    }
    manifest_data = json_bytes(manifest)
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted({**payload, "manifest.json": manifest_data}.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data, compresslevel=9)
    archive_data = archive_buffer.getvalue()
    # Verify the actual serialized ZIP before writing any deliverable.
    with zipfile.ZipFile(io.BytesIO(archive_data)) as archive:
        if archive.testzip() is not None:
            raise ValueError("The generated archive failed its CRC check.")
        for item in manifest["files"]:
            content = archive.read(item["path"])
            if len(content) != item["bytes"] or hashlib.sha256(content).hexdigest() != item["sha256"]:
                raise ValueError(f"Archive integrity check failed: {item['path']}")
    digest = hashlib.sha256(archive_data).hexdigest()
    output.mkdir(parents=True, exist_ok=True)
    for path, data in ((archive_path, archive_data), (output / "manifest.json", manifest_data),
                       (output / "SHA256.txt", f"{digest} *{ARCHIVE_NAME}\n".encode())):
        with path.open("xb") as target:
            target.write(data)
    return {"archive": str(archive_path), "manifest": str(output / "manifest.json"),
            "sha256": digest, "fileCount": len(payload), "bytes": len(archive_data), "verified": True}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "work" / "voice-kit")
    args = parser.parse_args()
    try:
        print(json.dumps(build(args.output)))
        return 0
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
