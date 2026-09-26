/**
 * nvidia-nim.js — shared NVIDIA NIM model registry + browser-safe gateway client.
 *
 * The browser never receives NVIDIA_API_KEY. Live execution goes through the
 * separately authorized maTumbo server gateway at /api/nvidia/*.
 */

export const NVIDIA_NIM_PROVIDER_ID = "nvidia";
export const NVIDIA_NIM_API_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const NVIDIA_NIM_STATUS_PATH = "/api/nvidia/status";
export const NVIDIA_NIM_CHAT_PATH = "/api/nvidia/chat";

export const NVIDIA_NIM_MODELS = Object.freeze([
  Object.freeze({
    id: "deepseek-ai/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    publisher: "DeepSeek AI",
    capabilities: Object.freeze(["chat", "reasoning", "code", "vision", "long-context"]),
    inputModalities: Object.freeze(["text", "image"]),
    role: "Fast coding, multimodal analysis, and agent work",
  }),
  Object.freeze({
    id: "z-ai/glm-5.3",
    name: "GLM-5.3",
    publisher: "Z.ai",
    capabilities: Object.freeze(["chat", "reasoning", "code", "tool-use", "long-context"]),
    inputModalities: Object.freeze(["text"]),
    role: "Deep reasoning, coding, planning, and tool-oriented work",
  }),
  Object.freeze({
    id: "z-ai/glm-5.3-flash",
    name: "GLM-5.3 Flash",
    publisher: "Z.ai",
    capabilities: Object.freeze(["chat", "reasoning", "code", "vision", "tool-use", "long-context"]),
    inputModalities: Object.freeze(["text", "image"]),
    role: "Fast multimodal agents and high-volume interactive work",
  }),
  Object.freeze({
    id: "moonshotai/kimi-k3",
    name: "Kimi K3",
    publisher: "Moonshot AI",
    capabilities: Object.freeze(["chat", "reasoning", "code", "vision", "tool-use", "long-context"]),
    inputModalities: Object.freeze(["text", "image"]),
    role: "Long-horizon coding, knowledge work, and visual understanding",
  }),
  Object.freeze({
    id: "nvidia/nemotron-3-super-120b-a12b",
    name: "Nemotron 3 Super 120B A12B",
    publisher: "NVIDIA",
    capabilities: Object.freeze(["chat", "reasoning", "code", "tool-use", "long-context"]),
    inputModalities: Object.freeze(["text"]),
    role: "Agentic reasoning, planning, tool use, and long-context work",
  }),
]);

const MODEL_BY_ID = new Map(NVIDIA_NIM_MODELS.map((model) => [model.id, model]));
const REASONING_EFFORTS = new Set(["low", "medium", "high", "max"]);

export function getNvidiaNimModel(modelId) {
  return MODEL_BY_ID.get(String(modelId ?? "")) ?? null;
}

function boundedText(value, { label, max, required = false } = {}) {
  const text = String(value ?? "").trim();
  if (required && !text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return text;
}

function optionalNumber(value, { label, min, max, integer = false, fallback } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new Error(`${label} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}`);
  }
  return number;
}

export function normalizeNvidiaNimChatRequest(input = {}) {
  const model = getNvidiaNimModel(input.model);
  if (!model) throw new Error("Unsupported NVIDIA NIM model");

  const prompt = boundedText(input.prompt, { label: "Prompt", max: 24000, required: true });
  const system = boundedText(input.system, { label: "System prompt", max: 8000 });
  const imageUrl = boundedText(input.imageUrl, { label: "Image URL", max: 4096 });
  if (imageUrl) {
    if (!model.inputModalities.includes("image")) throw new Error(`${model.name} is text-only in this registry`);
    let parsed;
    try { parsed = new URL(imageUrl); } catch { throw new Error("Image URL must be a valid HTTPS URL"); }
    if (parsed.protocol !== "https:") throw new Error("Image URL must use HTTPS");
  }

  const maxTokens = optionalNumber(input.maxTokens, { label: "maxTokens", min: 1, max: 32768, integer: true, fallback: 4096 });
  const temperature = optionalNumber(input.temperature, { label: "temperature", min: 0, max: 2, fallback: 0.5 });
  const reasoningEffort = boundedText(input.reasoningEffort, { label: "Reasoning effort", max: 16 }).toLowerCase();
  if (reasoningEffort && !REASONING_EFFORTS.has(reasoningEffort)) throw new Error("Unsupported reasoning effort");

  return Object.freeze({
    model: model.id,
    prompt,
    system,
    imageUrl,
    maxTokens,
    temperature,
    reasoningEffort: reasoningEffort || null,
  });
}

async function parseJsonResponse(response) {
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `Gateway request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function createNvidiaNimClient({
  fetchImpl = globalThis.fetch,
  statusPath = NVIDIA_NIM_STATUS_PATH,
  chatPath = NVIDIA_NIM_CHAT_PATH,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("NVIDIA NIM client needs fetch");

  async function status() {
    const response = await fetchImpl(statusPath, { method: "GET", headers: { Accept: "application/json" } });
    return parseJsonResponse(response);
  }

  async function execute(input) {
    const request = normalizeNvidiaNimChatRequest(input);
    const response = await fetchImpl(chatPath, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
    });
    return parseJsonResponse(response);
  }

  return Object.freeze({ status, execute });
}

export default Object.freeze({
  NVIDIA_NIM_PROVIDER_ID,
  NVIDIA_NIM_API_BASE_URL,
  NVIDIA_NIM_STATUS_PATH,
  NVIDIA_NIM_CHAT_PATH,
  NVIDIA_NIM_MODELS,
  getNvidiaNimModel,
  normalizeNvidiaNimChatRequest,
  createNvidiaNimClient,
});
