import test from "node:test";
import assert from "node:assert/strict";
import {COUNCIL_MEMORY_KEY,COUNCIL_MEMORY_LIMIT,COUNCIL_CAPSULE_SCHEMA,createCouncilMemory} from "../src/domains/council-memory.js";
import {createHash} from "node:crypto";
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


test("memory capsule preserves every original envelope, previews without writes, and merges duplicates atomically",async()=>{
  const source=createCouncilMemory({storage:storage()});
  const arithmetic=await exportCouncilReport(await runProviderCouncil());
  await source.archive(envelope);await source.archive(arithmetic);
  const capsule=await source.exportCapsule();
  assert.equal(capsule.schema,COUNCIL_CAPSULE_SCHEMA);
  assert.deepEqual(JSON.parse(capsule.journalJson),[envelope,arithmetic]);
  assert.equal(capsule.journalSha256,createHash("sha256").update(capsule.journalJson).digest("hex"));
  const tab=storage(),destination=createCouncilMemory({storage:tab});
  await destination.archive(envelope);
  const prior=tab.getItem(COUNCIL_MEMORY_KEY);
  const review=await destination.previewCapsule(capsule);
  assert.equal(review.added,1);assert.equal(review.duplicates,1);assert.equal(review.current,1);
  assert.equal(review.resulting,2);assert.equal(review.fixture,2);assert.equal(review.liveClaims,0);
  assert.equal(tab.getItem(COUNCIL_MEMORY_KEY),prior);
  assert.deepEqual(await destination.restoreCapsule(capsule,review),{status:"restored",added:1,duplicates:1,total:2});
  assert.deepEqual(JSON.parse(tab.getItem(COUNCIL_MEMORY_KEY)),[envelope,arithmetic]);
  assert.deepEqual(await destination.exportCapsule(),capsule);
  const restored=tab.getItem(COUNCIL_MEMORY_KEY);
  const duplicate=await destination.previewCapsule(capsule);
  assert.deepEqual(await destination.restoreCapsule(capsule,duplicate),{status:"unchanged",added:0,duplicates:2,total:2});
  assert.equal(tab.getItem(COUNCIL_MEMORY_KEY),restored);
});

test("capsule conflict, tampered digest and rehashed invalid journal never partially restore",async()=>{
  const tab=storage(),destination=createCouncilMemory({storage:tab});
  await destination.archive(envelope);
  const before=tab.getItem(COUNCIL_MEMORY_KEY);
  const conflicting=structuredClone(fixture);conflicting.rows[0].latencyMs=23;
  const newReport=await exportCouncilReport(await runProviderCouncil());
  const source=createCouncilMemory({storage:storage()});
  await source.archive(newReport);await source.archive(await exportCouncilReport(conflicting));
  const capsule=await source.exportCapsule();
  await assert.rejects(destination.previewCapsule(capsule),/conflicts/);
  assert.equal(tab.getItem(COUNCIL_MEMORY_KEY),before);
  const other=createCouncilMemory({storage:storage()});await other.archive(newReport);
  const valid=await other.exportCapsule(),review=await destination.previewCapsule(valid);
  await assert.rejects(destination.restoreCapsule({...valid,journalJson:valid.journalJson+" "},review),/digest mismatch/);
  const bad=JSON.stringify([newReport,{...envelope,reportSha256:"0".repeat(64)}]);
  const rehashed={schema:COUNCIL_CAPSULE_SCHEMA,journalJson:bad,journalSha256:createHash("sha256").update(bad).digest("hex")};
  await assert.rejects(destination.previewCapsule(rehashed),/Invalid Neural Memory capsule/);
  await assert.rejects(destination.restoreCapsule(rehashed,{...review,capsuleDigest:rehashed.journalSha256}),/Invalid Neural Memory capsule/);
  assert.equal(tab.getItem(COUNCIL_MEMORY_KEY),before);
});

test("a capsule restore requires a preview of the same file and unchanged journal revision",async()=>{
  const source=createCouncilMemory({storage:storage()});await source.archive(envelope);
  const capsule=await source.exportCapsule(),tab=storage(),destination=createCouncilMemory({storage:tab});
  await assert.rejects(destination.restoreCapsule(capsule),/Preview this exact capsule/);
  const review=await destination.previewCapsule(capsule);
  const claim=structuredClone(fixture);claim.mode="live";claim.runId="another-host-claim";
  const host=await exportCouncilReport(claim);await destination.archive(host);
  const before=tab.getItem(COUNCIL_MEMORY_KEY);
  await assert.rejects(destination.restoreCapsule(capsule,review),/preview the capsule again/);
  assert.equal(tab.getItem(COUNCIL_MEMORY_KEY),before);
  const next=await destination.previewCapsule(capsule);
  assert.equal(next.fixture,1);assert.equal(next.liveClaims,0);
  await destination.restoreCapsule(capsule,next);
  assert.deepEqual(JSON.parse(tab.getItem(COUNCIL_MEMORY_KEY)),[host,envelope]);
  assert.equal((await destination.search({mode:"live"}))[0].provenance,"host-reported-unverified");
});

test("capsule capacity and storage failure are checked before reporting restored memory",async()=>{
  const full=storage(),reports=[];
  for(let i=0;i<COUNCIL_MEMORY_LIMIT;i++){
    const r=structuredClone(fixture);r.runId="capsule-capacity-"+i;reports.push(await exportCouncilReport(r));
  }
  const bytes=JSON.stringify(reports);full.setItem(COUNCIL_MEMORY_KEY,bytes);
  const source=createCouncilMemory({storage:storage()});await source.archive(envelope);
  const capsule=await source.exportCapsule(),destination=createCouncilMemory({storage:full});
  await assert.rejects(destination.previewCapsule(capsule),/full/);
  assert.equal(full.getItem(COUNCIL_MEMORY_KEY),bytes);
  const blocked=createCouncilMemory({storage:{getItem:()=>null,setItem:()=>{throw Error("quota");}}});
  const review=await blocked.previewCapsule(capsule);
  await assert.rejects(blocked.restoreCapsule(capsule,review),/could not be saved/);
  assert.deepEqual(await blocked.snapshot(),[]);
});
