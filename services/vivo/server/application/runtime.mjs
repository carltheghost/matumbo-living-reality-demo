/** Private pipe adapter around the canonical authority; never a second solver.
 * One process owns one checkpoint. No TCP listener, renderer, raw camera input,
 * token persistence, or journal truncation. Node >= 22 (Web Crypto) is required.
 */
import {randomBytes} from 'node:crypto';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {lstat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {LocalLeaseWorld} from '../../web/authority/lease-authority.mjs';
import {FileAuthorityStore} from '../authority/file-store.mjs';
import {validateCommand} from '../../contracts/validate.mjs';
import {workshopSeed,phaseWorkshopSeed,entryView,LOCAL_SEATS,ENTITY_COUNT} from './seed.mjs';

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_LINE_BYTES = 64 * 1024;
// Private host phase payload only. Public dispatch remains capped at 64 KiB.
const MAX_MATERIAL_BYTES = 4 * 1024 * 1024;
const SESSION_IDLE_MS = 30_000;
const SWEEP_MS = 250;
const SEATS = Object.keys(LOCAL_SEATS);
// Four entity leases can each require one release/reconcile, two sessions each
// require one close; retain one sweep, one crash restart-release and two slots
// for admission/in-flight uncertainty. Global serialization prevents overshoot.
const MIN_RESERVE = ENTITY_COUNT + SEATS.length + 1 + 1 + 2;
// Strict bounded canonical commands and max-11D views in this fixed, depth-one
// workshop grow a record by less than this conservative bound per accepted event.
// Byte backpressure is independent of maxEvents; 65,536 is not a size guarantee.
const EVENT_BYTE_RESERVE = 64 * 1024;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const validId = v => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(v);
const uint = v => Number.isSafeInteger(v) && v >= 0;
const clone = v => structuredClone(v);
const fail = code => {throw Object.assign(new Error(code),{code});};
function keys(value, required=[], optional=[]) {
  if(!object(value) || required.some(k=>!Object.hasOwn(value,k)) ||
      Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k))) fail('INVALID_ARGUMENT');
}
function bounded(value,limit=MAX_LINE_BYTES) {
  let bytes;
  try {bytes=Buffer.byteLength(JSON.stringify(value));} catch {fail('INVALID_ARGUMENT');}
  if(bytes>limit) fail('REQUEST_TOO_LARGE');
}
function checkedView(view) {
  keys(view,['spaceId','chart','dimension','q','basis','slice'],['actorId','eyeId','revision','stack']);
  return Object.fromEntries(['spaceId','chart','dimension','q','basis','slice'].map(k=>[k,clone(view[k])]));
}
function publicLease(lease) {
  if(!lease)return null;
  return Object.fromEntries(['id','actorId','acquireCommandId','spaceId','entityId','source','inputEpoch','targetSeq','expiresAt','target']
    .map(k=>[k,clone(lease[k])]));
}
function publicError(error) {
  const code=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ?error.code:error instanceof TypeError?'INVALID_ARGUMENT':error instanceof SyntaxError?'INVALID_JSON':'RUNTIME_FAILURE';
  return {code,message:code};
}

/** Mounted profile is intentionally narrower than the reusable phase driver. */
export function checkMountedPhaseCheckpoint(cp){
  if(!cp||cp.spaceId!=='root'||JSON.stringify(cp.shape)!=='[8,8,8,8]'||JSON.stringify(cp.lengths)!=='[8,8,8,8]'||cp.coupling!==1||
      !object(cp.fields)||JSON.stringify(Object.keys(cp.fields).sort())!=='["portal","relic","workpiece"]')fail('MOUNTED_PHASE_CONFIGURATION');
  for(const [id,field]of Object.entries(cp.fields))if(field.initialMass!==1||field.chart!=='flat'||JSON.stringify(field.membership)!==JSON.stringify(['field.'+id]))fail('MOUNTED_PHASE_CONFIGURATION');
}

