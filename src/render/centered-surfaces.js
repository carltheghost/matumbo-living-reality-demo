/** Reality Lens Ω — universal floating spatial-window manager.
 *
 * Desktop floating surfaces are independent windows: move, resize, depth,
 * arrange, minimize/restore, focus, close and persist without recentering.
 * Minimized windows use the same compact glass-cube language as TUMBO-SIM
 * TRANSFERS instead of a long horizontal tab strip.
 *
 * Presentation only. This module does not own identity, wallet, ledger,
 * provider, signing, custody, settlement or execution authority.
 */

export const PANEL_DEPTH_MIN=-800;
export const PANEL_DEPTH_MAX=500;
export const PANEL_WIDTH_MIN=180;
export const PANEL_WIDTH_MAX=1200;
export const PANEL_HEIGHT_MIN=100;
export const PANEL_HEIGHT_MAX=900;

const PANEL_PERSPECTIVE=1400;
const NARROW_QUERY='(max-width:700px)';
const STORE_KEY='matumbo.panelSpace.v2';
const LEGACY_STORE_KEY='matumbo.panelSpace.v1';
const PANEL_GUTTER=18;
const RIGHT_RAIL_GUTTER=116;
const Z_BASE=2200;
const ARRANGEMENTS=new Set(['free','left','right','top','bottom','front','back']);
const EXTRA_PANEL_IDS=['gesture-input-panel','media-preview','city-journey','hint'];

export function clampSurface(x,y,width,height,viewportWidth,viewportHeight){
  const w=Math.max(0,Number(width)||0),h=Math.max(0,Number(height)||0);
  const vw=Math.max(8,Number(viewportWidth)||0),vh=Math.max(50,Number(viewportHeight)||0);
  return {
    x:Math.max(8,Math.min(Number(x)||0,Math.max(8,vw-w-8))),
    y:Math.max(8,Math.min(Number(y)||0,Math.max(8,vh-h-42))),
  };
}

export function clampDepth(z){
  const n=Number(z);
  return Number.isFinite(n)?Math.max(PANEL_DEPTH_MIN,Math.min(PANEL_DEPTH_MAX,n)):0;
}

export function depthScale(z){
  return PANEL_PERSPECTIVE/(PANEL_PERSPECTIVE-clampDepth(z));
}

export function depthBrightness(z){
  const c=clampDepth(z);
  return Math.max(.75,Math.min(1.12,1+c/4500));
}

export function clampSurfaceSize(width,height,viewportWidth,viewportHeight){
  const vw=Math.max(240,Number(viewportWidth)||0),vh=Math.max(180,Number(viewportHeight)||0);
  const maxW=Math.max(PANEL_WIDTH_MIN,Math.min(PANEL_WIDTH_MAX,vw-36));
  const maxH=Math.max(PANEL_HEIGHT_MIN,Math.min(PANEL_HEIGHT_MAX,vh-78));
  return {
    width:Math.max(PANEL_WIDTH_MIN,Math.min(maxW,Number(width)||PANEL_WIDTH_MIN)),
    height:Math.max(PANEL_HEIGHT_MIN,Math.min(maxH,Number(height)||PANEL_HEIGHT_MIN)),
  };
}

export function composePanelTransform(x,y,z){
  return 'translate3d('+Number(x||0).toFixed(1)+'px, '+Number(y||0).toFixed(1)+'px, 0px) scale('+depthScale(z).toFixed(4)+')';
}

export function normalizePanelArrangement(value){
  const key=String(value||'').toLowerCase();
  return ARRANGEMENTS.has(key)?key:'free';
}

export function collectPanelDescriptors(documentRoot){
  const out=[],seen=new Set();
  const push=(el,type='panel')=>{
    if(!el||seen.has(el))return;
    if(el.getAttribute?.('data-panel-space-ignore')==='true')return;
    if(el.id==='portal-return-console'||el.id==='cube-dive-hud')return;
    if(el.classList?.contains?.('assembly-directory'))return;
    seen.add(el);
    out.push({id:el.id||el.getAttribute?.('data-panel-space-title')||'(panel)',el,type});
  };
  if(!documentRoot)return out;
  if(typeof documentRoot.querySelectorAll==='function'){
    for(const el of documentRoot.querySelectorAll('aside'))push(el,'aside');
    for(const el of documentRoot.querySelectorAll('[data-floating-panel="true"]'))push(el,'floating');
  }
  if(typeof documentRoot.getElementById==='function'){
    for(const id of EXTRA_PANEL_IDS){
      const el=documentRoot.getElementById(id);
      if(el)push(el,'extra');
    }
  }
  return out;
}

