import {ConstructiveMemory,exampleMemory} from './constructive-memory.mjs';
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
  navigate=url=>globalThis.location.assign(url),resumeSignIn=false,
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
  const ensureScope=()=>{const scope=getScope();if(memory&&JSON.stringify(memory.summary().scope)!==JSON.stringify(scope))memory=null;return scope;};
  section.append(records,button('Load synthetic example',memrun(()=>{
    const scope=ensureScope();records.value=JSON.stringify(exampleMemory(scope).checkpoint().records,null,2);out.textContent='Synthetic example loaded into editor, not saved.';
  })),button('Compile and save these weights',memrun(async()=>{
    const scope=ensureScope(),candidate=new ConstructiveMemory({scope,records:JSON.parse(records.value),revision:Date.now()});
    await store.save(scope,candidate.checkpoint());
    if(JSON.stringify(getScope())!==JSON.stringify(scope))throw Error('World changed; saved model remains scoped to its original world.');
    memory=candidate;out.textContent=JSON.stringify(candidate.summary(),null,2);
  })),button('Restore this world’s memory',memrun(async()=>{
    const scope=ensureScope(),p=await store.load(scope);if(!p)throw Error('No saved memory for this world/branch.');
    const candidate=ConstructiveMemory.restore(p);if(JSON.stringify(candidate.summary().scope)!==JSON.stringify(scope))throw Error('Stored memory scope does not match this world.');if(JSON.stringify(getScope())!==JSON.stringify(scope))throw Error('World changed while loading.');
    memory=candidate;records.value=JSON.stringify(p.records,null,2);out.textContent=JSON.stringify(candidate.summary(),null,2);
  })),start,path,button('Recall through the network',memrun(()=>{
    const scope=ensureScope();if(!memory)throw Error('Compile or restore this world’s memory first.');
    out.textContent=JSON.stringify(memory.query({scope,start:Number(start.value),path:path.value.split(',').map(Number)}),null,2);
  })),out);
  root.prepend(section);
  if(resumeSignIn)run(render)();
  return {section,refresh:render,openProviders:()=>{clearSelection();search.value='';renderProviders();search.focus();},dispose:()=>{disposed=true;selectionEpoch++;section.remove();}};
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
