/** Bounded causal cooperation experiment. Model proposals are never permissions.
 * Uses host ports over the existing world/agent/economy owners; owns none of them.
 * This task adapter is deliberately structured, not a general language planner.
 */
const fail = code => Object.assign(new Error(code), {code});
const copy = value => structuredClone(value);
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const frozen = value => {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) frozen(item); Object.freeze(value); }
  return value;
};
const need = (condition,code) => { if (!condition) throw fail(code); };
const safeCode = value => {
  try { const d=Object.getOwnPropertyDescriptor(value,'code');if(typeof d?.value==='string')return d.value; } catch {}
  return 'SUBMISSION_UNCERTAIN';
};
const integer = x => Number.isSafeInteger(x) && x >= 0;
const id = x => typeof x === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(x);
export async function fingerprint(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),
    b=>b.toString(16).padStart(2,'0')).join('');
}
export function parseCue(note) {
  need(note?.document && id(note.document.note_id) && integer(note.document.revision), 'INVALID_NOTE');
  let body; try {body=JSON.parse(note.document.text);} catch {throw fail('INVALID_CUE_DOCUMENT');}
  need(body?.schema==='vivo.cooperation.cue/1' && [0,1].includes(body.code) &&
    Object.keys(body).length===2, 'INVALID_CUE_DOCUMENT');
  return body.code;
}
export function policyFrom(inspection,contractId) {
  need(inspection?.simulation===true && inspection.readOnly===true && inspection.verification?.ok===true &&
    inspection.verification?.simulation===true && Array.isArray(inspection.contracts), 'INVALID_CONTRACT_INSPECTION');
  const matches=inspection.contracts.filter(c=>c.id===contractId);
  need(matches.length===1,'CONTRACT_NOT_UNIQUE');
  const c=matches[0];
  need(c.simulation===true && c.amountFluff===0 && c.status==='draft' && integer(c.revision),'CONTRACT_NOT_PERMITTED');
  let wire;try{wire=JSON.parse(c.terms);}catch{throw fail('INVALID_POLICY');}
  need(wire?.s==='coop-lab/1' && Object.keys(wire).length===11,'INVALID_POLICY');
  const policy={schema:'vivo.cooperation.policy/1',labOnly:true,worldId:wire.w,branchId:wire.b,
    spaceId:wire.r,entityId:wire.e,probeId:wire.p,axis:wire.a,dimension:wire.d,step:wire.t,
    expiresAt:wire.x,allowedChoices:wire.c};
  need(policy?.schema==='vivo.cooperation.policy/1' && policy.labOnly===true &&
    ['worldId','branchId','spaceId','entityId','probeId'].every(k=>id(policy[k])) &&
    integer(policy.axis) && Number.isInteger(policy.dimension) && policy.dimension>=3 && policy.dimension<=11 &&
    policy.axis<policy.dimension && Number.isFinite(policy.step) && policy.step>0 && policy.step<=.5 &&
    Number.isFinite(policy.expiresAt) && Array.isArray(policy.allowedChoices) && policy.allowedChoices.length>0 &&
    policy.allowedChoices.every(c=>c===0||c===1), 'INVALID_POLICY');
  return {contract:copy(c),policy:copy(policy)};
}
export function frameOf(envelope,entityId) {
  const eye=envelope?.eyes?.[envelope.currentEyeId], space=envelope?.snapshot?.spaces?.[eye?.spaceId];
  const entity=space?.entities?.[entityId];
  need(entity && space && Array.isArray(entity.q) && entity.q.length===space.dimension &&
    entity.q.every(Number.isFinite) && integer(entity.revision),'INVALID_WORLD_FRAME');
  return {worldId:envelope.snapshot.worldId,branchId:envelope.branchId,eyeId:envelope.currentEyeId,
    spaceId:space.id,entityId,dimension:space.dimension,revision:entity.revision,q:[...entity.q]};
}
function taskCopy(task) {
  const keys=['noteId','contractId','entityId','probeId','axis','delaySteps','distractor'];
  need(task && equal(Object.keys(task).sort(),keys.sort()) &&
    ['noteId','contractId','entityId','probeId'].every(k=>id(task[k])) && integer(task.axis) &&
    integer(task.delaySteps) && task.delaySteps<=64 && Number.isFinite(task.distractor) && Math.abs(task.distractor)<=1,'INVALID_TASK');
  return frozen(copy(task));
}
function checkScope(frame,probe,task,policy,now) {
  need(['worldId','branchId','spaceId','entityId','dimension'].every(k=>frame[k]===policy[k]) &&
    task.axis===policy.axis && task.probeId===policy.probeId && frame.entityId!==probe.entityId &&
    ['worldId','branchId','spaceId','eyeId','dimension'].every(k=>frame[k]===probe[k]),'POLICY_SCOPE_MISMATCH');
  need(now < policy.expiresAt,'POLICY_EXPIRED');
}

