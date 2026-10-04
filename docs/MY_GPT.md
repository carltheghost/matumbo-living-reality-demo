# My GPT in Reality Lens

Open **Network & tools → Web + AI → My GPT**. My GPT uses the existing object's controls and Text view. It combines a local conversation surface, your assistant collection and selected imported history.

## Connect a provider

**ChatGPT plan:** On the local preview, open **Account & setup**, check **Allow this app to use my ChatGPT plan**, then choose **Continue with ChatGPT**. OpenAI's page lets you choose your account/workspace and authorize plan usage. Complete that step yourself, return to My GPT, refresh status and load the account's available models. Choose a model before sending. Account availability, plan limits and workspace policy are decided by OpenAI; a successful sign-in is distinct from a completed answer.

This uses the documented local/open-source Sign in with ChatGPT flow. It creates a maTumbo registration; it does not reuse Codex credentials, cookies or undocumented ChatGPT endpoints. Sign-in does not grant access to ChatGPT conversations or custom GPT configuration. [Official overview](https://developers.openai.com/siwc/token-sharing-open-source) · [Registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) · [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)

**OpenAI API:** Select OpenAI API to use the key configured in the local bridge environment. API usage has its own billing and account limits. Browser controls never accept or retain API keys. In Codex, use the OpenAI Developers secure key setup flow; if that connector requests reauthentication, reconnect it before provisioning. No key is included in the repository, exports or static deployment. The model is selected by the server's `OPENAI_MODEL` configuration; the default is `gpt-6.1-sol`. The app distinguishes a configured key from a verified response.

The Python bridge keeps credentials server-side. Windows account records are protected using current-user DPAPI outside the checkout; Unix records use an owner-only local directory. The static GitHub Pages build cannot provide this local account service. My GPT's local collection and import/export still work there, with account connection clearly unavailable.

## Start the local bridge

From the repository root, install the optional sign-in validation dependencies into the same Python environment used by the launcher:

```powershell
py -3 -m pip install -r requirements-gpt.txt
.\scripts\launch-demo.ps1 -StaticPort 8082
```

If the owned bridge is already running older source, stop it with `scripts/stop-demo.ps1` and launch it again. These scripts verify the checkout and process identity before taking action. NVIDIA and static serving retain their existing routes.

## Use your GPT collection

Expand **My GPT collection**. Give an assistant a name and optionally save its `https://chatgpt.com/g/g-…` link. **Open** opens that original GPT on ChatGPT. Saving a link does not extract its configuration or make that hosted GPT callable through the model API.

For an assistant that runs inside maTumbo, enter the instructions and reference knowledge you want it to use. This is a local assistant version; its behavior may differ from the original GPT. Select the assistant above the conversation before sending. The instructions and knowledge are included only in explicit requests you make with that assistant.

There are up to 12 profiles, with 8000 instruction characters and 12000 knowledge characters per profile. Importing a profile with an existing ID preserves both configurations instead of overwriting the existing one.

## Bring selected history

Expand **Local history & import** and choose a JSON file. Supported inputs are selected ChatGPT `conversations.json` entries and My GPT JSON exports. The file picker is also available through the object's Text view. Import stays on this device and does not call a model.

The importer follows the selected branch of a ChatGPT conversation and retains visible user/assistant text. It excludes tool-directed messages, hidden analysis and non-text attachments. It does not synchronize with ChatGPT. Choose a conversation in the local history before continuing it; pressing Send shares its recent text with the selected provider.

Import limits are 2 MB per file/workspace, 60 conversations, and 100 visible text messages per conversation, with 16000 characters per message. Oversized imports are rejected before changing existing data. A full history requires an explicit export/clear step; starting another chat does not silently evict the oldest one. Exports contain personal instructions, knowledge and conversations, so store them where you want that information kept.

## What Send does

Send transmits the selected assistant's instructions/knowledge and up to 20 recent messages, capped at 24000 message characters, to the selected provider through the local bridge. A new prompt may contain up to 8000 characters. Other conversations, browser history, wallets and app objects are not automatically included. The model has no tools or authority to change accounts, make payments or execute code.

There is one inference in flight and a local six-request-per-minute limit. Plan inference uses the official Responses API with `store:false` and `stream:true`; the bridge waits for a completed text response and enforces local time/output limits. Provider processing and plan/API usage may already occur before cancellation. Client cancellation stops displaying the pending answer; it is not a promise to reverse provider usage.

Chat data and assistant profiles use local browser storage. That is separate from protected provider credentials and is not an encrypted archive. Storage failures are shown rather than reported as successful persistence. Use **Export local data** to keep a portable backup.

If another tab has changed the saved workspace, an older tab keeps its new edits in memory and shows a warning instead of replacing the newer saved copy. Export that tab before reloading, then import the backup. A different continuation with the same conversation ID is recovered as a separate conversation; repeated imports of the same backup do not create more copies. This is an optimistic conflict check, not an atomic transaction between simultaneously writing tabs.

## Verification

```powershell
node --test tests/my-gpt.test.mjs tests/my-gpt-ui.test.mjs tests/web-ai-lens-return.test.mjs tests/web-ai-compute.test.mjs
py -3 -m unittest discover -s tests -p "test_gpt_bridge.py"
```

The bridge's automated tests use injected provider responses and generated test identities. Passing them does not establish successful owner sign-in, plan eligibility, a funded API account or a real model answer. See the delivery acceptance record for the checks actually performed on this revision.
