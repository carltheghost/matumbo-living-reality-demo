/** Explicit lab host; never mount this fixture automatically in the live phone app. */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LocalVivoEngine} from '../../services/vivo/web/phone/engine.mjs';
import {LocalAgentController} from '../../services/vivo/web/phone/agent-control.mjs';
import {AgentToolRegistry} from '../../services/vivo/web/phone/agent-tools.mjs';
import {VivoConvergenceAdapter} from '../../services/vivo/web/phone/convergence-adapter.mjs';
import {createSimulatedEconomy} from '../../services/vivo/web/phone/vendor/economy/src/domains/simulated-economy.js';
import {CausalCooperationLoop,frameOf,policyFrom} from './cooperation.mjs';
const error=code=>Object.assign(new Error(code),{code});
const need=(test,code)=>{if(!test)throw error(code);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
let economyOwner;
export function labEconomy(){return economyOwner??=createSimulatedEconomy({storage:null,seedLiquidity:false});}
export class FileWorldStore {
  constructor(root){this.root=resolve(root);}
  path(id){need(/^[A-Za-z0-9_.:-]{1,128}$/.test(id),'INVALID_WORLD_ID');return resolve(this.root,encodeURIComponent(id)+'.json');}
  async load(id){try{return JSON.parse(await readFile(this.path(id),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  async save(id,value){await mkdir(this.root,{recursive:true});const path=this.path(id),tmp=path+'.'+crypto.randomUUID()+'.tmp';
    await writeFile(tmp,JSON.stringify(value),{flag:'wx'});await rename(tmp,path);return {persistent:true};}
}
export class PythonProvider {
  constructor({bundle,state,python=process.env.PYTHON||'python'}) {
    this.pending=new Map();this.serial=0;this.calls=[];this.closed=false;this.stderr='';
    this.child=spawn(python,[fileURLToPath(new URL('./neural_host.py',import.meta.url)),'--bundle',resolve(bundle),'--state',resolve(state)],{stdio:['pipe','pipe','pipe']});
    this.reader=createInterface({input:this.child.stdout});
    const failAll=err=>{for(const p of this.pending.values())p.reject(err);this.pending.clear();};
    this.child.on('error',failAll);
    this.exit=new Promise(res=>this.child.on('exit',(code,signal)=>{this.closed=true;failAll(error('PROVIDER_EXITED'));res({code,signal});}));
    this.child.stderr.on('data',buf=>{this.stderr=(this.stderr+buf.toString()).slice(-10000);});
    this.reader.on('line',line=>{
      try{need(line.length<1000000,'RESPONSE_TOO_LARGE');const msg=JSON.parse(line),p=this.pending.get(msg.id);
        if(!p)return;this.pending.delete(msg.id);msg.error?p.reject(error(msg.error)):p.resolve(msg.result);
      }catch(e){failAll(e);}
    });
  }
  invoke(tool,args,{signal}={}) {
    need(!this.closed,'PROVIDER_CLOSED');this.calls.push({tool,args:structuredClone(args)});
    return new Promise((resolvePromise,rejectPromise)=>{
      const id=++this.serial;let timer;
      const finish=fn=>value=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.pending.delete(id);fn(value);};
      const abort=()=>finish(rejectPromise)(error('PROVIDER_ABORTED'));
      if(signal?.aborted){abort();return;}
      signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>finish(rejectPromise)(error('PROVIDER_DEADLINE')),15000);
      this.pending.set(id,{resolve:finish(resolvePromise),reject:finish(rejectPromise)});
      this.child.stdin.write(JSON.stringify({id,tool,args})+'\n',e=>{if(e)finish(rejectPromise)(e);});
    });
  }
  async close(){if(!this.closed)this.child.stdin.end();const result=await this.exit;this.reader.close();return result;}
}
export async function createFixture({state,dimension=4,query=0,axis=dimension-1,now=()=>Date.now()}={}) {
  const storage=new FileWorldStore(state),engine=new LocalVivoEngine({storage,now});
  await engine.open('lab.'+crypto.randomUUID(),dimension);
  // Set the probe through the native edit path, not by fabricating a model input.
  const probe=frameOf(engine.snapshot(),'workpiece'),delta=Array(dimension).fill(0);
  delta[axis]=(query===1?.25:-.25)-probe.q[axis];
  await engine.applyLocalTransform('workpiece',delta,null,{...probe,baseRevision:probe.revision,operationId:'sensor.'+crypto.randomUUID()});
  const frame=frameOf(engine.snapshot(),'relic'),economy=labEconomy();
  const policy={schema:'vivo.cooperation.policy/1',labOnly:true,worldId:frame.worldId,branchId:frame.branchId,
    spaceId:frame.spaceId,entityId:'relic',probeId:'workpiece',axis,dimension,step:.25,
    expiresAt:now()+60000,allowedChoices:[0,1]};
  const {contract}=economy.createContract({title:'Synthetic cooperation lab',amountFluff:0,
    terms:JSON.stringify({s:'coop-lab/1',w:policy.worldId,b:policy.branchId,r:policy.spaceId,e:policy.entityId,
      p:policy.probeId,a:policy.axis,d:policy.dimension,t:policy.step,x:policy.expiresAt,c:policy.allowedChoices}),idempotencyKey:crypto.randomUUID()});
  return {engine,storage,economy,policy,contract,dimension,axis};
}
export async function connectLab({engine,economy,contract,provider,mode='intact',sourceId='cooperation-lab',
  labWriteEnabled=false,timeoutMs=5000,now=()=>Date.now(),measureOverride=null,commitOverride=null}={}) {
  need(engine&&economy&&provider,'EXISTING_OWNERS_REQUIRED');
  let revoked=false;const approved=new Map();
  const inspection=()=>({contracts:economy.contracts(),verification:economy.verify(),simulation:true,readOnly:true});
  const controller=new LocalAgentController({snapshot:()=>engine.snapshot(),now,
    applyTransform:(entityId,delta,geometry,expected)=>{
      need(labWriteEnabled&&!revoked,'LAB_WRITE_NOT_GRANTED');
      const binding=approved.get(expected.operationId);need(binding,'UNAPPROVED_OPERATION');
      const {contract:current,policy}=policyFrom(inspection(),contract.id);
      need(current.revision===binding.contractRevision&&current.terms===binding.contractTerms,'CONTRACT_CHANGED_AT_ACCEPTANCE');
      need(now()<policy.expiresAt,'POLICY_EXPIRED');
      const live=frameOf(engine.snapshot(),entityId),probe=frameOf(engine.snapshot(),policy.probeId);
      need(same(live,binding.frame)&&same(probe,binding.probe),'WORLD_CHANGED_AT_ACCEPTANCE');
      need(entityId===policy.entityId&&delta.length===policy.dimension&&
        delta.every((x,i)=>i===policy.axis?Math.abs(x)===policy.step:x===0),'ACTION_OUTSIDE_POLICY');
      const choice=delta[policy.axis]>0?1:0;need(policy.allowedChoices.includes(choice),'CHOICE_NOT_PERMITTED');
      return engine.applyLocalTransform(entityId,delta,geometry,expected);
    }});
  const registry=new AgentToolRegistry({agentController:controller,bridge:{invokeLocal:(n,a,c)=>controller.invokeTool(c.session,n,a)}});
  await registry.setLocalCapabilities(labWriteEnabled?['world.read','world.edit']:['world.read']);
  const native=registry.registerAgent({sourceId,capabilities:labWriteEnabled?['world.read','world.edit']:['world.read']});
  let lastNeural=null;
  const transport={invoke:async(name,args,options)=>{
    const result=await (name==='neural.predict'?provider.invoke('lab.predict',{input:args.input,mode},options):provider.invoke(name,args,options));
    if(name==='neural.predict')lastNeural=structuredClone(result);return result;
  }};
  const adapter=new VivoConvergenceAdapter({registry,economy,transport,timeoutMs});
  const session=adapter.attach(native,['memory.read','contracts.read','neural.lab']);
  const measure=async(frame,axis)=>{
    const actual=frameOf(engine.snapshot(),frame.entityId);
    return {schema:'vivo.cooperation.measurement/1',frame:actual,query:Number(actual.q[axis]>0)};
  };
  const commit=async(command,binding,options)=>{
    need(labWriteEnabled&&!revoked,'LAB_WRITE_NOT_GRANTED');need(!options.signal.aborted,'SOURCE_STOPPED');
    need(!approved.has(command.operationId),'DUPLICATE_APPROVAL');approved.set(command.operationId,binding);
    return adapter.invoke(session,'vivo.world.edit',command);
  };
  const trackedEntityId=policyFrom(inspection(),contract.id).policy.entityId;
  const reconcile=async operationId=>{
    const envelope=engine.snapshot(),record=envelope.snapshot.localOperationResults?.find(r=>r.operationId===operationId)??null;
    return {record:structuredClone(record),frame:frameOf(envelope,trackedEntityId),persistence:envelope.persistence};
  };
  const ports={invoke:(n,a,o)=>adapter.invoke(session,n,a),measure:measureOverride||measure,
    commit:commitOverride?((c,b,o)=>commitOverride(c,b,o,commit)):commit,reconcile,
    stop:()=>adapter.stop(session),now,timeoutMs};
  const loop=new CausalCooperationLoop(ports);
  return {loop,ports,adapter,session,registry,controller,native,approved,measure,
    revoke:()=>{revoked=true;},cancelContract:()=>economy.cancelContract({contractId:contract.id,idempotencyKey:'cancel.'+crypto.randomUUID()}),
    stats:()=>({nativeCalls:structuredClone(registry.audit),approved:approved.size,revoked,lastNeural:structuredClone(lastNeural)})};
}
export function makeTask(fixture,{cue=0,delaySteps=2,distractor=0}={}) {
  return {noteId:`lab:cue:${cue}`,contractId:fixture.contract.id,entityId:'relic',probeId:'workpiece',
    axis:fixture.axis,delaySteps,distractor};
}
export async function verifyReload(fixture,outcome) {
  const reloaded=new LocalVivoEngine({storage:fixture.storage});await reloaded.open(fixture.engine.world.worldId);
  const snapshot=reloaded.snapshot();
  return {sameWorld:snapshot.snapshot.worldId===fixture.engine.world.worldId,
    sameBranch:snapshot.branchId===fixture.engine.branchId,sameEye:snapshot.currentEyeId===fixture.engine.currentEyeId,
    samePosition:same(frameOf(snapshot,'relic').q,outcome.receipt.frame.q),
    operationRetained:!!snapshot.snapshot.localOperationResults?.find(r=>r.operationId===outcome.proposalId)};
}