export function panelTitle(el){
  if(!el)return 'Panel';
  try{
    const explicit=el.getAttribute?.('data-panel-space-title');
    if(explicit?.trim())return explicit.trim().slice(0,64);
    const labelled=el.getAttribute?.('aria-label');
    if(labelled?.trim())return labelled.trim().slice(0,64);
    const head=el.querySelector?.('h1,h2,h3,summary');
    const text=head?.textContent?.trim();
    if(text)return text.slice(0,64);
  }catch{}
  const id=String(el.id||'').replace(/[-_]+/g,' ').trim();
  return id?id.replace(/\b\w/g,c=>c.toUpperCase()):'Panel';
}

export function isPanelVisible(el,view){
  if(!el||el.hidden===true)return false;
  if(el.id==='feature-shell')return !!el.classList?.contains?.('open');
  if(el.tagName==='DETAILS')return el.open!==false;
  try{
    const cs=view?.getComputedStyle?.(el);
    if(cs&&(cs.display==='none'||cs.visibility==='hidden'||cs.visibility==='collapse'))return false;
  }catch{}
  return true;
}

function readJson(view,key){
  try{
    const raw=view?.localStorage?.getItem?.(key);
    if(!raw)return {};
    const data=JSON.parse(raw);
    return data&&typeof data==='object'?data:{};
  }catch{return {};}
}

function readStore(view){
  const legacy=readJson(view,LEGACY_STORE_KEY);
  const modern=readJson(view,STORE_KEY);
  const merged={...legacy};
  for(const [id,value] of Object.entries(modern))merged[id]={...(merged[id]||{}),...(value||{})};
  return merged;
}

function writeStore(view,data){
  try{
    if(!view?.localStorage)return;
    view.localStorage.setItem(STORE_KEY,JSON.stringify(data));
    const legacy={};
    for(const [id,value] of Object.entries(data||{}))legacy[id]={x:value.x,y:value.y,z:value.z};
    view.localStorage.setItem(LEGACY_STORE_KEY,JSON.stringify(legacy));
  }catch{}
}