export class CausalCooperationLoop {
  #ports; #now; #timeout; #active=true; #busy=false; #flights=new Set(); #plans=new WeakMap(); #stopping=null;
  constructor({invoke,measure,commit,reconcile,stop,now=()=>Date.now(),timeoutMs=5000}) {
    need([invoke,measure,commit,reconcile,stop,now].every(x=>typeof x==='function'),'EXPLICIT_PORTS_REQUIRED');
    need(Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=60000,'INVALID_TIMEOUT');
    this.#ports={invoke,measure,commit,reconcile,stop};this.#now=now;this.#timeout=timeoutMs;
  }
  get active(){return this.#active;}
  #assert(){need(this.#active,'SOURCE_STOPPED');}
  async #call(work,{afterStop=false}={}) {
    if(!afterStop)this.#assert();
    const controller=new AbortController();let timer,abort;
    const cancelled=new Promise((_,reject)=>{
      abort=()=>reject(fail('CANCELLED_OR_DEADLINE'));
      controller.signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>controller.abort(),this.#timeout);
    });
    this.#flights.add(controller);
    try {
      const pending=Promise.resolve().then(()=>{need(!controller.signal.aborted,'CANCELLED_OR_DEADLINE');return work(controller.signal);});
      const result=await Promise.race([pending,cancelled]);
      if(!afterStop)this.#assert();return result;
    } finally {clearTimeout(timer);controller.signal.removeEventListener('abort',abort);this.#flights.delete(controller);}
  }
  #invoke(name,args={}) {return this.#call(signal=>this.#ports.invoke(name,args,{signal}));}
  async plan(task) {
    this.#assert();need(!this.#busy,'PLANNING_IN_PROGRESS');const goal=taskCopy(task);this.#busy=true;
    try {
      const [world,note,inspection]=await Promise.all([
        this.#invoke('vivo.world.read'),this.#invoke('memory.read',{note_id:goal.noteId}),this.#invoke('contracts.inspect')]);
      need(note?.document?.note_id===goal.noteId,'NOTE_ID_MISMATCH');
      const cue=parseCue(note),frame=frameOf(world,goal.entityId),probe=frameOf(world,goal.probeId);
      const {contract,policy}=policyFrom(inspection,goal.contractId);
      checkScope(frame,probe,goal,policy,this.#now());
      const observed=await this.#call(signal=>this.#ports.measure(copy(probe),goal.axis,{signal}));
      need(observed?.schema==='vivo.cooperation.measurement/1' && equal(observed.frame,probe) &&
        [0,1].includes(observed.query) && observed.query===Number(probe.q[goal.axis]>0),'STALE_OR_INVALID_MEASUREMENT');
      const neuralInput={cue,query:observed.query,delay_steps:goal.delaySteps,distractor:goal.distractor};
      const neural=await this.#invoke('neural.predict',{task:'scoped_delayed_retrieval',input:neuralInput});
      need(neural?.can_authorize_action===false && neural.promotion==='experimental_only' &&
        neural.prediction?.task==='scoped_delayed_retrieval' && equal(neural.prediction?.input,neuralInput), 'INVALID_NEURAL_RESULT');
      const choice=neural.prediction.predicted_index;
      need(choice===0||choice===1,'MODEL_ABSTAINED');
      need(policy.allowedChoices.includes(choice),'CHOICE_NOT_PERMITTED');
      const target=[...frame.q];target[goal.axis]+=(choice===1?1:-1)*policy.step;
      const binding={goal,frame,probe,contractRevision:contract.revision,contractTerms:contract.terms,
        note:copy(note.document),policy};
      const proof={note:await fingerprint(note.document),measurement:await fingerprint(observed),
        policy:await fingerprint(policy),neuralInput:await fingerprint(neuralInput),
        checkpoint:neural.prediction.checkpoint?.parameter_digest??neural.parameter_digest??null};
      this.#assert();
      const proposal=frozen({schema:'vivo.cooperation.proposal/1',id:'coop.'+crypto.randomUUID(),
        frame,target,choice,provisional:true,simulationOnly:true,neuralInput,proof});
      this.#plans.set(proposal,{binding,consumed:false,neural:copy(neural)});
      return proposal;
    } finally {this.#busy=false;}
  }
  async execute(proposal) {
    this.#assert();const entry=this.#plans.get(proposal);
    need(entry&&!entry.consumed,'UNKNOWN_OR_CONSUMED_PROPOSAL');entry.consumed=true;
    const b=entry.binding;
    // Revalidate evidence. Model output cannot grant world.edit or revise policy.
    const [world,note,inspection]=await Promise.all([
      this.#invoke('vivo.world.read'),this.#invoke('memory.read',{note_id:b.goal.noteId}),this.#invoke('contracts.inspect')]);
    const frame=frameOf(world,b.goal.entityId),probe=frameOf(world,b.goal.probeId);
    const {contract,policy}=policyFrom(inspection,b.goal.contractId);
    checkScope(frame,probe,b.goal,policy,this.#now());
    need(equal(frame,b.frame)&&equal(probe,b.probe),'WORLD_OR_PROBE_CHANGED');
    need(equal(note.document,b.note),'MEMORY_CHANGED');
    need(contract.revision===b.contractRevision&&contract.terms===b.contractTerms,'CONTRACT_CHANGED');
    const command={worldId:frame.worldId,branchId:frame.branchId,eyeId:frame.eyeId,spaceId:frame.spaceId,
      entityId:frame.entityId,baseRevision:frame.revision,operationId:proposal.id,
      delta:proposal.target.map((q,i)=>q-frame.q[i])};
    let outcome,interruption=null;
    try {
      outcome=await this.#call(signal=>this.#ports.commit(copy(command),copy(b),{signal}));
      need(outcome?.status==='accepted'&&outcome.submitted===true,'ACCEPTANCE_UNCONFIRMED');
    } catch(error) {
      interruption=safeCode(error);
    }
    // Always inspect existing receipts; never retry a possibly accepted edit.
    const evidence=await this.#call(signal=>this.#ports.reconcile(proposal.id,{signal}),{afterStop:true});
    const accepted=evidence?.record?.operationId===proposal.id;
    if(accepted) {
      need(equal(evidence.frame?.q,proposal.target)&&evidence.frame.revision===frame.revision+1,
        'ACCEPTED_STATE_MISMATCH');
    }
    return frozen({schema:'vivo.cooperation.outcome/1',proposalId:proposal.id,
      status:interruption?'reconciled-after-interruption':accepted?'accepted':'unconfirmed',
      accepted,interruption,receipt:copy(evidence),neural:entry.neural,automaticRetries:0,
      finalTargetPreserved:accepted&&equal(evidence.frame.q,proposal.target)});
  }
  stop() {
    if(this.#stopping)return this.#stopping;
    this.#active=false;for(const request of this.#flights)request.abort();
    this.#stopping=Promise.resolve().then(()=>this.#ports.stop());return this.#stopping;
  }
}
