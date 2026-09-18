/** User-authored, non-monetary rules. Provider observations are not settlement authority. */
const freeze = value => {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function label(value,name,max=160){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw Error(`${name} must contain 1–${max} characters`);return value.trim();}
export function createMarket({id,source,kind='single',question,outcomes,closesAt,origin='provider',author,terms='',parentId=null,now=Date.now()}) {
  if(!['single','pool'].includes(kind))throw Error('Choose single or pool');
  if(!['provider','authored'].includes(origin))throw Error('Unknown provenance mode');
  let provenance;
  if(origin==='authored') {
    provenance={id:label(id,'ID'),provider:'User-authored statement',title:label(author,'Author',64),retrievedAt:new Date(now).toISOString(),sourceUrl:null};
  } else {
  if(!source?.id||!source?.provider||!source?.retrievedAt||!Number.isFinite(Date.parse(source.retrievedAt)))throw Error('Select a timestamped public sports record first');
  const url=new URL(source.sourceUrl);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!/(^|\.)espn(?:cdn)?\.com$/i.test(url.hostname))throw Error('Unsupported provider provenance');
  provenance={id:label(source.id,'Source ID'),provider:label(source.provider,'Provider'),title:label(source.title||source.id,'Source title',300),sourceUrl:url.href,retrievedAt:source.retrievedAt};
  }
  if(typeof terms!=='string'||terms.length>4000)throw Error('Terms must be at most 4000 characters');
  if(parentId!==null)parentId=label(parentId,'Parent ID');
  if(!Array.isArray(outcomes)||outcomes.length<2||outcomes.length>12)throw Error('Provide 2–12 outcomes');
  const choices=outcomes.map(o=>label(o,'Outcome',80));
  if(new Set(choices.map(o=>o.toLowerCase())).size!==choices.length)throw Error('Outcomes must be distinct');
  const closes=Date.parse(closesAt);if(!Number.isFinite(closes)||closes<=now)throw Error('Closing time must be in the future');
  return freeze({schemaVersion:1,id:label(id,'ID'),kind,question:label(question,'Question'),outcomes:choices,closesAt:new Date(closes).toISOString(),createdAt:new Date(now).toISOString(),
    source:provenance,origin,author:origin==='authored'?provenance.title:null,terms:terms.trim(),parentId,
    entries:[],state:'open',result:null,localOnly:true,monetary:false,settlement:false});
}

/** One owner for all list and geometric views. Parent links are immutable and
 * may only point to an existing record, making cycles impossible on creation. */
export function createMarketBook(initial=[]) {
  let records=[];
  const listeners=new Set();
  const snapshot=()=>records.slice();
  function ancestors(record){const chain=[];let current=record;while(current.parentId){current=records.find(r=>r.id===current.parentId);if(!current)throw Error('Parent does not exist');chain.push(current);if(chain.length>8)throw Error('Maximum contract depth is eight');}return chain;}
  function notify(){for(const fn of listeners)fn(snapshot());}
  function add(spec,{restoring=false}={}){
    if(records.length>=100)throw Error('This workspace supports 100 authored contracts');
    if(records.some(r=>r.id===spec.id))throw Error('Contract ID already exists');
    const record=createMarket(spec);
    if(record.parentId){const parent=records.find(r=>r.id===record.parentId);if(!parent)throw Error('Parent does not exist');const chain=[parent,...ancestors(parent)];if(chain.length>8)throw Error('Maximum contract depth is eight');if(!restoring&&chain.some(r=>r.state!=='open'||Date.parse(r.closesAt)<=spec.now))throw Error('Parent is closed');if(Date.parse(record.closesAt)>Date.parse(parent.closesAt))throw Error('Child must close no later than its parent');}
    records=[...records,record];return record;
  }
  if(!Array.isArray(initial)||initial.length>100)throw Error('Invalid saved contract workspace');
  for(const raw of initial){
    const now=Date.parse(raw.createdAt);if(!Number.isFinite(now))throw Error('Invalid creation time');
    let record=add({...raw,now},{restoring:true});
    if(!Array.isArray(raw.entries)||raw.entries.length>100)throw Error('Invalid saved entries');
    for(const entry of raw.entries){const at=Date.parse(entry.enteredAt);if(!Number.isFinite(at)||at<now)throw Error('Invalid entry time');record=enterMarket(record,{...entry,now:at});}
    if(raw.state==='closed')record=closeMarket(record);else if(raw.state!=='open')throw Error('Invalid saved state');
    records=records.map(r=>r.id===record.id?record:r);
  }
  return {
    snapshot,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    create(spec){const record=add({...spec,now:spec.now??Date.now()});notify();return record;},
    enter(id,entry){const record=records.find(r=>r.id===id);if(!record)throw Error('Contract not found');const now=entry.now??Date.now();if(ancestors(record).some(r=>r.state!=='open'||now>=Date.parse(r.closesAt)))throw Error('Parent is closed');const next=enterMarket(record,{...entry,now});records=records.map(r=>r.id===id?next:r);notify();return next;},
    close(id){const record=records.find(r=>r.id===id);if(!record)throw Error('Contract not found');const next=closeMarket(record);records=records.map(r=>r.id===id?next:r);notify();return next;}
  };
}
export function enterMarket(market,{participant,outcome,now=Date.now()}) {
  if(market.state!=='open'||now>=Date.parse(market.closesAt))throw Error('Market is closed for entries');
  const name=label(participant,'Participant',64);
  if(!market.outcomes.includes(outcome))throw Error('Choose a configured outcome');
  if(market.entries.some(e=>e.participant.toLowerCase()===name.toLowerCase()))throw Error('This local participant already entered');
  if(market.kind==='single'&&market.entries.length>=1)throw Error('Single contract already has its entry');
  if(market.entries.length>=100)throw Error('Local pool limit reached');
  return freeze({...market,entries:[...market.entries,{participant:name,outcome,enteredAt:new Date(now).toISOString()}]});
}
export function closeMarket(market) {
  if(market.state!=='open')throw Error('Market is already closed');
  return freeze({...market,state:'closed'});
}
export function summarizeMarket(market) {
  return {state:market.state,participants:market.entries.length,outcomes:market.outcomes.map(outcome=>({outcome,entries:market.entries.filter(e=>e.outcome===outcome).length})),settlement:false};
}
