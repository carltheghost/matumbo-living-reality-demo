/** Same-origin loopback transport. Admission belongs to the host, not this adapter. */
export async function requestJSON(url,options={}, {fetch:fetcher=globalThis.fetch,timeoutMs=7000}={}){
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>30000)throw Error('INVALID_FETCH_TIMEOUT');
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('Local request timed out; inspect accepted state before retrying'),{code:'LOCAL_TIMEOUT'}));},timeoutMs);});
  const exchange=(async()=>{
    const response=await fetcher(url,{...options,signal:controller.signal});
    const text=await response.text();let result;
    try{result=JSON.parse(text);}catch{throw Object.assign(new Error(text||'Local application unavailable'),{code:'LOCAL_UNAVAILABLE'});}
    if(!response.ok)throw Object.assign(new Error(result.error||'Local request failed'),{code:result.error||'LOCAL_FAILED'});
    return result;
  })();
  try{return await Promise.race([exchange,deadline]);}finally{clearTimeout(timer);}
}
export class LocalTransport {
  constructor({base = '', fetch: fetcher = globalThis.fetch, onState = () => {},timeoutMs=7000} = {}) {
    this.base=base;this.fetch=fetcher;this.onState=onState;this.timeoutMs=timeoutMs;this.token=null;this.session=null;
    this.current=null;this.listeners=new Set();this.closed=false;
  }
  request(path, body, authenticated=true) {
    const headers={'Content-Type':'application/json'};
    if(authenticated)headers.Authorization='Bearer '+this.token;
    return requestJSON(this.base+path,{method:'POST',headers,body:JSON.stringify(body)},{fetch:this.fetch,timeoutMs:this.timeoutMs});
  }
  receive(state) {
    if(!state||this.closed)return;
    if(this.current&&state.snapshot.acceptedSequence<this.current.snapshot.acceptedSequence)return;
    if(this.current&&Number.isSafeInteger(state.runtimeRevision)&&Number.isSafeInteger(this.current.runtimeRevision)&&state.runtimeRevision<this.current.runtimeRevision)return;
    this.current=structuredClone(state);this.onState(structuredClone(state));
    for(const listener of this.listeners)listener(this.getSnapshot());
  }
  async admit(seat,resumeToken,readOnly=false) {
    const result=await this.request('/api/local/open',{seat,...(resumeToken?{resumeToken}:{}),...(readOnly?{readOnly:true}:{})},false);
    this.token=result.token;this.session=result.session;this.closed=false;this.current=null;this.receive(result.state);return result;
  }
  async call(op,args={}) {
    if(this.closed)throw Error('SESSION_CLOSED');
    const result=await this.request('/api/local/rpc',{op,args});this.receive(result.state);return result.value;
  }
  async open(){if(!this.session)throw Error('LOCAL_ADMISSION_REQUIRED');return this.session;}
  getSnapshot(){if(!this.current)throw Error('NO_SNAPSHOT');return structuredClone(this.current.snapshot);}
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  submit(command){return this.call('submit',{command});}
  inspectLease(spaceId,entityId,criteria={}){return this.call('inspectLease',{spaceId,entityId,...(Object.keys(criteria).length?{criteria}:{})});}
  renewLease(leaseId){return this.call('renewLease',{leaseId});}
  reconcileLease(event){return this.call('reconcileLease',{event});}
  moveEye(view,expectedRevision){return this.call('moveEye',{view,expectedRevision});}
  refresh(){return this.call('state');}
  nextEpoch(){return this.call('nextEpoch');}
  observeMaterial(entityId,axes){return this.call('materialObserve',{entityId,axes});}
  export(){return this.call('export');}
  async close(){if(this.closed)return;await this.call('close');this.closed=true;this.listeners.clear();}
}