const PANEL_SPACE_CSS=[
'[data-panel-space]{box-sizing:border-box!important;transform-origin:0 0!important;transition-property:opacity,filter!important;will-change:transform,opacity}',
'[data-panel-space].panel-space-front{box-shadow:0 22px 80px rgba(0,0,0,.62),0 0 0 1px rgba(116,218,255,.12),0 0 36px rgba(95,191,255,.08)!important}',
'.surface-grip{position:relative;display:grid;grid-template-columns:48px minmax(0,1fr) auto auto auto;align-items:center;gap:7px;width:100%;min-height:70px;padding:7px 8px;touch-action:none;color:#dff7ff;background:linear-gradient(145deg,rgba(25,59,82,.98),rgba(5,15,24,.98) 72%);border:1px solid rgba(129,232,255,.24);border-radius:15px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 10px 34px rgba(0,0,0,.48);user-select:none;-webkit-user-select:none}',
'.surface-grip-toggle{display:flex;align-items:center;gap:8px;min-width:0;min-height:54px;padding:3px 4px;border:0;background:transparent;color:inherit;cursor:grab;text-align:left;font:600 10px/1.2 system-ui,-apple-system,Segoe UI,sans-serif}',
'.surface-grip-toggle:active{cursor:grabbing}',
'.surface-grip-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.05em;text-transform:uppercase}',
'.surface-grip-action{display:block;min-width:48px;padding:6px 8px;border:1px solid rgba(127,218,255,.32);border-radius:8px;color:#9ee9ff;background:rgba(8,24,36,.76);font-size:9px;letter-spacing:.08em;text-transform:uppercase;text-align:center}',
'.surface-grip-center,.surface-grip-arrange,.surface-grip-close{min-width:36px;min-height:36px;padding:5px 7px;border:1px solid rgba(129,232,255,.28);border-radius:9px;color:#dff8ff;background:rgba(8,24,36,.82);cursor:pointer;font-size:11px}',
'.surface-grip-arrange{font-size:9px;max-width:82px}',
'.surface-grip-close{font-size:18px;line-height:1;border-color:rgba(255,123,143,.42);color:#ffd5dc}',
'.surface-grip-close:hover{border-color:rgba(255,123,143,.8);background:rgba(74,19,31,.92)}',
'.surface-mini-cube{position:relative;width:42px;height:42px;flex:none;transform-style:preserve-3d;transform:rotateX(-18deg) rotateY(28deg);animation:panel-space-cube-spin 6s linear infinite;perspective:520px}',
'.surface-mini-face{position:absolute;inset:0;border:1px solid rgba(153,238,255,.55);border-radius:6px;background:linear-gradient(145deg,rgba(111,225,255,.34),rgba(8,26,36,.92));box-shadow:inset 0 0 14px rgba(103,224,255,.12),0 0 15px rgba(103,224,255,.09);backface-visibility:hidden}',
'.surface-mini-face--front{transform:translateZ(21px)}',
'.surface-mini-face--back{transform:rotateY(180deg) translateZ(21px)}',
'.surface-mini-face--right{transform:rotateY(90deg) translateZ(21px)}',
'.surface-mini-face--left{transform:rotateY(-90deg) translateZ(21px)}',
'.surface-mini-face--top{transform:rotateX(90deg) translateZ(21px)}',
'.surface-mini-face--bottom{transform:rotateX(-90deg) translateZ(21px)}',
'.surface-mini-mark{position:absolute;inset:0;display:grid;place-items:center;color:#e9fdff;font-size:13px;line-height:1;text-shadow:0 0 12px rgba(117,232,255,.82)}',
'@keyframes panel-space-cube-spin{0%{transform:rotateX(-18deg) rotateY(0deg)}50%{transform:rotateX(-18deg) rotateY(180deg)}100%{transform:rotateX(-18deg) rotateY(360deg)}}',
'[data-panel-space][data-compact="true"]{width:auto!important;max-width:none!important;max-height:none!important;overflow:visible!important;background:transparent!important;border:0!important;box-shadow:none!important}',
'[data-panel-space][data-compact="true"]>:not(.surface-grip){display:none!important}',
'[data-panel-space][data-compact="true"]>.surface-grip{width:min(225px,calc(100vw - 24px))!important;min-height:92px!important;grid-template-columns:44px minmax(0,1fr) 30px!important;padding:7px!important;border-radius:15px!important}',
'[data-panel-space][data-compact="true"]>.surface-grip .surface-grip-toggle{grid-row:1 / span 2;min-height:76px}',
'[data-panel-space][data-compact="true"]>.surface-grip .surface-grip-action{grid-column:2;grid-row:2;min-height:24px;padding:4px 6px}',
'[data-panel-space][data-compact="true"]>.surface-grip .surface-grip-center,[data-panel-space][data-compact="true"]>.surface-grip .surface-grip-arrange{display:none!important}',
'[data-panel-space][data-compact="true"]>.surface-grip .surface-grip-close{grid-column:3;grid-row:1;align-self:start;min-width:30px;min-height:30px}',
'[data-panel-space]:not([data-compact="true"]){min-width:180px;max-width:min(92vw,1200px);max-height:min(88vh,900px);border-radius:17px}',
'.panel-space-resize{position:absolute;z-index:20;width:16px;height:16px;margin:-4px;background:transparent;border:0;padding:0;touch-action:none}',
'.panel-space-resize[data-dir="n"]{top:0;left:50%;transform:translate(-50%,-30%);cursor:ns-resize}',
'.panel-space-resize[data-dir="s"]{bottom:0;left:50%;transform:translate(-50%,30%);cursor:ns-resize}',
'.panel-space-resize[data-dir="e"]{top:50%;right:0;transform:translate(30%,-50%);cursor:ew-resize}',
'.panel-space-resize[data-dir="w"]{top:50%;left:0;transform:translate(-30%,-50%);cursor:ew-resize}',
'.panel-space-resize[data-dir="ne"]{top:0;right:0;transform:translate(30%,-30%);cursor:nesw-resize}',
'.panel-space-resize[data-dir="nw"]{top:0;left:0;transform:translate(-30%,-30%);cursor:nwse-resize}',
'.panel-space-resize[data-dir="se"]{bottom:0;right:0;transform:translate(30%,30%);cursor:nwse-resize}',
'.panel-space-resize[data-dir="sw"]{bottom:0;left:0;transform:translate(-30%,30%);cursor:nesw-resize}',
'.panel-space-dragging *,.panel-space-resizing *{user-select:none!important;-webkit-user-select:none!important}',
'@media(prefers-reduced-motion:reduce){.surface-mini-cube{animation:none}}',
].join('\\n');

