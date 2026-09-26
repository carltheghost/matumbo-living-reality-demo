import { randomUUID } from "node:crypto";
import {
  NVIDIA_NIM_API_BASE_URL,
  NVIDIA_NIM_MODELS,
  normalizeNvidiaNimChatRequest,
} from "../src/domains/nvidia-nim.js";

export class NvidiaGatewayError extends Error {
  constructor(message, status = 500, code = "nvidia_gateway_error") {
    super(message);
    this.name = "NvidiaGatewayError";
    this.status = status;
    this.code = code;
  }
}

function normalizedUsage(raw = {}) {
  const inputTokens = Number.isFinite(Number(raw.prompt_tokens)) ? Math.max(0, Math.floor(Number(raw.prompt_tokens))) : 0;
  const outputTokens = Number.isFinite(Number(raw.completion_tokens)) ? Math.max(0, Math.floor(Number(raw.completion_tokens))) : 0;
  const totalTokens = Number.isFinite(Number(raw.total_tokens)) ? Math.max(0, Math.floor(Number(raw.total_tokens))) : inputTokens + outputTokens;
  return Object.freeze({ inputTokens, outputTokens, totalTokens });
}

function buildMessages(request) {
  const messages = [];
  if (request.system) messages.push({ role: "system", content: request.system });
  const content = request.imageUrl
    ? [
        { type: "text", text: request.prompt },
        { type: "image_url", image_url: { url: request.imageUrl } },
      ]
    : request.prompt;
  messages.push({ role: "user", content });
  return messages;
}

export function createNvidiaGateway({
  apiKey = process.env.NVIDIA_API_KEY,
  baseUrl = process.env.NVIDIA_API_BASE_URL || NVIDIA_NIM_API_BASE_URL,
  fetchImpl = globalThis.fetch,
  uuid = randomUUID,
  now = () => Date.now(),
  timeoutMs = 120000,
} = {}) {
  const key = String(apiKey ?? "").trim();
  const cleanBase = String(baseUrl ?? NVIDIA_NIM_API_BASE_URL).replace(/\/+$/, "");
  if (typeof fetchImpl !== "function") throw new Error("NVIDIA gateway needs fetch");

  function status() {
    return Object.freeze({
      ok: true,
      providerId: "nvidia",
      configured: Boolean(key),
      baseUrl: cleanBase,
      models: NVIDIA_NIM_MODELS,
      keyExposed: false,
      executionSurface: "authorized-server-gateway",
      trialEndpoint: true,
    });
  }

  async function chat(input) {
    if (!key) throw new NvidiaGatewayError("NVIDIA_API_KEY is not configured on the server", 503, "nvidia_key_missing");
    const request = normalizeNvidiaNimChatRequest(input);
    const startedAt = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const payload = {
      model: request.model,
      messages: buildMessages(request),
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: false,
    };
    if (request.reasoningEffort) payload.reasoning_effort = request.reasoningEffort;

    let response;
    try {
      response = await fetchImpl(`${cleanBase}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new NvidiaGatewayError("NVIDIA request timed out", 504, "nvidia_timeout");
      throw new NvidiaGatewayError("NVIDIA endpoint is unreachable", 502, "nvidia_unreachable");
    } finally {
      clearTimeout(timer);
    }

    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) {
      const upstream = body?.error?.message || body?.message || `NVIDIA returned HTTP ${response.status}`;
      throw new NvidiaGatewayError(upstream, response.status >= 500 ? 502 : 400, "nvidia_upstream_error");
    }

    const message = body?.choices?.[0]?.message ?? {};
    const usage = normalizedUsage(body?.usage);
    const latencyMs = Math.max(0, now() - startedAt);
    const providerResponseId = String(response.headers?.get?.("x-request-id") || body?.id || "").trim() || null;
    const receiptId = `nvidia-${providerResponseId || uuid()}`;

    return Object.freeze({
      ok: true,
      providerId: "nvidia",
      model: request.model,
      content: typeof message.content === "string" ? message.content : "",
      reasoningContent: typeof message.reasoning_content === "string" ? message.reasoning_content : "",
      finishReason: body?.choices?.[0]?.finish_reason ?? null,
      providerResponseId,
      latencyMs,
      usage,
      receipt: Object.freeze({
        receiptId,
        providerId: "nvidia",
        model: request.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        reportedCostUsd: 0,
        verified: false,
        providerAuthenticated: true,
        costVerified: false,
        latencyMs,
        source: "provider-adapter",
      }),
      verification: Object.freeze({
        providerAuthenticated: true,
        usageReturnedByProvider: Boolean(body?.usage),
        costVerified: false,
        rewardEligible: false,
        reason: "trial endpoint does not provide an authoritative billed-cost receipt",
      }),
      keyExposed: false,
    });
  }

  return Object.freeze({ status, chat });
}

export default createNvidiaGateway;
