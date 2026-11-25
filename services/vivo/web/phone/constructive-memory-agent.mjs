/** Host-owned bridge between the existing memory lab and native agent tools.
 * No new checkpoint store, world, credential, model, or remote service.
 * The trusted host publishes a compiled/restored instance and grants an exact
 * native session. Only the numeric recall tool is exposed to that session.
 */
import {ConstructiveMemory} from './constructive-memory.mjs';
import {VivoConvergenceAdapter} from './convergence-adapter.mjs';
const TOOL='neural.predict';
const failure=code=>Object.assign(new Error(code),{code});
const same=(a,b)=>!!a&&!!b&&a.worldId===b.worldId&&a.projectId===b.projectId;
const pin=a=>Object.freeze({sourceId:a.sourceId,sessionId:a.sessionId,generation:a.generation});
const equal=(a,b)=>!!a&&!!b&&a.sessionId===b.sessionId&&a.generation===b.generation&&a.sourceId===b.sourceId;
const description='Read the explicitly shared numeric memory circuit. Arguments: start (16-bit address), path (1–32 relation banks, each 0–3). No action authority.';

export function createConstructiveMemoryAgentBridge({registry,getScope}) {
  if(typeof getScope!=='function')throw failure('SCOPE_RESOLVER_REQUIRED');
  let memory=null,scope=null;
  const grants=new Map();
  const active=session=>pin(registry.agentController.assertActive(session));
  function drop(sessionId) {
    const row=grants.get(sessionId);
    if(row){grants.delete(sessionId);adapter.detach(row.ref);}
  }
  function revokeAll(){for(const id of grants.keys())drop(id);}
  function clear(){revokeAll();memory=null;scope=null;}
  function syncScope(){
    if(!memory)return false;
    try {if(same(scope,getScope()))return true;}catch{}
    clear();return false;
  }
  function prune(){
    for(const [id,row] of grants){
      try{if(equal(active(row.agent),row.agent))continue;}catch{}
      drop(id);
    }
  }
  function grantFor(agent){
    if(!syncScope())return null;
    const row=grants.get(agent?.sessionId);
    if(!row||!equal(agent,row.agent))return null;
    try{if(equal(active(row.agent),row.agent))return row;}catch{}
    drop(row.agent.sessionId);return null;
  }
  const transport={
    supports(name,agent){return name===TOOL&&!!grantFor(agent);},
    invoke(name,args,{agent,signal}){
      if(signal.aborted||name!==TOOL||!grantFor(agent))throw failure('TOOL_NOT_GRANTED');
      if(Object.keys(args).length!==2||!Object.hasOwn(args,'start')||!Object.hasOwn(args,'path'))throw failure('INVALID_ARGUMENTS');
      // Caller may choose addresses, never scope, checkpoint, identity or permissions.
      const result=memory.query({scope,start:args.start,path:args.path});
      return {schema:'vivo.constructed-memory-agent-result/1',scope:{...scope},readOnly:true,...result};
    },
  };
  const adapter=new VivoConvergenceAdapter({registry,transport});
  function publish(candidate){
    if(!(candidate instanceof ConstructiveMemory))throw failure('EXISTING_MEMORY_REQUIRED');
    const selected=candidate.summary().scope;
    if(!same(selected,getScope()))throw failure('SCOPE_MISMATCH');
    // A different revision or restored checkpoint needs fresh explicit consent.
    clear();memory=candidate;scope=Object.freeze({...selected});
  }
  function grant(session){
    if(!syncScope())throw failure('MEMORY_NOT_MOUNTED');
    const agent=active(session);prune();
    if(!grants.has(agent.sessionId))grants.set(agent.sessionId,{agent,ref:adapter.attach(agent,['neural.lab'])});
    return {sourceId:agent.sourceId,generation:agent.generation,scope:{...scope},revision:memory.summary().revision};
  }
  function revoke(session){
    const id=typeof session==='string'?session:session?.sessionId;
    if(typeof id==='string')drop(id);
  }
  function status(){
    syncScope();prune();
    return {mounted:!!memory,scope:scope?{...scope}:null,revision:memory?.summary().revision??null,granted:[...grants.values()].map(r=>({...r.agent}))};
  }
  function listFor(session){
    const tools=registry.listFor(session);
    try{if(grantFor(active(session)))return [...tools,{name:TOOL,description}];}catch{}
    return tools;
  }
  async function invokeFor(session,name,args={}){
    if(name!==TOOL)return registry.invokeFor(session,name,args);
    const row=grantFor(active(session));
    if(!row)throw failure('TOOL_NOT_GRANTED');
    return adapter.invoke(row.ref,name,args);
  }
  return Object.freeze({tools:Object.freeze({listFor,invokeFor}),admin:Object.freeze({publish,grant,revoke,revokeAll,clear,status}),syncScope});
}
