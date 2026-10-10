# Voice in maTumbo spaces

Voice extends the existing text fields, My GPT conversation, and local Rooms workspace. Capture starts only from an explicit control. Opening a space, refreshing status, importing history, or receiving a reply does not start a microphone.

## Use it

**Search on any screen.** After reviewing your words, **Search app** explicitly uses the app's existing Locate control. This also works when a phone hides the header search box. Recognition never starts a search automatically.

**Numbers and dates.** Number fields replace their whole value and retain the original minimum, maximum, step and validation rules. Use digits such as `12.5`; ambiguous number words are retained for review. Date and time fields accept the exact format shown by Voice, such as `2026-10-05` or `2026-10-05T09:30`. Invalid dates and values are rejected before the original field changes. Native pickers and file uploads keep their original controls.

**Write into a field.** Focus an editable field, open **Voice** or press **Alt + Shift + V**, confirm the destination and language, then choose **Start dictation**. Stop, review or edit the transcript, and choose **Insert into field**. The original Search or Send action remains separate. If the destination changed while speaking, select it again; existing writing is preserved. Passwords and identified secret fields are excluded. For a website embedded from another origin, use **Copy words** and paste the reviewed words into that site's own field; if automatic copy is unavailable, select and copy the transcript with the device's controls.

**Talk with My GPT.** Open **Voice conversation**, or My GPT in Web + AI. Select the existing provider and complete its normal setup. Choose a voice language, press **Listen**, then **Stop listening**. Edit the original message and press **Send message**. Enable **Read voice replies aloud** to hear replies to voice turns. Press **Listen** for another reviewed turn, or **Interrupt voice** to stop speech or stop waiting for the current request. For a spoken back-and-forth, check **Hands-free turns** and press **Start voice dialogue**. Each pause sends one recognized turn to the selected assistant, reads the reply, and listens again after playback. Press **Stop voice dialogue** at any time; editing the message or changing the assistant space also stops it. Browser speech recognition may process audio online. Typed messages and imported history do not automatically speak. Provider access, plan consent, model selection, and the local GPT bridge remain necessary; voice supplies none of those credentials or permissions.

**Save a voice message.** Create and enter your own local room. **Encrypt audio with an unlock code** is selected by default; choose **Readable audio** only when you want a playable, unencrypted clip. Press **Record voice**, stop, and preview the clip. For readable audio, choose **Save local voice**. For encrypted audio, choose **Encrypt voice & show unlock code**, retain that code separately, acknowledge that it is saved, then save the voice message. Any typed caption remains readable. From a saved encrypted message, choose **Share / download encrypted envelope** to hand the file to your device's share menu when available, or download it for another app. Send the unlock code separately. Saved clips require an explicit playback action. Encrypted clips require their separate code before playback; **Lock voice** releases the unlocked playback copy.

## What stays local

Rooms save messages in this browser and can export/import files; there is no in-app inbox or server delivery. The explicit share action hands one encrypted audio envelope to the device's share menu, or downloads it. The app cannot confirm the recipient received it. Existing membership and cipher indicators remain projections; saving or sharing a local voice message does not establish remote membership, identity, or end-to-end messaging.

Readable voice stores playable audio. Encrypted voice stores an AES-GCM envelope with a random 256-bit key and a fresh 96-bit nonce. The 43-character unlock code encodes the key and is excluded from room history, backups, and encrypted envelopes. The original recording and any explicitly unlocked audio exist in memory during use. Audio encryption does not hide captions, room names, authors, dates, MIME type, duration, or byte length. The audio metadata is authenticated with the ciphertext, but remains readable. Losing the code means this app cannot recover the audio. These details describe this implementation; Web Crypto supplies the encryption primitive. See [MDN: SubtleCrypto.encrypt](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt) and [MDN: AES-GCM parameters](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams).

Dictation uses the browser's recognition service, which may send microphone audio to its provider. Browser recognition is not universally supported and may require an internet connection. This app does not promise offline recognition. See [MDN: SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).

Spoken GPT replies prefer an available local voice matching the selected language. The status identifies local playback only when the browser reports `localService: true`; other playback may use an online voice. See [MDN: SpeechSynthesisVoice.localService](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService).

## Device and browser limits

- Recording needs a working microphone, browser permission, and a secure context such as HTTPS or localhost. A phone opening a PC's plain HTTP LAN address may lack microphone access. Permission denial, missing devices, and ignored prompts remain visible failures. See [MDN: getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
- Recognition, recording, and playback are detected separately. A browser can support local recording while lacking dictation. Typed input remains available. Language availability and voice quality depend on the browser and operating system.
- If the 3D app cannot load, the static fallback still offers reviewed dictation and copying. Rooms and My GPT continue to require their app owners to load; the fallback reports that limitation.
- A local clip is limited to **60 seconds and 384,000 bytes**, whichever constraint is reached first. Oversized recordings are discarded with an error. WebM/Opus, Ogg/Opus, or MP4 support depends on the device; the recorder negotiates an allowed format rather than relabeling bytes. See [MDN: MediaRecorder.isTypeSupported](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static).
- One recognition take is bounded to 90 seconds and 8,000 characters. Spoken replies are bounded to 8,000 characters and a playback deadline; the full reply remains in the conversation, with a visible notice when only its beginning is read.
- Closing or changing the owner, hiding the page, navigating, cancellation, or disposal releases active capture/playback. A newly claimed voice activity stops the previous one, preventing a spoken reply from being recorded by another voice tool.

## Adopt it in another space

Reuse the existing owner and its real editable controls. Do not add another chat backend or interpret recognized text as commands.

