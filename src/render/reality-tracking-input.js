import { REALITY_TAB_SIZE_MIN, REALITY_TAB_SIZE_MAX, resolveRealityTabPosition } from '../domains/reality-tab-layout.js';

/** Camera input observes this canvas in normalized top-left coordinates.
 * It calls the existing owner/controller directly, never dispatching pointer
 * events on the render canvas or creating another world. Scale factors and
 * roll radians are relative to the previous sample, not absolute hand sizes.
 */
export function trackingCanvasPoint(input, canvas) {
  if(![input?.x,input?.y].every(Number.isFinite)||input.x<0||input.x>1||input.y<0||input.y>1)return null;
  const rect=canvas.getBoundingClientRect();
  if(![rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0)return null;
  return {clientX:rect.left+input.x*rect.width,clientY:rect.top+input.y*rect.height,x:input.x,y:input.y};
}
export function trackingPointIsObstructed(documentRoot,canvas,point){
  const front=documentRoot?.elementFromPoint?.(point.clientX,point.clientY);
  if(!front||front===canvas||front.dataset?.nativeTarget==='true')return false;
  return Boolean(front.closest?.('button,a,input,select,textarea,summary,iframe,[contenteditable="true"],.assembly-header,.assembly-toolbar,.assembly-directory,.assembly-inspector,.reality-lens-feature-panel,.assembly-wrap-fallback,#hands-eyes-panel,#hands-eyes-calibration,#hands-eyes-live,#hand-lens-panel'));
}
/** Only the original Assembly's explicitly registered navigation buttons may
 * receive a tracked click. Matching data attributes alone never grant access. */
export function createTrackingNavigationTargets({documentRoot,entries=[]}={}){
  const byElement=new Map(),byId=new Map();
  for(const entry of entries){
    if(!entry?.element)continue;
    if(entry.element.tagName!=='BUTTON'||typeof entry.id!=='string'||!/^nav-[a-z0-9-]+$/.test(entry.id)||byId.has(entry.id)||byElement.has(entry.element))throw Error('Tracking navigation requires unique original button references');
    byElement.set(entry.element,entry);byId.set(entry.id,entry);
  }
  function visible(button){
    return button.isConnected!==false&&!button.disabled&&button.getAttribute?.('aria-disabled')!=='true'
      &&!button.closest?.('[hidden],[inert]')&&(!button.getClientRects||button.getClientRects().length>0);
  }
  function pick(point){
    const front=documentRoot?.elementFromPoint?.(point.clientX,point.clientY),button=front?.closest?.('button'),entry=byElement.get(button);
    if(!entry||!visible(button))return null;
    const rect=button.getBoundingClientRect();
    if(![rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0
      ||point.clientX<rect.left||point.clientX>rect.left+rect.width||point.clientY<rect.top||point.clientY>rect.top+rect.height)return null;
    const dwellAllowed=typeof entry.dwellAllowed==='function'?entry.dwellAllowed():entry.dwellAllowed;
    const label=typeof entry.label==='function'?entry.label():entry.label;
    return {kind:'navigation',id:entry.id,label:label??button.getAttribute?.('aria-label')??button.textContent.trim(),
      actionId:entry.id,controlActionability:true,dwellAllowed:dwellAllowed===true,element:button};
  }
  function activate(target){
    const entry=byId.get(target?.id);
    if(!entry||entry.element!==target.element||!visible(entry.element))return false;
    entry.element.click();return true;
  }
  return Object.freeze({pick,activate});
}
const copy=value=>JSON.parse(JSON.stringify(value));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export const REALITY_HOME_LAYOUT_KEY='tumbo.reality.home-layout.v1';
/** Small renderer-owned Home layout, keyed by the six existing space IDs.
 * Offsets remain relative to responsive authored slots; no feature identity
 * or canonical data is imported. Preview is not written to browser storage. */
export function createHomeTransformStore({ids,storage=null}={}){
  const known=new Set(ids),defaults=id=>({id,offset:[0,0,0],size:1,rotation:[0,0,0]});
  let committed=new Map(),preview=new Map(),checkpoint=null,error=null,held=false;
  function validate(row){
    if(!row||!known.has(row.id)||!Array.isArray(row.offset)||row.offset.length!==3||row.offset.some(value=>!Number.isFinite(value)||Math.abs(value)>120)
      ||!Array.isArray(row.rotation)||row.rotation.length!==3||row.rotation.some(value=>!Number.isFinite(value)||Math.abs(value)>Math.PI)
      ||!Number.isFinite(row.size)||row.size<.5||row.size>2.5)throw Error('Home layout requires bounded transforms of existing spaces');
    return {id:row.id,offset:[...row.offset],size:row.size,rotation:[...row.rotation]};
  }
  if(storage)try{
    checkpoint=storage.getItem(REALITY_HOME_LAYOUT_KEY);
    if(checkpoint!==null){
      if(checkpoint.length>8000)throw Error('Saved Home layout is too large');
      const data=JSON.parse(checkpoint);if(data.version!==1||!Array.isArray(data.transforms)||data.transforms.length>known.size)throw Error('Unsupported Home layout');
      for(const raw of data.transforms){const row=validate(raw);if(committed.has(row.id))throw Error('Duplicate Home space');committed.set(row.id,row);}
    }
  }catch(cause){committed.clear();held=true;error=`Saved Home layout is held: ${cause.message}. Use Reset Home layout to replace it.`;}
  function get(id){if(!known.has(id))throw Error('Unknown Home space');return copy(preview.get(id)??committed.get(id)??defaults(id));}
  function save(next){
    if(storage){
      const latest=storage.getItem(REALITY_HOME_LAYOUT_KEY);if(latest!==checkpoint)throw Error('Another tab changed Home layout; reload before arranging it');
      const raw=JSON.stringify({version:1,transforms:[...next.values()]});
      try{storage.setItem(REALITY_HOME_LAYOUT_KEY,raw);checkpoint=raw;error=null;}
      catch(cause){error=`Home layout stays in this session; saving failed: ${cause.message}`;}
    }
    committed=next;held=false;
  }
  return Object.freeze({get,
    preview(id,value){if(held)throw Error(error);const row=validate({...value,id});preview.set(id,row);return get(id);},
    commit(id,value){if(held)throw Error(error);const row=validate({...value,id}),next=new Map(committed);next.set(id,row);save(next);preview.delete(id);return get(id);},
    cancel(id){if(id===undefined||id===null)preview.clear();else preview.delete(id);},
    reset(){save(new Map());preview.clear();return this.snapshot();},
    snapshot(){return {transforms:[...known].map(get),previewIds:[...preview.keys()],persistence:storage?'local-browser':'session-only',storageError:error,held};},
  });
}

export function createRealityTrackingInput({THREE,canvas,camera,isActive,getOwner,getArrange,pick,getRay,getDisplayedPosition,
  select,previewFeature,commitFeature,restore,activateSpace,activateFeature,activateNavigation,getSurface,getHome,previewHome,commitHome,cancelHome,setBusy=()=>{},onHover=()=>{}}={}){
  let held=null,target=null,source=null,lastReason=null;
  function publicTarget(value){return value?{kind:value.kind,id:value.id,label:value.label??value.id,
    actionId:value.actionId??null,controlActionability:value.controlActionability===true,dwellAllowed:value.dwellAllowed===true}:null;}
  function snapshot(){return {source,active:isActive(),held:held?{kind:held.kind,id:held.id,arrange:held.arrange}:null,target:publicTarget(target),reason:lastReason,coordinateSpace:'normalized-screen',localOnly:true};}
  function result(handled,reason=null){lastReason=reason;return {handled,...snapshot()};}
  function hover(point){target=point?pick(point):null;onHover(publicTarget(target));return target;}
  function cancel(reason='cancelled'){
    if(held?.surface)held.surface.handleTrackingInput({type:'cancel'});
    if(held?.kind==='space')cancelHome?.(held.id);
    const previous=held;held=null;
    if(previous?.arrange){setBusy(false);restore();}
    target=null;onHover(null);return result(Boolean(previous)||isActive(),reason);
  }
  function editable(session){
    const owner=getOwner(),state=owner.getSnapshot();
    if(owner!==session.owner||state.mode==='past'||state.revision!==session.revision)return false;
    if(session.kind==='space')return true;
    const object=state.objects.find(item=>item.id===session.id);
    return Boolean(object&&!object.anchor&&!object.locked);
  }
  function preview(session){
    if(!editable(session))return cancel('owner-changed-or-read-only');
    if(session.kind==='space')session.next=previewHome(session.id,session.next);
    else {
      const state=session.owner.getSnapshot(),objects=state.objects.map(object=>object.id===session.id?{...object,...session.next}:object);
      session.next.position=resolveRealityTabPosition(session.id,session.next.position,objects);
      previewFeature(session.id,session.next);
    }
    return result(true);
  }
  function handle(input={}){
    try{
      if(input.type==='cancel')return cancel(input.reason??'cancelled');
      if(!isActive()){cancel('assembly-inactive');return result(false,'assembly-inactive');}
      if(!['hover','down','move','up','activate','scale','rotate'].includes(input.type))return result(false,'unsupported-input');
      const nextSource=input.source==='gaze'?'gaze':'hand';
      if(source&&source!==nextSource)cancel('source-changed');source=nextSource;
      const point=trackingCanvasPoint(input,canvas);
      if(!point){cancel('outside-canvas');return result(true,'outside-canvas');}
      if(input.type==='hover'){if(!held)hover(point);return result(true);}
      if(source==='gaze'){
        hover(point);
        if(input.type!=='activate')return result(true,'gaze-hover-only');
        if(input.dwellArmed!==true||!target?.dwellAllowed)return result(true,'dwell-not-navigation');
        if(target.kind==='space')activateSpace(target.id);else if(target.kind==='feature')activateFeature(target.id);
        else if(target.kind==='navigation'&&activateNavigation?.(target)!==true)return result(true,'navigation-no-longer-available');
        target=null;onHover(null);return result(true,'navigation-activated');
      }
      if(input.type==='activate')return result(true,'pinch-down-up-required');
      if(input.type==='down'){
        cancel('new-pinch');hover(point);if(!target)return result(true,'no-mesh-hit');
        if(target.kind==='navigation'){
          held={id:target.id,kind:'navigation',navigation:target,arrange:false,start:point,last:point,dragged:false};
          return result(true);
        }
        const owner=getOwner(),state=owner.getSnapshot(),arrange=getArrange()===true;
        if(arrange){
          if(state.mode==='past')return result(true,'recorded-history-read-only');
          let original;
          if(target.kind==='space')original=getHome?.(target.id);
          else original=state.objects.find(object=>object.id===target.id);
          if(!original||original.locked||original.anchor)return result(true,'object-locked');
          select?.(target.id,target.kind);
          const displayed=getDisplayedPosition(target.id,target.kind),normal=camera.getWorldDirection(new THREE.Vector3());
          const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,new THREE.Vector3(...displayed));
          const hit=getRay(point).intersectPlane(plane,new THREE.Vector3());
          if(!hit)return result(true,'no-drag-plane');
          held={id:target.id,kind:target.kind==='space'?'space':'feature',owner,revision:owner.getSnapshot().revision,arrange:true,
            original:copy(original),next:copy(original),plane,hit,start:point,last:point,dragged:false};
          setBusy(true);
          return result(true);
        }
        const surface=getSurface?.();
        if(['control','surface'].includes(target.kind)&&surface?.handleTrackingInput({type:'down',...point})){
          held={id:target.id,kind:'surface',surface,arrange:false,start:point,last:point};return result(true);
        }
        held={id:target.id,kind:target.kind,arrange:false,start:point,last:point,dragged:false};return result(true);
      }
      if(!held)return result(true,'no-held-pinch');
      held.last=point;
      if(held.surface){
        if(input.type==='up'&&!['control','surface'].includes(pick(point)?.kind)){
          held.surface.handleTrackingInput({type:'cancel'});held=null;target=null;onHover(null);return result(true,'surface-release-not-visible');
        }
        if(input.type==='scale')return result(true,'size-requires-arrange');
        const handled=held.surface.handleTrackingInput({...point,type:input.type,radians:input.radians??input.rotation});
        if(input.type==='up'){held=null;target=null;onHover(null);}
        return result(true,handled?null:'surface-input-unsupported');
      }
      if(input.type==='move'){
        held.dragged ||= Math.hypot(point.clientX-held.start.clientX,point.clientY-held.start.clientY)>7;
        if(!held.arrange)return result(true);
        const hit=getRay(point).intersectPlane(held.plane,new THREE.Vector3());if(!hit)return result(true,'no-drag-plane');
        const delta=hit.sub(held.hit);held.next.position=held.original.position.map((value,axis)=>clamp(value+delta.getComponent(axis),-60,60));
        return preview(held);
      }
      if(input.type==='scale'||input.type==='rotate'){
        if(!held.arrange)return result(true,'transform-requires-arrange');
        if(input.type==='scale'){
          const factor=input.factor??input.scale;if(!Number.isFinite(factor)||factor<=0)return result(true,'invalid-scale');
          held.next.size=clamp(held.next.size*clamp(factor,.8,1.25),held.kind==='space'?.5:REALITY_TAB_SIZE_MIN,held.kind==='space'?2.5:REALITY_TAB_SIZE_MAX);
        }else{
          const radians=input.radians??input.rotation;if(!Number.isFinite(radians))return result(true,'invalid-rotation');
          held.next.rotation??=[0,0,0];
          held.next.rotation[2]=clamp(held.next.rotation[2]+clamp(radians,-Math.PI/4,Math.PI/4),-Math.PI,Math.PI);
        }
        held.dragged=true;return preview(held);
      }
      if(input.type==='up'){
        const previous=held;
        if(previous.arrange){
          if(!editable(previous))return cancel('owner-changed-or-read-only');
          if(previous.kind==='space')commitHome(previous.id,previous.next);else commitFeature(previous.id,previous.next);
          held=null;setBusy(false);restore();return result(true,'layout-committed');
        }
        held=null;
        const release=pick(point);
        if(!previous.dragged&&Math.hypot(point.clientX-previous.start.clientX,point.clientY-previous.start.clientY)<=7&&release?.kind===previous.kind&&release?.id===previous.id){
          if(previous.kind==='space')activateSpace(previous.id);else if(previous.kind==='feature')activateFeature(previous.id);
          else if(previous.kind==='navigation'&&(previous.navigation.element!==release.element||activateNavigation?.(release)!==true))return result(true,'navigation-no-longer-available');
          target=null;onHover(null);return result(true,'navigation-activated');
        }
        return result(true,'pinch-released');
      }
      return result(true,'unsupported-held-input');
    }catch(error){cancelHome?.(held?.id);cancel('input-blocked');return result(true,String(error?.message??error));}
  }
  return Object.freeze({handle,snapshot,cancel});
}
