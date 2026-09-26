import test from "node:test";
import assert from "node:assert/strict";
import {
  NVIDIA_NIM_MODELS,
  createNvidiaNimClient,
  normalizeNvidiaNimChatRequest,
} from "../src/domains/nvidia-nim.js";

test("registry contains the five NVIDIA-hosted maTumbo models", () => {
  assert.deepEqual(NVIDIA_NIM_MODELS.map((m) => m.id), [
    "deepseek-ai/deepseek-v4.1-flash",
    "z-ai/glm-5.3",
    "z-ai/glm-5.3-flash",
    "moonshotai/kimi-k3",
    "nvidia/nemotron-3-super-120b-a12b",
  ]);
});

test("vision is allowed only for models registered with image input", () => {
  assert.equal(normalizeNvidiaNimChatRequest({
    model: "moonshotai/kimi-k3",
    prompt: "describe",
    imageUrl: "https://example.com/a.jpg",
  }).imageUrl, "https://example.com/a.jpg");
  assert.throws(() => normalizeNvidiaNimChatRequest({
    model: "z-ai/glm-5.3",
    prompt: "describe",
    imageUrl: "https://example.com/a.jpg",
  }), /text-only/);
});

test("browser client sends no credential field", async () => {
  let seen;
  const fetchImpl = async (_url, init) => {
    seen = JSON.parse(init.body);
    return { ok: true, status: 200, async json(){ return { ok:true, content:"ok" }; } };
  };
  const client = createNvidiaNimClient({ fetchImpl });
  await client.execute({ model: "z-ai/glm-5.3", prompt: "hello" });
  assert.equal("apiKey" in seen, false);
  assert.equal("NVIDIA_API_KEY" in seen, false);
});
