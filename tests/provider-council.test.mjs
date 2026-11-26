import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { COUNCIL_PROVIDERS, exportCouncilReport, parseCouncilReport, validateCouncilReport } from "../src/domains/provider-council-evidence.js";
import { runProviderCouncil, parseCouncilArgs } from "../scripts/vivo/provider-council.mjs";
const env={
  OPENAI_API_KEY:"fixture-private-openai-key",VIVO_COUNCIL_OPENAI_MODEL:"owner-model-a",
  ANTHROPIC_API_KEY:"fixture-private-claude-key",VIVO_COUNCIL_ANTHROPIC_MODEL:"owner-model-b",
  GEMINI_API_KEY:"fixture-private-google-key",VIVO_COUNCIL_GOOGLE_MODEL:"owner-model-c",
  DEEPSEEK_API_KEY:"fixture-private-deepseek-key",VIVO_COUNCIL_DEEPSEEK_MODEL:"owner-model-d",
  MOONSHOT_API_KEY:"fixture-private-kimi-key",VIVO_COUNCIL_KIMI_MODEL:"owner-model-e",
  NVIDIA_API_KEY:"fixture-private-nvidia-key",VIVO_COUNCIL_NVIDIA_MODEL:"owner/model-f",
  XAI_API_KEY:"fixture-private-xai-key",VIVO_COUNCIL_XAI_MODEL:"owner-model-g",
};
const success=(url,body)=>{
  const model=body.model;
  if(url.endsWith("/responses"))return {model,output:[{type:"message",role:"assistant",content:[{type:"output_text",text:"31"}]}],usage:{input_tokens:10,output_tokens:2}};
  if(url.endsWith("/messages"))return {model,content:[{type:"text",text:"31"}],usage:{input_tokens:6,cache_read_input_tokens:3,cache_creation_input_tokens:1,output_tokens:2}};
  if(url.endsWith(":generateContent"))return {modelVersion:"owner-model-c",candidates:[{content:{parts:[{thought:true,text:"ignore"},{text:"31"}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:1,thoughtsTokenCount:1}};
  return {model,choices:[{message:{content:"31"}}],usage:{prompt_tokens:10,completion_tokens:2}};
};
test("seven fixture lanes exercise real response parsers, never ambient configuration or network",async()=>{
  const never=new Proxy({}, {get(){throw new Error("fixture inspected secrets");}});
  const r=await runProviderCouncil({env:never,fetchImpl:()=>{throw new Error("fixture reached network");}});
  assert.equal(r.mode,"fixture");assert.deepEqual(r.rows.map(x=>x.provider),COUNCIL_PROVIDERS);
  assert.ok(r.rows.every(x=>x.status==="response-observed"&&x.answerCorrect&&x.usage.inputTokens===20&&x.usage.outputTokens===1));
  assert.deepEqual(await parseCouncilReport(await exportCouncilReport(r)),r);
  assert.equal(r.postedChargesUsd,null);assert.equal(r.worldActionExecuted,false);
});
test("live transport requires acknowledgement, exact provider list and cap",async()=>{
  let called=0;const fetchImpl=()=>{called++;throw Error("not allowed");};
  await assert.rejects(runProviderCouncil({mode:"live",env,fetchImpl}),/acknowledgement/);
  await assert.rejects(runProviderCouncil({mode:"live",providers:["unknown"],acknowledgeCharges:true,env,fetchImpl}),/options/);
  assert.throws(()=>parseCouncilArgs(["--live","--accept-provider-charges"]),/requires/);
  assert.throws(()=>parseCouncilArgs(["--fixture","--live"]),/one mode/);
  assert.equal(called,0);
});
test("all configured provider adapters use only fixed HTTPS endpoints and bounded one-shot requests",async()=>{
  const calls=[];
  const r=await runProviderCouncil({mode:"live",env,acknowledgeCharges:true,fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,options,body});
    return new Response(JSON.stringify(success(url,body)),{status:200});
  }});
  assert.deepEqual(calls.map(c=>c.url),[
    "https://api.openai.com/v1/responses","https://api.anthropic.com/v1/messages",
    "https://generativelanguage.googleapis.com/v1beta/models/owner-model-c:generateContent",
    "https://api.deepseek.com/chat/completions","https://api.moonshot.ai/v1/chat/completions",
    "https://integrate.api.nvidia.com/v1/chat/completions","https://api.x.ai/v1/responses"]);
  assert.ok(calls.every(c=>c.options.method==="POST"&&c.options.redirect==="error"&&!Object.hasOwn(c.body,"tools")));
  assert.ok(calls.every(c=>(c.body.max_output_tokens??c.body.max_tokens??c.body.generationConfig?.maxOutputTokens)===64));
  assert.ok(calls.filter(c=>c.url.endsWith("/responses")).every(c=>c.body.store===false));
  assert.ok(r.rows.every(x=>x.answerCorrect&&x.usage.inputTokens===10&&x.usage.outputTokens===2));
  const json=JSON.stringify(await exportCouncilReport(r));
  for(const value of Object.values(env).filter(v=>v.includes("private")))assert.ok(!json.includes(value));
  assert.ok(!json.includes("What is 12"));assert.equal(r.postedChargesUsd,null);
});
test("missing credentials, unsafe model and exhausted attempt cap never dispatch",async()=>{
  const calls=[];
  const r=await runProviderCouncil({mode:"live",providers:["google","openai","anthropic","nvidia"],maxAttempts:1,
    acknowledgeCharges:true,env:{...env,GEMINI_API_KEY:"fixture",VIVO_COUNCIL_GOOGLE_MODEL:"../../else",NVIDIA_API_KEY:""},
    fetchImpl:async(url,options)=>{calls.push(url);return new Response(JSON.stringify(success(url,JSON.parse(options.body))),{status:200});}});
  assert.deepEqual(calls,["https://api.openai.com/v1/responses"]);
  assert.deepEqual(r.rows.map(x=>x.status),["not-configured","response-observed","skipped-limit","not-configured"]);
});
test("errors and uncertain transport are never retried or reported as zero cost",async()=>{
  const calls=[];
  const r=await runProviderCouncil({mode:"live",providers:["openai","anthropic","google","deepseek"],acknowledgeCharges:true,env,
    fetchImpl:async(url)=>{calls.push(url);if(url.includes("openai.com"))throw Error("secret upstream exception");
      if(url.includes("anthropic.com"))return new Response("secret error body",{status:429});
      if(url.includes("googleapis.com"))return new Response("{bad",{status:200});
      return new Response(JSON.stringify({model:"owner-model-d",choices:[{message:{content:"32"}}]}),{status:200});}});
  assert.equal(calls.length,4);assert.deepEqual(r.rows.map(x=>x.status),["transport-uncertain","http-error","invalid-response","response-observed"]);
  assert.equal(r.rows[3].answerCorrect,false);assert.equal(r.rows[3].usage,null);assert.equal(r.postedChargesUsd,null);
  assert.doesNotMatch(JSON.stringify(r),/secret upstream|secret error body/);
});
test("blank visible answers and missing counts are distinct from zero; large response is rejected",async()=>{
  const r=await runProviderCouncil({mode:"live",providers:["openai","anthropic"],acknowledgeCharges:true,env,
    fetchImpl:async url=>url.includes("openai.com")?new Response(JSON.stringify({model:"owner-model-a",output:[],usage:{input_tokens:9,output_tokens:4}})):new Response("x".repeat(270000))});
  assert.equal(r.rows[0].status,"no-usable-answer");assert.deepEqual(r.rows[0].usage,{inputTokens:9,outputTokens:4});
  assert.equal(r.rows[1].status,"invalid-response");assert.equal(r.rows[1].usage,null);
});
test("export rejects changed bytes, rehashed fabricated billing, duplicates and count overflow",async()=>{
  const report=await runProviderCouncil(),e=await exportCouncilReport(report);
  await assert.rejects(parseCouncilReport({...e,reportJson:e.reportJson.replace("fixture-openai","altered")}),/Invalid/);
  const forged={...report,postedChargesUsd:0},json=JSON.stringify(forged);
  await assert.rejects(parseCouncilReport({...e,reportJson:json,reportSha256:createHash("sha256").update(json).digest("hex")}),/Invalid/);
  assert.throws(()=>validateCouncilReport({...report,rows:[report.rows[0],report.rows[0]]}),/Invalid/);
  assert.throws(()=>validateCouncilReport({...report,maxAttempts:1}),/Invalid/);
});
test("Compute object reads council evidence locally, without a billing or execution control",async()=>{
  const src=await readFile(new URL("../src/render/web-ai.js",import.meta.url),"utf8");
  const start=src.indexOf("const councilSection ="),end=src.indexOf("const treasurySection =",start);
  assert.ok(start>0&&end>start);
  const region=src.slice(start,end);
  assert.match(region,/parseCouncilReport/);assert.match(region,/sessionStore/);
  assert.match(region,/not provider-authenticated/);assert.match(region,/Fixture report/);
  assert.doesNotMatch(region,/appendEconomicEvent|computeAccount\.|computeLedger\.|fetch\(|recordReceipt\(/);
});
