/** Native Station face extension. No credentials, persistent store or new world. */
export function createContinuityFace({doc,request,refresh,report}) {
 const el=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const label=(text,input)=>{const n=el('label',text+' ');n.append(input);return n;};
 const root=el('section');root.dataset.stationContinuity='true';root.hidden=true;root.setAttribute('aria-label','Mission continuity');
 const select=el('select');select.setAttribute('aria-label','Mission recipient');
 const objective=el('textarea');objective.setAttribute('aria-label','Mission objective');objective.maxLength=8000;objective.required=true;
 const grantsBox=el('fieldset');const list=el('section');list.dataset.continuityList='true';
 const create=el('button','Assign managed mission');create.type='submit';
 const form=el('form');form.append(label('Recipient',select),label('Objective',objective),grantsBox,create);
 root.append(el('h4','Mission continuity'),el('p','Assign an objective, explicitly select existing evidence grants, and inspect confirmed native observations before accepting a checkpoint. Handoffs do not copy private working notes. No mission checkpoint executes a world edit.'),form,list);
 let people=[],grants=[],epoch=0,active=false,selectedMission=null;const retries=new Map(),drafts=new Map();
 function eligible(a){return a.active&&a.capabilities.includes('mission.continue')&&a.capabilities.includes('world.read');}
 function activeGrants(agent){return grants.filter(g=>g.agent===agent&&!g.revoked&&g.expires*1000>Date.now()&&g.reads<256);}
 function choices(box,agent,selected=[]){box.replaceChildren(el('legend','Approved evidence for this recipient (optional)'));const valid=activeGrants(agent);for(const g of valid){const c=el('input');c.type='checkbox';c.value=g.id;c.checked=selected.includes(g.id);box.append(label(g.task+' · '+g.evidence_sha.slice(0,12)+'…',c));}if(!valid.length)box.append(el('p','No active evidence grants. You can assign an observation-only mission.'));}
 const picked=box=>[...box.querySelectorAll('input:checked')].map(n=>n.value).sort();
 function optionList(target,entries,keep){target.replaceChildren();for(const a of entries){const n=el('option',a.label);n.value=a.id;target.append(n);}if(entries.some(x=>x.id===keep))target.value=keep;}
 function safe(fn,button){return async()=>{const e=epoch;if(!active||button?.disabled)return;if(button)button.disabled=true;try{await fn(e);}catch(err){if(active&&e===epoch)report(String(err.message||'Mission operation unavailable'));}finally{if(button?.isConnected&&active&&e===epoch)button.disabled=false;}};}
 function action(text,fn){const b=el('button',text);b.type='button';b.onclick=safe(fn,b);return b;}
 async function write(path,payload,e){if(!active||e!==epoch)throw Error('Station disconnected or refreshed');const key=path+JSON.stringify(payload);let rid=retries.get(key);if(!rid){if(retries.size>=64)throw Error('Too many unresolved submissions; reconnect after checking state');rid=doc.defaultView.crypto.randomUUID();retries.set(key,rid);}const result=await request(path,{...payload,request_id:rid});retries.delete(key);if(path.endsWith('/handoff')||path.endsWith('/accept')||path.endsWith('/cancel'))drafts.delete(payload.id);if(active&&e===epoch){report('Mission change recorded at revision '+result.applied_revision);try{await refresh();}catch{report('Mission change recorded. Refresh failed; inspect the current revision before another action.');}}return result;}
 select.onchange=()=>choices(grantsBox,select.value);
 form.onsubmit=e=>{e.preventDefault();void safe(async version=>{if(!select.value||!objective.value.trim())throw Error('Select a continuity-enabled agent and objective');const submitted=objective.value;await write('/v1/owner/continuity/create',{agent:select.value,objective:submitted,grants:picked(grantsBox)},version);if(active&&objective.value===submitted){objective.value='';choices(grantsBox,select.value);}},create)();};
 async function showDetail(row,detail,e){const m=await request('/v1/owner/continuity/state',{id:row.id});if(!active||e!==epoch||!detail.isConnected)return;detail.replaceChildren();
  detail.append(el('p','Revision '+m.revision+' · assignment '+m.assignment+' · '+m.phase),el('p',m.evidence_current?'Required evidence available at last check.':'Required evidence unavailable or changed.'),el('p',m.observation_current?'Recent confirmed native observation (not proof of current state).':'Fresh confirmed native observation required.'));
  if(m.handoff)detail.append(el('p','Owner handoff: '+m.handoff));
  if(m.checkpoint){detail.append(el('h5','Agent checkpoint — unverified assertion'),el('p',m.checkpoint.progress),el('p','Proposed next step: '+m.checkpoint.next_step));if(m.observation){detail.append(el('p','Native observation receipt: '+m.observation),action('Inspect confirmed observation',async v=>{const receipt=await request('/v1/actions/'+m.observation);if(!active||v!==epoch||!detail.isConnected)return;const pre=el('pre',JSON.stringify(receipt,null,2));pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';detail.append(pre);}));}}
  detail.append(action('Inspect owner-only history',async v=>{const history=await request('/v1/owner/continuity/history',{id:m.id});if(!active||v!==epoch||!detail.isConnected)return;const pre=el('pre',JSON.stringify(history,null,2));pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';detail.append(pre);}));
  if(['closed','cancelled'].includes(m.phase))return;
  const draft=drafts.get(m.id)||{review:'',note:'',recipient:'',grants:[],revision:m.revision};drafts.set(m.id,draft);
  if(draft.revision!==m.revision){detail.append(el('p','Mission revision changed. Review the current record before submitting the preserved draft.'));draft.revision=m.revision;}
  // Inline review keeps the exact decision inside the mission object.
  const confirmation=el('section');confirmation.hidden=true;confirmation.dataset.missionConfirmation='true';confirmation.setAttribute('aria-label','Review exact mission decision');
  let proposal=null;
  function dismiss(){proposal=null;confirmation.hidden=true;confirmation.replaceChildren();}
  function stage(path,payload,title,explanation,stillCurrent){
   if(!active||e!==epoch||!detail.isConnected)throw Error('Inspect the current mission again');
   dismiss();const frozen=JSON.stringify(payload);proposal=frozen;
   const description=el('p',explanation);description.setAttribute('role','status');
   const exact=el('pre',JSON.stringify(payload,null,2));exact.style.whiteSpace='pre-wrap';exact.style.overflowWrap='anywhere';
   const approve=action('Confirm '+title,async v=>{if(proposal!==frozen||v!==e||!detail.isConnected||!stillCurrent())throw Error('Decision changed. Review it again.');await write(path,JSON.parse(frozen),v);dismiss();});
   const back=el('button','Return to review');back.type='button';back.onclick=dismiss;
   confirmation.append(el('h5','Confirm '+title+' · revision '+m.revision),description,exact,approve,back);confirmation.hidden=false;approve.focus();
  }
  const review=el('textarea');review.setAttribute('aria-label','Owner review note');review.maxLength=4000;review.value=draft.review;review.oninput=()=>{draft.review=review.value;dismiss();};detail.append(label('Review note',review));
  if(m.phase==='ready'&&m.evidence_current&&m.observation_current)detail.append(action('Accept reviewed checkpoint',async v=>{if(!review.value.trim())throw Error('Write a review note');const value=review.value;stage('/v1/owner/continuity/accept',{id:m.id,expected_revision:m.revision,note:value},'checkpoint acceptance','This records review, not independent truth or authorization for a world edit.',()=>review.value===value);}));
  detail.append(action('Cancel managed mission',async v=>{if(!review.value.trim())throw Error('Write a cancellation note');const value=review.value;stage('/v1/owner/continuity/cancel',{id:m.id,expected_revision:m.revision,note:value},'mission cancellation','A running observation may remain uncertain. Other native actions and separately granted memory are not revoked.',()=>review.value===value);}));
  const target=el('select');target.setAttribute('aria-label','Handoff recipient');const targets=people.filter(a=>eligible(a)&&a.id!==m.agent);optionList(target,targets,draft.recipient);const box=el('fieldset');choices(box,target.value,draft.recipient===target.value?draft.grants:[]);target.onchange=()=>{dismiss();draft.recipient=target.value;draft.grants=[];choices(box,target.value);};box.onchange=()=>{dismiss();draft.recipient=target.value;draft.grants=picked(box);};const note=el('textarea');note.setAttribute('aria-label','Reviewed handoff note');note.maxLength=4000;note.value=draft.note;note.oninput=()=>{draft.note=note.value;dismiss();};
  if(targets.length){detail.append(el('h5','Transfer mission'),label('New recipient',target),box,label('Only this reviewed handoff note is shared',note),action('Transfer with reviewed handoff',async v=>{if(!note.value.trim())throw Error('Write the exact note to share');const recipient=target.value,value=note.value,selected=picked(box);stage('/v1/owner/continuity/handoff',{id:m.id,expected_revision:m.revision,agent:recipient,grants:selected,note:value},'mission handoff','Transfer to '+target.selectedOptions[0]?.textContent+'. Only the reviewed note and selected grants are shared. Old private notes remain in owner history.',()=>target.value===recipient&&note.value===value&&JSON.stringify(picked(box))===JSON.stringify(selected));}));}
  detail.append(confirmation);
 }
 async function render({agents,availableGrants,missions,world}){epoch++;active=true;root.hidden=false;people=agents;grants=availableGrants;const keep=select.value,checked=picked(grantsBox);optionList(select,people.filter(eligible),keep);choices(grantsBox,select.value,keep===select.value?checked:[]);create.disabled=!select.value;const version=epoch;list.replaceChildren(el('h5','Managed missions'));
  for(const m of missions.filter(x=>x.world===world)){const card=el('article');card.dataset.continuityMission=m.id;const detail=el('section');card.append(el('strong',m.objective),el('p',m.phase+' · '+(people.find(x=>x.id===m.agent)?.label||'Former agent')+' · revision '+m.revision),action('Inspect mission '+m.id.slice(0,8),async e=>{selectedMission=m.id;await showDetail(m,detail,e);}),detail);list.append(card);if(selectedMission===m.id)await showDetail(m,detail,version);if(!active||version!==epoch)return;}
  if(!missions.some(m=>m.world===world))list.append(el('p','No managed missions in this world.'));
 }
 function clear(){epoch++;active=false;root.hidden=true;people=[];grants=[];selectedMission=null;retries.clear();drafts.clear();select.replaceChildren();grantsBox.replaceChildren();objective.value='';list.replaceChildren();}
 return {element:root,render,clear};
}
