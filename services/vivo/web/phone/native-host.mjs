// Explicit owner-side adapter for the existing Vivo local session interfaces.
// Import into a trusted Vivo page and bind only on a human's deliberate action.
export function createVivoStationHost({base='http://127.0.0.1:18761',hostToken,worldId,tools=globalThis.VivaAgentTools,admin=globalThis.VivaPhoneAgentAdmin,fetcher=globalThis.fetch,interval=1500,onEvent=()=>{}}){
  const url=new URL(base);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.username||url.password)throw Error('Local loopback Station only');
  if(!hostToken||!worldId||!tools?.invokeFor||!tools?.listFor||!admin?.register||!admin?.stop||!admin?.agents)throw Error('Native Vivo registry and owner host credential required');
  const sessions=new Map();let stopped=false,timer=null,busy=false;
  const CAP={'vivo.world.read':'world.read','vivo.world.edit':'world.edit'};
  async function request(path,body){const r=await fetcher(url.origin+path,{method:'POST',credentials:'omit',redirect:'error',headers:{Authorization:'Bearer '+hostToken,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Station HTTP '+r.status);return r.json();}
  function bind({id,label,capabilities}){
    if(stopped)throw Error('Host stopped');if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw Error('Invalid Station agent');
    const sourceId='station:'+id;if(sessions.has(id))throw Error('Agent already bound');
    const prior=admin.agents().find(r=>r.sourceId===sourceId);if(prior)throw Error('Native source already exists; owner must explicitly resolve or re-enable it');
    if(!Array.isArray(capabilities)||capabilities.some(x=>!Object.values(CAP).includes(x)&&!['memory.mission.read','mission.continue'].includes(x)))throw Error('Invalid grant');
    const nativeCaps=capabilities.filter(x=>Object.values(CAP).includes(x));
    if(!nativeCaps.length)throw Error('No native world grant; memory-only agents do not bind a native session');
    const session=admin.register({sourceId,label:String(label||id).slice(0,100),capabilities:nativeCaps});
    if(session?.status!=='active'||session.sourceId!==sourceId||!session.sessionId)throw Error('Native session not registered');sessions.set(id,session);return {id,status:'bound',sourceId};
  }
  async function tick(){
    if(stopped||busy)return;busy=true;
    try{
      const ready=[...sessions.keys()].filter(id=>{const s=sessions.get(id);return admin.agents().some(a=>a.sessionId===s.sessionId&&a.status==='active');});
      const {job,stopped:revoked=[]}=await request('/v1/host/poll',{world:worldId,ready_agents:ready});
      for(const id of revoked){const s=sessions.get(id);if(s){sessions.delete(id);try{await admin.stop(s,'station-revoked');}catch{}onEvent({agent:id,state:'stopped'});}}
      if(!job)return;
      const s=sessions.get(job.agent);let result,outcome='rejected';
      if(stopped||!s||!CAP[job.tool]||!job.capabilities.includes(CAP[job.tool])||!tools.listFor(s).some(t=>t.name===job.tool)){result={code:'NATIVE_GRANT_MISSING'};}
      else if(job.tool==='vivo.world.edit'&&job.args.worldId!==worldId){result={code:'WRONG_WORLD'};}
      else {
        try{
          result=await tools.invokeFor(s,job.tool,job.args);
          if(job.tool==='vivo.world.read')outcome=result?.snapshot?.worldId===worldId?'completed':'rejected';
          else outcome=result?.status==='accepted'?'completed':(['rejected','cancelled-before-submission'].includes(result?.status)?'rejected':'uncertain');
        }catch(e){result={code:e?.code||'NATIVE_TOOL_FAILED'};outcome=job.tool==='vivo.world.edit'?'uncertain':'rejected';}
      }
      // Failed receipt delivery never causes automatic replay.
      await request('/v1/host/result',{id:job.id,claim:job.claim,outcome,result});onEvent({id:job.id,agent:job.agent,state:outcome});
    }catch(e){onEvent({state:'connection-error',message:String(e.message)});}finally{busy=false;}
  }
  function start(){if(stopped)throw Error('Host stopped');if(!timer){timer=setInterval(tick,interval);void tick();}}
  async function stop(){stopped=true;clearInterval(timer);timer=null;const existing=[...sessions.values()];sessions.clear();await Promise.allSettled(existing.map(s=>admin.stop(s,'station-host-stop')));}
  return Object.freeze({bind,tick,start,stop,agents:()=>[...sessions.keys()]});
}
