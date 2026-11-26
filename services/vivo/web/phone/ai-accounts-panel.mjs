import {ConstructiveMemory,exampleMemory} from './constructive-memory.mjs';
import {missionView} from './mission-graph.mjs';
import {parseMissionPlanLines} from './mission-planner.mjs';
/** Native Vivo controls extension. No second world, password inputs, or auto-login. */
const API='/api/vivo/accounts';
const message=e=>typeof e?.message==='string'?e.message:'Operation failed';
const node=(tag,text)=>Object.assign(document.createElement(tag),text===undefined?{}:{textContent:text});
const button=(text,fn)=>{const b=node('button',text);b.type='button';b.onclick=fn;return b;};
/** Labels describe connection methods, never claim provider entitlement or model availability. */
export const AI_PROVIDERS=Object.freeze([
  {id:'chatgpt-plan',group:'Popular',name:'ChatGPT / Codex subscription',method:'Plan sign-in',description:'Use an eligible ChatGPT plan. Accounts and limits stay separate.',action:'chatgpt',help:'https://developers.openai.com/siwc/token-sharing-open-source/sign-in'},
  {id:'openai-api',group:'Popular',name:'OpenAI',method:'API key',description:'Separate API billing, not your ChatGPT subscription.',action:null,help:'https://platform.openai.com/docs/overview'},
  {id:'claude-api',group:'Popular',name:'Anthropic Claude',method:'API key',description:'Connect using an Anthropic API account.',action:null,help:'https://platform.claude.com/docs/en/api/overview'},
  {id:'claude-native',group:'Popular',name:'Claude Pro / Max',method:'Native app',description:'Use Claude Code’s own sign-in. This is not a Claude login inside Vivo.',action:null,help:'https://code.claude.com/docs/en/authentication'},
  {id:'gemini-api',group:'Popular',name:'Google Gemini',method:'API key',description:'Choose models from the account’s verified catalogue after connecting.',action:null,help:'https://ai.google.dev/gemini-api/docs/api-key'},
  {id:'grok-api',group:'Popular',name:'Grok / xAI',method:'API key',description:'An xAI API connection is separate from a persistent Grok Bot.',action:null,help:'https://docs.x.ai/docs/overview'},
  {id:'hermes',group:'Local & self-hosted',name:'Hermes agent',method:'Agent runtime',description:'Connect your running Hermes session and its configured provider.',action:null,help:'https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration'},
  {id:'local-model',group:'Local & self-hosted',name:'Local model',method:'Local runtime',description:'Use an authorized desktop or device runtime. No NPU support is assumed.',action:null,help:null},
  {id:'council',group:'Advanced',name:'Agent council',method:'Multiple connections',description:'Bring connected agents together. Requires working provider adapters.',action:null,help:null},
  {id:'persistent-agents',group:'Advanced',name:'Muse & matumbo dot',method:'Persistent agents',description:'Existing agents need their own supported session connector, not a renamed model.',action:null,help:null},
].map(p=>Object.freeze(p)));
export function findAIProviders(query='') {
  if(typeof query!=='string')throw TypeError('Search must be text');
  const text=query.trim().toLocaleLowerCase();
  return AI_PROVIDERS.filter(p=>[p.name,p.method,p.group,p.description].join(' ').toLocaleLowerCase().includes(text));
}

