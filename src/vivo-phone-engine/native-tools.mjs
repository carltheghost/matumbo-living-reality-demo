const makeError=(code,message=code)=>Object.assign(new Error(message),{code});
export class NativeToolClient{
  constructor({timeoutMs=7000}={}){
    this.timeoutMs=timeoutMs;this.pending=new Map();this.serial=0;this.bridge=globalThis.VivoAndroid??null;
    this.listener=event=>{const r=event?.detail;if(!r||typeof r.id!=='string')return;const p=this.pending.get(r.id);if(!p)return;this.pending.delete(r.id);clearTimeout(p.timer);r.ok===false?p.reject(makeError(r.error||'NATIVE_TOOL_FAILED')):p.resolve(r.value??r);};
    globalThis.addEventListener?.('vivo-native-result',this.listener);
  }
  available(){return!!this.bridge;}
  capabilities(){if(!this.bridge)return{schema:'vivo.android-capabilities/1',tools:[]};try{return JSON.parse(this.bridge.capabilities());}catch{return{tools:[]};}}
  request(tool,args={}){
    if(!this.bridge)return Promise.reject(makeError('NATIVE_BRIDGE_UNAVAILABLE'));
    const id='web.'+(++this.serial)+'.'+crypto.randomUUID();
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(makeError('NATIVE_TOOL_TIMEOUT'));},this.timeoutMs);this.pending.set(id,{resolve,reject,timer});try{this.bridge.request(JSON.stringify({id,tool,args}));}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});
  }
  close(){globalThis.removeEventListener?.('vivo-native-result',this.listener);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(makeError('NATIVE_CLIENT_CLOSED'));}this.pending.clear();}
}
export class BrowserToolClient{
  constructor(){this.wake=null;}
  capabilities(){const tools=['device.info','haptics.pulse','display.keepAwake'];if('share'in navigator)tools.push('app.shareText');return{schema:'vivo.browser-capabilities/1',tools};}
  async request(tool,args={}){
    switch(tool){
      case'device.info':return{userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency||null,deviceMemory:navigator.deviceMemory||null,maxTouchPoints:navigator.maxTouchPoints||0,webgpu:!!navigator.gpu,secureContext:isSecureContext};
      case'haptics.pulse':{const ms=Math.max(10,Math.min(1000,Number(args.ms)||40));if(!navigator.vibrate)throw makeError('VIBRATION_UNAVAILABLE');navigator.vibrate(ms);return{ms};}
      case'display.keepAwake':{if(args.enabled===false){await this.wake?.release?.();this.wake=null;return{enabled:false};}if(!navigator.wakeLock?.request)throw makeError('WAKE_LOCK_UNAVAILABLE');this.wake=await navigator.wakeLock.request('screen');return{enabled:true};}
      case'app.shareText':{if(!navigator.share)throw makeError('SHARE_UNAVAILABLE');await navigator.share({text:String(args.text??'').slice(0,10000)});return{shared:true};}
      default:throw makeError('TOOL_UNAVAILABLE');
    }
  }
}
