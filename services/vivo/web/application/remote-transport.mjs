/** Canonical remote Vivo transport over one authenticated WebSocket.
 * The server-owned runtime token is never exposed to this client.
 */
import {offlineForkCommand} from './offline-branch.mjs';
import {createRemoteConversationProvider} from './conversation-transport.mjs';

export class RemoteTransport {
  constructor({url,token,WebSocket:Socket=globalThis.WebSocket,onState=()=>{},onError=()=>{},onClose=()=>{},timeoutMs=7000}={}) {
    if(typeof url!=='string'||!url.length||typeof token!=='string'||token.length<20||typeof Socket!=='function')
      throw new TypeError('Remote transport configuration required');
    this.url=url;this.invitationToken=token;this.Socket=Socket;this.onState=onState;this.onError=onError;this.onClose=onClose;this.timeoutMs=timeoutMs;
    this.socket=null;this.session=null;this.actorId=null;this.role=null;this.current=null;
    this.pending=new Map();this.listeners=new Set();this.conversationProviders=new Set();this.serial=0;this.closed=true;
  }
  receive(state) {
    if(!state)return;
    if(this.current&&state.snapshot.acceptedSequence<this.current.snapshot.acceptedSequence)return;
    this.current=structuredClone(state);this.onState(structuredClone(state));
    for(const listener of this.listeners)listener(this.getSnapshot());
  }
  async admit() {
    if(this.socket&&!this.closed)throw Error('REMOTE_ALREADY_OPEN');
    const ws=new this.Socket(this.url);this.socket=ws;this.closed=false;
    return new Promise((resolve,reject)=>{
      let timer=setTimeout(()=>{try{ws.close();}catch{};reject(Object.assign(new Error('Remote join timeout'),{code:'REMOTE_TIMEOUT'}));},this.timeoutMs);
      const fail=error=>{clearTimeout(timer);this.closed=true;reject(error instanceof Error?error:new Error(String(error)));};
      ws.onerror=()=>fail(Object.assign(new Error('Remote socket failed'),{code:'REMOTE_SOCKET'}));
      ws.onclose=()=>{if(this.socket!==ws)return;this.closed=true;this._rejectPending('REMOTE_CLOSED','Remote socket closed');void this._closeConversationProviders();try{this.onClose();}catch{}};
      ws.onopen=()=>ws.send(JSON.stringify({type:'join',token:this.invitationToken}));
      ws.onmessage=event=>{
        let msg;try{msg=JSON.parse(event.data);}catch{return;}
        if(msg.type==='joined'){
          clearTimeout(timer);this.role=msg.role;this.actorId=msg.actorId;this.session=msg.session;this.receive(msg.state);
          resolve({role:this.role,actorId:this.actorId,session:structuredClone(this.session),state:structuredClone(this.current)});return;
        }
        if(msg.type==='error'){
          const code=msg.code||'REMOTE_PROTOCOL_ERROR';
          const error=Object.assign(new Error(code),{code});
          try{this.onError(error);}catch{}
          if(!this.session){fail(error);return;}
          this._rejectPending(code,code,msg.id);return;
        }
        this._message(msg);
      };
    });
  }
  _rejectPending(code,message=code,onlyId=null) {
    const error=Object.assign(new Error(message),{code});
    if(onlyId!==null){
      const pending=this.pending.get(onlyId);if(!pending)return;
      this.pending.delete(onlyId);clearTimeout(pending.timer);pending.reject(error);return;
    }
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}
    this.pending.clear();
  }
  _message(msg) {
    if(msg.type==='state'){this.receive(msg.state);return;}
    if(msg.type==='reply'&&typeof msg.id==='string'){
      const pending=this.pending.get(msg.id);if(!pending)return;this.pending.delete(msg.id);clearTimeout(pending.timer);
      if(msg.state)this.receive(msg.state);
      if(msg.error)pending.reject(Object.assign(new Error(msg.error),{code:msg.error}));
      else pending.resolve(msg.value);
    }
  }
  call(op,args={}) {
    if(this.closed||!this.socket||this.socket.readyState!==1)return Promise.reject(Object.assign(new Error('REMOTE_CLOSED'),{code:'REMOTE_CLOSED'}));
    const id='remote.'+(++this.serial);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Object.assign(new Error('Remote request timed out; reconcile accepted state'),{code:'REMOTE_TIMEOUT'}));},this.timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try{this.socket.send(JSON.stringify({id,op,args}));}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  async open(){if(!this.session)throw Error('REMOTE_ADMISSION_REQUIRED');return this.session;}
  getSnapshot(){if(!this.current)throw Error('NO_SNAPSHOT');return structuredClone(this.current.snapshot);}
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  submit(command){return this.call('submit',{command});}
  forkOffline(options={}){return this.submit(offlineForkCommand(this.current?.snapshot,options));}
  inspectLease(spaceId,entityId,criteria={}){return this.call('inspectLease',{spaceId,entityId,...(Object.keys(criteria).length?{criteria}:{})});}
  renewLease(leaseId){return this.call('renewLease',{leaseId});}
  reconcileLease(event){return this.call('reconcileLease',{event});}
  moveEye(view,expectedRevision){return this.call('moveEye',{view,expectedRevision});}
  refresh(){return this.call('state');}
  nextEpoch(){return this.call('nextEpoch');}
  export(){return this.call('export');}
  materialRun(running){return this.call('materialRun',{running});}
  conversationProvider(options={}){
    if(this.closed||!this.session)throw Object.assign(new Error('REMOTE_ADMISSION_REQUIRED'),{code:'REMOTE_ADMISSION_REQUIRED'});
    const remoteOrigin=new URL(this.url).origin.replace(/^ws/,'http');
    const provider=createRemoteConversationProvider({
      ...options,
      token:this.invitationToken,
      origin:options.origin||remoteOrigin,
    });
    this.conversationProviders.add(provider);
    return provider;
  }
  async connectConversationProvider(options={}){
    const provider=this.conversationProvider(options);
    try{await provider.connect();return provider;}catch(error){this.conversationProviders.delete(provider);await provider.close().catch(()=>{});throw error;}
  }
  async _closeConversationProviders(){
    const providers=[...this.conversationProviders];
    this.conversationProviders.clear();
    await Promise.all(providers.map(provider=>provider.close().catch(()=>{})));
  }
  async memoryRequest(op,args={},fetchImpl=globalThis.fetch){
    if(this.closed||!this.session)throw Object.assign(new Error('REMOTE_ADMISSION_REQUIRED'),{code:'REMOTE_ADMISSION_REQUIRED'});
    const origin=new URL(this.url).origin.replace(/^ws/,'http');
    if(globalThis.location?.origin&&globalThis.location.origin!==origin)throw Error('MEMORY_ORIGIN_INVALID');
    const socket=this.socket,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try{
      const response=await fetchImpl(origin+'/api/neural-memory',{method:'POST',redirect:'error',cache:'no-store',
        credentials:'omit',signal:controller.signal,headers:{'Content-Type':'application/json',
          Authorization:'Bearer '+this.invitationToken},body:JSON.stringify({op,args})});
      const body=await response.json();
      if(this.closed||this.socket!==socket)throw Error('REMOTE_CLOSED');
      if(body?.schema!=='vivo.neural-memory/1')throw Error('MEMORY_PROTOCOL_INVALID');
      if(!response.ok)throw Object.assign(new Error(/^[A-Z][A-Z0-9_]{1,63}$/.test(body.error)?body.error:'MEMORY_REQUEST_FAILED'),{code:body.error});
      return body.result;
    }finally{clearTimeout(timer);}
  }
  async prepareAgentContext(selection,fetchImpl=globalThis.fetch){
    const packet=await this.memoryRequest('context',selection,fetchImpl);
    if(packet?.schema!=='vivo.agent-evidence-context/1'||packet.authority!=='evidence-only'||
      packet.providerAuthenticated!==false||packet.worldActionExecuted!==false||packet.postedChargesUsd!==null||
      packet.selection?.task!==selection.task||packet.selection?.mode!==selection.mode||
      !Array.isArray(packet.records)||packet.records.length>8||
      packet.records.some(r=>r.task!==selection.task||r.mode!==selection.mode||r.authority!=='evidence-only'||
        r.providerAuthenticated!==false||r.worldActionExecuted!==false||r.postedChargesUsd!==null)||
      !['evidence-found','no-matching-evidence'].includes(packet.status)||
      (packet.status==='evidence-found')!==(packet.records.length>0))throw Error('MEMORY_CONTEXT_INVALID');
    return packet;
  }
  async reasonAgentMission(selection,fetchImpl=globalThis.fetch){
    const scope=structuredClone(selection),socket=this.socket;
    const packet=await this.memoryRequest('reason',scope,fetchImpl);
    if(!packet||packet.schema!=='vivo.agent-reasoning/1'||packet.authority!=='evidence-only'||
      packet.providerAuthenticated!==false||packet.providerCallsInitiated!==0||packet.worldActionExecuted!==false||
      packet.postedChargesUsd!==null||packet.selection?.task!==scope.task||packet.selection?.mode!==scope.mode||
      packet.selection?.limit!==(scope.limit??4)||
      JSON.stringify(packet.selection?.providers)!==JSON.stringify([...(scope.providers??[])].sort())||
      !/^[0-9a-f]{64}$/.test(packet.decisionSha256??'')||
      packet.proof?.method!=='exhaustive-subset-enumeration'||packet.proof?.subsetsChecked!==15||
      packet.proposal?.feasible!==true||!Array.isArray(packet.evidence?.citations)||
      packet.evidence.citations.length>(scope.limit??4)||packet.evidence.recordsUsed!==packet.evidence.citations.length||
      !['no-matching-evidence','matching-optimum-observed','dissent-or-invalid-only','no-usable-proposal'].includes(packet.evidence.status)||
      (packet.evidence.status==='no-matching-evidence')!==(packet.evidence.citations.length===0)||
      packet.evidence.citations.some(r=>!/^council:[0-9a-f]{64}$/.test(r.memoryId??'')||
        r.memoryId!=='council:'+r.evidenceDigest||
        r.provenance!==(scope.mode==='fixture'?'synthetic-fixture':'host-reported-unverified')||
        !Array.isArray(r.observations)||r.observations.length>7||
        (scope.providers??[]).some(provider=>!r.observations.some(row=>row.provider===provider))))throw Error('MEMORY_REASONING_INVALID');
    const {decisionSha256,...core}=packet;
    const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(core)));
    const actual=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    if(this.closed||this.socket!==socket)throw Error('REMOTE_CLOSED');
    if(actual!==decisionSha256)throw Error('MEMORY_REASONING_DIGEST_MISMATCH');
    return packet;
  }
  createInvite(ttlSeconds=3600){return this.call('invite.create',{ttlSeconds});}
  revokeInvite(id){return this.call('invite.revoke',{id});}
  listInvites(){return this.call('invite.list',{});}
  async close(){
    if(this.closed)return;
    try{if(this.session)await this.call('close',{});}finally{
      await this._closeConversationProviders();
      this.closed=true;this.listeners.clear();try{this.socket?.close();}catch{}
    }
  }
}
