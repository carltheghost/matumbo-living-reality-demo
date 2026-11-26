import test from "node:test";
import assert from "node:assert/strict";
import {COUNCIL_MEMORY_KEY,COUNCIL_MEMORY_LIMIT,createCouncilMemory} from "../src/domains/council-memory.js";
import {COUNCIL_MISSION_TASK,exportCouncilReport} from "../src/domains/provider-council-evidence.js";
import {runProviderCouncil} from "../scripts/vivo/provider-council.mjs";
function storage(){
  const rows=new Map();
  return {getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)};
}
const fixture=await runProviderCouncil({task:COUNCIL_MISSION_TASK});
const envelope=await exportCouncilReport(fixture);
test("archive and recall use the original digest across remounts; evidence is advisory",async()=>{
  const tab=storage(),first=createCouncilMemory({storage:tab});
  const result=await first.archive(envelope);
  assert.equal(result.status,"recorded");assert.equal(result.record.memoryId,"council:"+envelope.reportSha256);
  assert.equal(result.record.authority,"evidence-only");assert.equal(result.record.providerAuthenticated,false);
  assert.equal(result.record.postedChargesUsd,null);assert.equal(result.record.worldActionExecuted,false);
  assert.ok(Object.isFrozen(result.record.rows[0]));
  const reopened=createCouncilMemory({storage:tab});
  assert.deepEqual(await reopened.snapshot(),[result.record]);
  assert.deepEqual(await reopened.getEvidence(result.record.memoryId),envelope);
  assert.deepEqual(await reopened.search({query:"KIMI over-budget",mode:"fixture"}),[result.record]);
  assert.deepEqual(await reopened.search({query:"route",mode:"live"}),[]);
  assert.deepEqual(await createCouncilMemory({storage:storage()}).snapshot(),[]);
});
test("concurrent same-tab saves across instances deduplicate; conflicting run preserves bytes",async()=>{
  const tab=storage(),one=createCouncilMemory({storage:tab}),two=createCouncilMemory({storage:tab});
  const results=await Promise.all([one.archive(envelope),two.archive(envelope)]);
  assert.deepEqual(results.map(x=>x.status),["recorded","duplicate"]);
  const before=tab.getItem(COUNCIL_MEMORY_KEY);
  const conflict=structuredClone(fixture);conflict.rows[0].latencyMs=9;
  await assert.rejects(two.archive(await exportCouncilReport(conflict)),/conflicts/);
  assert.equal(tab.getItem(COUNCIL_MEMORY_KEY),before);
  assert.deepEqual(await one.snapshot(),[results[0].record]);
});
test("no automatic promotion from fixture to host-reported live evidence",async()=>{
  const tab=storage(),memory=createCouncilMemory({storage:tab});
  await memory.archive(envelope);
  const hostClaim=structuredClone(fixture);hostClaim.mode="live";hostClaim.runId="host-claim-test";
  const live=await memory.archive(await exportCouncilReport(hostClaim));
  assert.equal(live.record.provenance,"host-reported-unverified");
  assert.equal(live.record.providerAuthenticated,false);
  assert.equal((await memory.search({mode:"fixture"})).length,1);
  assert.equal((await memory.search({mode:"live"})).length,1);
  assert.equal((await memory.snapshot()).length,2);
});
test("tampered imports and corrupt saved envelopes fail closed without overwriting bytes",async()=>{
  const tab=storage(),memory=createCouncilMemory({storage:tab});
  await memory.archive(envelope);
  const before=tab.getItem(COUNCIL_MEMORY_KEY);
  await assert.rejects(memory.archive({...envelope,reportJson:envelope.reportJson.replace("fixture-council-mission-v1","changed")}),/Invalid/);
  assert.equal(tab.getItem(COUNCIL_MEMORY_KEY),before);
  tab.setItem(COUNCIL_MEMORY_KEY,JSON.stringify([{...envelope,reportSha256:"0".repeat(64)}]));
  const corrupt=tab.getItem(COUNCIL_MEMORY_KEY);
  await assert.rejects(memory.snapshot(),/invalid/);
  await assert.rejects(memory.archive(envelope),/invalid/);
  assert.equal(tab.getItem(COUNCIL_MEMORY_KEY),corrupt);
});
test("capacity fails closed, no eviction; unavailable storage does not fabricate success",async()=>{
  const tab=storage(),memory=createCouncilMemory({storage:tab});
  const entries=[];
  for(let i=0;i<COUNCIL_MEMORY_LIMIT;i++){
    const r=structuredClone(fixture);r.runId="fixture-capacity-"+i;entries.push(await exportCouncilReport(r));
  }
  const bytes=JSON.stringify(entries);tab.setItem(COUNCIL_MEMORY_KEY,bytes);
  await assert.rejects(memory.archive(envelope),/full/);
  assert.equal(tab.getItem(COUNCIL_MEMORY_KEY),bytes);
  assert.equal((await memory.snapshot()).length,COUNCIL_MEMORY_LIMIT);
  await assert.rejects(createCouncilMemory().archive(envelope),/unavailable/);
  const blocked={getItem:()=>null,setItem:()=>{throw Error("quota");}};
  await assert.rejects(createCouncilMemory({storage:blocked}).archive(envelope),/could not be saved/);
});
