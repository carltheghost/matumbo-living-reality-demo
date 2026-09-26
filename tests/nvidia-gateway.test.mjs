import test from "node:test";
import assert from "node:assert/strict";
import { createNvidiaGateway } from "../server/nvidia-nim-gateway.mjs";

test("gateway fails closed when NVIDIA_API_KEY is absent", async () => {
  const gateway = createNvidiaGateway({ apiKey: "", fetchImpl: async () => { throw new Error("should not call"); } });
  await assert.rejects(() => gateway.chat({ model: "z-ai/glm-5.3", prompt: "hello" }), (error) => error.status === 503);
});

test("gateway keeps the key server-side and returns a non-cost-verified receipt", async () => {
  let auth;
  let sent;
  let t = 1000;
  const gateway = createNvidiaGateway({
    apiKey: "nvapi-secret",
    now: () => (t += 25),
    uuid: () => "uuid-1",
    fetchImpl: async (_url, init) => {
      auth = init.headers.Authorization;
      sent = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        headers: { get: () => "req-123" },
        async json() {
          return {
            id: "chatcmpl-1",
            choices: [{ message: { content: "pong", reasoning_content: "hidden-ish" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
          };
        },
      };
    },
  });
  const result = await gateway.chat({ model: "z-ai/glm-5.3", prompt: "ping" });
  assert.equal(auth, "Bearer nvapi-secret");
  assert.equal(sent.model, "z-ai/glm-5.3");
  assert.equal(result.content, "pong");
  assert.equal(result.usage.totalTokens, 10);
  assert.equal(result.receipt.providerAuthenticated, true);
  assert.equal(result.receipt.costVerified, false);
  assert.equal(result.receipt.verified, false);
  assert.equal(result.keyExposed, false);
  assert.equal(JSON.stringify(result).includes("nvapi-secret"), false);
});
