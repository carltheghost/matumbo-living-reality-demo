/** Presentation only: opening a feature does not replace the canonical world. */
export function clampSurface(x,y,width,height,viewportWidth,viewportHeight) {
  return {x:Math.max(8,Math.min(x,Math.max(8,viewportWidth-width-8))), y:Math.max(8,Math.min(y,Math.max(8,viewportHeight-height-42)))};
}
export function mountCenteredSurfaces(documentRoot=document, view=window) {
  const style=documentRoot.createElement('style');
  style.textContent='[data-centered-surface="true"]{position:fixed!important;right:auto!important;bottom:auto!important;transform:none!important;max-width:calc(100vw - 16px)!important;max-height:calc(100dvh - 100px)!important;overflow-y:auto!important;box-sizing:border-box}.surface-grip{display:flex;align-items:center;gap:8px;flex-shrink:0;padding:7px;border-bottom:1px solid #52687a;touch-action:none;cursor:grab;color:#d9eeff;font:12px system-ui}.surface-grip button{margin-left:auto;color:inherit;background:#15283b;border:1px solid #68859e;border-radius:4px;padding:4px 8px;cursor:pointer}';
  documentRoot.head.append(style);
  const quick=documentRoot.getElementById('block-world-quick-actions');
  if(quick){
    const toggle=documentRoot.createElement('button');toggle.type='button';toggle.textContent='Cube controls · expand / collapse';toggle.className='surface-grip';
    quick.prepend(toggle);quick.dataset.compact=String(view.innerWidth<650);
    style.textContent+=' #block-world-quick-actions[data-compact="true"] > :not(.surface-grip){display:none!important} #block-world-quick-actions[data-compact="true"]{min-height:0!important;height:auto!important;padding:5px!important}';
    toggle.setAttribute('aria-expanded',String(view.innerWidth>=650));
    toggle.onclick=()=>{const compact=quick.dataset.compact!=='true';quick.dataset.compact=String(compact);toggle.setAttribute('aria-expanded',String(!compact));};
  }
  const disposers=[];
  for(const panel of documentRoot.querySelectorAll('[id$="-console"],#launch-kit,#launch-receipt')) {
    panel.dataset.centeredSurface='true';
    const grip=documentRoot.createElement('div');grip.className='surface-grip';
    const label=documentRoot.createElement('span');label.textContent='Drag to move · world stays connected';
    const reset=documentRoot.createElement('button');reset.type='button';reset.textContent='Center';
    grip.append(label,reset); panel.prepend(grip);
    let drag=null, wasHidden=panel.hidden;
    const place=(x,y)=>{const r=panel.getBoundingClientRect();const p=clampSurface(x,y,r.width,r.height,view.innerWidth,view.innerHeight);panel.style.left=p.x+'px';panel.style.top=p.y+'px';};
    const center=()=>{const r=panel.getBoundingClientRect();place((view.innerWidth-r.width)/2,(view.innerHeight-r.height)/2);};
    reset.addEventListener('click',center);
    grip.addEventListener('pointerdown',e=>{if(e.target.closest('button')||e.button!==0)return;const r=panel.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX-r.left,y:e.clientY-r.top};grip.setPointerCapture(e.pointerId);e.preventDefault();});
    grip.addEventListener('pointermove',e=>{if(drag?.id===e.pointerId)place(e.clientX-drag.x,e.clientY-drag.y);});
    const release=()=>{drag=null;};grip.addEventListener('pointerup',release);grip.addEventListener('pointercancel',release);grip.addEventListener('lostpointercapture',release);
    const observer=new MutationObserver(()=>{if(wasHidden&&!panel.hidden)view.requestAnimationFrame(center);wasHidden=panel.hidden;});
    observer.observe(panel,{attributes:true,attributeFilter:['hidden']});
    const resize=()=>{if(!panel.hidden)center();};view.addEventListener('resize',resize);if(!panel.hidden)view.requestAnimationFrame(center);
    disposers.push(()=>{observer.disconnect();view.removeEventListener('resize',resize);grip.remove();});
  }
  return ()=>{disposers.forEach(fn=>fn());style.remove();};
}