export class MemoryStore {
  constructor(factory=globalThis.indexedDB){this.factory=factory;}
  async access(mode,key,value) {
    if(!this.factory)throw Error('IndexedDB unavailable; memory was not saved.');
    const db=await new Promise((resolve,reject)=>{const r=this.factory.open('vivo-constructed-memory',1);
      r.onupgradeneeded=()=>r.result.createObjectStore('models');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try{return await new Promise((resolve,reject)=>{const t=db.transaction('models',mode),s=t.objectStore('models');
      const r=mode==='readonly'?s.get(key):s.put(value,key);t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
    finally{db.close();}
  }
  load(scope){return this.access('readonly',JSON.stringify(scope));}
  save(scope,value){return this.access('readwrite',JSON.stringify(scope),value);}
}
export function mountIntelligence({root,request=globalThis.fetch.bind(globalThis),store=new MemoryStore(),
  navigate=url=>globalThis.location.assign(url),resumeSignIn=false,worldEvents=globalThis,
  getScope=()=>{
    const e=globalThis.VivaPhoneEngine?.publishedSnapshot?.();
    if(!globalThis.VivaPhoneEngine?.active||!e?.snapshot?.worldId)throw Error('Enter the existing local Vivo world first.');
    return {worldId:e.snapshot.worldId,projectId:e.branchId||'local'};
  }}={}) {
  if(!root||root.querySelector('#vivo-ai-accounts'))return null;
  const section=node('section');section.id='vivo-ai-accounts';section.tabIndex=-1;
  section.append(node('h3','Bring your AI into maTumbo'));
  section.append(node('p','Choose a provider, then how to connect. These are AI account connections, not maTumbo billing.'));
  const style=node('style');style.textContent=`
    #vivo-ai-accounts{color:inherit;overflow-wrap:anywhere;max-width:100%;box-sizing:border-box}
    #vivo-ai-accounts [hidden]{display:none!important}
    #vivo-ai-accounts button{box-sizing:border-box;min-height:44px;padding:10px 14px;margin:4px 4px 4px 0;border:1px solid #617667;border-radius:10px;background:#263c32;color:#e8eee2;white-space:normal;font:inherit;cursor:pointer}
    #vivo-ai-accounts input,#vivo-ai-accounts select,#vivo-ai-accounts textarea{box-sizing:border-box;max-width:100%;min-height:44px;padding:10px;border:1px solid #526b62;border-radius:10px;background:#10252a;color:#e8eee2;font:inherit}
    #vivo-ai-accounts input[type=checkbox]{min-height:0}
    #vivo-ai-accounts textarea{width:100%}
    #vivo-ai-accounts .provider-search,#vivo-ai-accounts #vivoAccountLabel{box-sizing:border-box;width:100%;min-height:48px;padding:12px;border:1px solid #53706b;border-radius:12px;background:#0d2026;color:#e8f1e8;font:inherit}
    #vivo-ai-accounts .provider-group{margin:12px 0;border:1px solid #38514e;border-radius:14px;overflow:hidden}
    #vivo-ai-accounts .provider-group summary{cursor:pointer;min-height:48px;box-sizing:border-box;padding:14px;font-weight:600}
    #vivo-ai-accounts .provider-count{float:right;margin-right:18px;color:#adc6be}
    #vivo-ai-accounts .provider-row{display:grid;grid-template-columns:28px minmax(0,1fr) 16px;gap:10px;width:100%;min-height:84px;margin:0;padding:16px;text-align:left;align-items:center;border:0;border-top:1px solid #304743;border-radius:0;background:#10252a;color:#e8f1e8;cursor:pointer;font:inherit;box-sizing:border-box}
    #vivo-ai-accounts .provider-row:hover,#vivo-ai-accounts .provider-row[aria-pressed=true]{background:#20352e}
    #vivo-ai-accounts button:focus-visible,#vivo-ai-accounts a:focus-visible,#vivo-ai-accounts input:focus-visible,#vivo-ai-accounts summary:focus-visible{outline:3px solid #e4c78d;outline-offset:-3px}
    #vivo-ai-accounts .provider-name{display:block;font-weight:650;font-size:16px}
    #vivo-ai-accounts .provider-meta{display:block;color:#b7c9c3;margin-top:6px;font-size:13px;line-height:1.5}
    #vivo-ai-accounts .provider-chevron{color:#d9bd83;font-size:22px}
    #vivo-ai-accounts .provider-detail{border:1px solid #a58e5f;border-radius:14px;padding:16px;margin:14px 0}
    #vivo-ai-accounts .provider-detail button,#vivo-ai-accounts .provider-detail a{display:block;box-sizing:border-box;width:100%;min-height:46px;padding:12px;margin-top:12px;white-space:normal}
    #vivo-ai-accounts .provider-detail a{color:#e4c78d}
    #vivo-ai-accounts .provider-detail button{border:1px solid #d5b77d;border-radius:10px;background:#dac18d;color:#172620;font-weight:600}
    #vivo-ai-accounts .provider-detail h4{margin:6px 0 12px}
    #vivo-ai-accounts .provider-note{font-size:13px;color:#c2d1cb}
  `;section.append(style);
  const state=node('p','Choose a service to see its connection options. Nothing connects automatically.');state.setAttribute('role','status');state.id='vivoAccountStatus';
  const rows=node('div'),picker=node('div');picker.id='vivoProviderPicker';
  const search=node('input');search.type='search';search.className='provider-search';search.placeholder='Search providers';search.setAttribute('aria-label','Search AI providers');
  const groups=node('div'),empty=node('p','No providers match. Try another name.');empty.hidden=true;
  picker.append(search,groups,empty);
  const detail=node('div');detail.className='provider-detail';detail.id='vivoProviderDetail';detail.hidden=true;detail.tabIndex=-1;
  const label=node('input');label.placeholder='Name this account, e.g. Personal or Work';label.maxLength=60;label.id='vivoAccountLabel';label.setAttribute('aria-label','Account label');
  const loginArea=node('div');loginArea.id='vivoLoginArea';let busy=false,selected=null,selectionEpoch=0,disposed=false;
  const clearSelection=()=>{selected=null;selectionEpoch++;loginArea.replaceChildren();detail.hidden=true;renderProviders();};
  const renderProviders=()=>{
    const providers=findAIProviders(search.value);groups.replaceChildren();empty.hidden=providers.length!==0;
    for(const groupName of ['Popular','Local & self-hosted','Advanced']) {
      const members=providers.filter(p=>p.group===groupName);if(!members.length)continue;
      const group=node('details');group.className='provider-group';group.open=groupName==='Popular'||search.value.trim().length>0;
      const heading=node('summary',groupName),count=node('span',String(members.length));count.className='provider-count';heading.append(count);group.append(heading);
      for(const p of members){
        const item=button('',()=>selectProvider(p));item.className='provider-row';item.dataset.providerId=p.id;
        item.setAttribute('aria-label',`${p.name} — ${p.method}`);item.setAttribute('aria-pressed',String(selected?.id===p.id));item.setAttribute('aria-controls','vivoProviderDetail');
        const icon=node('span','◇');icon.setAttribute('aria-hidden','true');const text=node('span'),title=node('span',p.name),sub=node('span',`${p.method} · ${p.description}${p.action?'':' Connector needed.'}`),arrow=node('span','›');
        title.className='provider-name';sub.className='provider-meta';arrow.className='provider-chevron';arrow.setAttribute('aria-hidden','true');text.append(title,sub);item.append(icon,text,arrow);group.append(item);
      }
      groups.append(group);
    }
  };
  const selectProvider=p=>{
    selected=p;selectionEpoch++;loginArea.replaceChildren();detail.replaceChildren();detail.hidden=false;
    detail.append(node('h4',p.name),node('p',p.description));
    if(p.action==='chatgpt'){
      detail.append(node('p','Continue through your Vivo account host. Adding an account does not replace an existing one.'),label,
        button('Sign in with ChatGPT',run(()=>offerLogin(null))));
    }else{
      const note=node('p',p.id==='claude-native'
        ? 'Claude subscription sign-in stays in the native Claude Code application. Vivo does not collect or reuse Claude.ai login tokens. A native session connector is not installed in this build.'
        : 'This connection method is not implemented in this account host yet. No account, token, or model will be connected by selecting it.');
      note.className='provider-note';detail.append(note);
      if(p.help){const help=node('a','Read provider setup instructions');help.href=p.help;help.target='_blank';help.rel='noopener noreferrer';detail.append(help);}
    }
    detail.append(button('Back to providers',()=>{clearSelection();search.focus();}));
    state.textContent=p.action==='chatgpt'?'Ready to start provider sign-in. Your account is not connected yet.':'Connector required. Existing accounts and tasks are unchanged.';
    renderProviders();detail.focus({preventScroll:true});detail.scrollIntoView({block:'nearest'});
  };
  search.addEventListener('input',renderProviders);
  const api=async(path='',body)=>{
    const response=await request(API+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
      headers:body?{'Content-Type':'application/json','X-Vivo-Action':'user'}:{},body:body?JSON.stringify(body):undefined});
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{throw Error('Connect your Vivo companion first. This page has no account server at its current address. Your existing accounts have not changed.');}
    if(!response.ok)throw Error(data.error||'Account operation failed');return data;
  };
  const run=fn=>async()=>{if(busy||disposed)return;busy=true;state.textContent='Working…';try{await fn();}catch(e){if(!disposed)state.textContent=message(e);}finally{busy=false;}};
  const offerLogin=async connectionId=>{
    if(selected?.action!=='chatgpt'&&!connectionId)throw Error('Choose a supported provider sign-in first.');
    const epoch=selectionEpoch;loginArea.replaceChildren();
    const result=await api('/login',{label:label.value.trim()||'ChatGPT account',connectionId});
    if(disposed||epoch!==selectionEpoch)return;
    const url=new URL(result.authorizationUrl);
    if(url.origin!=='https://auth.openai.com'||url.pathname!=='/api/accounts/authorize'||url.username||url.password)throw Error('Unexpected sign-in destination.');
    loginArea.replaceChildren();const link=node('a','Continue with ChatGPT');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';
    loginArea.append(link,node('p','Continue on OpenAI’s page. Vivo will reload your connection when you return. This attempt expires in five minutes.'));
    state.textContent='Opening ChatGPT sign-in. No account is connected yet.';
    // Navigate only after the explicit sign-in action and destination validation.
    // Keep the validated link as a fallback if this browser blocks navigation.
    try{navigate(url.href);}catch{state.textContent='Use Continue with ChatGPT to finish signing in.';}
  };
  const render=async()=>{
    if(disposed)return;
    const data=await api();if(disposed)return;rows.replaceChildren();state.textContent=`${data.connections.length} saved connection(s). Status is separate for every account.`;
    for(const c of data.connections){
      const row=node('fieldset');row.append(node('legend',c.label),node('p',`${c.provider} · ${c.status}${data.default===c.id?' · default for new work':''}`),node('p',`${c.accountHint||'Identity unavailable'} · registration ${c.registrationHint||'unknown'}`),node('p',c.message||''));
      const actions=node('div');actions.className='row';
      actions.append(button('Use for new work',run(async()=>{await api('/default',{connectionId:c.id});await render();})),
        button('Reconnect',run(async()=>{if(c.provider!=='openai')throw Error('This account needs its own installed provider connector.');await offerLogin(c.id);})),
        button('Disconnect this account',run(async()=>{const r=await api('/disconnect',{connectionId:c.id});await render();state.textContent=r.remoteRevocationConfirmed?'Disconnected and provider revocation confirmed.':'Disconnected locally; remote revocation unconfirmed.';})));
      const model=node('select');model.setAttribute('aria-label',`Model for ${c.label}`);
      const consent=node('input');consent.type='checkbox';const consentLabel=node('label');consentLabel.append(consent,document.createTextNode(' Allow one small verification request using this account’s allowance.'));
      const verify=button('Verify one inference',run(async()=>{if(!consent.checked)throw Error('Explicit request consent is required.');
        await api('/verify',{connectionId:c.id,model:model.value,consent:true});await render();}));verify.disabled=true;
      actions.append(button('Load this account’s models',run(async()=>{
        const result=await api('/models',{connectionId:c.id});model.replaceChildren();
        for(const m of result.models){const o=node('option',m.label);o.value=m.id;model.append(o);}
        verify.disabled=!result.models.length;state.textContent='Catalog loaded. No inference has run.';
      })));
      row.append(actions,model,consentLabel,verify);rows.append(row);
    }
  };
  renderProviders();
  section.append(picker,detail,state,loginArea,node('h4','Your connected accounts'),
    button('Add another account',()=>{clearSelection();search.value='';renderProviders();search.focus();picker.scrollIntoView({block:'start'});}),
    button('Refresh account status',run(render)),rows);
  section.append(node('p','Saved service names and management links are notes, not authentication. Your existing subscription records remain unchanged.'));
  section.append(node('hr'),node('h3','Explicit-weight memory lab'),node('p','Four relation banks and a recurrent readout. Exact numeric graph recall, not a trained language model. This does not replace the existing reciprocal model or authorize actions.'));
  const records=node('textarea');records.id='vivoMemoryRecords';records.rows=6;records.maxLength=150000;records.setAttribute('aria-label','Exact authorized graph records JSON');
  const start=node('input');start.id='vivoMemoryStart';start.type='number';start.min='0';start.max='65535';start.value='17';start.setAttribute('aria-label','Starting numeric address');
  const path=node('input');path.id='vivoMemoryPath';path.value='0,1,2,3';path.setAttribute('aria-label','Bank sequence');
  const out=node('pre','No memory compiled or loaded.');out.id='vivoMemoryResult';out.style.whiteSpace='pre-wrap';out.style.overflowWrap='anywhere';out.setAttribute('aria-live','polite');
  let memory=null;const memrun=fn=>async()=>{try{await fn();}catch(e){out.textContent=message(e);}};
  const memoryAccess=()=>globalThis.VivaPhoneAgentAdmin?.memoryAccess;
  const agentPicker=node('select');agentPicker.id='vivoMemoryAgent';agentPicker.setAttribute('aria-label','Active native agent session');
  const accessStatus=node('p','Agent recall is not shared.');accessStatus.setAttribute('aria-live','polite');
  function refreshMemoryAgents(){
    const selected=agentPicker.value,admin=globalThis.VivaPhoneAgentAdmin,access=memoryAccess();
    const status=access?.status(),agents=(admin?.agents?.()||[]).filter(a=>a.status==='active');
    agentPicker.replaceChildren();
    const placeholder=node('option','Choose an active agent');placeholder.value='';agentPicker.append(placeholder);
    const granted=new Set((status?.granted||[]).map(a=>a.sessionId));
    for(const agent of agents){
      const option=node('option',agent.label+' · generation '+agent.generation+(granted.has(agent.sessionId)?' · granted':''));option.value=agent.sessionId;agentPicker.append(option);
    }
    if(agents.some(a=>a.sessionId===selected))agentPicker.value=selected;
    accessStatus.textContent=!access?'Native memory access unavailable.':!status.mounted?'Compile or restore this world’s memory first.':
      'Memory revision '+status.revision+' · '+status.granted.length+' active read-only grant(s).';
    grantMemory.disabled=!status?.mounted||!agents.length;
    revokeMemory.disabled=!status?.granted.length;
    revokeEveryMemory.disabled=!status?.granted.length;
  }
  const grantMemory=button('Grant selected agent read-only recall',memrun(()=>{
    if(!agentPicker.value)throw Error('Choose an active agent first.');
    memoryAccess()?.grant(agentPicker.value);refreshMemoryAgents();
  }));
  const revokeMemory=button('Revoke selected agent recall',memrun(()=>{
    if(!agentPicker.value)throw Error('Choose an active agent first.');
    memoryAccess()?.revoke(agentPicker.value);refreshMemoryAgents();
  }));
  const revokeEveryMemory=button('Revoke all agent recall',memrun(()=>{memoryAccess()?.revokeAll();refreshMemoryAgents();}));
  const publishMemory=candidate=>{
    if(disposed)throw Error('Memory panel closed.');
    memoryAccess()?.publish(candidate);memory=candidate;refreshMemoryAgents();
  };
  const ensureScope=()=>{const scope=getScope();if(memory&&JSON.stringify(memory.summary().scope)!==JSON.stringify(scope))memory=null;return scope;};
  section.append(records,button('Load synthetic example',memrun(()=>{
    const scope=ensureScope();records.value=JSON.stringify(exampleMemory(scope).checkpoint().records,null,2);out.textContent='Synthetic example loaded into editor, not saved.';
  })),button('Compile and save these weights',memrun(async()=>{
    const scope=ensureScope(),candidate=new ConstructiveMemory({scope,records:JSON.parse(records.value),revision:Date.now()});
    await store.save(scope,candidate.checkpoint());
    if(JSON.stringify(getScope())!==JSON.stringify(scope))throw Error('World changed; saved model remains scoped to its original world.');
    publishMemory(candidate);out.textContent=JSON.stringify(candidate.summary(),null,2);
  })),button('Restore this world’s memory',memrun(async()=>{
    const scope=ensureScope(),p=await store.load(scope);if(!p)throw Error('No saved memory for this world/branch.');
    const candidate=ConstructiveMemory.restore(p);if(JSON.stringify(candidate.summary().scope)!==JSON.stringify(scope))throw Error('Stored memory scope does not match this world.');if(JSON.stringify(getScope())!==JSON.stringify(scope))throw Error('World changed while loading.');
    publishMemory(candidate);records.value=JSON.stringify(p.records,null,2);out.textContent=JSON.stringify(candidate.summary(),null,2);
  })),start,path,button('Recall through the network',memrun(()=>{
    const scope=ensureScope();if(!memory)throw Error('Compile or restore this world’s memory first.');
    out.textContent=JSON.stringify(memory.query({scope,start:Number(start.value),path:path.value.split(',').map(Number)}),null,2);
  })),out,node('h4','Agent access to this memory'),node('p','Grants are per active local agent session. Recall is read-only and does not authorize actions. Compiling, restoring or changing worlds clears grants.'),
    agentPicker,button('Refresh active agents',memrun(refreshMemoryAgents)),grantMemory,revokeMemory,revokeEveryMemory,accessStatus);
  // Task history is owner-controlled and remains on the existing native agent face.
  const taskTitle=node('input');taskTitle.maxLength=100;taskTitle.placeholder='Task title';taskTitle.setAttribute('aria-label','New task title');
  const taskPicker=node('select');taskPicker.setAttribute('aria-label','Saved task in this world and branch');
  const prerequisitePicker=node('select');prerequisitePicker.multiple=true;prerequisitePicker.size=3;prerequisitePicker.setAttribute('aria-label','Prerequisite tasks for new task');
  const taskStatus=node('p','Refresh to inspect saved tasks for the open world.');taskStatus.setAttribute('aria-live','polite');
  const taskDetail=node('pre','No task selected.');taskDetail.style.whiteSpace='pre-wrap';taskDetail.style.overflowWrap='anywhere';
  let journal=null,taskBusy=false,taskScope=null,taskScopeEpoch=0,recommendation=null;
  section.dataset.taskBusy='false';
  let planPreview=null,planInputEpoch=0,recoveryPreview=null,recoveryReviewEpoch=0;
  const recoveryReason=node('input');recoveryReason.maxLength=160;recoveryReason.setAttribute('aria-label','Reason for reopening task');recoveryReason.placeholder='Reason for reopening';
  const recoveryDetail=node('pre','Select a task to inspect its blockers.');recoveryDetail.setAttribute('aria-live','polite');recoveryDetail.style.whiteSpace='pre-wrap';recoveryDetail.style.overflowWrap='anywhere';
  const planObjective=node('input');planObjective.maxLength=160;planObjective.setAttribute('aria-label','Mission objective');planObjective.placeholder='Objective';
  const planLines=node('textarea');planLines.rows=5;planLines.maxLength=8192;planLines.setAttribute('aria-label','Mission plan steps');
  planLines.placeholder='key | task title | agent source | prerequisite keys';
  const planDetail=node('pre','Review a plan before saving its tasks.');planDetail.setAttribute('aria-live','polite');planDetail.style.whiteSpace='pre-wrap';planDetail.style.overflowWrap='anywhere';
  const planSummary=node('pre','Refresh saved tasks to see mission progress.');planSummary.setAttribute('aria-live','polite');planSummary.style.whiteSpace='pre-wrap';planSummary.style.overflowWrap='anywhere';
  const evidencePicker=node('select');evidencePicker.multiple=true;evidencePicker.size=4;evidencePicker.setAttribute('aria-label','Completed mission evidence sources');
  const recallSpace=node('input');recallSpace.maxLength=256;recallSpace.setAttribute('aria-label','Recall space ID');recallSpace.placeholder='Exact space ID';
  const recallEntity=node('input');recallEntity.maxLength=256;recallEntity.setAttribute('aria-label','Recall entity ID');recallEntity.placeholder='Exact object ID';
  const traceSpace=node('input');traceSpace.maxLength=256;traceSpace.setAttribute('aria-label','Association destination space ID');traceSpace.placeholder='Destination space ID';
  const traceEntity=node('input');traceEntity.maxLength=256;traceEntity.setAttribute('aria-label','Association destination object ID');traceEntity.placeholder='Destination object ID';
  const recallDetail=node('pre','Refresh tasks, select completed evidence and grant recall.');recallDetail.id='vivoMissionRecall';recallDetail.setAttribute('aria-live','polite');recallDetail.style.whiteSpace='pre-wrap';recallDetail.style.overflowWrap='anywhere';
  let recallViewEpoch=0;
  function resetRecallView(){recallViewEpoch++;recallDetail.textContent='Refresh tasks, select completed evidence and grant recall.';}
  agentPicker.addEventListener('change',resetRecallView);recallSpace.addEventListener('input',resetRecallView);recallEntity.addEventListener('input',resetRecallView);evidencePicker.addEventListener('change',resetRecallView);traceSpace.addEventListener('input',resetRecallView);traceEntity.addEventListener('input',resetRecallView);
  const experienceDetail=node('pre','Refresh saved tasks to inspect collective experience.');experienceDetail.id='vivoMissionExperience';experienceDetail.setAttribute('aria-live','polite');experienceDetail.style.whiteSpace='pre-wrap';experienceDetail.style.overflowWrap='anywhere';
  const recommendationDetail=node('pre','Select a detached, ready task to review agent recommendations.');recommendationDetail.style.whiteSpace='pre-wrap';recommendationDetail.style.overflowWrap='anywhere';recommendationDetail.setAttribute('aria-live','polite');
  const taskScopeNow=()=>{const host=globalThis.VivaPhoneEngine,e=host?.publishedSnapshot?.();return host?.active&&e?.snapshot?.worldId&&e?.branchId?JSON.stringify([e.snapshot.worldId,e.branchId]):null;};
  const taskAdmin=()=>{const access=globalThis.VivaPhoneAgentAdmin?.taskAccess;if(!access)throw Error('Native task continuity is unavailable.');return access;};
  const selectedAgent=()=>{if(!agentPicker.value)throw Error('Choose an active agent session first.');return agentPicker.value;};
  const selectedTask=()=>{if(!taskPicker.value)throw Error('Select a saved task first.');return taskPicker.value;};
  function resetPlanPreview(){
    const old=planPreview;planPreview=null;planInputEpoch++;if(old)globalThis.VivaPhoneAgentAdmin?.taskAccess?.discardPlan?.(old.token);
    planDetail.textContent='Review a plan before saving its tasks.';savePlanButton.disabled=true;
  }
  function drawExperience(){
    const rows=journal?.experience||[];
    experienceDetail.textContent=rows.map(p=>p.sourceId+' · '+p.completedContributions+' completed task contribution(s) · '+p.contributedTasks+' recorded task(s)\n'
      +p.confirmedChanged+' confirmed changed · '+p.confirmedUnchanged+' confirmed unchanged · '+p.pending+' pending · '+p.conflict+' conflicting · '+p.notDispatched+' not dispatched · '+p.closedIncompleteContributions+' closed-incomplete contributions'
      +(p.unknownSpaceOperations?' · '+p.unknownSpaceOperations+' legacy/unknown-space operations':'')
      +(p.objects.length?'\n'+p.objects.slice(0,3).map(o=>o.spaceId+' / '+o.entityId+' · '+o.completedChangedTasks+' completed task(s) with changes · '+o.changedTasks+' changed task(s)').join('\n'):'')
      +(p.objects.length>3?'\n'+(p.objects.length-3)+' additional object histories in the journal.':'')).join('\n\n')||'No recorded operation experience in this world/branch.';
  }
  function drawPlanSummary(){
    planSummary.textContent=(journal?.plans||[]).map(p=>p.objective+' · '+p.completed+'/'+p.total+' completed · '+p.ready+' ready · '+p.blocked+' blocked · '+p.needsReview+' needs review · '+p.closedIncomplete+' closed incomplete').join('\n')||'No saved mission plans in this world/branch.';
  }
  function resetRecommendation(){recommendation=null;recommendationDetail.textContent='Select a detached, ready task to review agent recommendations.';approveTaskButton.disabled=true;}
  function resetRecovery(){
    const old=recoveryPreview;recoveryPreview=null;recoveryReviewEpoch++;if(old?.reviewToken)globalThis.VivaPhoneAgentAdmin?.taskAccess?.discardRecovery?.(old.reviewToken);
    recoveryDetail.textContent='Select a task to inspect its blockers.';recoveryReason.value='';reopenTaskButton.disabled=true;
  }
  function drawTask(){
    resetRecommendation();resetRecovery();resetRecallView();
    const task=journal?.tasks.find(t=>t.id===taskPicker.value);
    if(!task){taskDetail.textContent='No task selected.';return;}
    const attached=journal.attachments.some(a=>a.taskId===task.id),mission=missionView(journal,task);
    const count=state=>task.steps.filter(s=>s.state===state).length;
    taskDetail.textContent=task.title+' · '+task.sourceId+' · '+(task.completed?'completed':task.closed?'closed incomplete':attached?'attached':'detached')+' · '+mission.state+'\n'
      +'Confirmed '+count('confirmed')+' · unresolved '+count('pending')+' · conflicts '+count('conflict')+' · not dispatched '+count('not-dispatched')+'\n'
      +task.steps.map(s=>s.state+' · '+(s.sourceId||task.sourceId)+' · '+s.entityId+' · '+s.operationId+(s.state==='confirmed'?' · revision '+s.revision:'')).join('\n')
      +(task.handoffs||[]).map(h=>'\nHandoff · '+h.from+' → '+h.to+' · epoch '+h.epoch).join('')
      +(task.recoveries||[]).map(r=>'\nReopened · '+r.sourceId+' · '+r.reason+' · epoch '+r.epoch+' · '+r.confirmed+' confirmed receipt(s) retained').join('')
      +mission.dependencies.map(d=>'\nPrerequisite · '+d.title+' · '+d.status+' · '+d.receipts.length+' confirmed receipt(s)').join('');
  }
  function invalidateTaskScope(){
    const next=taskScopeNow();if(next===taskScope)return;taskScope=next;taskScopeEpoch++;journal=null;resetRecommendation();resetPlanPreview();resetRecovery();planSummary.textContent='Refresh saved tasks to see mission progress.';experienceDetail.textContent='Refresh saved tasks to inspect collective experience.';
    taskPicker.replaceChildren();prerequisitePicker.replaceChildren();evidencePicker.replaceChildren();resetRecallView();taskDetail.textContent='No task selected.';taskStatus.textContent='World changed. Refresh to inspect the current world’s journal.';
  }
  async function refreshTasks(preferred){
    invalidateTaskScope();const expected=taskScopeNow();if(!expected)throw Error('Open a local world first.');
    const epoch=taskScopeEpoch,result=await taskAdmin().inspect();invalidateTaskScope();
    if(disposed||epoch!==taskScopeEpoch||expected!==taskScopeNow())return;
    const old=preferred||taskPicker.value,selectedPrerequisites=new Set(Array.from(prerequisitePicker.selectedOptions||[],o=>o.value)),selectedEvidence=new Set(Array.from(evidencePicker.selectedOptions||[],o=>o.value));journal=result;taskScope=expected;taskPicker.replaceChildren();prerequisitePicker.replaceChildren();evidencePicker.replaceChildren();
    const placeholder=node('option','Choose a saved task');placeholder.value='';taskPicker.append(placeholder);
    for(const t of journal.tasks){const label=t.title+' · '+t.sourceId+' · '+missionView(journal,t).state;const option=node('option',label);option.value=t.id;taskPicker.append(option);const prerequisite=node('option',label);prerequisite.value=t.id;prerequisite.selected=selectedPrerequisites.has(t.id);prerequisitePicker.append(prerequisite);if(t.completed===true){const evidence=node('option',t.title+' · '+t.sourceId);evidence.value=t.id;evidence.selected=selectedEvidence.has(t.id);evidencePicker.append(evidence);}}
    if(journal.tasks.some(t=>t.id===old))taskPicker.value=old;
    taskStatus.textContent=journal.warning||journal.tasks.length+' saved task(s) in this world/branch. Grants never resume automatically.';drawTask();drawPlanSummary();drawExperience();
  }
  const taskRun=fn=>async()=>{if(taskBusy||disposed)return;invalidateTaskScope();const epoch=taskScopeEpoch;taskBusy=true;section.dataset.taskBusy='true';try{refreshMemoryAgents();await fn();}catch(e){if(!disposed){invalidateTaskScope();if(epoch===taskScopeEpoch)taskStatus.textContent=message(e);}}finally{taskBusy=false;section.dataset.taskBusy='false';}};
  taskPicker.addEventListener('change',drawTask);
  const refreshTaskButton=button('Refresh saved tasks',taskRun(()=>refreshTasks()));
  const createTaskButton=button('Create and attach task',taskRun(async()=>{const deps=Array.from(prerequisitePicker.selectedOptions||[],o=>o.value);const result=await taskAdmin().create(selectedAgent(),taskTitle.value,deps);taskTitle.value='';for(const option of Array.from(prerequisitePicker.selectedOptions||[]))option.selected=false;await refreshTasks(result.taskId);}));
  const resumeTaskButton=button('Resume selected task explicitly',taskRun(async()=>{const id=selectedTask();await taskAdmin().resume(selectedAgent(),id);await refreshTasks(id);}));
  const handoffTaskButton=button('Handoff selected task to chosen agent',taskRun(async()=>{
    const id=selectedTask(),task=journal?.tasks.find(t=>t.id===id);
    if(!task)throw Error('Refresh and review the saved task first.');
    await taskAdmin().handoff(selectedAgent(),id,{sourceId:task.sourceId,epoch:task.epoch});await refreshTasks(id);
  }));
  const recommendTaskButton=button('Recommend agent for selected task',taskRun(async()=>{
    resetRecommendation();const id=selectedTask(),epoch=taskScopeEpoch;
    const plan=await taskAdmin().recommend(id);invalidateTaskScope();
    if(disposed||epoch!==taskScopeEpoch||taskPicker.value!==id)return;
    recommendation=plan;const top=plan.candidates.find(a=>a.sessionId===plan.recommended?.sessionId);
    const rows=plan.candidates.map(a=>a.label+' · '+(a.eligible?'eligible':a.reasons.join(', '))+' · '+a.relatedCompletedTasks+' related completed task(s) · '+a.relatedChangedTasks+' related changed task(s) · '+a.relatedChangedReceipts+' changed receipt(s)'+(a.continuity?' · current owner':'')+(a.memoryAvailable?' · memory available':''));
    recommendationDetail.textContent=(top?'Recommended: '+top.label:'No assignment: '+plan.reason)+'\n'+rows.join('\n');
    approveTaskButton.disabled=!top;
  }));
  const approveTaskButton=button('Approve recommended assignment',taskRun(async()=>{
    const plan=recommendation;if(!plan||plan.taskId!==selectedTask())throw Error('Review a current recommendation first.');
    resetRecommendation();await taskAdmin().approveRecommendation(plan);await refreshTasks(plan.taskId);
  }));approveTaskButton.disabled=true;
  const previewPlanButton=button('Review mission plan',taskRun(async()=>{
    resetPlanPreview();const epoch=taskScopeEpoch,inputEpoch=planInputEpoch;
    const preview=await taskAdmin().previewPlan({objective:planObjective.value,steps:parseMissionPlanLines(planLines.value)},agentPicker.value||null);
    invalidateTaskScope();
    if(disposed||epoch!==taskScopeEpoch||inputEpoch!==planInputEpoch){globalThis.VivaPhoneAgentAdmin?.taskAccess?.discardPlan?.(preview.token);return;}
    planPreview=preview;planDetail.textContent=preview.objective+' · '+preview.steps.length+' tasks · '+preview.stageCount+' dependency stages · '+preview.remainingAfterSave+' slots left after save\n'
      +preview.steps.map(s=>'Stage '+s.stage+' · '+s.key+' · '+s.title+' · '+s.sourceId+(s.dependsOn.length?' · after '+s.dependsOn.join(', '):' · no prerequisites')).join('\n');
    savePlanButton.disabled=false;
  }));
  const savePlanButton=button('Save reviewed mission plan',taskRun(async()=>{
    const preview=planPreview;if(!preview)throw Error('Review a current plan first.');
    const epoch=taskScopeEpoch,inputEpoch=planInputEpoch;
    planPreview=null;savePlanButton.disabled=true;
    const result=await taskAdmin().commitPlan(preview.token);invalidateTaskScope();
    if(disposed||epoch!==taskScopeEpoch||inputEpoch!==planInputEpoch)return;
    planDetail.textContent='Saved '+result.created.length+' detached tasks. No actions or permissions were granted.';
    await refreshTasks(result.created[0]?.taskId);
  }));savePlanButton.disabled=true;
  planObjective.addEventListener('input',resetPlanPreview);planLines.addEventListener('input',resetPlanPreview);agentPicker.addEventListener('change',resetPlanPreview);
  const examplePlanButton=button('Load native edit example',()=>{resetPlanPreview();planLines.value='prepareA | Record first object state | |\nprepareB | Record second object state | |\nchange | Apply reviewed object change | | prepareA,prepareB';});
  const diagnoseTaskButton=button('Review selected task blockers',taskRun(async()=>{
    resetRecovery();const id=selectedTask(),epoch=taskScopeEpoch,reviewEpoch=recoveryReviewEpoch;
    const report=await taskAdmin().diagnose(id);invalidateTaskScope();
    if(disposed||epoch!==taskScopeEpoch||reviewEpoch!==recoveryReviewEpoch||taskPicker.value!==id){if(report.reviewToken)taskAdmin().discardRecovery(report.reviewToken);return;}
    recoveryPreview=report;
    const rows=report.roots.map(r=>r.title+' · '+r.state+' · '+r.counts.confirmed+' confirmed · '+r.counts.pending+' pending · '+r.counts.conflict+' conflicting\n'+r.next
      +(r.assignment?.sourceId?'\nSuggested '+(r.assignment.afterReopen?'after reopening: ':'agent: ')+r.assignment.sourceId+' · '+r.assignment.relatedChangedReceipts+' related changed receipt(s)':'')
      +(r.canReopen&&r.taskId!==id?'\nSelect this prerequisite in Saved task, then review it explicitly.':''));
    recoveryDetail.textContent=report.target.title+' · '+report.target.state+'\n'+(rows.join('\n\n')||report.target.next);
    reopenTaskButton.disabled=!report.reviewToken;
  }));
  const reopenTaskButton=button('Reopen reviewed incomplete task',taskRun(async()=>{
    const report=recoveryPreview;
    if(!report?.reviewToken||report.target.taskId!==selectedTask())throw Error('Review a current archived task first.');
    const epoch=taskScopeEpoch,reviewEpoch=recoveryReviewEpoch,reason=recoveryReason.value;
    recoveryPreview=null;reopenTaskButton.disabled=true;
    const result=await taskAdmin().commitRecovery(report.reviewToken,reason);invalidateTaskScope();
    if(disposed||epoch!==taskScopeEpoch||reviewEpoch!==recoveryReviewEpoch)return;
    await refreshTasks(result.taskId);
    taskStatus.textContent='Reopened task with its evidence intact. No agent attached and no action replayed.';
  }));reopenTaskButton.disabled=true;
  const grantRecallButton=button('Grant selected mission evidence',taskRun(async()=>{
    const id=selectedTask(),task=journal?.tasks.find(t=>t.id===id);if(!task)throw Error('Refresh and select the attached target task.');
    const epoch=taskScopeEpoch,view=recallViewEpoch,session=selectedAgent(),sourceTaskIds=Array.from(evidencePicker.selectedOptions||[],o=>o.value);
    const result=await taskAdmin().grantMissionRecall(session,{taskId:id,epoch:task.epoch,sourceTaskIds});invalidateTaskScope();
    if(disposed||epoch!==taskScopeEpoch||view!==recallViewEpoch||taskPicker.value!==id||agentPicker.value!==session)return;
    recallDetail.textContent='Granted '+result.sourceTaskIds.length+' completed source task(s) to this exact attachment. Read-only; no action authority.';
  }));
  const revokeRecallButton=button('Revoke mission evidence recall',taskRun(async()=>{taskAdmin().revokeMissionRecall(selectedAgent());resetRecallView();recallDetail.textContent='Mission recall grant revoked.';}));
  const queryRecallButton=button('Recall exact object evidence',taskRun(async()=>{
    const id=selectedTask(),session=selectedAgent(),epoch=taskScopeEpoch,view=recallViewEpoch;
    const host=globalThis.VivaAgentTools;if(!host)throw Error('Native agent tools unavailable.');
    if(!journal?.attachments.some(a=>a.taskId===id&&a.sessionId===session))throw Error('Refresh and select the matching attached task and agent.');
    const result=await host.invokeFor(session,'neural.missionRecall',{spaceId:recallSpace.value,entityId:recallEntity.value,limit:8});invalidateTaskScope();
    if(disposed||epoch!==taskScopeEpoch||view!==recallViewEpoch||taskPicker.value!==id||agentPicker.value!==session)return;
    if(result.targetTaskId!==id||result.attachmentEpoch!==journal?.tasks.find(t=>t.id===id)?.epoch)throw Error('The task attachment changed. Refresh before recalling.');
    recallDetail.textContent=result.status==='matched'?result.total+' exact confirmed receipt(s) · '+result.pages+' circuit page(s)\n'+result.matches.map(r=>r.operationId+' · '+r.sourceId+' · revision '+r.revision+' · '+(r.changed?'changed':'unchanged')+' · '+r.sha256).join('\n')+(result.nextOffset!==null?'\nMore receipts available through the agent tool.':''):'No result: '+result.reason;
  }));
  const queryTraceButton=button('Trace object association',taskRun(async()=>{
    const id=selectedTask(),session=selectedAgent(),epoch=taskScopeEpoch,view=recallViewEpoch;
    if(!journal?.attachments.some(a=>a.taskId===id&&a.sessionId===session))throw Error('Refresh and select the matching attached task and agent.');
    const host=globalThis.VivaAgentTools;if(!host)throw Error('Native agent tools unavailable.');
    const result=await host.invokeFor(session,'neural.missionTrace',{from:{spaceId:recallSpace.value,entityId:recallEntity.value},to:{spaceId:traceSpace.value,entityId:traceEntity.value},maxHops:6});invalidateTaskScope();
    if(disposed||epoch!==taskScopeEpoch||view!==recallViewEpoch||taskPicker.value!==id||agentPicker.value!==session)return;
    if(result.targetTaskId!==id||result.attachmentEpoch!==journal?.tasks.find(t=>t.id===id)?.epoch)throw Error('The task attachment changed. Refresh before tracing.');
    const nodeLabel=n=>n.kind==='task'?'Task '+n.taskId:n.spaceId+' / '+n.entityId;
    recallDetail.textContent=result.status==='matched'?result.hopCount+' linked evidence hops · association, not causal proof\n'+result.hops.map((h,i)=>nodeLabel(h.from)+' → '+h.relation+' → '+nodeLabel(h.to)+'\n'+(h.evidence.kind==='confirmed-receipt'?h.evidence.operationId+' · '+h.evidence.sourceId+' · revision '+h.evidence.revision+' · '+h.evidence.sha256:'Recorded task prerequisite')+' · bank '+result.circuitTrace[i].bank).join('\n'):'No association: '+result.reason;
  }));
  const queryForecastButton=button('Forecast next object',taskRun(async()=>{
    const id=selectedTask(),session=selectedAgent(),epoch=taskScopeEpoch,view=recallViewEpoch;
    if(!journal?.attachments.some(a=>a.taskId===id&&a.sessionId===session))throw Error('Refresh and select the matching attached task and agent.');
    const host=globalThis.VivaAgentTools;if(!host)throw Error('Native agent tools unavailable.');
    const result=await host.invokeFor(session,'neural.missionForecast',{spaceId:recallSpace.value,entityId:recallEntity.value});invalidateTaskScope();
    if(disposed||epoch!==taskScopeEpoch||view!==recallViewEpoch||taskPicker.value!==id||agentPicker.value!==session)return;
    if(result.targetTaskId!==id||result.attachmentEpoch!==journal?.tasks.find(t=>t.id===id)?.epoch)throw Error('The task attachment changed. Refresh before forecasting.');
    const q=result.counts,h=result.retrospective;
    const headline=result.suggestion?'Suggest inspecting '+result.suggestion.spaceId+' / '+result.suggestion.entityId+' · '+result.suggestion.supportingTasks+' distinct tasks':'No suggestion: '+result.reason;
    recallDetail.textContent=headline+'\n'+q.matchingTasks+' matching tasks · '+q.objectVotes+' consistent next-object votes · '+q.terminal+' terminal · '+q.unknown+' unknown · '+q.ambiguous+' ambiguous\n'
      +result.candidates.map(x=>x.spaceId+' / '+x.entityId+' · '+x.supportingTasks+'/'+q.matchingTasks+' historical task votes\n'+x.witnesses.map(w=>w.from.operationId+' → '+w.to.operationId+' · '+w.to.sourceId).join('\n')).join('\n')
      +'\nRetrospective: '+h.correct+'/'+h.evaluated+' suggested cases correct · '+h.abstained+' abstained of '+h.eligible+' eligible cases. Historical evidence only; no calibrated probability or action authority.';
  }));
  const reconcileTaskButton=button('Reconcile native receipts',taskRun(async()=>{await taskAdmin().reconcile();await refreshTasks();}));
  const pauseTaskButton=button('Detach selected agent from task',taskRun(async()=>{taskAdmin().pause(selectedAgent());await refreshTasks();}));
  const completeTaskButton=button('Complete selected task with confirmed receipts',taskRun(async()=>{
    const id=selectedTask(),task=journal?.tasks.find(t=>t.id===id);if(!task)throw Error('Refresh and review the saved task first.');
    await taskAdmin().complete(selectedAgent(),{taskId:id,epoch:task.epoch});await refreshTasks(id);
  }));
  const closeTaskButton=button('Close attached task journal',taskRun(async()=>{await taskAdmin().finish(selectedAgent());await refreshTasks();}));
  section.append(node('h4','Persistent agent task journal'),node('p','Use the active agent selector above. Only attached native world edits are journaled. Review receipts before handoff. An explicit handoff replaces the chosen agent’s task attachment without changing native grants. Unresolved object edits block other attached tasks. Detaching does not revoke native action permissions. No automatic replay or cloud sync. Prerequisites must be explicitly completed with confirmed native receipts. Closing a task without completion does not unblock its dependents.'),
    taskTitle,node('p','Optional prerequisites for a new task (select saved tasks first).'),prerequisitePicker,createTaskButton,taskPicker,refreshTaskButton,resumeTaskButton,handoffTaskButton,reconcileTaskButton,pauseTaskButton,completeTaskButton,closeTaskButton,taskStatus,taskDetail,node('h4','Mission agent recommendation'),node('p','Advisory only. Uses active native grants, local workload, task continuity, distinct related completed tasks, distinct related changed tasks and optional memory availability. Receipt volume is descriptive, not a ranking bonus. Approval attaches a task without granting action permissions.'),recommendTaskButton,approveTaskButton,recommendationDetail,node('h4','Collective mission experience'),node('p','Derived from recorded operations in this world and branch. Counts distinguish owner-completed contributions, unchanged receipts, unresolved outcomes and non-dispatch. These observations are not intelligence ratings or provider identity verification.'),experienceDetail,node('h4','Collective Neural Memory'),node('p','Select the current attached task and its active agent, then explicitly share completed source tasks. Exact object recall uses the existing four-bank numeric circuit; no model call, new permission or restored grant.'),evidencePicker,grantRecallButton,revokeRecallButton,recallSpace,recallEntity,queryRecallButton,node('p','Optional destination for association tracing. The result links recorded object observations and task prerequisites, not causes or instructions to repeat.'),traceSpace,traceEntity,queryTraceButton,node('p','Forecast next object uses the recall object as a cue. Requires at least three distinct completed tasks supporting the same next observation and a strict majority. Historical patterns are not predictions of successful actions.'),queryForecastButton,recallDetail,node('h4','Adaptive mission recovery'),node('p','Review the root causes blocking this task. Only an incomplete archive with no unresolved receipts can be reopened. The original task ID, prerequisites, receipts and source history remain intact. Review assignment separately after reopening.'),diagnoseTaskButton,recoveryDetail,recoveryReason,reopenTaskButton,node('h4','Shared mission plan'),node('p','One line per subtask: key | title | registered source ID | comma-separated prerequisite keys. Leave source blank to use the selected active agent. The example is a native-edit template, not AI-generated task decomposition. Review and save creates detached tasks only; each still uses the existing recommendation and receipt gates.'),planObjective,planLines,examplePlanButton,previewPlanButton,savePlanButton,planDetail,planSummary);
  for(const event of ['vivo:phone-statechange','vivo:phone-local-ready'])worldEvents?.addEventListener?.(event,invalidateTaskScope);
  invalidateTaskScope();
  refreshMemoryAgents();
  root.prepend(section);
  if(resumeSignIn)run(render)();
  return {section,refresh:render,openProviders:()=>{clearSelection();search.value='';renderProviders();search.focus();},dispose:()=>{disposed=true;selectionEpoch++;taskScopeEpoch++;memoryAccess()?.clear();globalThis.VivaPhoneAgentAdmin?.taskAccess?.clear();for(const event of ['vivo:phone-statechange','vivo:phone-local-ready'])worldEvents?.removeEventListener?.(event,invalidateTaskScope);section.remove();}};
}
export function installIntelligenceControls() {
  let mounted,observer;
  const attach=()=>{
    const root=document.querySelector('#panel .sheet[data-sheet="phone"]');
    if(!root||!globalThis.VivaPhoneEngine)return;
    if(!root.querySelector('#vivo-ai-accounts')){
      const returnURL=new URL(globalThis.location.href);
      const resumeSignIn=returnURL.searchParams.get('vivo-signin')==='complete';
      mounted=mountIntelligence({root,resumeSignIn});
      if(resumeSignIn){
        // The marker only opens the panel; the authenticated host supplies status.
        returnURL.searchParams.delete('vivo-signin');
        globalThis.history.replaceState(globalThis.history.state,'',returnURL.href);
        document.querySelector('#phonePanelButton')?.click();
        mounted?.section.scrollIntoView({block:'start'});
      }
    }
    const toolbar=document.querySelector('#toolbar');
    if(toolbar&&!document.querySelector('#vivoAIButton'))toolbar.append(button('AI & memory',()=>{
      document.querySelector('#phonePanelButton')?.click();
      document.querySelector('#vivo-ai-accounts')?.scrollIntoView({block:'start'});
    }));
    if(toolbar?.lastElementChild?.textContent==='AI & memory')toolbar.lastElementChild.id='vivoAIButton';
    if(mounted&&document.querySelector('#vivoAIButton'))observer?.disconnect();
  };
  observer=new MutationObserver(attach);observer.observe(document.body,{childList:true,subtree:true});attach();
  globalThis.addEventListener('vivo:phone-local-ready',attach);
  return ()=>{observer.disconnect();globalThis.removeEventListener('vivo:phone-local-ready',attach);mounted?.dispose();};
}