| Module | Contract |
| --- | --- |
| `src/render/voice-session.js` | `createSpeechInput`, `createVoiceRecorder`, `createVoiceOutput`, the shared `claimVoiceActivity` coordinator, and `watchVoiceOwnerVisibility`. Factories are inert until explicitly started. |
| `src/render/voice-text-target.js` | `captureVoiceTarget` remembers the original field/selection; `insertVoiceTranscript` checks the unchanged value and dispatches ordinary editing events. |
| `src/render/voice-dictation.js` | One app-wide `mountVoiceDictation` panel with an owner-supplied `getContext()` key. |
| `src/render/my-gpt.js` | Existing chat submission plus explicit voice turns. `voiceContext()` returns owner identity without copying messages or notes. |
| `src/domains/voice-dialogue.js` | Half-duplex, explicit-consent voice turns. It submits only finalized pauses, reads one returned reply, waits for playback, and then reopens capture. |
| `src/render/web-ai.js` | `getVoiceContext()` adds the selected tab and open/minimized state. Use `setTab('gpt'); open()` to preserve the selected provider. |
| `src/domains/voice-message.js` | Validates audio envelopes; creates readable attachments; encrypts/decrypts audio; serializes portable envelopes without unlock codes. |
| `src/render/room-conversations.js` | Local recording, preview, explicit save, import/export, unlock/lock, and playback cleanup in the existing Rooms UI. |

1. Give fields accessible labels. Mark private controls or whole private regions with `data-voice-exclude`. Keep existing form validation and submission behavior.
2. Supply a stable, content-free destination key that changes when the space, object, room/channel, conversation, assistant, provider, account, model, or owner visibility changes. Include `webAiConsole.getVoiceContext()` for GPT destinations. Do not include transcript text or a counter that changes during ordinary speech.
3. Import the shared session module with the same app version URL (`voice-session.js?v=20261005-voice`). Recognition updates contain cumulative finalized `transcript` and separate `interim`; replace the current take's text rather than appending every callback. `stop()` finishes a take; `abort()` rejects delayed results. Keep transcript review and Send separate.
4. General dictation dispatches `matumbo:voice-input` with `{ final: true, source: 'dictation' }` after actual insertion. My GPT uses this to identify a voice-origin draft; it is not a submission event.
5. Keep capture, preview, and playback mutually exclusive through `claimVoiceActivity(owner, onRevoke, windowRoot)`. The session factories supply their window automatically. Same-origin embedded games share the nearest accessible ancestor window's activity slot; third-party frames retain their own origin boundary. Pause audio, release tracks and object URLs, invalidate pending asynchronous work on owner changes, and call `destroy()` at final teardown. Use `watchVoiceOwnerVisibility({ element, windowRoot, onHidden })` when docks or mobile surfaces can hide ancestors directly; retain and call its cleanup function at final teardown. It observes real concealment/removal without treating a Lens transform or brief DOM reparenting as a new conversation.
6. Validate envelopes before storing or importing them. In encrypted mode, persist only the encrypted attachment, never its key or decrypted copy. Readable mode deliberately stores playable audio. Preserve the existing workspace's quota, conflict, and export behavior.
7. If a slow app replaces a boot fallback, use `handoverVoiceDictation(previous, options)` to retain reviewed words and language in memory. It stops old recognition and requires a fresh destination; it does not carry capture or a stale field into the new owner.

## Portable package boundary

This checkout integrates voice into Reality Lens. Other repositories and cloud projects require their own adoption and verification; their existence does not establish that voice is installed there.

Build the reusable browser package from the repository root:

```sh
python scripts/build_voice_kit.py
python -m unittest discover -s tests -p test_voice_kit.py
```

The default destination is `work/voice-kit/`: `matumbo-browser-voice-0.1.0.zip`, a complete payload hash manifest, and `SHA256.txt`. An existing deliverable is never replaced; use `--output work/voice-kit-next` for a later snapshot. The manifest excludes its own hash, and the ZIP checksum covers the complete archive including that manifest. Its Git revision identifies the base; source-file hashes identify the exact working-copy content.

The ZIP contains `voice-session.js`, `voice-text-target.js`, `voice-dictation.js`, `voice-dictation.css`, and `voice-message.js`, preserving their relative paths, plus a package export map, README, MIT license, this guide, and `examples/index.html`. Session and text-target tests are copied with a standalone envelope test; app-specific Room workspace tests and provider bridge code stay outside the package. Extraction tests prove that the package imports and tests without repository dependencies. Browser/microphone behavior still needs device verification.

After extracting into a new folder, run `python -m http.server 8090 --bind 127.0.0.1` there and open `http://127.0.0.1:8090/examples/` to use the adoption example. The example has editable fields, owner/context switching, excluded private fields, and host navigation callbacks. It keeps drafts in memory and supplies no provider or recipient delivery. Static apps can import its `index.js`; bundled apps can install the extracted directory with `npm install --save file:../matumbo-browser-voice`.

These modules need browser APIs, not a separate inference service. A host supplies navigation, destination identity, storage, and its existing authorized chat submit/cancel callbacks. Keep My GPT credentials, Rooms membership projections, application routing, and provider bridge code with their existing owners.

Adopt the package first in one additional identified browser checkout with its own tests and review. Treat Python services and cloud conversation projects as separate integration targets; a browser ES module package alone does not add native dictation or modify cloud chat interfaces.

Verification should cover denied permission, unsupported APIs, late permission/results/replies, manual edits, owner changes, interruption, storage failure, wrong unlock codes, modified ciphertext/metadata, and cleanup. Node tests use browser doubles and do not prove physical microphone quality or device codec/playback behavior; verify those separately on the target device.
