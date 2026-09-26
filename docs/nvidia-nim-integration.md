# NVIDIA NIM live provider integration

maTumbo can use NVIDIA's hosted NIM API as one external compute lane while keeping SIMFABRIC and the browser projection provider-neutral.

## Supported initial model roster

- `deepseek-ai/deepseek-v4.1-flash` — multimodal, coding/agent work
- `z-ai/glm-5.3` — text reasoning, coding, planning, tool-oriented work
- `z-ai/glm-5.3-flash` — multimodal, fast agent work
- `moonshotai/kimi-k3` — multimodal long-horizon coding and knowledge work
- `nvidia/nemotron-3-super-120b-a12b` — agentic reasoning, planning, tool use

The registry is deliberately explicit rather than silently accepting arbitrary provider model IDs. NVIDIA's hosted catalog can change, so additions should be reviewed and tested.

## Security boundary

The browser never stores or receives `NVIDIA_API_KEY`. Live execution is performed only by `server/nvidia-nim-gateway.mjs`, which reads the key from the server process environment and forwards an allow-listed request to `https://integrate.api.nvidia.com/v1/chat/completions`.

The gateway:

- fails closed when the key is missing;
- accepts only registered model IDs;
- bounds prompt, system, image URL, max-token, and temperature inputs;
- uses HTTPS image URLs only;
- returns provider usage metadata when NVIDIA supplies it;
- never returns the API key;
- marks trial-endpoint usage as provider-authenticated but **not cost-verified**;
- does not turn free/trial calls into TUMBO-SIM rewards.

NVIDIA's hosted trial service may log input/output under its trial terms. maTumbo therefore does not automatically send Rooms, private messages, files, health data, secrets, or hidden SIMFABRIC state. Only the prompt explicitly submitted to the NVIDIA live runner is sent.

## Local start on Windows PowerShell

```powershell
$env:NVIDIA_API_KEY="YOUR_NVIDIA_KEY"
npm run dev:nvidia
```

Then open:

```text
http://127.0.0.1:8080
```

Do not commit the key. The key is an environment variable, not browser storage and not a source file.

## API surface

`GET /api/nvidia/status`

Returns whether the server has a key configured, the allow-listed model roster, and `keyExposed: false`.

`POST /api/nvidia/chat`

Example request:

```json
{
  "model": "z-ai/glm-5.3",
  "prompt": "Explain the current maTumbo task.",
  "maxTokens": 4096,
  "temperature": 0.5
}
```

For registered multimodal models an optional HTTPS `imageUrl` can be supplied.

The normalized response includes model text, optional reasoning content, latency, provider usage counts, and a receipt-shaped record suitable for the local Compute Economy timeline. Because the NVIDIA trial endpoint does not provide an authoritative billed-cost receipt, that record is not eligible for verified-spend rewards.

## Architecture

```text
Reality Lens / Web + AI
        |
        | same-origin request, no secret
        v
maTumbo authorized server gateway
        |
        | Authorization: Bearer NVIDIA_API_KEY
        v
https://integrate.api.nvidia.com/v1/chat/completions
        |
        v
normalized response + usage evidence
        |
        v
Compute Exchange -> Economic Timeline -> SIMFABRIC projection
```

This keeps the Three.js world a projection. The external execution authority lives behind the separate server gateway.
