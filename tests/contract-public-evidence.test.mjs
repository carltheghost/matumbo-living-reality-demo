import test from 'node:test';
import assert from 'node:assert/strict';
import {createContractAutomation} from '../src/domains/contract-automation.js';
import {applyContractPublicEvidence} from '../src/domains/contract-public-evidence.js';
const NOW=Date.parse('2026-09-24T12:00:00Z'),EVENT='espn-multi-sport:soccer:eng.1:123:123:0';
function setup() {
  const engine=createContractAutomation({now:()=>NOW});
  const terms=structuredClone(engine.listTemplates().find(t=>t.id==='prediction_binary').defaults);
  terms.sources[0]={...terms.sources[0],provider:'public',binding:{adapter:'espn-result',eventId:EVENT}};
  terms.prediction.outcomes=['HOME','AWAY'];
  terms.prediction.positions[0].outcome='HOME';terms.prediction.positions[1].outcome='AWAY';
  terms.rules[0].when.value=['HOME','AWAY','DRAW','VOID'];
  const contract=engine.create({templateId:'prediction_binary',title:'Public result rehearsal',creator:'owner',parties:['owner','reviewer'],terms});
  engine.approve(contract.id,{actor:'owner'});engine.approve(contract.id,{actor:'reviewer'});
  const record={id:EVENT,providerAvailable:true,liveFetch:true,sourceUrl:'https://site.api.espn.com/event/123',retrievedAt:new Date(NOW).toISOString(),statusDetail:{completed:true,final:true},participants:[{name:'HOME',winner:true,scoreValue:2},{name:'AWAY',winner:false,scoreValue:1}]};
  return {engine,contract,record};
}
test('bound public result automatically produces same-engine conserved receipt and provenance',()=>{
  const {engine,contract,record}=setup();
  assert.equal(applyContractPublicEvidence({engine,records:[record],now:NOW}).observed,1);
  const result=engine.get(contract.id);
  assert.equal(result.status,'completed');assert.equal(result.receipts.length,1);
  assert.equal(result.evidence[0].provenance.eventId,EVENT);
  assert.equal(result.receipts[0].effects[0].poolCents,2000);
  assert.equal(applyContractPublicEvidence({engine,records:[record],now:NOW}).observed,0);
});
test('public adapter never invents results for absent, stale, unfinished, spoofed or mismatched data',()=>{
  for(const scenario of ['missing','stale','unfinished','spoofed','mismatched','conflicting','ambiguous']){
    const {engine,contract,record}=setup();
    if(scenario==='stale')record.retrievedAt=new Date(NOW-3600000).toISOString();
    if(scenario==='unfinished')record.statusDetail.completed=false;
    if(scenario==='spoofed')record.sourceUrl='https://espn.com.evil.example/event';
    if(scenario==='mismatched')record.participants[0].name='OTHER';
    if(scenario==='conflicting')record.participants[1].winner=true;
    const records=scenario==='missing'?[]:scenario==='ambiguous'?[record,record]:[record];
    assert.equal(applyContractPublicEvidence({engine,records,now:NOW}).observed,0,scenario);
    assert.equal(engine.get(contract.id).receipts.length,0,scenario);
  }
});
test('public refresh counts are scoped to each contract rather than reporting unrelated executions',()=>{
  const {engine,contract,record}=setup();
  const terms=structuredClone(engine.get(contract.id).terms);
  terms.sources[0].binding.eventId='espn-multi-sport:another-event';
  const pending=engine.create({templateId:'prediction_binary',title:'Still waiting',creator:'owner',parties:['owner','reviewer'],terms});
  const report=applyContractPublicEvidence({engine,records:[record],now:NOW});
  assert.equal(report.observed,1);
  assert.deepEqual(report.byContract[contract.id],{observed:1,pending:0,errors:[]});
  assert.deepEqual(report.byContract[pending.id],{observed:0,pending:1,errors:[]});
});
test('malformed participant payload is held without interrupting other contracts',()=>{
  for(const participants of [{name:'HOME'},[null,{}]]){
    const {engine,contract,record}=setup();record.participants=participants;
    const report=applyContractPublicEvidence({engine,records:[record],now:NOW});
    assert.equal(report.observed,0);assert.equal(report.pending,1);
    assert.equal(engine.get(contract.id).receipts.length,0);
  }
});
