# ChatGPT sign-in return flow

This change completes the navigation and return handling for the existing local
Vivo ChatGPT account host. It does not install native Codex, attach an existing
Codex conversation, or provide API-key authentication.

## Behavior

1. Select ChatGPT / Codex subscription and choose Sign in with ChatGPT.
2. Vivo requests the existing account host's PKCE authorization URL, validates
   its exact official origin/path, then navigates the current tab to OpenAI.
   The validated Continue link remains available if navigation is blocked.
3. The existing callback validates the signed identity and stores credentials
   privately. Only success redirects to the phone page with a return marker.
4. The native account panel reopens, reads the authenticated host's account
   metadata, and removes the return marker from the address bar. The marker
   itself never establishes authentication or starts model inference.

Account creation and reconnection both use this flow. Provider selection changes
and component disposal fence late authorization responses before navigation.

## Site integration

Integrate the changed panel and callback handling into the existing Site source,
preserving newer changes. The Python host binds to the computer's loopback address;
copying the UI to a public Site does not make that host reachable from a phone.
The Site owner must retain its authenticated companion/relay architecture and
map equivalent callback status there. Do not copy local credentials to the Site.
The release owner must include changed assets in their cache/version process.

## Evidence

- 34 Python account/HTTP tests passed, including signed fixture callback and
  real loopback HTTP. No real OpenAI account was used.
- 19 Node entry/provider/navigation checks passed, including a minimal DOM
  handler fixture. This is not a browser rendering or live-provider test.
- Existing browser fixtures intercept navigation; they do not visit OpenAI.
  Browser acceptance still requires an environment where Chromium starts.

Official flow: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
