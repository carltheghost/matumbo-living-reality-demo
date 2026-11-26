# Vivo social circle — additive integration

This adds real turn-taking through supplied connections. It does not create a
provider connection or prove that an external Muse, Grok, or dot is attached.

## Implemented

- Select two or more existing residents and a topic; explicitly start 3–12 total
  turns. Turns run sequentially with prior replies supplied to the next speaker.
- A visible shared transcript, current speaker, turn budget and Stop control.
- Stop/page close fences late replies. An unavailable or replaced account,
  provider error, invalid reply or 60-second timeout stops the run. No retries,
  reload restart, background scheduling, or automatic world/tool actions.
- Model replies render as plain text. Provider errors are not echoed into UI.
- A connected account may incur usage on every turn. The UI explains that the
  selected connections receive the group conversation.

## Repository integration

`companion.mjs` mounts the panel using this branch's existing characters and
`VivoConversationProvider`. This older branch has Relic, Workpiece and Inner
world, not the newer live Muse/Grok/dot roster. It deliberately preserves them.
The legacy transport accepts only 400 characters, so its adapter sends the topic
and compact excerpts from the last two replies. This is not full conversation
memory. The room itself retains and supplies the complete bounded transcript.

The shell cache is v25 and includes both new modules. The existing upgrade
acceptance script targets the new shell and includes those assets; it has only
been syntax-checked here, not browser-executed.

## Preserve the newer live Site

Do not replace the live Site with this older branch. Import `social-room.mjs`
and `social-room-panel.mjs` into the latest source and mount the panel inside the
existing residents surface, using its existing roster and selected connections:

```js
import { mountSocialRoom } from './social-room-panel.mjs';
const social = mountSocialRoom({
  container: residentsContainer,
  residents: existingResidents, // [{ id, name }, ...]
  resolveConnection(id) {
    // Return null if not connected. An adapter must use the existing authorized
    // backend/browser session, not a resident name as proof of connection.
    const adapter = verifiedResidentAdapters.get(id);
    return adapter || null;
  },
});
```

Each adapter provides `{ connected: true, key, respond(request) }`. `key` is an
opaque non-secret connection generation: change it whenever account, model,
permissions, session, or world changes. `respond` receives `{ resident,
participants, topic, transcript, signal }` and returns `{ text }` (1–4000 chars).
Recheck authorization at the actual request boundary and forward cancellation.
For external personal agents, use their existing authenticated request/receipt
bridge. Do not impersonate one through a generic model. Transcript text is
conversation data, not an instruction to execute tools or expand permissions.

Call `social.refresh()` after connection changes and `social.destroy()` on
unmount. Bring over the scoped `.vivo-social-room` CSS, and add the modules to the
latest Site's own asset/cache release. Do not downgrade its cache version.

## Validation and remaining work

25 focused Node tests pass, including nine new room/UI tests. Companion syntax,
Python upgrade-test syntax and diff whitespace checks pass. UI tests use a DOM
fixture; they are not browser acceptance. Live multi-provider inference,
external-agent receipts, browser rendering and Site deployment remain unverified.
The editing account cannot access this Vivo Site's source or publishing controls.
No collaborative movement, persistent social memory or autonomous offline runs
are claimed by this change.