export function mountCenteredSurfaces(documentRoot=document,view=window){
  const noop=()=>{};
  if(!documentRoot||!view)return noop;
  const mq=typeof view.matchMedia==='function'?view.matchMedia(NARROW_QUERY):null;
  const isNarrow=()=>mq?!!mq.matches:(Number(view.innerWidth)||1024)<=700;
  const raf=typeof view.requestAnimationFrame==='function'?view.requestAnimationFrame.bind(view):(fn)=>setTimeout(fn,16);
  let active=false,teardownActive=null;

  const viewport=()=>({
    w:Math.max(320,Number(view.innerWidth)||1024),
    h:Math.max(240,Number(view.innerHeight)||768),
  });

  function applyTransform(rec){
    rec.el.style.transform=composePanelTransform(rec.state.x,rec.state.y,rec.state.z);
    rec.el.style.filter=rec.state.z===0?'':'brightness('+depthBrightness(rec.state.z).toFixed(3)+')';
    rec.el.style.zIndex=String(rec.state.zIndex||Z_BASE);
  }

  function persistSoon(ctx){
    if(ctx.saveTimer)return;
    ctx.saveTimer=setTimeout(()=>{
      ctx.saveTimer=0;
      const data={};
      for(const rec of ctx.recs){
        if(!rec.placed)continue;
        data[rec.id]={
          x:Math.round(rec.state.x),
          y:Math.round(rec.state.y),
          z:Math.round(rec.state.z),
          width:Math.round(rec.state.width),
          height:Math.round(rec.state.height),
          compact:rec.compact!==false,
          arrangement:rec.arrangement||'free',
          zIndex:Math.round(rec.state.zIndex||Z_BASE),
        };
      }
      writeStore(view,data);
    },180);
  }

  function dimensions(rec){
    const v=viewport();
    return rec.compact
      ? {width:Math.min(225,Math.max(180,v.w-24)),height:92}
      : {width:rec.state.width||320,height:rec.state.height||220};
  }

  function clampPosition(rec){
    const d=dimensions(rec);
    const scale=depthScale(rec.state.z);
    const v=viewport();
    const p=clampSurface(rec.state.x,rec.state.y,d.width*scale,d.height*scale,v.w,v.h);
    rec.state.x=p.x;
    rec.state.y=p.y;
  }

  function bringFront(rec,ctx){
    if(!rec?.placed)return;
    rec.state.zIndex=++ctx.zCounter;
    rec.el.style.zIndex=String(rec.state.zIndex);
    rec.el.classList?.add?.('panel-space-front');
    persistSoon(ctx);
  }

  function setCompact(rec,on,ctx,remember=true){
    if(!rec.compactible)return;
    rec.compact=!!on;
    rec.el.setAttribute('data-compact',rec.compact?'true':'false');
    if(rec.actionEl)rec.actionEl.textContent=rec.compact?'Open':'Minimize';
    if(rec.toggleBtn)rec.toggleBtn.setAttribute('aria-expanded',String(!rec.compact));
    if(rec.compact){
      rec.el.style.removeProperty?.('width');
      rec.el.style.removeProperty?.('height');
    }else{
      rec.el.style.width=(rec.state.width||320)+'px';
      rec.el.style.height=(rec.state.height||220)+'px';
    }
    clampPosition(rec);
    applyTransform(rec);
    if(remember)persistSoon(ctx);
  }

  function toggleCompact(rec,ctx){
    setCompact(rec,!rec.compact,ctx);
  }

  function recenter(rec,ctx){
    if(!rec.placed)return;
    const v=viewport(),d=dimensions(rec);
    rec.state.x=Math.max(8,(v.w-d.width)/2);
    rec.state.y=Math.max(48,(v.h-d.height)/2);
    rec.state.z=0;
    rec.arrangement='free';
    bringFront(rec,ctx);
    clampPosition(rec);
    applyTransform(rec);
    persistSoon(ctx);
  }

  function arrange(rec,ctx,value){
    const arrangement=normalizePanelArrangement(value);
    const v=viewport(),d=dimensions(rec);
    rec.arrangement=arrangement;
    if(arrangement==='left'){
      rec.state.x=PANEL_GUTTER;
      rec.state.y=Math.max(48,(v.h-d.height)/2);
    }else if(arrangement==='right'){
      rec.state.x=Math.max(PANEL_GUTTER,v.w-d.width-RIGHT_RAIL_GUTTER);
      rec.state.y=Math.max(48,(v.h-d.height)/2);
    }else if(arrangement==='top'){
      rec.state.x=Math.max(PANEL_GUTTER,(v.w-d.width)/2);
      rec.state.y=56;
    }else if(arrangement==='bottom'){
      rec.state.x=Math.max(PANEL_GUTTER,(v.w-d.width)/2);
      rec.state.y=Math.max(48,v.h-d.height-58);
    }else if(arrangement==='front'){
      rec.state.z=PANEL_DEPTH_MAX;
    }else if(arrangement==='back'){
      rec.state.z=PANEL_DEPTH_MIN;
    }
    clampPosition(rec);
    bringFront(rec,ctx);
    applyTransform(rec);
    if(rec.arrange)rec.arrange.value=arrangement;
    persistSoon(ctx);
  }

  function createMiniCube(rec){
    const cube=documentRoot.createElement('span');
    cube.className='surface-mini-cube';
    cube.setAttribute('aria-hidden','true');
    const faces=[
      ['front',rec.icon],
      ['back','⌖'],
      ['right','T'],
      ['left','Ω'],
      ['top','✦'],
      ['bottom','▦'],
    ];
    for(const [name,mark] of faces){
      const face=documentRoot.createElement('span');
      face.className='surface-mini-face surface-mini-face--'+name;
      const symbol=documentRoot.createElement('span');
      symbol.className='surface-mini-mark';
      symbol.textContent=mark;
      face.appendChild(symbol);
      cube.appendChild(face);
    }
    return cube;
  }

  function createGrip(rec,ctx){
    const grip=documentRoot.createElement('div');
    grip.className='surface-grip';

    const toggle=documentRoot.createElement('button');
    toggle.type='button';
    toggle.className='surface-grip-toggle';
    toggle.title=rec.title+' — drag to move; Shift-drag or wheel for depth';
    toggle.setAttribute('aria-label',rec.title+' — drag to move');

    const cube=createMiniCube(rec);
    const label=documentRoot.createElement('span');
    label.className='surface-grip-label';
    label.textContent=rec.title;
    toggle.append(cube,label);

    const action=documentRoot.createElement('span');
    action.className='surface-grip-action';
    action.textContent='Open';

    const center=documentRoot.createElement('button');
    center.type='button';
    center.className='surface-grip-center';
    center.textContent='⌖';
    center.title='Center panel';
    center.setAttribute('aria-label','Center '+rec.title);

    const arrangeSelect=documentRoot.createElement('select');
    arrangeSelect.className='surface-grip-arrange';
    arrangeSelect.title='Arrange panel';
    arrangeSelect.setAttribute('aria-label','Arrange '+rec.title);
    for(const value of ['free','left','right','top','bottom','front','back']){
      const option=documentRoot.createElement('option');
      option.value=value;
      option.textContent=value==='free'?'Free':value.charAt(0).toUpperCase()+value.slice(1);
      arrangeSelect.appendChild(option);
    }
    arrangeSelect.value=rec.arrangement;

    const close=documentRoot.createElement('button');
    close.type='button';
    close.className='surface-grip-close';
    close.textContent='×';
    close.title='Close panel';
    close.setAttribute('aria-label','Close '+rec.title);

    grip.append(toggle,action,center,arrangeSelect,close);

    center.addEventListener('click',()=>recenter(rec,ctx));
    arrangeSelect.addEventListener('change',()=>arrange(rec,ctx,arrangeSelect.value));
    close.addEventListener('click',(event)=>{
      event.preventDefault?.();
      event.stopPropagation?.();
      try{rec.hide();}catch{rec.el.hidden=true;}
      rec.wasVisible=false;
      persistSoon(ctx);
    });

    attachPlaneDepthDrag(rec,ctx,toggle,{tapToggles:true});

    rec.grip=grip;
    rec.toggleBtn=toggle;
    rec.actionEl=action;
    rec.center=center;
    rec.arrange=arrangeSelect;
    rec.close=close;
    return grip;
  }

  function attachPlaneDepthDrag(rec,ctx,handle,{tapToggles}){
    let drag=null;
    let suppressClick=false;
    handle.addEventListener('pointerdown',(e)=>{
      if(!rec.placed)return;
      if(e.pointerType==='mouse'&&e.button!==0)return;
      try{handle.setPointerCapture?.(e.pointerId);}catch{}
      drag={
        pointerId:e.pointerId,
        startX:e.clientX,
        startY:e.clientY,
        startAvgY:e.clientY,
        originX:rec.state.x,
        originY:rec.state.y,
        originZ:rec.state.z,
        moved:false,
        depth:!!e.shiftKey,
      };
      handle.style.cursor=drag.depth?'ns-resize':'grabbing';
      bringFront(rec,ctx);
      e.preventDefault?.();
    });
    handle.addEventListener('pointermove',(e)=>{
      if(!drag||drag.pointerId!==e.pointerId)return;
      const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
      if(Math.abs(dx)+Math.abs(dy)>5)drag.moved=true;
      if(drag.depth||e.shiftKey){
        rec.state.z=clampDepth(drag.originZ+(drag.startY-e.clientY)*2);
        rec.arrangement='free';
      }else{
        rec.state.x=drag.originX+dx;
        rec.state.y=drag.originY+dy;
        rec.arrangement='free';
        clampPosition(rec);
      }
      applyTransform(rec);
      e.preventDefault?.();
    });
    const end=(e)=>{
      if(!drag||drag.pointerId!==e.pointerId)return;
      try{handle.releasePointerCapture?.(e.pointerId);}catch{}
      const wasTap=!drag.moved&&!drag.depth;
      drag=null;
      handle.style.cursor='';
      if(wasTap&&tapToggles){
        suppressClick=true;
        toggleCompact(rec,ctx);
      }else{
        persistSoon(ctx);
      }
    };
    handle.addEventListener('pointerup',end);
    handle.addEventListener('pointercancel',end);
    if(tapToggles){
      handle.addEventListener('click',()=>{
        if(suppressClick){suppressClick=false;return;}
        toggleCompact(rec,ctx);
      });
      handle.addEventListener('wheel',(e)=>{
        if(!rec.placed)return;
        e.preventDefault?.();
        rec.state.z=clampDepth(rec.state.z-(Number(e.deltaY)||0)*1.2);
        rec.arrangement='free';
        bringFront(rec,ctx);
        applyTransform(rec);
        persistSoon(ctx);
      },{passive:false});
    }
  }

  function addResizeHandles(rec,ctx){
    rec.resizeHandles=[];
    for(const dir of ['n','s','e','w','ne','nw','se','sw']){
      const handle=documentRoot.createElement('button');
      handle.type='button';
      handle.className='panel-space-resize';
      handle.setAttribute('data-panel-space-resize',dir);
      handle.setAttribute('data-dir',dir);
      handle.setAttribute('aria-label','Resize '+rec.title+' '+dir);
      handle.tabIndex=-1;
      const start=(e)=>{
        if(!rec.placed||rec.compact)return;
        if(e.pointerType==='mouse'&&e.button!==0)return;
        try{handle.setPointerCapture?.(e.pointerId);}catch{}
        rec.resize={
          pointerId:e.pointerId,dir,startX:e.clientX,startY:e.clientY,
          x:rec.state.x,y:rec.state.y,width:rec.state.width,height:rec.state.height,
        };
        ctx.activeResize=rec;
        rec.el.classList.add('panel-space-resizing');
        bringFront(rec,ctx);
        e.preventDefault?.();
        e.stopPropagation?.();
      };
      const move=(e)=>{
        const r=rec.resize;
        if(!r||r.pointerId!==e.pointerId)return;
        const dx=e.clientX-r.startX,dy=e.clientY-r.startY;
        let x=r.x,y=r.y,w=r.width,h=r.height;
        if(dir.includes('e'))w=r.width+dx;
        if(dir.includes('s'))h=r.height+dy;
        if(dir.includes('w')){w=r.width-dx;x=r.x+dx;}
        if(dir.includes('n')){h=r.height-dy;y=r.y+dy;}
        const size=clampSurfaceSize(w,h,viewport().w,viewport().h);
        if(dir.includes('w'))x=r.x+(r.width-size.width);
        if(dir.includes('n'))y=r.y+(r.height-size.height);
        rec.state.width=size.width;
        rec.state.height=size.height;
        rec.state.x=x;
        rec.state.y=y;
        rec.arrangement='free';
        rec.el.style.width=size.width+'px';
        rec.el.style.height=size.height+'px';
        clampPosition(rec);
        applyTransform(rec);
        e.preventDefault?.();
        e.stopPropagation?.();
      };
      const end=(e)=>{
        if(!rec.resize||rec.resize.pointerId!==e.pointerId)return;
        try{handle.releasePointerCapture?.(e.pointerId);}catch{}
        rec.resize=null;
        ctx.activeResize=null;
        rec.el.classList.remove('panel-space-resizing');
        persistSoon(ctx);
        e.stopPropagation?.();
      };
      handle.addEventListener('pointerdown',start);
      handle.addEventListener('pointermove',move);
      handle.addEventListener('pointerup',end);
      handle.addEventListener('pointercancel',end);
      rec.resizeHandles.push(handle);
      rec.el.appendChild(handle);
    }
  }

  function placePanel(rec,ctx){
    if(rec.placed||!isPanelVisible(rec.el,view))return false;
    let rect=null;
    try{rect=rec.el.getBoundingClientRect?.();}catch{}
    if(!rect||((rect.width||0)===0&&(rect.height||0)===0))return false;

    const saved=ctx.store[rec.id]||{};
    const v=viewport();
    const size=clampSurfaceSize(Number(saved.width)||rect.width||320,Number(saved.height)||rect.height||220,v.w,v.h);

    rec.home={x:Number.isFinite(rect.left)?rect.left:32,y:Number.isFinite(rect.top)?rect.top:86};
    rec.state.width=size.width;
    rec.state.height=size.height;
    rec.state.x=Number.isFinite(Number(saved.x))?Number(saved.x):rec.home.x;
    rec.state.y=Number.isFinite(Number(saved.y))?Number(saved.y):rec.home.y;
    rec.state.z=clampDepth(saved.z);
    rec.state.zIndex=Number.isFinite(Number(saved.zIndex))?Math.max(Z_BASE,Number(saved.zIndex)):(++ctx.zCounter);
    rec.compact=saved.compact===false?false:true;
    rec.arrangement=normalizePanelArrangement(saved.arrangement);
    rec.placed=true;

    const st=rec.el.style;
    st.position='fixed';
    st.left='0px';st.top='0px';st.right='auto';st.bottom='auto';st.margin='0px';

    setCompact(rec,rec.compact,ctx,false);
    if(!rec.compact){st.width=rec.state.width+'px';st.height=rec.state.height+'px';}
    clampPosition(rec);
    applyTransform(rec);
    rec.el.classList.add('panel-space-appearing');
    setTimeout(()=>rec.el.classList.remove('panel-space-appearing'),240);
    persistSoon(ctx);
    return true;
  }

  function requestPlace(rec,ctx,attempt=0){
    if(rec.placed||rec.placeQueued)return;
    rec.placeQueued=true;
    raf(()=>{
      rec.placeQueued=false;
      if(rec.placed||!isPanelVisible(rec.el,view))return;
      if(placePanel(rec,ctx))return;
      if(attempt<12){
        const timer=setTimeout(()=>requestPlace(rec,ctx,attempt+1),120);
        if(timer?.unref)try{timer.unref();}catch{}
      }
    });
  }

  function setupPanel(desc,ctx){
    const el=desc.el;
    const isHint=el.id==='hint';
    if(el.getAttribute?.('data-panel-space-ignore')==='true')return null;

    const rec={
      id:desc.id,el,title:panelTitle(el),icon:el.getAttribute?.('data-panel-space-icon')||'◈',type:desc.type,
      state:{x:0,y:0,z:0,width:320,height:220,zIndex:Z_BASE},
      home:null,placed:false,placeQueued:false,wasVisible:isPanelVisible(el,view),
      originalCssText:el.style?.cssText||'',grip:null,toggleBtn:null,actionEl:null,
      center:null,arrange:null,close:null,resizeHandles:[],resize:null,drag:null,
      compactible:!isHint,compact:true,arrangement:'free',hide:()=>{el.hidden=true;},
    };

    el.setAttribute('data-panel-space','managed');

    if(!isHint){
      const grip=createGrip(rec,ctx);
      const summary=el.tagName==='DETAILS'?el.querySelector('summary'):null;
      if(summary&&summary.parentNode===el)summary.after(grip);
      else if(typeof el.prepend==='function')el.prepend(grip);
      else el.insertBefore(grip,el.firstChild);
      addResizeHandles(rec,ctx);
    }else{
      attachPlaneDepthDrag(rec,ctx,el,{tapToggles:false});
    }

    rec.onContentPointerDown=()=>{if(rec.placed)bringFront(rec,ctx);};
    el.addEventListener?.('pointerdown',rec.onContentPointerDown,true);

    ctx.recs.push(rec);
    ctx.byEl.set(el,rec);
    ctx.byId.set(String(rec.id),rec);

    if(rec.wasVisible)requestPlace(rec,ctx);
    return rec;
  }

  function retirePanel(rec){
    try{
      rec.el.removeEventListener?.('pointerdown',rec.onContentPointerDown,true);
      rec.grip?.remove?.();
      for(const h of rec.resizeHandles||[])h.remove?.();
      rec.el.removeAttribute?.('data-panel-space');
      rec.el.removeAttribute?.('data-compact');
      rec.el.classList?.remove?.('panel-space-front','panel-space-appearing','panel-space-dragging','panel-space-resizing');
      rec.el.style.cssText=rec.originalCssText;
    }catch{}
  }

  function activate(){
    const styleEl=documentRoot.createElement('style');
    styleEl.setAttribute('data-panel-space-style','true');
    styleEl.textContent=PANEL_SPACE_CSS;
    (documentRoot.head||documentRoot).appendChild(styleEl);

    const ctx={recs:[],byEl:new Map(),byId:new Map(),store:readStore(view),saveTimer:0,zCounter:Z_BASE,activeResize:null};

    const registerDescriptor=(desc)=>{
      if(!desc?.el)return;
      const id=String(desc.id||'');
      const old=ctx.byId.get(id);
      if(old&&old.el!==desc.el){
        const i=ctx.recs.indexOf(old);if(i>=0)ctx.recs.splice(i,1);
        ctx.byEl.delete(old.el);ctx.byId.delete(id);retirePanel(old);
      }
      if(ctx.byEl.has(desc.el))return;
      try{setupPanel(desc,ctx);}catch{}
    };

    for(const desc of collectPanelDescriptors(documentRoot))registerDescriptor(desc);

    const reconcile=()=>{
      const current=new Map(collectPanelDescriptors(documentRoot).map(desc=>[String(desc.id||''),desc]));
      for(const desc of current.values())registerDescriptor(desc);

      for(const rec of [...ctx.recs]){
        const live=current.get(String(rec.id));
        if(!live||live.el!==rec.el){
          const i=ctx.recs.indexOf(rec);if(i>=0)ctx.recs.splice(i,1);
          ctx.byEl.delete(rec.el);ctx.byId.delete(rec.id);retirePanel(rec);
        }
      }

      for(const rec of ctx.recs){
        const visible=isPanelVisible(rec.el,view);
        if(!visible){rec.wasVisible=false;continue;}
        const was=rec.wasVisible;
        rec.wasVisible=true;
        if(!rec.placed){requestPlace(rec,ctx);continue;}
        if(!was){
          // Reopening a window never restores a stale saved position over the
          // live record. Its current x/y/z/size/state is authoritative.
          clampPosition(rec);
          bringFront(rec,ctx);
          applyTransform(rec);
        }
      }
    };

    const MO=view.MutationObserver||(typeof MutationObserver!=='undefined'?MutationObserver:null);
    let observer=null;
    if(MO&&documentRoot.documentElement){
      observer=new MO((mutations)=>{
        let structural=false;
        for(const mutation of mutations||[]){
          if(mutation.type==='childList'){structural=true;continue;}
          const target=mutation.target;
          if(!target)continue;
          if(ctx.byEl.has(target)||target.id==='feature-shell'||target.closest?.('#reality-assembly')){
            reconcile();
            break;
          }
        }
        if(structural)reconcile();
      });
      observer.observe(documentRoot.documentElement,{
        subtree:true,
        childList:true,
        attributes:true,
        attributeFilter:['hidden','open','class','style','data-floating-panel'],
      });
    }

    const onResize=()=>{
      const v=viewport();
      for(const rec of ctx.recs){
        if(!rec.placed)continue;
        if(!rec.compact){
          const size=clampSurfaceSize(rec.state.width,rec.state.height,v.w,v.h);
          rec.state.width=size.width;rec.state.height=size.height;
          rec.el.style.width=size.width+'px';rec.el.style.height=size.height+'px';
        }
        if(isPanelVisible(rec.el,view)){
          clampPosition(rec);
          applyTransform(rec);
        }
      }
    };
    view.addEventListener?.('resize',onResize);

    const timer=setTimeout(reconcile,0);
    if(timer?.unref)try{timer.unref();}catch{}

    return ()=>{
      observer?.disconnect?.();
      view.removeEventListener?.('resize',onResize);
      if(ctx.saveTimer)clearTimeout(ctx.saveTimer);
      for(const rec of ctx.recs)retirePanel(rec);
      ctx.recs.length=0;ctx.byEl.clear();ctx.byId.clear();
      styleEl.remove?.();
    };
  }

  const syncMode=()=>{
    const narrow=isNarrow();
    if(narrow&&active){
      teardownActive?.();
      teardownActive=null;
      active=false;
    }else if(!narrow&&!active){
      teardownActive=activate();
      active=true;
    }
  };

  view.addEventListener?.('resize',syncMode);
  mq?.addEventListener?.('change',syncMode);
  syncMode();

  return ()=>{
    view.removeEventListener?.('resize',syncMode);
    mq?.removeEventListener?.('change',syncMode);
    teardownActive?.();
    teardownActive=null;
    active=false;
  };
}
