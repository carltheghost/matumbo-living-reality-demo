// Owner-side diagnostic. Never run this module from the public browser.
// Default: deterministic fixtures. Live calls are explicit, one per lane,
// fixed synthetic prompt, no tools, redirects, automatic retries or fallback.
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { COUNCIL_PROVIDERS, COUNCIL_REPORT_SCHEMA, COUNCIL_TASK, COUNCIL_OUTPUT_LIMIT,
  COUNCIL_MISSION_TASK, COUNCIL_MISSION_SCHEMA, COUNCIL_MISSION, solveCouncilMission, normalizeCouncilCandidate,
  validCouncilModel, exportCouncilReport, validateCouncilReport } from "../../src/domains/provider-council-evidence.js";
const PROMPTS=Object.freeze({
  [COUNCIL_TASK]:"What is 12 + 19? Reply with only the integer.",
  [COUNCIL_MISSION_TASK]:"Choose a nonempty subset of jobs with total cost at most "+COUNCIL_MISSION.budget+
    ", maximizing total value. Each job can be used once. "+COUNCIL_MISSION.jobs.map(j=>j.id+": cost "+j.cost+", value "+j.value).join("; ")+
    ". Reply with only the selected job IDs separated by commas, in alphabetical order.",
});
const MAX_RESPONSE_BYTES=256*1024;
const digest=value=>createHash("sha256").update(value).digest("hex");
const ROSTER=Object.freeze({
  openai:{key:"OPENAI_API_KEY",model:"VIVO_COUNCIL_OPENAI_MODEL",url:"https://api.openai.com/v1/responses",kind:"responses"},
  anthropic:{key:"ANTHROPIC_API_KEY",model:"VIVO_COUNCIL_ANTHROPIC_MODEL",url:"https://api.anthropic.com/v1/messages",kind:"messages"},
  google:{key:"GEMINI_API_KEY",model:"VIVO_COUNCIL_GOOGLE_MODEL",url:"https://generativelanguage.googleapis.com/v1beta/models/",kind:"gemini"},
  deepseek:{key:"DEEPSEEK_API_KEY",model:"VIVO_COUNCIL_DEEPSEEK_MODEL",url:"https://api.deepseek.com/chat/completions",kind:"chat"},
  kimi:{key:"MOONSHOT_API_KEY",model:"VIVO_COUNCIL_KIMI_MODEL",url:"https://api.moonshot.ai/v1/chat/completions",kind:"chat"},
  nvidia:{key:"NVIDIA_API_KEY",model:"VIVO_COUNCIL_NVIDIA_MODEL",url:"https://integrate.api.nvidia.com/v1/chat/completions",kind:"chat"},
  xai:{key:"XAI_API_KEY",model:"VIVO_COUNCIL_XAI_MODEL",url:"https://api.x.ai/v1/responses",kind:"responses"},
});
const count=v=>Number.isSafeInteger(v)&&v>=0;
const tokens=(a,b)=>count(a)&&count(b)?{inputTokens:a,outputTokens:b}:null;
const safeModel=(v,key)=>validCouncilModel(v)&&(!key||!v.includes(key))?v:null;
function requestFor(id,model,key,task){
  const prompt=PROMPTS[task],lane=ROSTER[id],headers={"content-type":"application/json"},msg=[{role:"user",content:prompt}];
  let url=lane.url,body;
  if(lane.kind==="gemini"){
    // A bare model ID is required; it cannot change the fixed HTTPS origin.
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(model))throw new Error("Invalid configured model.");
    url+=encodeURIComponent(model)+":generateContent";
    headers["x-goog-api-key"]=key;
    body={contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:COUNCIL_OUTPUT_LIMIT}};
  }else{
    headers.authorization="Bearer "+key;
    if(lane.kind==="responses")body={model,input:msg,max_output_tokens:COUNCIL_OUTPUT_LIMIT,store:false};
    else if(lane.kind==="messages"){
      // Pin the existing response contract rather than silently migrating API versions.
      headers["anthropic-version"]="2023-06-01";
      body={model,messages:msg,max_tokens:COUNCIL_OUTPUT_LIMIT};
    }else{
      body={model,messages:msg,max_tokens:COUNCIL_OUTPUT_LIMIT,stream:false};
      if(id==="deepseek")body.thinking={type:"disabled"};
    }
  }
  return {url,headers,body};
}
function extract(id,data,key){
  if(!data||typeof data!=="object"||Array.isArray(data))throw new Error("Invalid response.");
  const kind=ROSTER[id].kind,u=data.usage??{},result={text:"",usage:null,model:safeModel(data.model,key)};
  if(kind==="responses"){
    result.text=(Array.isArray(data.output)?data.output:[]).filter(x=>x?.type==="message"&&x.role==="assistant")
      .flatMap(x=>Array.isArray(x.content)?x.content:[]).filter(x=>x?.type==="output_text"&&typeof x.text==="string").map(x=>x.text).join("\n");
    result.usage=tokens(u.input_tokens,u.output_tokens);
  }else if(kind==="messages"){
    result.text=(Array.isArray(data.content)?data.content:[]).filter(x=>x?.type==="text"&&typeof x.text==="string").map(x=>x.text).join("\n");
    // These are the provider's reported counters, not a bill. Cache counters
    // are included when present; malformed/missing counters stay unknown.
    const read=u.cache_read_input_tokens??0,write=u.cache_creation_input_tokens??0;
    result.usage=count(u.input_tokens)&&count(read)&&count(write)?tokens(u.input_tokens+read+write,u.output_tokens):null;
  }else if(kind==="gemini"){
    const candidate=Array.isArray(data.candidates)?data.candidates[0]:null;
    result.text=(Array.isArray(candidate?.content?.parts)?candidate.content.parts:[]).filter(x=>x?.thought!==true&&typeof x?.text==="string").map(x=>x.text).join("\n");
    const m=data.usageMetadata??{},thoughts=m.thoughtsTokenCount??0;
    result.usage=count(m.candidatesTokenCount)&&count(thoughts)?tokens(m.promptTokenCount,m.candidatesTokenCount+thoughts):null;
    result.model=safeModel(data.modelVersion,key);
  }else{
    const content=Array.isArray(data.choices)?data.choices[0]?.message?.content:null;
    result.text=typeof content==="string"?content:"";
    result.usage=tokens(u.prompt_tokens,u.completion_tokens);
  }
  return result;
}
function fixtureResponse(id,model,task){
  const kind=ROSTER[id].kind;
  // Deterministic, deliberately mixed responses exercise the local verifier.
  // They are not observed provider quality or evidence of a live account.
  const answer=task===COUNCIL_MISSION_TASK?
    ({deepseek:"A,B",kimi:"A,C",xai:"invalid proposal"}[id]??"C,D"):"31";
  const body=kind==="responses"?{model,output:[{type:"message",role:"assistant",content:[{type:"output_text",text:answer}]}],usage:{input_tokens:20,output_tokens:1}}:
    kind==="messages"?{model,content:[{type:"text",text:answer}],usage:{input_tokens:20,output_tokens:1}}:
    kind==="gemini"?{modelVersion:model,candidates:[{content:{parts:[{text:answer}]}}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:1}}:
    {model,choices:[{message:{role:"assistant",content:answer}}],usage:{prompt_tokens:20,completion_tokens:1}};
  return new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});
}
async function readBounded(response){
  const reader=response.body?.getReader();
  if(!reader)throw new Error("No response body.");
  const chunks=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>MAX_RESPONSE_BYTES){await reader.cancel();throw new Error("Response limit.");}chunks.push(Buffer.from(value));}}
  finally{reader.releaseLock();}
  return Buffer.concat(chunks);
}
function emptyRow(provider,requestedModel=null){
  return {provider,requestedModel,resolvedModel:null,status:"not-configured",attempted:false,latencyMs:null,httpStatus:null,usage:null,answerCorrect:null,responseSha256:null};
}
export async function runProviderCouncil({mode="fixture",task=COUNCIL_TASK,providers=COUNCIL_PROVIDERS,maxAttempts=7,acknowledgeCharges=false,env=process.env,fetchImpl=globalThis.fetch,timeoutMs=20000}={}){
  if(!["fixture","live"].includes(mode)||!Object.hasOwn(PROMPTS,task)||!Array.isArray(providers)||!providers.length||providers.length>COUNCIL_PROVIDERS.length||
    new Set(providers).size!==providers.length||providers.some(id=>!COUNCIL_PROVIDERS.includes(id))||
    !Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>COUNCIL_PROVIDERS.length||
    !Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw new Error("Invalid council options.");
  if(mode==="live"&&acknowledgeCharges!==true)throw new Error("Live probes require explicit acknowledgement of provider charges.");
  const mission=task===COUNCIL_MISSION_TASK,optimum=mission?solveCouncilMission().candidate:null;
  const rows=[];let attempts=0;
  for(const id of providers){
    const lane=ROSTER[id];
    // Fixtures never inspect ambient provider configuration or use a network transport.
    const key=mode==="fixture"?"fixture-key":(typeof env[lane.key]==="string"?env[lane.key].trim():"");
    const model=mode==="fixture"?"fixture-"+id:safeModel(typeof env[lane.model]==="string"?env[lane.model].trim():null,key);
    const row=emptyRow(id,model);if(mission)row.candidate=null;rows.push(row);
    if(!key||!model||(id==="google"&&!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(model)))continue;
    if(attempts>=maxAttempts){row.status="skipped-limit";continue;}
    let req;try{req=requestFor(id,model,key,task);}catch{continue;}
    attempts++;row.attempted=true;
    const start=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      let response;
      try{
        response=mode==="fixture"?fixtureResponse(id,model,task):await fetchImpl(req.url,{method:"POST",headers:req.headers,
          body:JSON.stringify(req.body),redirect:"error",cache:"no-store",signal:controller.signal});
      }catch{row.status="transport-uncertain";continue;}
      row.httpStatus=response.status;
      if(!response.ok){row.status="http-error";try{await response.body?.cancel();}catch{}continue;}
      let raw,data;
      try{raw=await readBounded(response);data=JSON.parse(raw.toString("utf8"));}
      catch{row.status="invalid-response";continue;}
      let value;try{value=extract(id,data,key);}catch{row.status="invalid-response";continue;}
      row.responseSha256=digest(raw);row.resolvedModel=value.model;row.usage=value.usage;
      const answer=value.text.trim();
      row.status=answer?"response-observed":"no-usable-answer";
      if(mission)row.candidate=normalizeCouncilCandidate(answer);
      row.answerCorrect=answer?(mission?row.candidate===optimum:answer==="31"):null;
    }finally{clearTimeout(timer);row.latencyMs=mode==="fixture"?0:Math.max(0,Date.now()-start);}
  }
  return validateCouncilReport({schema:mission?COUNCIL_MISSION_SCHEMA:COUNCIL_REPORT_SCHEMA,runId:mode==="fixture"?(mission?"fixture-council-mission-v1":"fixture-council-v1"):randomUUID(),
    createdAt:mode==="fixture"?"2026-11-25T00:00:00.000Z":new Date().toISOString(),mode,task,
    maxAttempts,requestedOutputTokens:COUNCIL_OUTPUT_LIMIT,rows,postedChargesUsd:null,worldActionExecuted:false});
}
export function parseCouncilArgs(args){
  let mode="fixture",task=COUNCIL_TASK,providers=COUNCIL_PROVIDERS,maxAttempts=7,acknowledgeCharges=false,out=null,hasProviders=false,hasAttempts=false;
  const seen=new Set();
  for(const arg of args){
    const key=arg.split("=")[0];if(seen.has(key))throw new Error("Duplicate option.");seen.add(key);
    if(arg==="--live")mode="live";
    else if(arg==="--fixture")mode="fixture";
    else if(arg.startsWith("--task=")){
      const name=arg.slice(7);if(name==="arithmetic")task=COUNCIL_TASK;else if(name==="route")task=COUNCIL_MISSION_TASK;else throw new Error("Unknown council task.");
    }
    else if(arg==="--accept-provider-charges")acknowledgeCharges=true;
    else if(arg.startsWith("--providers=")){const value=arg.slice(12);providers=value==="all"?COUNCIL_PROVIDERS:value.split(",");hasProviders=true;}
    else if(arg.startsWith("--max-attempts=")){maxAttempts=Number(arg.slice(15));hasAttempts=true;}
    else if(arg.startsWith("--out=")&&arg.length>6)out=arg.slice(6);
    else throw new Error("Unknown council option.");
  }
  if(seen.has("--live")&&seen.has("--fixture"))throw new Error("Select one mode.");
  if(mode==="live"&&(!acknowledgeCharges||!hasProviders||!hasAttempts))throw new Error("Live mode requires explicit providers, attempt limit and charge acknowledgement.");
  return {mode,task,providers,maxAttempts,acknowledgeCharges,out};
}
async function main(){
  const options=parseCouncilArgs(process.argv.slice(2));
  const report=await runProviderCouncil(options),envelope=await exportCouncilReport(report);
  const json=JSON.stringify(envelope,null,2)+"\n";
  if(options.out)await writeFile(options.out,json,{flag:"wx",mode:0o600});
  else process.stdout.write(json);
  // Non-successful attempted or unconfigured requested lanes cannot be
  // mistaken for a green all-provider availability check.
  if(options.mode==="live"&&report.rows.some(r=>r.status!=="response-observed"||!r.answerCorrect))process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{
  // Never log thrown request objects, raw provider errors, headers or keys.
  process.stderr.write("Provider council failed. Check options and trusted host configuration.\n");process.exitCode=1;
});
