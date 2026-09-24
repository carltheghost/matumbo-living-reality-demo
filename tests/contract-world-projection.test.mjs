import test from 'node:test';
import assert from 'node:assert/strict';
import {createContractWorldContribution} from '../src/domains/contract-world-projection.js';
import {createProjectionEnvelope} from '../src/core/view-state.js';
import {createContractAutomation} from '../src/domains/contract-automation.js';
test('contracts, parties, conditions, evidence, receipts and events share one linked world contribution',()=>{
  const state={contracts:[{id:'c:1',title:'Delivery',templateId:'delivery',status:'completed',parties:['alice','bob'],terms:{rules:[{id:'delivered'}]},evidence:[{id:'e:1',source:'delivery',provider:'manual'}],receipts:[{id:'r:1'}],history:[{type:'approved'},{type:'executed'}]}]};
  const projection=createContractWorldContribution(state,'2026-09-24T00:00:00Z');
  assert.equal(projection.relationships.length,7);
  const ids=new Set(projection.entities.map(e=>e.id));
  for(const edge of projection.relationships){assert.ok(ids.has(edge.from));assert.ok(ids.has(edge.to));}
  const envelope=createProjectionEnvelope({contributions:[projection],projectedAt:projection.updatedAt});
  assert.equal(envelope.world.entities.filter(e=>e.kind==='living-contract').length,1);
  assert.equal(envelope.authority,'none');
  assert.equal(state.contracts[0].status,'completed');
});
test('live contract graph carries exact approved dependencies and the evidence-to-receipt causal chain',()=>{
  const engine=createContractAutomation({now:()=>1000});
  const c=engine.create({templateId:'milestone'});
  c.parties.forEach(actor=>engine.approve(c.id,{actor}));
  engine.observe({contractId:c.id,id:'design-proof',source:'design',provider:'manual',value:true,observedAt:1000});
  const projection=createContractWorldContribution(engine.snapshot());
  const ids=new Set(projection.entities.map(e=>e.id));
  for(const edge of projection.relationships){assert.ok(ids.has(edge.from),edge.id);assert.ok(ids.has(edge.to),edge.id);}
  const relations=projection.relationships.map(e=>e.relation);
  for(const relation of ['input-to','precedes','authorizes','observes','fulfills','used-by','records-effect','emitted-for'])assert.ok(relations.includes(relation),relation);
  assert.equal(ids.size,projection.entities.length,'all world entities have unique identifiers');
  assert.equal(projection.entities.filter(e=>e.kind==='contract-approved-action').length,2);
  assert.equal(projection.entities.filter(e=>e.kind==='contract-effect').length,1);
  const prior=projection.relationships.find(e=>e.relation==='precedes');
  assert.equal(prior.from,`${c.id}:rule:design`);assert.equal(prior.to,`${c.id}:rule:delivery`);
});
