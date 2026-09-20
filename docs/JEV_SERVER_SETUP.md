# Jev server setup

The project can use Jev for the narrow semantic decisions owned by the
existing AI judgment seam.

## Environment

For the TypeSafe endpoint:

    TYPESAFE_JUDGMENTS=http
    TYPESAFE_API_KEY=replace-with-your-server-secret
    JEV_MODEL=jev-latest

Optional endpoint override:

    TYPESAFE_API_URL=https://api.typesafe.ai/v1/systemone

For the Jev Agent endpoint:

    TYPESAFE_JUDGMENTS=http
    JEV_AGENT_KEY=jv_live_replace-with-your-secret
    JEV_MODEL=jev-latest

Optional endpoint override:

    JEV_API_URL=https://jev-agent.com/api/v1/systemone

Never place these secrets in index.html, client JavaScript, localStorage,
GitHub Pages environment variables, or a public repository commit.

## What Jev decides

Jev is used only for typed Choice/Score questions such as Bot Plaza intent
routing and proposal readiness. The application workflow remains code-owned.
Jev does not receive raw camera frames, eye images, audio, or hand landmarks.

The browser-safe default remains the deterministic heuristic. A trusted
server process selects the HTTP provider through TYPESAFE_JUDGMENTS=http.

## Failure behavior

Missing credentials, non-2xx responses, timeouts, malformed answers, and schema
mismatches fall back to the deterministic heuristic. No mutation is performed
by the judgment provider itself.
