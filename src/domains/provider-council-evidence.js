// Shared browser-safe contract for one bounded operator probe run.
// A digest detects inconsistent bytes, never authenticates a provider or bill.
export const COUNCIL_PROVIDERS = Object.freeze(["openai","anthropic","google","deepseek","kimi","nvidia","xai"]);
export const COUNCIL_REPORT_SCHEMA = "matumbo.provider-council/1";
export const COUNCIL_EXPORT_SCHEMA = "matumbo.provider-council-export/1";
export const COUNCIL_TASK = "arithmetic-31-v1";
export const COUNCIL_MISSION_TASK = "route-constraint-v1";
export const COUNCIL_MISSION_SCHEMA = "matumbo.provider-council/2";
export const COUNCIL_MISSION = Object.freeze({
  budget:7,
  jobs:Object.freeze([
    Object.freeze({id:"A",cost:3,value:5}),
    Object.freeze({id:"B",cost:4,value:7}),
    Object.freeze({id:"C",cost:5,value:9}),
    Object.freeze({id:"D",cost:2,value:4}),
  ]),
});
const candidateValid = v => typeof v === "string" && /^(?:A|B|C|D)(?:,(?:A|B|C|D))*$/.test(v) &&
  [...new Set(v.split(","))].sort().join(",") === v;
export function scoreCouncilPlan(candidate){
  if(!candidateValid(candidate))return null;
  const selected=COUNCIL_MISSION.jobs.filter(job=>candidate.split(",").includes(job.id));
  const cost=selected.reduce((sum,job)=>sum+job.cost,0),value=selected.reduce((sum,job)=>sum+job.value,0);
  return Object.freeze({candidate,cost,value,feasible:cost<=COUNCIL_MISSION.budget});
}
export function solveCouncilMission(){
  const jobs=COUNCIL_MISSION.jobs,plans=[];
  // Enumerate all nonempty subsets. This small objective is independently
  // reproducible and does not trust the providers' own scores or confidence.
  for(let mask=1;mask<(1<<jobs.length);mask++){
    const plan=scoreCouncilPlan(jobs.filter((_,i)=>mask&(1<<i)).map(job=>job.id).join(","));
    if(plan.feasible)plans.push(plan);
  }
  plans.sort((a,b)=>b.value-a.value||a.cost-b.cost||a.candidate.localeCompare(b.candidate));
  if(!plans.length||plans[0].value===plans[1]?.value)throw new Error("Mission requires a unique optimum.");
  return plans[0];
}
export function normalizeCouncilCandidate(answer){
  const v=typeof answer==="string"?answer.trim():"";
  // Accept only the requested small grammar, never instructions, markup,
  // tool calls, or free-form text. Reordering is not an invalid proposal.
  if(!/^[A-D](?:\s*,\s*[A-D]){0,3}$/.test(v))return null;
  const ids=v.split(",").map(id=>id.trim());
  if(new Set(ids).size!==ids.length)return null;
  return ids.sort().join(",");
}

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
function validRow(v,mission=false) {
  const fields=["provider","requestedModel","resolvedModel","status","attempted","latencyMs","httpStatus","usage","answerCorrect","responseSha256"];
  if(mission)fields.push("candidate");
  if (!exact(v,fields) ||
      !COUNCIL_PROVIDERS.includes(v.provider) || !modelOrNull(v.requestedModel) || !modelOrNull(v.resolvedModel) || !usageValid(v.usage) ||
      !(v.responseSha256 === null || hex(v.responseSha256)) || !(v.answerCorrect === null || typeof v.answerCorrect === "boolean")) return false;
  if(mission){
    if(v.candidate!==null&&!candidateValid(v.candidate))return false;
    if(v.status==="response-observed"){
      if(v.answerCorrect!==(v.candidate===solveCouncilMission().candidate))return false;
    }else if(v.candidate!==null)return false;
  }
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
      ![COUNCIL_REPORT_SCHEMA,COUNCIL_MISSION_SCHEMA].includes(v.schema) || typeof v.runId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(v.runId) ||
      typeof v.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.createdAt) ||
      !Number.isFinite(Date.parse(v.createdAt)) || !["fixture","live"].includes(v.mode) || v.task !== (v.schema===COUNCIL_MISSION_SCHEMA?COUNCIL_MISSION_TASK:COUNCIL_TASK) ||
      !Number.isInteger(v.maxAttempts) || v.maxAttempts < 1 || v.maxAttempts > COUNCIL_PROVIDERS.length ||
      v.requestedOutputTokens !== COUNCIL_OUTPUT_LIMIT || v.postedChargesUsd !== null || v.worldActionExecuted !== false ||
      !Array.isArray(v.rows) || !v.rows.length || v.rows.length > COUNCIL_PROVIDERS.length ||
      !v.rows.every(row=>validRow(row,v.schema===COUNCIL_MISSION_SCHEMA)) || new Set(v.rows.map(r=>r.provider)).size !== v.rows.length ||
      v.rows.filter(r=>r.attempted).length > v.maxAttempts) throw new Error("Invalid provider council report.");
  return v;
}
export function summarizeCouncilMission(report){
  validateCouncilReport(report);
  if(report.schema!==COUNCIL_MISSION_SCHEMA)throw new Error("Not a planning mission report.");
  const optimum=solveCouncilMission(),rows=report.rows.map(row=>{
    const plan=scoreCouncilPlan(row.candidate);
    let verdict="unknown";
    if(row.status==="response-observed"){
      verdict=!plan?"invalid-proposal":!plan.feasible?"over-budget":plan.candidate===optimum.candidate?"optimal":"feasible-suboptimal";
    }
    return Object.freeze({provider:row.provider,plan,verdict});
  });
  const supporting=rows.filter(row=>row.verdict==="optimal").map(row=>row.provider);
  const disagreements=rows.filter(row=>["feasible-suboptimal","over-budget"].includes(row.verdict)).map(row=>row.provider);
  const invalid=rows.filter(row=>row.verdict==="invalid-proposal").map(row=>row.provider);
  const unknown=rows.filter(row=>row.verdict==="unknown").map(row=>row.provider);
  return Object.freeze({optimum,supporting:Object.freeze(supporting),disagreements:Object.freeze(disagreements),
    invalid:Object.freeze(invalid),unknown:Object.freeze(unknown),
    outcome:supporting.length?"verified-proposal-observed":"no-verified-provider-proposal",
    // No provider vote, confidence or even a correct plan grants authority.
    authority:"evidence-only",worldActionExecuted:false,rows:Object.freeze(rows)});
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
