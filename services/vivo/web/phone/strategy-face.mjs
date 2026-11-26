/** Strategy on the existing Station owner face; only the real broker calculates a plan. */
export function createStrategyFace({doc,request,refresh,report}) {
  const el=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const root=el('details');root.hidden=true;root.dataset.stationStrategy='true';
  root.append(el('summary','Strategy · mission dependencies'));
  const intro=el('p','Compare two to eight existing unused missions. Enter your estimates and review dependencies. A preview is not a reservation, execution, or a guaranteed deadline.');
  const roster=el('ul');roster.setAttribute('aria-label','Eligible missions');
  const editor=el('textarea');editor.setAttribute('aria-label','Strategy request JSON');editor.rows=12;editor.maxLength=32000;
  const label=el('label','Strategy request (JSON; edit all estimates) ');label.append(editor);
  const make=el('button','Prepare request from selected missions');make.type='button';
  const compare=el('button','Compare strategy with Station');compare.type='button';
  const results=el('section');results.dataset.strategyResults='true';results.setAttribute('aria-live','polite');
  root.append(intro,roster,make,label,compare,results);
  let generation=0,active=false,world='',people=[],missions=[],pinned=null,committing=false;
  function invalidate(){generation++;pinned=null;results.replaceChildren();}
  editor.oninput=invalidate;
  function error(e){report(String(e?.message||'Strategy unavailable'));}
  function eligible(m){return m.world===world&&m.phase==='assigned'&&m.lease_epoch===0&&m.lease_until==null&&people.some(a=>a.id===m.agent&&a.active);}
  function render(data){
    const same=active&&world===data.world;active=true;root.hidden=false;world=data.world;people=data.agents;missions=data.missions;
    const selected=new Set([...roster.querySelectorAll('input:checked')].map(n=>n.value));
    invalidate();if(!same){editor.value='';root.open=false;}
    roster.replaceChildren();
    for(const m of missions.filter(eligible)){
      const item=el('li'),check=el('input');check.type='checkbox';check.value=m.id;check.checked=same&&selected.has(m.id);check.setAttribute('aria-label','Select mission '+m.objective);
      const l=el('label',m.objective+' · '+(people.find(a=>a.id===m.agent)?.label||'Assigned agent'));l.prepend(check);item.append(l);roster.append(item);
    }
    make.disabled=missions.filter(eligible).length<2;compare.disabled=committing;
  }
  make.onclick=()=>{try{
    const ids=[...roster.querySelectorAll('input:checked')].map(n=>n.value);if(ids.length<2||ids.length>8)throw Error('Select two to eight required missions');
    const selected=ids.map(id=>missions.find(m=>m.id===id&&eligible(m)));if(selected.some(m=>!m))throw Error('Refresh and select current eligible missions');
    // Deliberately leave root, dependency edges and all estimates unset: no invented dependencies.
    const requestBody={id:null,tasks:selected.map(m=>({id:m.id,expected_revision:m.revision,minutes:{optimistic:null,nominal:null,conservative:null},units:null})),availability:[...new Set(selected.map(m=>m.agent))].map(agent=>({agent,available_after_minutes:null})),alternatives:[{name:'Reviewed plan A',nodes:selected.map(m=>({id:m.id,requires:[]})),max_parallel:null,overhead_units:null}],deadline_minutes:null,budget_units:null};
    invalidate();editor.value=JSON.stringify(requestBody,null,2);report('Template only. Enter the final mission ID, exact dependencies, and all estimates. Duplicate an alternative to compare up to four.');editor.focus();
  }catch(e){error(e);}};
  compare.onclick=async()=>{if(!active||committing)return;invalidate();const version=generation,raw=editor.value;compare.disabled=true;try{
    const b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b)||!Array.isArray(b.tasks)||!b.tasks.every(t=>missions.some(m=>eligible(m)&&m.id===t.id&&m.revision===t.expected_revision)))throw Error('Use the current same-world mission IDs and revisions');
    const answer=await request('/v1/owner/continuity/strategy/compare',b);if(!active||version!==generation||editor.value!==raw)return;
    if(answer?.schema!=='matumbo.mission.strategy/1'||answer.root!==b.id||!Array.isArray(answer.plans)||!answer.plans.length||!/^[a-f0-9]{64}$/.test(answer.plan_sha256))throw Error('Connected broker does not provide a valid v0.12 strategy result');
    const result=structuredClone(answer);pinned={raw,version,result};results.append(el('p','Actual Station result: '+result.decision+(result.recommended?' · '+result.recommended:'')),el('p','Preview SHA-256: '+result.plan_sha256));
    const assumptions=el('ul');for(const a of result.assumptions||[])assumptions.append(el('li',a));results.append(assumptions);
    for(const plan of result.plans){
      const card=el('article');card.append(el('h5',plan.name),el('p',plan.status+' · estimated units '+plan.estimated_units),el('p','Optimistic / nominal / conservative minutes: '+['optimistic','nominal','conservative'].map(k=>plan.scenarios[k].finish_minutes).join(' / ')));
      const edges=el('ul');for(const n of plan.organization_setup.nodes){const name=missions.find(m=>m.id===n.id)?.objective||n.id;edges.append(el('li',name+' requires '+(n.requires.map(id=>missions.find(m=>m.id===id)?.objective||id).join(', ')||'nothing')+' · rev '+n.expected_revision));}card.append(edges);
      const stage=el('button','Review '+plan.name);stage.type='button';const detail=el('section');detail.hidden=true;detail.dataset.strategyReview='true';card.append(stage,detail);results.append(card);
      stage.onclick=()=>{if(pinned?.version!==version||editor.value!==raw)return;
        for(const node of results.querySelectorAll('[data-strategy-review]')){node.hidden=true;node.replaceChildren();}
        detail.hidden=false;const graph=structuredClone(plan.organization_setup);const rid=doc.defaultView.crypto.randomUUID();const exact=el('pre',JSON.stringify(graph,null,2));exact.style.whiteSpace='pre-wrap';exact.style.overflowWrap='anywhere';
        const approve=el('button','Configure reviewed graph');approve.type='button';const back=el('button','Return to strategies');back.type='button';
        detail.append(el('p','This creates an immutable dependency graph for these exact mission revisions. No task is dispatched. Review every edge before confirming.'),exact,approve,back);back.onclick=()=>{detail.hidden=true;detail.replaceChildren();};approve.focus();
        approve.onclick=async()=>{if(!active||committing||!approve.isConnected||detail.hidden||pinned?.version!==version||editor.value!==raw)return;committing=true;approve.disabled=true;compare.disabled=true;try{
          const receipt=await request('/v1/owner/continuity/organization/set',{...graph,request_id:rid});if(!active||version!==generation)return;invalidate();report('Graph configured at revision '+receipt.applied_revision+'; no work was dispatched.');await refresh();
        }catch(e){if(active&&version===generation)error(e);}finally{committing=false;if(active){compare.disabled=false;if(approve.isConnected)approve.disabled=false;}}};
      };
    }
  }catch(e){if(active&&version===generation)error(e);}finally{if(active)compare.disabled=false;}};
  function clear(){active=false;world='';people=[];missions=[];invalidate();root.hidden=true;root.open=false;editor.value='';roster.replaceChildren();}
  return {element:root,render,clear};
}