/** Metering only: all accepted state, validation, hashing and CAS remain canonical. */
class MeteredStore {
  record=null; bytes=0;
  constructor(backend,kind) {this.file=backend;this.kind=kind;}
  static async open(path,kind,phase) {
    if(kind==='posix') {
      if(process.platform==='win32')fail('POSIX_STORE_UNSUPPORTED');
      return new MeteredStore(new FileAuthorityStore({path,maxBytes:MAX_BYTES}),kind);
    }
    // Backend selection is explicit. Never seed a new SQLite world beside a
    // corresponding JSON world and never interpret JSON as a SQLite migration.
    const exists=async p=>{try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
    if(!await exists(path)&&await exists(join(dirname(path),phase?'canonical-phase.json':'canonical-world.json')))
      fail('STORE_LEGACY_CHECKPOINT_PRESENT');
    const {SQLiteAuthorityStore}=await import('../authority/sqlite-store.mjs');
    return new MeteredStore(await SQLiteAuthorityStore.open({path,maxBytes:MAX_BYTES}),kind);
  }
  get supportsCommitGuard() {return this.file.supportsCommitGuard===true;}
  get fault() {return this.file.fault??null;}
  async close() {await this.file.close?.();}
  async load() {
    const record=await this.file.load();
    this.record=record;this.bytes=record?Buffer.byteLength(JSON.stringify(record)+'\n'):0;
    return record;
  }
  async compareAndSwap(expected,record,options) {
    await this.file.compareAndSwap(expected,record,options);
    this.record=record;this.bytes=Buffer.byteLength(JSON.stringify(record)+'\n');
  }
}

export class MountedRuntime {
  #world; #store; #maxEvents; #reserve; #sessions=new Map(); #seats=new Map();
  #phase=false; #materialRunning=false; #statusRevision=0; #storageFault=null;
  #tail=Promise.resolve(); #timer; #stopped=false; #fault=null; #sweepQueued=false;
  constructor(key,world,store,maxEvents,reserve,phase) {
    if(key!==MountedRuntime)fail('USE_OPEN');
    this.#phase=phase;this.#world=world;this.#store=store;this.#maxEvents=maxEvents;this.#reserve=reserve;
    this.#timer=setInterval(()=>{
      if(this.#sweepQueued)return;this.#sweepQueued=true;
      void this.#queue(()=>this.#sweep()).catch(error=>{this.#fault=publicError(error).code;})
        .finally(()=>{this.#sweepQueued=false;});
    },SWEEP_MS);
    this.#timer.unref();
  }
  static async open({path,store:storeKind='posix',maxEvents=65536,reserve=MIN_RESERVE,phase=false,initializeMaterial}={}) {
    if(typeof phase!=='boolean'||!['posix','sqlite'].includes(storeKind))fail('INVALID_RUNTIME_OPTIONS');
    if(typeof path!=='string'||!isAbsolute(path)||!Number.isSafeInteger(maxEvents)||maxEvents>65536||
      !Number.isSafeInteger(reserve)||reserve<MIN_RESERVE||maxEvents<reserve+2)fail('INVALID_RUNTIME_OPTIONS');
    const store=await MeteredStore.open(path,storeKind,phase);
    try {
    const existing=await store.load();
    let seed=phase?phaseWorkshopSeed():workshopSeed(),materialInitial;
    if(existing) {
      if(phase)checkMountedPhaseCheckpoint(existing.state?.material?.checkpoint);
      const snapshot=existing.state?.snapshot;
      const normalized=clone(snapshot);
      if(phase&&normalized?.spaces?.root){
        normalized.simulationTime=0;normalized.spaces.root.field.hash=seed.spaces.root.field.hash;
        for(const [id,e] of Object.entries(normalized.spaces.root.entities??{})){
          if(!seed.spaces.root.entities[id])fail('WORKSHOP_CHECKPOINT_MISMATCH');
          Object.assign(e,{q:seed.spaces.root.entities[id].q,v:[0,0,0,0],revision:0});
        }
      }
      // Capacity proof is for exactly this fixed four-entity, depth-one workshop.
      // Refuse other checkpoint topologies rather than silently weaken that bound.
      if(!snapshot || JSON.stringify({...normalized,acceptedSequence:0,stateHash:seed.stateHash})!==JSON.stringify(seed))
        fail('WORKSHOP_CHECKPOINT_MISMATCH');
      if(!Array.isArray(existing.state.events)||existing.state.events.length>maxEvents)fail('JOURNAL_LIMIT_MISMATCH');
      if(existing.state.events.length>=maxEvents && Object.keys(existing.state.leases??{}).length)fail('JOURNAL_RECOVERY_CAPACITY');
      for(const eye of Object.values(existing.state.eyes??{})) {
        if(!Object.values(LOCAL_SEATS).includes(eye.actorId)||eye.eyeId!=='main'||eye.stack?.length>1)fail('WORKSHOP_CHECKPOINT_MISMATCH');
      }
    }
    if(phase&&!existing){
      if(typeof initializeMaterial!=='function')fail('PHASE_INITIALIZER_REQUIRED');
      const initialized=await initializeMaterial(clone(seed));
      keys(initialized,['snapshot','checkpoint']);bounded(initialized,MAX_MATERIAL_BYTES);checkMountedPhaseCheckpoint(initialized.checkpoint);
      // Driver-derived q/v and field hash are the only permitted seed changes.
      const normalized=clone(initialized.snapshot);
      normalized.spaces.root.field.hash=seed.spaces.root.field.hash;
      for(const [id,e]of Object.entries(normalized.spaces.root.entities)){
        if(!seed.spaces.root.entities[id])fail('PHASE_INITIALIZER_MISMATCH');
        Object.assign(e,{q:seed.spaces.root.entities[id].q,v:[0,0,0,0],revision:0});
      }
      if(JSON.stringify(normalized)!==JSON.stringify(seed))fail('PHASE_INITIALIZER_MISMATCH');
      seed=initialized.snapshot;materialInitial={spaceId:'root',checkpoint:initialized.checkpoint};
    }
    const world=await LocalLeaseWorld.create({snapshot:seed,store,maxEvents,
      ...(phase?{materialProtocol:'vivo.lease-material/1',...(materialInitial?{materialInitial}:{})}:{})});
    return new MountedRuntime(MountedRuntime,world,store,maxEvents,reserve,phase);
    } catch(error) {
      // An owner acquired before validation must never escape a failed startup.
      // Preserve a FIRST close failure: a retry is not proof ownership released.
      await store.close();throw error;
    }
  }
  #latchStoreFault() {
    if(this.#store.fault){this.#storageFault??=this.#store.fault;this.#fault=this.#storageFault;this.#materialRunning=false;}
  }
  #queue(fn) {
    const job=this.#tail.then(async()=>{this.#latchStoreFault();try{return await fn();}finally{this.#latchStoreFault();}});
    this.#tail=job.catch(()=>{});return job;
  }
  #journal() {
    const events=this.#store.record.state.events,count=events.length;
    const eventThreshold=this.#maxEvents-this.#reserve;
    const byteThreshold=MAX_BYTES-(this.#reserve+2)*EVENT_BYTE_RESERVE;
    return {label:'Bounded retained accepted history; never silently truncated',
      retainedEvents:count,maxEvents:this.#maxEvents,reserve:this.#reserve,
      writeThreshold:eventThreshold,remainingEvents:Math.max(0,eventThreshold-count),
      checkpointBytes:this.#store.bytes,maxCheckpointBytes:MAX_BYTES,writeByteThreshold:byteThreshold,
      remainingBytes:Math.max(0,byteThreshold-this.#store.bytes),
      backpressure:count>=eventThreshold||this.#store.bytes>=byteThreshold,
      readOnly:!!this.#storageFault||count>=eventThreshold||this.#store.bytes>=byteThreshold,
      firstSequence:events[0]?.sequence??null,lastSequence:events.at(-1)?.sequence??null,
      cleanupReserve:{leases:ENTITY_COUNT,sessions:SEATS.length,sweep:1,restart:1,inFlightOrAdmission:2},
      fault:this.#fault};
  }
  #capabilities() {
    return {materialDynamics:this.#phase,materialLearning:false,remoteMultiplayer:false,localSeats:2,nested:true,
      material:this.#phase?{profile:'phase',dimension:4,spaceId:'root',resolution:[8,8,8,8],running:this.#materialRunning,simulationStep:.02,wallIntervalMs:500,leaseRevisionProtocol:'vivo.lease-material/1'}:null,
      persistence:this.#store.kind==='sqlite'?'SQLite WAL/FULL exclusive checkpoint':'POSIX atomic checkpoint',sessionIdleMs:SESSION_IDLE_MS,
      maxRequestBytes:MAX_LINE_BYTES,leaseMs:3000,journal:this.#journal()};
  }
  get capabilities() {return this.#capabilities();}
  get closed() {return this.#stopped;}
  #gate(cost=1) {
    if(this.#storageFault)fail('STORE_FAILED_CLOSED');
    const j=this.#journal();
    if(j.backpressure||j.retainedEvents+cost>j.writeThreshold)fail('JOURNAL_BACKPRESSURE');
  }
  #session(token) {
    if(typeof token!=='string'||!this.#sessions.has(token))fail('SESSION_EXPIRED');
    const s=this.#sessions.get(token);s.lastSeen=Date.now();return s;
  }
  #materialDiagnostics(){
    if(!this.#phase)return null;
    const event=this.#store.record.state.events.findLast(e=>e.kind==='material-step');
    return {tick:this.#store.record.state.material?.checkpoint?.tick??0,
      diagnostics:clone(event?.payload?.diagnostics??null),fieldDiagnostics:clone(event?.payload?.fieldDiagnostics??[])};
  }
  #state(session) {
    if(this.#statusRevision>=Number.MAX_SAFE_INTEGER)fail('STATUS_REVISION_EXHAUSTED');
    return {runtimeRevision:++this.#statusRevision,snapshot:this.#world.snapshot(),eye:clone(this.#store.record.state.eyes[JSON.stringify([session.session.actorId,'main'])]??null),
      constraints:this.#world.constraints().map(l=>({actorId:l.actorId,entityId:l.entityId,
        spaceId:l.spaceId,source:l.source,target:clone(l.target)})),
      participants:SEATS.map(seat=>({seat,actorId:LOCAL_SEATS[seat],online:this.#seats.has(seat)})),
      capabilities:this.#capabilities(),journal:this.#journal(),
      materialDiagnostics:this.#materialDiagnostics()};
  }
  async #close(session) {
    if(session.authority)await session.authority.close();
    this.#sessions.delete(session.token);this.#seats.delete(session.seat);
    if(!this.#seats.size)this.#materialRunning=false;
  }
  async #sweep() {
    if(this.#stopped||this.#storageFault)return;
    for(const s of [...this.#sessions.values()])if(Date.now()-s.lastSeen>=SESSION_IDLE_MS)await this.#close(s);
    await this.#world.sweepExpired();if(!this.#storageFault)this.#fault=null;
  }
  #events(actorId) {
    return this.#store.record.state.events.map(event=>{
      const out={sequence:event.sequence,kind:event.kind,actorId:event.actorId,stateHash:event.stateHash};
      const privateEye=['eye-register','eye-move','space.enter','space.exit'].includes(event.kind);
      out.payload=privateEye&&event.actorId!==actorId?{redacted:'Private participant Eye'}:clone(event.payload);
      return out;
    });
  }
  async #open(args) {
    keys(args,['seat'],['resumeToken','readOnly']);
    if(Object.hasOwn(args,'readOnly')&&typeof args.readOnly!=='boolean')fail('INVALID_ARGUMENT');
    if(typeof args.seat!=='string'||!Object.hasOwn(LOCAL_SEATS,args.seat))fail('INVALID_SEAT');
    const existing=this.#seats.get(args.seat);
    if(Object.hasOwn(args,'resumeToken')) {
      if(typeof args.resumeToken!=='string'||!existing||existing.token!==args.resumeToken)fail('SESSION_EXPIRED');
    } else if(existing)fail('SEAT_BUSY');
    const actorId=LOCAL_SEATS[args.seat];
    let authority=null,session;
    if(args.readOnly) {
      if(!this.#store.record.state.eyes[JSON.stringify([actorId,'main'])])fail('NO_SAVED_EYE');
      if(existing)await this.#close(existing);
      const snapshot=this.#world.snapshot();
      session={mode:'local',actorId,worldId:snapshot.worldId,authorityId:snapshot.authorityId,
        capabilities:['observe','export'],readOnly:true};
    } else {
      this.#gate(existing?2:1);
      if(existing)await this.#close(existing);
      authority=this.#world.attach({actorId});
      session={...await authority.open(),readOnly:false};
      try {await authority.registerEye('main',entryView());}
      catch(error) {await authority.close();throw error;}
    }
    const token=randomBytes(32).toString('base64url');
    const admitted={authority,session,token,seat:args.seat,lastSeen:Date.now(),epoch:0};
    this.#sessions.set(token,admitted);this.#seats.set(args.seat,admitted);
    return {token,session:clone(session),state:this.#state(admitted)};
  }
  /** Trusted private host only; never exposed by the public HTTP RPC allowlist. */
  dispatchMaterial(raw){
    let request;try{keys(raw,['op','args']);bounded(raw,MAX_MATERIAL_BYTES);request=clone(raw);}catch(e){return Promise.reject(e);}
    return this.#queue(async()=>{
      if(this.#stopped||!this.#phase)fail('MATERIAL_UNAVAILABLE');
      if(this.#storageFault)fail('STORE_FAILED_CLOSED');
      if(request.op==='materialCapture'){
        keys(request.args,['spaceId']);if(request.args.spaceId!=='root')fail('MATERIAL_SPACE');
        const capture=await this.#world.captureMaterial('root');
        return capture;
      }
      if(request.op==='materialApply'){
        keys(request.args,['proposal']);checkMountedPhaseCheckpoint(request.args.proposal?.fieldState);if(request.args.proposal?.dt!==.02)fail('MOUNTED_PHASE_STEP');if(!this.#materialRunning)fail('MATERIAL_PAUSED');
        try{this.#gate();}catch(error){if(error.code==='JOURNAL_BACKPRESSURE')this.#materialRunning=false;throw error;}
        const snapshot=await this.#world.applyMaterialProposal(request.args.proposal);
        return snapshot;
      }
      fail('UNKNOWN_OPERATION');
    });
  }
  /** Every gate and subsequent canonical call share this queue with timer cleanup. */
  dispatch(raw,receivedAt=performance.now()) {
    let request;
    try {
      if(!Number.isFinite(receivedAt)||receivedAt<0||receivedAt>performance.now())fail('INVALID_ARGUMENT');
      keys(raw,['op'],['token','args','queueAgeMs']);bounded(raw);request=clone(raw);
    } catch(error) {return Promise.reject(error);}
    return this.#queue(async()=>{
      if(request.queueAgeMs!==undefined&&(!Number.isFinite(request.queueAgeMs)||request.queueAgeMs<0))fail('INVALID_ARGUMENT');
      if(typeof request.op!=='string')fail('INVALID_OPERATION');
      const args=request.args===undefined?{}:request.args;
      if(this.#stopped)fail('RUNTIME_CLOSED');
      if(request.op==='shutdown') {
        keys(args);if(request.token!==undefined)fail('INVALID_ARGUMENT');
        let cleanupError;
        try {
          for(const s of [...this.#sessions.values()]) {
            // No further persistence after an ambiguous storage failure. Any
            // durable old leases are released by the next lifetime owner.
            this.#latchStoreFault();if(this.#storageFault)break;
            try {await this.#close(s);}catch(error){cleanupError??=error;}
          }
        } finally {
          clearInterval(this.#timer);this.#stopped=true;this.#materialRunning=false;
          this.#sessions.clear();this.#seats.clear();
          // Always after session cleanup, including a failing cleanup write.
          await this.#store.close();
        }
        if(cleanupError)throw cleanupError;
        return {value:{closed:true},state:null};
      }
      await this.#sweep();
      if(request.op==='ready') {
        keys(args);if(request.token!==undefined)fail('INVALID_ARGUMENT');
        return {ok:!this.#storageFault,capabilities:this.#capabilities(),journal:this.#journal(),
      materialDiagnostics:this.#materialDiagnostics()};
      }
      if(this.#storageFault)fail('STORE_FAILED_CLOSED');
      if(request.op==='open') {
        if(request.token!==undefined)fail('INVALID_ARGUMENT');return this.#open(args);
      }
      if(!['state','submit','moveEye','inspectLease','renewLease','reconcileLease','close','export','nextEpoch','materialRun'].includes(request.op))
        fail('UNKNOWN_OPERATION');
      const s=this.#session(request.token);let value=null;
      if(s.session.readOnly&&!['state','inspectLease','close','export','nextEpoch'].includes(request.op))fail('READ_ONLY_SESSION');
      switch(request.op) {
        case 'materialRun':
          keys(args,['running']);if(!this.#phase||typeof args.running!=='boolean')fail('MATERIAL_UNAVAILABLE');
          if(args.running)this.#gate();this.#materialRunning=args.running;value={running:this.#materialRunning};break;
        case 'state': keys(args);break;
        case 'nextEpoch':
          keys(args);if(s.epoch>=Number.MAX_SAFE_INTEGER)fail('EPOCH_EXHAUSTED');value=++s.epoch;break;
        case 'submit': {
          keys(args,['command']);const command=clone(validateCommand(args.command));
          if(['space.enter','space.exit'].includes(command.kind)&&command.payload.eyeId!=='main')fail('INVALID_EYE_ID');
          if(command.kind!=='grab.end')this.#gate();
          if(command.kind==='grab.target'&&command.payload.sampleAgeMs+(request.queueAgeMs??0)+Math.max(0,performance.now()-receivedAt)>150)
            fail('TARGET_STALE');
          value=await s.authority.submit(command);break;
        }
        case 'moveEye':
          keys(args,['view','expectedRevision']);if(!uint(args.expectedRevision))fail('INVALID_ARGUMENT');
          this.#gate();value=await s.authority.moveEye('main',checkedView(args.view),args.expectedRevision);break;
        case 'inspectLease':
          keys(args,['spaceId','entityId']);if(!validId(args.spaceId)||!validId(args.entityId))fail('INVALID_ARGUMENT');
          value=s.authority?publicLease(s.authority.inspectLease(args.spaceId,args.entityId)):null;break;
        case 'renewLease':
          keys(args,['leaseId']);if(!validId(args.leaseId))fail('INVALID_ARGUMENT');
          this.#gate();value=publicLease(await s.authority.renewLease(args.leaseId));break;
        case 'reconcileLease': {
          keys(args,['event']);const e=args.event;
          keys(e,['worldId','authorityId','spaceId','entityId','leaseId','inputEpoch'],['reason','message','source','command','receipt','latest','cancelled','commandId','detail']);
          if(!['worldId','authorityId','spaceId','entityId','leaseId'].every(k=>validId(e[k]))||!uint(e.inputEpoch))fail('INVALID_ARGUMENT');
          value=await s.authority.reconcileLease(Object.fromEntries(
            ['worldId','authorityId','spaceId','entityId','leaseId','inputEpoch'].map(k=>[k,e[k]])));break;
        }
        case 'export':
          keys(args);value={schema:'vivo.mounted-export/1',snapshot:this.#world.snapshot(),eye:clone(this.#store.record.state.eyes[JSON.stringify([s.session.actorId,'main'])]??null),
            material:clone(this.#store.record.state.material??null),
            history:{...this.#journal(),privacy:'Other participants’ private Eye payloads are redacted',events:this.#events(s.session.actorId)}};break;
        case 'close':
          keys(args);await this.#close(s);value={closed:true};break;
      }
      return {value,state:this.#state(s)};
    });
  }
}

async function* privateLines(stream){
  let pending=Buffer.alloc(0),discard=false;
  for await(const chunk of stream){
    let offset=0;while(offset<chunk.length){
      const nl=chunk.indexOf(10,offset),end=nl<0?chunk.length:nl,fragment=chunk.subarray(offset,end);
      offset=nl<0?chunk.length:nl+1;
      if(!discard){if(pending.length+fragment.length>MAX_MATERIAL_BYTES){pending=Buffer.alloc(0);discard=true;}
        else pending=Buffer.concat([pending,fragment]);}
      if(nl<0)continue;
      if(discard){discard=false;yield {error:'REQUEST_TOO_LARGE'};continue;}
      const bytes=pending.length;try{const value=JSON.parse(pending.toString('utf8'));yield {value,bytes};}
      catch{yield {error:bytes>MAX_LINE_BYTES?'REQUEST_TOO_LARGE':'INVALID_JSON'};}finally{pending=Buffer.alloc(0);}
    }
  }
  if(pending.length||discard)yield {error:'INCOMPLETE_REQUEST'};
}
async function main() {
  if(!isAbsolute(process.argv[2]??''))fail('ABSOLUTE_CHECKPOINT_PATH_REQUIRED');
  let phase=false,maxEvents=65536,store='posix';const flags=process.argv.slice(3),seen=new Set();
  while(flags.length) {
    const flag=flags.shift();if(seen.has(flag))fail('INVALID_RUNTIME_OPTIONS');seen.add(flag);
    if(flag==='--phase')phase=true;
    else if(flag==='--journal-events'&&flags.length)maxEvents=Number(flags.shift());
    else if(flag==='--store'&&flags.length)store=flags.shift();
    else fail('INVALID_RUNTIME_OPTIONS');
  }
  const write=value=>new Promise((done,reject)=>process.stdout.write(JSON.stringify(value)+'\n',error=>error?reject(error):done()));
  const lines=privateLines(process.stdin);
  const runtime=await MountedRuntime.open({path:process.argv[2],store,phase,maxEvents,initializeMaterial:async snapshot=>{
    await write({initializePhase:true,snapshot});const line=await lines.next();
    if(line.done||line.value.error)fail('PHASE_INITIALIZER_FAILED');return line.value.value;
  }});
  await write({ready:true,capabilities:runtime.capabilities});let done=false;
  const stop=async()=>{if(done)return;done=true;await runtime.dispatch({op:'shutdown'});};
  process.once('SIGTERM',()=>{void stop().then(()=>process.exit(0),()=>process.exit(1));});
  process.once('SIGINT',()=>{void stop().then(()=>process.exit(0),()=>process.exit(1));});
  try{
    for await(const line of lines){
      let id=null,shuttingDown=false;try{
        if(line.error)fail(line.error);const request=line.value;
        keys(request,['id','op'],['token','args','queueAgeMs']);
        if(!((typeof request.id==='string'&&request.id.length>0&&request.id.length<=128)||uint(request.id)))fail('INVALID_REQUEST_ID');
        id=request.id;shuttingDown=request.op==='shutdown';const {id:_,...body}=request;
        const privateMaterial=['materialCapture','materialApply'].includes(request.op);
        if(privateMaterial&&request.token!==undefined)fail('INVALID_ARGUMENT');
        if(!privateMaterial&&line.bytes>MAX_LINE_BYTES)fail('REQUEST_TOO_LARGE');
        const result=privateMaterial?await runtime.dispatchMaterial({op:request.op,args:request.args}):await runtime.dispatch(body);
        await write({id,ok:true,result});if(request.op==='shutdown'){done=true;return;}
      }catch(error){
        await write({id,ok:false,error:publicError(error)});
        // A failed close is fatal even if the store later reports closed. Exit
        // this lifetime owner instead of retrying close or serving stale state.
        if(shuttingDown&&runtime.closed){done=true;process.exitCode=1;return;}
      }
    }
  }finally{await stop();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error=>{process.stderr.write(publicError(error).code+'\n');process.exitCode=1;});
}
