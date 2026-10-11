/* Additive, explicit publication/return adapter. No automatic multiplayer conversion.
 * Original Studio bytes are preserved as studio-original.html.
 */
(function(){
 'use strict';const A=window.FieldApp;if(!A)return;
 if(/^https?:$/.test(location.protocol))window.FieldHandAssets={bundle:new URL('vendor/field-lab/vision_bundle.mjs',location.href).href,wasm:new URL('vendor/field-lab/wasm',location.href).href,model:new URL('vendor/field-lab/hand_landmarker.task',location.href).href};
 const store={get(k){try{return sessionStorage.getItem(k);}catch(_){return null;}},set(k,v){sessionStorage.setItem(k,v);},remove(k){try{sessionStorage.removeItem(k);}catch(_){}}};
 const bar=document.createElement('div');bar.id='sharedBridge';bar.style.cssText='position:fixed;left:12px;top:82px;z-index:100;display:flex;gap:8px;max-width:95vw;flex-wrap:wrap;';
 const open=document.createElement('button');open.textContent='Shared workshop 0.8 ↗';const publish=document.createElement('button');publish.textContent='Publish this place ↗';bar.append(open,publish);document.body.append(bar);
 const whole=store.get('viva-bridge-universe');
 if(whole&&A.viva){A.viva.import(JSON.parse(whole)).catch(e=>alert('Stored Studio universe could not be restored: '+e.message));}
 open.onclick=()=>{A.presence?.stop();location.href='./';};
 publish.onclick=()=>{try{
  if(!confirm('Publish named objects to a new shared 9D workshop? This is an explicit state handoff. The original Studio world is retained, not silently synchronized.'))return;
  A.setPause(true);const state=A.snapshot();store.set('viva-bridge-original',JSON.stringify(state));if(A.viva)store.set('viva-bridge-universe',JSON.stringify(A.viva.export()));
  const space=A.viva?.active||'field',objects=A.landmarks.slice(0,32).map(l=>{const raw=Array.from(A.engine.q.slice(l.node*9,l.node*9+9));return {id:('viva-'+space+'-node-'+l.node).replace(/[^a-zA-Z0-9_-]/g,'_'),name:l.name,q:[raw[0],raw[2],raw[1],...raw.slice(3)],radius:.12,source:space+':'+l.node};});
  if(!objects.length)throw Error('Create a named landmark before publishing.');
  store.set('viva-publish',JSON.stringify({space,dimension:9,entities:objects}));A.presence?.stop();location.href='./';
 }catch(e){alert(e.message);}};
 const saved=store.get('viva-return-state');if(saved){
  const b=document.createElement('button');b.textContent='Apply exported shared positions';bar.append(b);
  b.onclick=()=>{try{
   const s=JSON.parse(saved),original=JSON.parse(store.get('viva-bridge-original'));
   if(!original)throw Error('Original publication checkpoint is missing.');
   if(s.geometry.kind!=='flat'||s.geometry.dimension!==9)throw Error('Only the explicitly published flat 9D map can be returned. Other spaces remain in the server export.');
   if(!confirm('Restore the published place and apply its shared positions? It remains paused and receives a new energy baseline. Other visited spaces are kept.'))return;
   const staged=JSON.parse(JSON.stringify(original)),space=original.viva?.space||'field';let count=0;
   for(const e of Object.values(s.entities||{})){
    if(typeof e.source!=='string'||!e.source.startsWith(space+':'))continue;
    const node=Number(e.source.slice(space.length+1));if(!Number.isInteger(node)||!staged.landmarks.some(l=>l.node===node))throw Error('Unrecognized published node.');
    if(!Array.isArray(e.q)||e.q.length!==9||!e.q.every(x=>Number.isFinite(x)&&Math.abs(x)<=30))throw Error('Invalid shared coordinates.');
    const q=[e.q[0],e.q[2],e.q[1],...e.q.slice(3)];for(let j=0;j<9;j++){staged.engine.q[node*9+j]=q[j];staged.engine.velocity[node*9+j]=0;}count++;
   }
   if(!count)throw Error('No matching published objects.');
   const candidate=NDPhysics.NDFieldEngine.restore(staged.engine);candidate.work=0;candidate.dissipated=0;candidate.initialEnergy=candidate.energy();staged.engine=candidate.snapshot();staged.view.paused=true;
   A.viva?.validateState(staged);A.applySnapshot(staged);if(A.viva)store.set('viva-bridge-universe',JSON.stringify(A.viva.export()));store.remove('viva-return-state');b.remove();
  }catch(e){alert(e.message);}};
 }
})();
