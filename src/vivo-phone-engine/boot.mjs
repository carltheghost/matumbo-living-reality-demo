import{VivoPhoneEngine}from'./engine.mjs';

// Navigation only: the legacy app and its saved data stay available below.
function installFieldLabHandoff(host) {
  const page=new URL(location.href), legacy=new URL('../../field-lab-studio.html',import.meta.url);
  if(!['https:','http:'].includes(page.protocol)||page.origin!==legacy.origin||page.pathname!==legacy.pathname)return null;
  const previous=document.getElementById('vivoCurrentFieldLab');if(previous)return previous;
  const section=document.createElement('section');section.id='vivoCurrentFieldLab';section.className='panel';
  section.setAttribute('aria-labelledby','vivoCurrentFieldLabTitle');
  const label=document.createElement('div');label.className='badge';label.textContent='CURRENT VIVO / FIELD LAB';
  const title=document.createElement('h2');title.id='vivoCurrentFieldLabTitle';title.textContent='Your current Field Lab is here.';
  const link=document.createElement('a');link.id='vivoCurrentFieldLabLink';
  link.href=new URL('../../services/vivo/web/phone/field-lab.html',import.meta.url).href;
  link.textContent='Open current Vivo Field Lab';link.setAttribute('aria-describedby','vivoCurrentFieldLabNote');
  const note=document.createElement('p');note.id='vivoCurrentFieldLabNote';
  note.textContent='No original HTML download is required. First use may need an internet connection.';
  const retained=document.createElement('p');retained.className='vivo-retained-note';
  retained.textContent='Your saved Viva 0.7 app remains below. Its worlds stay separate and are not automatically migrated. This link does not erase your saved data.';
  section.append(label,title,link,note,retained);
  const style=document.createElement('style');style.id='vivoCurrentFieldLabStyle';
  style.textContent='#vivoCurrentFieldLab{border-color:#a4eedc}#vivoCurrentFieldLab h2{margin:12px 0;line-height:1.2;font-size:26px}#vivoCurrentFieldLabLink{display:flex;align-items:center;justify-content:center;box-sizing:border-box;min-height:54px;margin:16px 0;padding:14px;border:2px solid #a4eedc;border-radius:12px;background:#a4eedc;color:#09251d;text-decoration:none;text-align:center;font:600 16px system-ui}#vivoCurrentFieldLabLink:focus-visible{outline:3px solid #fff;outline-offset:4px}#vivoCurrentFieldLab p{font-size:14px;line-height:1.6}#vivoCurrentFieldLab .vivo-retained-note{font-size:12px;color:#bbd3d5}';
  document.head.append(style);host.prepend(section);return section;
}

const engine=new VivoPhoneEngine({worldId:'field-lab-studio.phone'});
globalThis.VivoPhoneEngine=engine;
async function installCache(){if(!('serviceWorker'in navigator)||!isSecureContext)return false;try{await navigator.serviceWorker.register('./vivo-phone-sw.js',{scope:'./'});return true;}catch{return false;}}
function xrLabel(caps){if(!caps.apiAvailable)return'WebXR unavailable in this browser/companion';const supported=caps.supported||{};return'WebXR '+(supported['immersive-ar']?'AR ready':'AR unavailable')+' / '+(supported['immersive-vr']?'VR ready':'VR unavailable')+'; physical validation remains separate';}
function badge(){
  const host=document.querySelector('main')||document.body,section=document.createElement('section');
  section.className='panel';section.id='vivoPhoneEnginePanel';
  section.innerHTML='<div class="badge">VIVO / PHONE ENGINE</div><h2 style="margin:10px 0">Local compute node</h2><p id="vivoPhoneEngineState">Starting sparse phone engine.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button id="vivoGuardian" class="secondary">Run device agent</button><button id="vivoProjection" class="secondary">Hands-free projection</button><button id="vivoAR" class="secondary">Start AR</button><button id="vivoVR" class="secondary">Start VR</button></div><small id="vivoXRState">Checking WebXR capabilities...</small><pre id="vivoAgentState" style="white-space:pre-wrap;font:11px ui-monospace,monospace;color:#a9c8c0"></pre><small id="vivoNativeState"></small>';
  host.prepend(section);
  installFieldLabHandoff(host);
  section.querySelector('#vivoGuardian').onclick=async()=>{const out=section.querySelector('#vivoAgentState');try{const result=await engine.runAgent('device.guardian',{});out.textContent=JSON.stringify(result,null,2);}catch(e){out.textContent=e.code||e.message;}};
  section.querySelector('#vivoProjection').onclick=async()=>{const s=section.querySelector('#vivoPhoneEngineState');try{const r=await engine.handsFreeProjection();s.textContent=r?.reason??'Projection controls opened. Vivo remains active on this phone.';}catch(e){s.textContent=e.code||e.message;}};
  const xrState=section.querySelector('#vivoXRState');
  const updateXR=async()=>{try{const caps=await engine.xrCapabilities();xrState.textContent=xrLabel(caps);for(const [id,mode] of [['vivoAR','immersive-ar'],['vivoVR','immersive-vr']])section.querySelector('#'+id).disabled=!caps.supported?.[mode];}catch(e){xrState.textContent='WebXR check failed: '+(e.code||e.message);}};
  const startXR=mode=>async()=>{try{const caps=engine.xr.capabilities();if(caps.sessionActive){await engine.endXR();xrState.textContent='XR session ended; local engine remains active.';return;}const result=await engine.startXR(mode);xrState.textContent='XR '+mode+' active; frames remain local and are not authority commits.';section.querySelector('#vivoAR').disabled=true;section.querySelector('#vivoVR').disabled=true;}catch(e){xrState.textContent='XR '+mode+' not started: '+(e.code||e.message);}};
  section.querySelector('#vivoAR').onclick=startXR('immersive-ar');section.querySelector('#vivoVR').onclick=startXR('immersive-vr');
  engine.addEventListener('xrchange',event=>{if(!event.detail.sessionActive)updateXR();});
  void updateXR();return section;
}
const panel=badge();
panel.querySelector('#vivoNativeState').textContent=engine.native.available()?'Android Companion detected - native device tools available':'Browser-only mode - engine/camera/touch still run locally';
Promise.all([installCache(),engine.start({dimension:4})]).then(([cached,caps])=>{panel.querySelector('#vivoPhoneEngineState').textContent='READY - worker-local sparse 3-11D engine - '+(caps.webgpu?'WebGPU available':'WebGL/WASM path')+' - '+(cached?'offline cache armed':'online cache unavailable');}).catch(error=>{panel.querySelector('#vivoPhoneEngineState').textContent='Phone engine start failed: '+(error.code||error.message);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)engine.checkpoint().catch(()=>{});});
addEventListener('pagehide',()=>{engine.checkpoint().catch(()=>{});engine.close();});
