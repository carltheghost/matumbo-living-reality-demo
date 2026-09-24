import {validateProjectionContribution} from '../core/world-state.js';

/** Read source dependencies from approved declarative predicates, never guess
 * relationships from geometry/proximity or execute a supplied expression. */
export function contractPredicateSources(predicate) {
  const found=new Set();
  const visit=(value,depth=0)=>{
    if(!value||typeof value!=='object'||depth>8)return;
    if(typeof value.source==='string')found.add(value.source);
    if(value.op==='not')visit(value.condition,depth+1);
    if(['all','any'].includes(value.op))for(const child of value.conditions??[])visit(child,depth+1);
  };
  visit(predicate);return [...found];
}

/** Domain records stay authoritative; this is only a serializable world view.
 * Relationships are entities too, so every device receives the same graph. */
export function createContractWorldContribution(snapshot, updatedAt = new Date().toISOString()) {
  const entities = [], evidence = [], edges = [];
  const linked=new Set();
  const add = record => entities.push({...record, simulation:true});
  const link = (from, to, relation) => {
    const edge = {id:`${from}:${relation}:${to}`,kind:'neural-relationship',from,to,relation,simulation:true};
    if(linked.has(edge.id))return;linked.add(edge.id);
    edges.push(edge); add(edge);
  };
  for (const contract of snapshot?.contracts ?? []) {
    add({id:contract.id,kind:'living-contract',label:contract.title,status:contract.status,templateId:contract.templateId,terms:contract.terms});
    const partyIds=new Map(),ruleIds=new Map(),sourceIds=new Map();
    for (const party of contract.parties ?? []) {
      const name = typeof party === 'string' ? party : party.id;
      const id = `${contract.id}:party:${name}`;
      partyIds.set(name,id);
      add({id,kind:'contract-party',label:name,identityVerified:false,approved:(contract.approvals??[]).some(entry=>entry.actor===name),termsDigest:contract.termsDigest});
      link(id,contract.id,'party-to');
    }
    for(const source of contract.terms?.sources??[]){
      const id=`${contract.id}:source:${source.id}`;sourceIds.set(source.id,id);
      add({id,kind:'contract-source',label:source.label??source.id,declaration:source});
      link(contract.id,id,'declares-source');
      if(source.binding){
        const external=`${id}:binding`;
        add({id:external,kind:'contract-observation-binding',label:source.binding.eventId,binding:source.binding,verified:false});
        link(id,external,'bound-to');
      }
    }
    for(const [index,rule] of (contract.terms?.rules??[]).entries())ruleIds.set(rule.id,`${contract.id}:rule:${rule.id??index}`);
    for (const [index,rule] of (contract.terms?.rules ?? []).entries()) {
      const id = `${contract.id}:rule:${rule.id ?? index}`;
      add({id,kind:'contract-condition',label:rule.label ?? rule.id ?? `Condition ${index+1}`,rule});
      link(contract.id,id,'condition');
      for(const source of contractPredicateSources(rule.when))if(sourceIds.has(source))link(sourceIds.get(source),id,'input-to');
      for(const prior of rule.after??[])if(ruleIds.has(prior))link(ruleIds.get(prior),id,'precedes');
      for(const [actionIndex,action] of (rule.actions??[]).entries()){
        const actionId=`${id}:action:${actionIndex}`;
        add({id:actionId,kind:'contract-approved-action',label:action.label??action.type,action});
        link(id,actionId,'authorizes');
        for(const role of ['from','to','subject'])if(partyIds.has(action[role]))link(actionId,partyIds.get(action[role]),role);
      }
    }
    for (const item of contract.evidence ?? []) {
      const id = `${contract.id}:evidence:${item.id}`;
      add({id,kind:'contract-evidence',label:item.source,observation:item});
      evidence.push({id,kind:'local-contract-observation',status:item.provider ?? 'manual',contractId:contract.id});
      link(id,contract.id,'supports');
      if(sourceIds.has(item.source))link(id,sourceIds.get(item.source),'observes');
    }
    for (const item of contract.receipts ?? []) {
      const id = `${contract.id}:receipt:${item.id}`;
      add({id,kind:'contract-receipt',label:'Local execution receipt',receipt:item});
      link(contract.id,id,'produced');
      if(ruleIds.has(item.ruleId))link(id,ruleIds.get(item.ruleId),'fulfills');
      for(const evidenceId of item.evidenceIds??[])if((contract.evidence??[]).some(entry=>entry.id===evidenceId))link(`${contract.id}:evidence:${evidenceId}`,id,'used-by');
      for(const [effectIndex,effect] of (item.effects??[]).entries()){
        const effectId=`${id}:effect:${effectIndex}`;
        add({id:effectId,kind:'contract-effect',label:effect.label??effect.type,effect});
        link(id,effectId,'records-effect');
        for(const role of ['from','to','subject'])if(partyIds.has(effect[role]))link(effectId,partyIds.get(effect[role]),role);
      }
    }
    for (const [index,item] of (contract.history ?? []).entries()) {
      const id = `${contract.id}:event:${item.id ?? index}`;
      add({id,kind:'contract-event',label:item.type ?? item.action ?? 'Contract transition',event:item});
      link(id,contract.id,'records');
      const receiptId=item.detail?.receiptId;
      if(receiptId&&(contract.receipts??[]).some(entry=>entry.id===receiptId))link(id,`${contract.id}:receipt:${receiptId}`,'emitted-for');
    }
  }
  const contribution = {
    schemaVersion:1,source:'contract-organism',simulation:true,updatedAt,entities,evidence,relationships:edges,
    capabilities:[{id:'contract-organism.inspect',mode:'local-projection',authority:'none',executable:false}],
    boundary:'Local simulated workflows and claimed evidence, not legal instruments, verified identity, custody or external execution.',
  };
  validateProjectionContribution(contribution);
  return contribution;
}
