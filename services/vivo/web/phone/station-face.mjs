import {createStrategyFace} from './strategy-face.mjs';
import {createContinuityFace} from './continuity-face.mjs';
import {createVivoStationHost} from './native-host.mjs';
// Mount this on the existing agent object's working face. It is not a new identity
// authority, provider login screen, or permission bypass.
export function mountAgentStationFace(container,{tools=globalThis.VivaAgentTools,admin=globalThis.VivaPhoneAgentAdmin,engine=globalThis.VivaPhoneEngine,base='http://127.0.0.1:18761'}={}){
 const origin=new URL(base);if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.pathname!=='/'||origin.username||origin.password)throw Error('Loopback Station only');
 const d=container.ownerDocument;const el=(tag,text)=>{const n=d.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const root=el('section');root.dataset.stationFace='true';root.setAttribute('aria-label','Agent Station control object');
 const heading=el('h3','Agent Station');const caption=el('p','Connect enrolled agents to this native world. Local credentials are not provider login tokens. A running loopback Station broker is required; GitHub Pages does not start it.');
 const status=el('p','Disconnected');status.setAttribute('role','status');
 const field=(title,id)=>{const label=el('label',title),n=el('input');n.type='password';n.autocomplete='off';n.id=id;label.append(n);return [label,n];};
 const [ownerLabel,owner]=field('Owner credential','station-owner-key'),[hostLabel,host]=field('World host credential','station-host-key');
 const connect=el('button','Connect station'),stop=el('button','Disconnect and stop local sessions'),refresh=el('button','Refresh agents and receipts');
 for(const b of [connect,stop,refresh])b.type='button';stop.disabled=true;refresh.disabled=true;
 const list=el('section'),review=el('section'),inbox=el('section');list.dataset.stationAgents='true';review.dataset.stationActions='true';inbox.dataset.stationTasks='true';
 const compose=el('form');const select=el('select');select.setAttribute('aria-label','Task recipient');const message=el('textarea');message.setAttribute('aria-label','Task instruction');message.required=true;message.maxLength=8000;const send=el('button','Send durable task');send.type='submit';compose.append(select,message,send);compose.hidden=true;
 let connection=null,ownerKey='',world='',busy=false,disposed=false,refreshEpoch=0,memoryAvailable=false,continuityAvailable=false,pinned=null;
 const mem=el('section');mem.dataset.stationMemory='true';mem.hidden=true;
 const memRecipient=el('select');memRecipient.setAttribute('aria-label','Evidence recipient');
 const task=el('input');task.type='text';task.maxLength=240;task.setAttribute('aria-label','Native mission task ID');task.placeholder='Exact mission task ID';
 const ttl=el('input');ttl.type='number';ttl.min='1';ttl.max='1440';ttl.value='60';ttl.setAttribute('aria-label','Grant duration in minutes');
 const preview=el('button','Review exact mission evidence'),grant=el('button','Grant reviewed evidence');preview.type=grant.type='button';grant.disabled=true;
 const evidence=el('pre');evidence.style.whiteSpace='pre-wrap';evidence.style.overflowWrap='anywhere';evidence.setAttribute('aria-live','polite');
 const memList=el('section');memList.dataset.memoryGrants='true';
 function clearPin(){pinned=null;grant.disabled=true;evidence.textContent='';}
 for(const field of [memRecipient,task])field.addEventListener('input',clearPin);
 const label=(name,input)=>{const l=el('label',name+' ');l.append(input);return l;};
 mem.append(el('h4','Agent memory access'),el('p','Share one exact historical mission with one enrolled agent. This grant does not authorize a world edit. It survives browser disconnect until revoked, expired, or its read limit is reached; previously read content cannot be recalled.'),label('Recipient',memRecipient),label('Mission ID',task),preview,evidence,label('Minutes',ttl),grant,memList);
 async function req(path,data){const options={headers:{Authorization:'Bearer '+ownerKey,'Content-Type':'application/json'},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)};if(data!==undefined){options.method='POST';options.body=JSON.stringify(data);}const r=await fetch(origin.origin+path,options);if(!r.ok)throw Error('Station HTTP '+r.status);return r.json();}
 function safe(fn){return async()=>{if(disposed)return;try{await fn();}catch(e){status.textContent=String(e.message||'Operation unavailable');}};}
 function action(text,fn){const b=el('button',text);b.type='button';b.onclick=safe(async()=>{b.disabled=true;try{await fn();}finally{if(b.isConnected)b.disabled=false;}});return b;}
 const continuity=createContinuityFace({doc:d,request:req,refresh:render,report:message=>{status.textContent=message;}});
 const strategy=createStrategyFace({doc:d,request:req,refresh:render,report:message=>{status.textContent=message;}});
 async function render(){
  if(!connection||busy)return;const epoch=++refreshEpoch;busy=true;
  try{const [agents,actions,tasks,grants,missions]=await Promise.all([req('/v1/owner/agents'),req('/v1/owner/actions'),req('/v1/owner/tasks'),memoryAvailable?req('/v1/owner/memory/grants'):Promise.resolve([]),continuityAvailable?req('/v1/owner/continuity/list'):Promise.resolve([])]);if(disposed||epoch!==refreshEpoch||!connection)return;
   const people=agents.filter(a=>a.role==='agent'&&a.world===world);list.replaceChildren(el('h4','Enrolled identities'));const old=select.value;select.replaceChildren();
   for(const a of people){const r=el('div');r.dataset.agentId=a.id;r.append(el('strong',a.label),el('p',(a.active?'Enrolled':'Revoked')+' · '+a.capabilities.join(', ')));if(a.active){const bound=connection.agents().includes(a.id);if(a.capabilities.some(c=>c==='world.read'||c==='world.edit')){if(!bound)r.append(action('Bind '+a.label,async()=>{connection.bind({id:a.id,label:a.label,capabilities:a.capabilities});await render();}));else r.append(el('p','Native session bound'));}else r.append(el('p','Memory-only identity'));r.append(action('Revoke '+a.label,async()=>{if(!d.defaultView.confirm('Revoke this exact agent? Submitted work may need reconciliation.'))return;await req('/v1/owner/stop',{id:a.id});await connection.tick();await render();}));const op=el('option',a.label);op.value=a.id;select.append(op);}list.append(r);}
   if([...select.options].some(x=>x.value===old))select.value=old;
   mem.hidden=!memoryAvailable;const oldMem=memRecipient.value;memRecipient.replaceChildren();
   for(const a of people.filter(a=>a.active&&a.capabilities.includes('memory.mission.read'))){const op=el('option',a.label);op.value=a.id;memRecipient.append(op);}
   if([...memRecipient.options].some(x=>x.value===oldMem))memRecipient.value=oldMem;
   if(pinned&&pinned.agent!==memRecipient.value)clearPin();preview.disabled=!memRecipient.value;
   memList.replaceChildren(el('h4','Evidence grants'));
   for(const g of grants.filter(g=>g.world===world)){const row=el('div');row.dataset.memoryGrant=g.id;const state=g.revoked?'Revoked':g.expires*1000<=Date.now()?'Expired':g.reads>=256?'Read limit reached':'Active';
    row.append(el('strong',people.find(a=>a.id===g.agent)?.label||'Former agent'),el('p',state+' · '+g.task+' · reads '+g.reads),el('p','Evidence SHA-256: '+g.evidence_sha));
    if(state==='Active')row.append(action('Revoke evidence access',async()=>{await req('/v1/owner/memory/revoke',{id:g.id});await render();}));memList.append(row);}

   review.replaceChildren(el('h4','Action receipts'));for(const a of actions.filter(x=>x.world===world)){const r=el('div');r.dataset.actionId=a.id;r.append(el('strong',a.tool+' · '+a.status));if(a.status==='awaiting_approval'){const pre=el('pre',JSON.stringify(a.args,null,2));pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';r.append(pre,action('Approve exact action',async()=>{await req('/v1/owner/decision',{id:a.id,decision:'approve'});await connection.tick();await render();}),action('Reject action',async()=>{await req('/v1/owner/decision',{id:a.id,decision:'reject'});await render();}));}else if(a.status==='uncertain')r.append(el('p','No automatic retry. Inspect the original native record.'));review.append(r);}
   inbox.replaceChildren(el('h4','Task inbox and replies'));const ids=new Set(people.map(a=>a.id));for(const t of tasks.filter(t=>ids.has(t.agent))){const r=el('div');r.append(el('strong',t.status),el('p',t.text));if(t.answer)r.append(el('p',t.answer));inbox.append(r);}
   if(continuityAvailable){await continuity.render({agents:people,availableGrants:grants,missions,world});if(disposed||epoch!==refreshEpoch||!connection)return;strategy.render({agents:people,missions,world});}else{continuity.clear();strategy.clear();}
  }finally{busy=false;}
 }
 preview.onclick=safe(async()=>{clearPin();const target=memRecipient.value,id=task.value.trim(),epoch=refreshEpoch;if(!target||!id)throw Error('Select a recipient and exact mission ID');
  const r=await req('/v1/owner/memory/preview',{agent:target,task:id});
  if(!connection||epoch!==refreshEpoch||memRecipient.value!==target||task.value.trim()!==id||r.agent!==target||r.task!==id||r.world!==world)return;
  pinned=r;evidence.textContent='Historical evidence · authentication unverified\nRecipient: '+memRecipient.selectedOptions[0]?.textContent+'\nFact: '+r.fact+'\nEvidence SHA-256: '+r.evidence_sha+'\nArtifact SHA-256: '+r.artifact_sha+'\n\n'+r.evidenceJson;grant.disabled=false;});
 grant.onclick=safe(async()=>{const p=pinned;if(!p||p.agent!==memRecipient.value||p.task!==task.value.trim())throw Error('Review this exact evidence first');const minutes=Number(ttl.value);if(!Number.isInteger(minutes)||minutes<1||minutes>1440)throw Error('Grant duration must be 1–1440 minutes');grant.disabled=true;
  try{await req('/v1/owner/memory/grant',{agent:p.agent,task:p.task,fact:p.fact,evidence_sha:p.evidence_sha,artifact_sha:p.artifact_sha,ttl_seconds:minutes*60});clearPin();status.textContent='Exact evidence grant saved';await render();}catch(e){if(pinned===p)grant.disabled=false;throw e;}});
 connect.onclick=safe(async()=>{if(connection)return;const native=await engine?.snapshot?.();world=native?.snapshot?.worldId;if(typeof world!=='string'||!world)throw Error('Enter the original local Vivo world first');ownerKey=owner.value;const hk=host.value;if(!ownerKey||!hk)throw Error('Both local credentials required');const identity=await req('/v1/info');if(identity.role!=='owner'){ownerKey='';throw Error('Owner credential required');}memoryAvailable=identity.memory_available===true;continuityAvailable=identity.continuity_available===true;const hostCheck=await fetch(origin.origin+'/v1/info',{headers:{Authorization:'Bearer '+hk},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});if(!hostCheck.ok)throw Error('Host credential rejected');const id=await hostCheck.json();if(id.role!=='host'||id.world!==world)throw Error('Host must be enrolled for this exact native world');connection=createVivoStationHost({base:origin.origin,hostToken:hk,worldId:world,tools,admin,onEvent:e=>{status.textContent=e.state==='connection-error'?'Station connection unavailable':e.state||'Connected';}});owner.value='';host.value='';connect.disabled=true;stop.disabled=false;refresh.disabled=false;compose.hidden=false;status.textContent='Connected · '+world;connection.start();await render();});
 async function disconnect(){refreshEpoch++;const old=connection;connection=null;ownerKey='';memoryAvailable=false;continuityAvailable=false;continuity.clear();strategy.clear();mem.hidden=true;clearPin();task.value='';memRecipient.replaceChildren();memList.replaceChildren();owner.value='';host.value='';await old?.stop();connect.disabled=false;stop.disabled=true;refresh.disabled=true;compose.hidden=true;message.value='';list.replaceChildren();review.replaceChildren();inbox.replaceChildren();status.textContent='Disconnected · local sessions stopped';}
 stop.onclick=safe(disconnect);refresh.onclick=safe(render);compose.onsubmit=e=>{e.preventDefault();safe(async()=>{await req('/v1/owner/tasks',{agent:select.value,text:message.value});message.value='';await render();})();};
 root.append(heading,caption,ownerLabel,hostLabel,connect,stop,refresh,status,list,review,mem,continuity.element,strategy.element,compose,inbox);container.append(root);
 const pagehide=()=>{void disconnect();};d.defaultView.addEventListener('pagehide',pagehide);
 return {element:root,async dispose(){disposed=true;d.defaultView.removeEventListener('pagehide',pagehide);await disconnect();root.remove();}};
}
