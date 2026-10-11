/** Canonical remote Vivo transport over one authenticated WebSocket.
 * The server-owned runtime token is never exposed to this client.
 */
export class RemoteTransport {
  constructor({url,token,WebSocket:Socket=globalThis.WebSocket,onState=()=>{},timeoutMs=7000}={}) {
    if(typeof url!=='string'||!url.length||typeof token!=='string'||token.length<20||typeof Socket!=='function')
      throw new TypeError('Remote transport configuration required');
    this.url=url;this.invitationToken=token;this.Socket=Socket;this.onState=onState;this.timeoutMs=timeoutMs;
    this.socket=null;this.session=null;this.actorId=null;this.role=null;this.current=null;
    this.pending=new Map();this.listeners=new Set();this.serial=0;this.closed=true;
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
      ws.onclose=()=>{this.closed=true;for(const p of this.pending.values())p.reject(Object.assign(new Error('Remote socket closed'),{code:'REMOTE_CLOSED'}));this.pending.clear();};
      ws.onopen=()=>ws.send(JSON.stringify({type:'join',token:this.invitationToken}));
      ws.onmessage=event=>{
        let msg;try{msg=JSON.parse(event.data);}catch{return;}
        if(msg.type==='joined'){
          clearTimeout(timer);this.role=msg.role;this.actorId=msg.actorId;this.session=msg.session;this.receive(msg.state);
          resolve({role:this.role,actorId:this.actorId,session:structuredClone(this.session),state:structuredClone(this.current)});return;
        }
        if(msg.type==='error'&&!this.session){fail(Object.assign(new Error(msg.code||'REMOTE_JOIN_FAILED'),{code:msg.code||'REMOTE_JOIN_FAILED'}));return;}
        this._message(msg);
      };
    });
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
  inspectLease(spaceId,entityId,criteria={}){return this.call('inspectLease',{spaceId,entityId,...(Object.keys(criteria).length?{criteria}:{})});}
  renewLease(leaseId){return this.call('renewLease',{leaseId});}
  reconcileLease(event){return this.call('reconcileLease',{event});}
  moveEye(view,expectedRevision){return this.call('moveEye',{view,expectedRevision});}
  refresh(){return this.call('state');}
  nextEpoch(){return this.call('nextEpoch');}
  export(){return this.call('export');}
  materialRun(running){return this.call('materialRun',{running});}
  createInvite(ttlSeconds=3600){return this.call('invite.create',{ttlSeconds});}
  revokeInvite(id){return this.call('invite.revoke',{id});}
  listInvites(){return this.call('invite.list',{});}
  async close(){
    if(this.closed)return;
    try{if(this.session)await this.call('close',{});}finally{this.closed=true;this.listeners.clear();try{this.socket?.close();}catch{}}
  }
}
