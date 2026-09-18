import {summarizeMarket,createMarketBook} from '../domains/market-engine.js';

export function mountMarketBuilder({documentRoot,panel,getSource}) {
  // Minimal DOM fixtures intentionally omit native form APIs.
  if(!documentRoot.defaultView?.HTMLFormElement)return null;
  const root=documentRoot.createElement('details');root.id='market-builder';root.open=true;
  root.style.cssText='flex-shrink:0;padding:12px;border:1px solid #815267;border-radius:10px;background:#091521';
  const heading=documentRoot.createElement('summary');heading.textContent='Contract Workshop · personal markets, pools and child contracts';root.append(heading);
  const note=documentRoot.createElement('p');note.textContent='Your authored terms or a public sports observation. Shared records across normal and cube views; saved on this browser. Not shared accounts, authenticated people, wagering or settlement.';root.append(note);
  const sourceLink=documentRoot.createElement('a');sourceLink.href='?feature=multi-sport-events';sourceLink.textContent='Open all connected sports → choose a provider record → create contract';root.append(sourceLink);
  const form=documentRoot.createElement('form');form.style.cssText='display:grid;gap:8px';root.append(form);
  function field(title,tag='input',type='text') {
    const label=documentRoot.createElement('label');label.textContent=title;
    const control=documentRoot.createElement(tag);control.setAttribute('aria-label',title);if(tag==='input')control.type=type;
    control.style.cssText='display:block;width:100%;box-sizing:border-box;padding:8px;background:#0d2233;color:#eef6ff;border:1px solid #456175;border-radius:5px';label.append(control);form.append(label);return control;
  }
  function option(select,value,text){const o=documentRoot.createElement('option');o.value=value;o.textContent=text;select.append(o);}
  const origin=field('Source mode','select');option(origin,'authored','Personal · authored terms');option(origin,'provider','Selected public sports observation');
  const author=field('Creator label');author.maxLength=64;
  const parent=field('Parent contract','select');
  const kind=field('Contract type','select');for(const value of ['single','pool']){const o=documentRoot.createElement('option');o.value=value;o.textContent=value==='single'?'Single entry':'Pool · multiple local entries';kind.append(o);}
  const question=field('Your market question');question.maxLength=160;
  const terms=field('Terms and completion criteria','textarea');terms.maxLength=4000;
  const outcomes=field('Outcomes · one per line','textarea');outcomes.rows=3;
  const closes=field('Close entries at','input','datetime-local');
  const create=documentRoot.createElement('button');create.type='submit';create.textContent='Create rule-based market';form.append(create);
  const status=documentRoot.createElement('p');status.setAttribute('role','status');root.append(status);
  const list=documentRoot.createElement('div');root.append(list);
  let book,storageBlocked=false,selected=null,view=null;
  const storageKey='matumbo.contract-workshop.v1';
  try{book=createMarketBook(JSON.parse(documentRoot.defaultView.localStorage.getItem(storageKey)||'[]'));}catch{book=createMarketBook();storageBlocked=true;status.textContent='Saved workspace could not be read; existing storage will not be overwritten. Export new work before leaving.';}
  let markets=book.snapshot();
  const viewport=documentRoot.createElement('div');viewport.style.cssText='height:320px;position:relative;overflow:hidden;border:1px solid #456175';viewport.hidden=true;root.insertBefore(viewport,list);
  const controls=documentRoot.createElement('div');root.insertBefore(controls,viewport);
  const workspace=documentRoot.createElement('div');workspace.className='contract-workshop-layout';root.append(workspace);workspace.append(form,controls,viewport,list);form.className='contract-workshop-form';controls.className='contract-workshop-controls';viewport.className='contract-workshop-viewport';list.className='contract-workshop-records';
  const styles=documentRoot.createElement('style');styles.textContent=`
    #contracts-markets-console:has(#market-builder){width:min(1120px,calc(100vw - 32px))!important;max-width:calc(100vw - 24px)!important;}
    #market-builder{color:#e5eff9;font:14px/1.5 system-ui;border-color:#8d764f!important;background:linear-gradient(140deg,#112637,#081321)!important;}
    #market-builder summary{font-size:20px;font-weight:650;color:#f1d4a1;cursor:pointer;}
    #market-builder a{color:#83d7fa;}
    #market-builder button{background:#16384b;color:#f0e3c7;border:1px solid #4a6d7c;border-radius:6px;padding:9px 12px;cursor:pointer;min-height:44px;}
    #market-builder button:hover,#market-builder button:focus-visible{background:#25506a;outline:2px solid #d7b673;outline-offset:2px;}
    #market-builder input,#market-builder select{max-width:100%;box-sizing:border-box;background:#0d2233;color:#edf6ff;border:1px solid #547084;border-radius:5px;padding:8px;}
    .contract-workshop-layout{display:grid;grid-template-columns:minmax(230px,320px) minmax(0,1fr);gap:12px;align-items:start;}
    .contract-workshop-form{grid-column:1;grid-row:1 / span 3;}
    .contract-workshop-controls{grid-column:2;grid-row:1;}
    .contract-workshop-viewport{grid-column:2;grid-row:2;background:radial-gradient(ellipse at center,#183b58,#06101e);}
    .contract-workshop-records{grid-column:2;grid-row:3;max-height:420px;overflow:auto;overflow-wrap:anywhere;padding:0 8px;}
    @media(max-width:700px){.contract-workshop-layout{display:flex;flex-direction:column}.contract-workshop-layout>*{width:100%;box-sizing:border-box}.contract-workshop-records{max-height:none;overflow:visible}}
  `;root.append(styles);
  action('Normal view',()=>{viewport.hidden=true;view?.setVisible(false);},controls);
  action('Export workspace',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(book.snapshot(),null,2)],{type:'application/json'}));const link=documentRoot.createElement('a');link.href=url;link.download='matumbo-contract-workspace.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},controls);
  action('Cube view',()=>{viewport.hidden=false;if(view){view.setVisible(true);return;}status.textContent='Loading contract geometry…';import('./market-constellation.js').then(({mountMarketConstellation})=>{if(!view)view=mountMarketConstellation({host:viewport,onSelect:id=>{selected=id;render();list.querySelector('[data-selected="true"]')?.scrollIntoView({block:'nearest'});}});view.update(markets,selected);}).catch(error=>{viewport.hidden=true;status.textContent='3D unavailable: '+error.message;});},controls);
  book.subscribe(records=>{markets=records;try{if(storageBlocked)throw Error();documentRoot.defaultView.localStorage.setItem(storageKey,JSON.stringify(records));}catch{storageBlocked=true;}root.dataset.previewDirty=storageBlocked?'true':'false';render();});
  function action(title,fn,parent) {const b=documentRoot.createElement('button');b.type='button';b.textContent=title;b.style.cssText='margin:4px;min-height:44px';b.onclick=()=>{try{fn();status.textContent=storageBlocked?'Storage unavailable: export work before leaving.':'Saved on this browser · both views use the same records';render();}catch(e){status.textContent=e.message;}};parent.append(b);}
  function render(){
    list.replaceChildren();
    const oldParent=parent.value;parent.replaceChildren();option(parent,'','No parent · root contract');for(const m of markets)option(parent,m.id,m.question);parent.value=markets.some(m=>m.id===oldParent)?oldParent:'';
    if(!markets.length){const empty=documentRoot.createElement('p');empty.textContent='No contracts yet. Personal contracts do not require a sports record.';list.append(empty);}
    for(const market of markets){
      const card=documentRoot.createElement('section');card.style.cssText='border-top:1px solid #486176;padding:10px 0';
      const title=documentRoot.createElement('h3');title.textContent=market.question;card.append(title);
      card.dataset.contractId=market.id;card.dataset.selected=String(selected===market.id);if(selected===market.id)card.style.border='1px solid #e6bc73';
      action('Inspect cube',()=>{selected=market.id;},card);
      const provenance=documentRoot.createElement(market.source.sourceUrl?'a':'p');if(market.source.sourceUrl){provenance.href=market.source.sourceUrl;provenance.target='_blank';provenance.rel='noopener noreferrer';}provenance.textContent=market.source.title+' · '+market.source.provider;card.append(provenance);
      const description=documentRoot.createElement('p');description.textContent=market.terms;card.append(description);
      if(market.parentId){const p=markets.find(m=>m.id===market.parentId);action('↑ Parent: '+p.question,()=>{selected=p.id;},card);}
      for(const child of markets.filter(m=>m.parentId===market.id))action('↳ Child: '+child.question,()=>{selected=child.id;},card);
      action('Create child contract',()=>{parent.value=market.id;closes.value=new Date(Date.parse(market.closesAt)-new Date(market.closesAt).getTimezoneOffset()*60000).toISOString().slice(0,16);question.value='';question.focus();form.scrollIntoView({block:'nearest'});},card);
      const stats=documentRoot.createElement('p');const s=summarizeMarket(market);stats.textContent=`${market.kind} · ${s.state} · ${s.participants} local entries · ${s.outcomes.map(o=>o.outcome+': '+o.entries).join(' / ')}`;card.append(stats);
      const name=documentRoot.createElement('input');name.placeholder='Local participant label';name.setAttribute('aria-label','Local participant label');name.maxLength=64;card.append(name);
      const choice=documentRoot.createElement('select');choice.setAttribute('aria-label','Entry outcome');for(const value of market.outcomes){const o=documentRoot.createElement('option');o.textContent=value;choice.append(o);}card.append(choice);
      action('Add local entry',()=>book.enter(market.id,{participant:name.value,outcome:choice.value}),card);
      action('Close entries',()=>book.close(market.id),card);
      action('Export rules + entries',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(market,null,2)],{type:'application/json'}));const a=documentRoot.createElement('a');a.href=url;a.download='matumbo-local-market.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},card);
      list.append(card);
    }
    view?.update(markets,selected);
  }
  form.addEventListener('submit',e=>{e.preventDefault();try{
    const market=book.create({id:crypto.randomUUID(),origin:origin.value,author:author.value,terms:terms.value,parentId:parent.value||null,source:getSource(),kind:kind.value,question:question.value,outcomes:outcomes.value.split('\n').map(v=>v.trim()).filter(Boolean),closesAt:closes.value});
    selected=market.id;status.textContent=storageBlocked?'Created, but storage unavailable. Export before leaving.':'Contract created and saved on this browser.';render();
  }catch(error){status.textContent=error.message;}});
  const legacy=documentRoot.createElement('details');const legacyTitle=documentRoot.createElement('summary');legacyTitle.textContent='Earlier scenario inspector and provider draft tools';legacy.append(legacyTitle);
  const header=documentRoot.getElementById('contracts-markets-head');
  for(const child of [...panel.children])if(child!==header)legacy.append(child);
  panel.append(root,legacy);
  render();const api={getSnapshot:()=>structuredClone(markets),getSelection:()=>selected,getCubeSnapshot:()=>view?.getSnapshot()??null};documentRoot.defaultView.__TUMBO_MARKET_WORKSHOP__=api;return api;
}
