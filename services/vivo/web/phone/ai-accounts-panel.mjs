import {ConstructiveMemory,exampleMemory} from './constructive-memory.mjs';
/** Native Vivo controls extension. No second world, password inputs, or auto-login. */
const API='/api/vivo/accounts';
const message=e=>typeof e?.message==='string'?e.message:'Operation failed';
const node=(tag,text)=>Object.assign(document.createElement(tag),text===undefined?{}:{textContent:text});
const button=(text,fn)=>{const b=node('button',text);b.type='button';b.onclick=fn;return b;};
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
  getScope=()=>{
    const e=globalThis.VivaPhoneEngine?.publishedSnapshot?.();
    if(!globalThis.VivaPhoneEngine?.active||!e?.snapshot?.worldId)throw Error('Enter the existing local Vivo world first.');
    return {worldId:e.snapshot.worldId,projectId:e.branchId||'local'};
  }}={}) {
  if(!root||root.querySelector('#vivo-ai-accounts'))return null;
  const section=node('section');section.id='vivo-ai-accounts';section.tabIndex=-1;
  section.append(node('h3','AI accounts and constructed memory'));
  section.append(node('p','Connect accounts explicitly. Login is not an agent, chat-history import, or permission to edit your world.'));
  const state=node('p','Account host not checked. No provider has been contacted.');state.setAttribute('role','status');state.id='vivoAccountStatus';
  const rows=node('div'),provider=node('select');provider.id='vivoAccountProvider';provider.setAttribute('aria-label','Provider');
  for(const [value,label] of [['openai','ChatGPT plan access'],['claude','Claude native runtime (not configured)'],['hermes','Hermes session (not configured)'],['grok','Grok session (not configured)'],['muse','Muse session (unavailable)'],['dot','matumbo dot session (unavailable)']]){
    const o=node('option',label);o.value=value;provider.append(o);}
  const label=node('input');label.placeholder='Account label, e.g. Personal';label.maxLength=60;label.id='vivoAccountLabel';label.setAttribute('aria-label','Account label');
  const loginArea=node('div');let busy=false;
  const api=async(path='',body)=>{
    const response=await request(API+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
      headers:body?{'Content-Type':'application/json','X-Vivo-Action':'user'}:{},body:body?JSON.stringify(body):undefined});
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{throw Error('No Vivo account host at this origin. GitHub Pages cannot run the OAuth credential host.');}
    if(!response.ok)throw Error(data.error||'Account operation failed');return data;
  };
  const run=fn=>async()=>{if(busy)return;busy=true;state.textContent='Working…';try{await fn();}catch(e){state.textContent=message(e);}finally{busy=false;}};
  const offerLogin=async connectionId=>{
    if(provider.value!=='openai'&&!connectionId)throw Error('This provider requires its own supported runtime adapter. No invented sign-in or token collection.');
    const result=await api('/login',{label:label.value.trim()||'ChatGPT account',connectionId});
    const url=new URL(result.authorizationUrl);
    if(url.origin!=='https://auth.openai.com'||url.pathname!=='/api/accounts/authorize')throw Error('Unexpected sign-in destination.');
    loginArea.replaceChildren();const link=node('a','Continue with ChatGPT');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';
    loginArea.append(link,node('p','Sign in and approve on OpenAI’s page. This attempt expires in five minutes. Return here and refresh afterward.'));
    state.textContent='Awaiting your provider sign-in. No account is connected yet.';
  };
  const render=async()=>{
    const data=await api();rows.replaceChildren();state.textContent=`${data.connections.length} saved connection(s). Status is separate for every account.`;
    for(const c of data.connections){
      const row=node('fieldset');row.append(node('legend',c.label),node('p',`${c.provider} · ${c.status}${data.default===c.id?' · default for new work':''}`),node('p',`${c.accountHint||'Identity unavailable'} · registration ${c.registrationHint||'unknown'}`),node('p',c.message||''));
      const actions=node('div');actions.className='row';
      actions.append(button('Use for new work',run(async()=>{await api('/default',{connectionId:c.id});await render();})),
        button('Reconnect',run(()=>offerLogin(c.id))),
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
  section.append(provider,label,button('Add another account',run(()=>offerLogin(null))),button('Refresh account status',run(render)),state,loginArea,rows);
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
  return {section,refresh:render,dispose:()=>section.remove()};
}
export function installIntelligenceControls() {
  let mounted,observer;
  const attach=()=>{
    const root=document.querySelector('#panel .sheet[data-sheet="phone"]');
    if(!root||!globalThis.VivaPhoneEngine)return;
    if(!root.querySelector('#vivo-ai-accounts'))mounted=mountIntelligence({root});
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
