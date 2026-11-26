// Shared browser-safe contract for one bounded operator probe run.
// A digest detects inconsistent bytes, never authenticates a provider or bill.
export const COUNCIL_PROVIDERS = Object.freeze(["openai","anthropic","google","deepseek","kimi","nvidia","xai"]);
export const COUNCIL_REPORT_SCHEMA = "matumbo.provider-council/1";
export const COUNCIL_EXPORT_SCHEMA = "matumbo.provider-council-export/1";
export const COUNCIL_TASK = "arithmetic-31-v1";
export const COUNCIL_OUTPUT_LIMIT = 64;
export const COUNCIL_STORAGE_KEY = "matumbo.provider-council.latest.v1";
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v,keys) => object(v) && Object.keys(v).length === keys.length && keys.every(k=>Object.hasOwn(v,k));
const hex = v => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const count = v => Number.isSafeInteger(v) && v >= 0;
export const validCouncilModel = v => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(v) && !/^(?:sk-|nvapi-|jv_live_|AIza)/i.test(v);
const modelOrNull = v => v === null || validCouncilModel(v);
const usageValid = v => v === null || (exact(v,["inputTokens","outputTokens"]) && count(v.inputTokens) && count(v.outputTokens));
const statusCode = v => Number.isInteger(v) && v >= 100 && v <= 599;
const isSuccess = v => statusCode(v) && v >= 200 && v < 300;
const noEvidence = v => v.resolvedModel === null && v.usage === null && v.answerCorrect === null && v.responseSha256 === null;
function validRow(v) {
  if (!exact(v,["provider","requestedModel","resolvedModel","status","attempted","latencyMs","httpStatus","usage","answerCorrect","responseSha256"]) ||
      !COUNCIL_PROVIDERS.includes(v.provider) || !modelOrNull(v.requestedModel) || !modelOrNull(v.resolvedModel) || !usageValid(v.usage) ||
      !(v.responseSha256 === null || hex(v.responseSha256)) || !(v.answerCorrect === null || typeof v.answerCorrect === "boolean")) return false;
  if (["not-configured","skipped-limit"].includes(v.status)) return v.attempted === false && v.latencyMs === null && v.httpStatus === null && noEvidence(v);
  if (v.attempted !== true || !validCouncilModel(v.requestedModel) || !count(v.latencyMs)) return false;
  if (v.status === "transport-uncertain") return v.httpStatus === null && noEvidence(v);
  if (v.status === "http-error") return statusCode(v.httpStatus) && !isSuccess(v.httpStatus) && noEvidence(v);
  if (v.status === "invalid-response") return isSuccess(v.httpStatus) && noEvidence(v);
  if (v.status === "response-observed") return isSuccess(v.httpStatus) && hex(v.responseSha256) && typeof v.answerCorrect === "boolean";
  if (v.status === "no-usable-answer") return isSuccess(v.httpStatus) && hex(v.responseSha256) && v.answerCorrect === null;
  return false;
}
export function validateCouncilReport(v) {
  if (!exact(v,["schema","runId","createdAt","mode","task","maxAttempts","requestedOutputTokens","rows","postedChargesUsd","worldActionExecuted"]) ||
      v.schema !== COUNCIL_REPORT_SCHEMA || typeof v.runId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(v.runId) ||
      typeof v.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.createdAt) ||
      !Number.isFinite(Date.parse(v.createdAt)) || !["fixture","live"].includes(v.mode) || v.task !== COUNCIL_TASK ||
      !Number.isInteger(v.maxAttempts) || v.maxAttempts < 1 || v.maxAttempts > COUNCIL_PROVIDERS.length ||
      v.requestedOutputTokens !== COUNCIL_OUTPUT_LIMIT || v.postedChargesUsd !== null || v.worldActionExecuted !== false ||
      !Array.isArray(v.rows) || !v.rows.length || v.rows.length > COUNCIL_PROVIDERS.length ||
      !v.rows.every(validRow) || new Set(v.rows.map(r=>r.provider)).size !== v.rows.length ||
      v.rows.filter(r=>r.attempted).length > v.maxAttempts) throw new Error("Invalid provider council report.");
  return v;
}
async function sha(text, cryptoApi) {
  if (!cryptoApi?.subtle) throw new Error("Receipt integrity check unavailable.");
  return Array.from(new Uint8Array(await cryptoApi.subtle.digest("SHA-256",new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,"0")).join("");
}
export async function exportCouncilReport(report,{cryptoApi=globalThis.crypto}={}) {
  validateCouncilReport(report);
  const reportJson = JSON.stringify(report);
  return {schema:COUNCIL_EXPORT_SCHEMA,reportJson,reportSha256:await sha(reportJson,cryptoApi)};
}
export async function parseCouncilReport(envelope,{cryptoApi=globalThis.crypto}={}) {
  if (!exact(envelope,["schema","reportJson","reportSha256"]) || envelope.schema !== COUNCIL_EXPORT_SCHEMA ||
      typeof envelope.reportJson !== "string" || envelope.reportJson.length > 32000 || !hex(envelope.reportSha256) ||
      await sha(envelope.reportJson,cryptoApi) !== envelope.reportSha256) throw new Error("Invalid provider council export.");
  let report;try{report=JSON.parse(envelope.reportJson);}catch{throw new Error("Invalid provider council export.");}
  if(JSON.stringify(report)!==envelope.reportJson)throw new Error("Invalid provider council export.");
  return validateCouncilReport(report);
}
