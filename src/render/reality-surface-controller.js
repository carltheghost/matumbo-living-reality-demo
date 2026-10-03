import {createRealitySurfaceDocument} from './reality-surface-document.js?v=20261003-skin360';
import {createRealitySurfaceAtlas} from './reality-surface-atlas.js?v=20261003-skin360';

/** One live feature owner, projected onto the triangles of its whole body.
 * The canvas is presentation only: original DOM handlers own every action. */
export function createRealitySurfaceController({THREE,node,element,feature,renderer,camera,controls,onStatus=()=>{}}){
  let dirty=true,disposed=false,mesh=null,previousMaterials=null,atlas=null,pointer=null,lastRefresh=0,editor=null,typography=null;
  const semantic=createRealitySurfaceDocument({element,feature,onDirty:()=>{dirty=true;}});
  const ray=new THREE.Raycaster(),point=new THREE.Vector2(),canvas=renderer.domElement;
  const stop=event=>{event.preventDefault();event.stopImmediatePropagation();};
  const originalTabIndex=canvas.getAttribute('tabindex');canvas.tabIndex=0;
  const originalLabel=canvas.getAttribute('aria-label');canvas.setAttribute('aria-label',`${feature.label} surface. Drag to rotate. Arrow keys turn the body. Page Up and Page Down browse its contents.`);

  function finishEditing(){
    if(!editor)return;
    const current=editor;editor=null;
    current.field.removeEventListener('blur',current.blur);
    if(current.style===null)current.field.removeAttribute('style');else current.field.setAttribute('style',current.style);
    for(const saved of current.ancestors??[]){
      if(saved.node.style.getPropertyValue(saved.property)!==saved.temporary)continue;
      if(saved.value)saved.node.style.setProperty(saved.property,saved.value,saved.priority);else saved.node.style.removeProperty(saved.property);
    }
    current.field.classList.remove('reality-surface-native-editor');
    dirty=true;
  }
  function edit(field,event){
    if(!field?.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea,[contenteditable=true]'))return;
    finishEditing();
    const width=Math.min(360,innerWidth-32),x=Math.max(16,Math.min(innerWidth-width-16,event?.clientX??innerWidth/2-width/2)),y=Math.max(120,Math.min(innerHeight-110,event?.clientY??innerHeight/2));
    const style=field.getAttribute('style'),blur=()=>finishEditing();editor={field,style,blur,ancestors:[]};
    // A nested glass card's filter/perspective establishes a fixed-position
    // containing block. Temporarily release only those presentation properties
    // along the original field's ancestry; retain its node, form and handlers.
    if(typeof getComputedStyle==='function')for(let parent=field.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
      const computed=getComputedStyle(parent);
      for(const [property,temporary] of [['transform','none'],['perspective','none'],['filter','none'],['backdrop-filter','none'],['contain','none'],['container-type','normal'],['will-change','auto'],['transform-style','flat'],['content-visibility','visible']]){
        const actual=computed.getPropertyValue(property);if(!actual||['none','normal','auto','flat','visible'].includes(actual))continue;
        editor.ancestors.push({node:parent,property,value:parent.style.getPropertyValue(property),priority:parent.style.getPropertyPriority(property),temporary});parent.style.setProperty(property,temporary,'important');
      }
    }
    field.classList.add('reality-surface-native-editor');
    for(const [key,value] of Object.entries({position:'fixed',left:`${x}px`,top:`${y}px`,right:'auto',bottom:'auto',width:`${width}px`,height:field.tagName==='TEXTAREA'?'120px':'48px',margin:'0',transform:'none',visibility:'visible',opacity:'1','z-index':'10050','pointer-events':'auto'}))field.style.setProperty(key,value,'important');
    // Container-query roots and individual CSS transforms can still establish
    // a containing block. Reconcile against the actual rendered field instead
    // of assuming its fixed coordinates are relative to the viewport.
    for(let pass=0;pass<2;pass++){
      const bounds=field.getBoundingClientRect(),dx=x-bounds.left,dy=y-bounds.top;
      if(Math.abs(dx)<.5&&Math.abs(dy)<.5)break;
      field.style.setProperty('left',`${parseFloat(field.style.left)+dx}px`,'important');
      field.style.setProperty('top',`${parseFloat(field.style.top)+dy}px`,'important');
    }
    field.addEventListener('blur',blur,{once:true});field.focus({preventScroll:true});
  }
  function sync(){
    if(disposed||!node.tabMesh)return;
    const nextTypography=(globalThis.innerWidth??1440)<700?1.7:1;
    if(mesh!==node.tabMesh||typography!==nextTypography){
      if(mesh&&mesh.parent)mesh.material=previousMaterials;
      atlas?.dispose();mesh=node.tabMesh;previousMaterials=mesh.material;
      atlas=createRealitySurfaceAtlas({THREE,charts:node.surfaceCharts,document:semantic,feature,size:768,typeScale:nextTypography});typography=nextTypography;
      mesh.material=atlas.materials;mesh.userData.fullSurfaceOwner=feature.id;
      for(const material of atlas.materials)material.userData.realitySurfaceOwned=true;
      node.surface360=true;node.surfaceReading=true;node.surfaceStretch=[1,1,1];dirty=true;
    }
    const now=performance.now();
    // Existing features can update property values without DOM mutation.
    // One selected owner is sampled at 4 Hz; textures change only with ink.
    if(dirty||now-lastRefresh>250){atlas.refresh(Boolean(element.querySelector('canvas')));dirty=false;lastRefresh=now;}
  }
  /** Resolve a chart UV to a real triangle, for focus and pointer diagnostics.
   * No screen rectangles or bounding-volume approximations enter picking. */
  function surfacePoint(chartIndex,uv){
    sync();const geometry=mesh.geometry,position=geometry.getAttribute('position'),coords=geometry.getAttribute('uv'),normal=geometry.getAttribute('normal'),index=geometry.index;
    const target=new THREE.Vector2(uv.x??uv[0],uv.y??uv[1]);
    for(const group of geometry.groups.filter(group=>group.materialIndex===chartIndex))for(let offset=group.start;offset<group.start+group.count;offset+=3){
      const ids=[0,1,2].map(i=>index?index.getX(offset+i):offset+i),uvs=ids.map(i=>new THREE.Vector2().fromBufferAttribute(coords,i));
      const a=uvs[1].clone().sub(uvs[0]),b=uvs[2].clone().sub(uvs[0]),p=target.clone().sub(uvs[0]),den=a.x*b.y-a.y*b.x;
      if(Math.abs(den)<1e-9)continue;
      const v=(p.x*b.y-p.y*b.x)/den,w=(a.x*p.y-a.y*p.x)/den,u=1-v-w;if(Math.min(u,v,w)<-1e-5)continue;
      const weights=[u,v,w],local=new THREE.Vector3(),n=new THREE.Vector3();
      ids.forEach((id,i)=>{local.addScaledVector(new THREE.Vector3().fromBufferAttribute(position,id),weights[i]);n.addScaledVector(new THREE.Vector3().fromBufferAttribute(normal,id),weights[i]);});
      const vertices=ids.map(id=>new THREE.Vector3().fromBufferAttribute(position,id));
      const chartUp=vertices[1].clone().sub(vertices[0]).multiplyScalar(-b.x).addScaledVector(vertices[2].clone().sub(vertices[0]),a.x).divideScalar(den).normalize();
      node.root.updateMatrixWorld(true);camera.updateMatrixWorld();const world=mesh.localToWorld(local.clone()),projected=world.clone().project(camera),rect=canvas.getBoundingClientRect();
      return {local,normal:n.normalize(),chartUp,world,x:rect.left+(projected.x*.5+.5)*rect.width,y:rect.top+(-projected.y*.5+.5)*rect.height,visible:projected.z>-1&&projected.z<1};
    }
    return null;
  }
  function orientChart(chartIndex,uv=[.5,.5]){
    const point=surfacePoint(chartIndex,uv);if(!point)return false;
    const outward=camera.getWorldPosition(new THREE.Vector3()).sub(node.root.getWorldPosition(new THREE.Vector3())).normalize();
    const desiredUp=new THREE.Vector3(0,1,0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    if(node.root.parent){const inverse=node.root.parent.getWorldQuaternion(new THREE.Quaternion()).invert();outward.applyQuaternion(inverse);desiredUp.applyQuaternion(inverse);}
    const rotation=new THREE.Quaternion().setFromUnitVectors(point.normal,outward);
    const currentUp=point.chartUp.clone().applyQuaternion(rotation).projectOnPlane(outward).normalize();
    desiredUp.projectOnPlane(outward).normalize();
    const roll=Math.atan2(currentUp.clone().cross(desiredUp).dot(outward),currentUp.dot(desiredUp));
    node.root.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(outward,roll).multiply(rotation));node.root.updateMatrixWorld(true);return true;
  }
  function pointerToDocument(type,event,target){
    const region=pointer?.region??target?.region;if(!region||!pointer?.actionId)return;
    const uv=target?.uv??pointer.uv;pointer.uv=uv;
    semantic.dispatchPointer?.(pointer.actionId,{type,x:Math.max(0,Math.min(1,(uv.x-region.x)/region.width)),y:Math.max(0,Math.min(1,((1-uv.y)-region.y)/region.height)),pointerId:event.pointerId,pointerType:event.pointerType,button:event.button,buttons:event.buttons});
    if(type!=='pointerup'&&type!=='pointercancel')canvas.setPointerCapture(event.pointerId);
  }
  function hit(event){
    sync();if(!mesh?.visible||!node.root.visible)return null;
    const rect=canvas.getBoundingClientRect();point.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    camera.updateMatrixWorld();node.root.updateMatrixWorld(true);ray.setFromCamera(point,camera);
    const intersection=ray.intersectObject(mesh,false)[0];
    return intersection?.uv?{intersection,chart:intersection.face.materialIndex??0,uv:intersection.uv,region:atlas.hit(intersection.face.materialIndex??0,intersection.uv)}:null;
  }
  function down(event){
    if(pointer&&pointer.id!==event.pointerId){stop(event);return true;}
    const target=hit(event);if(event.button!==0||!target)return false;
    finishEditing();pointer={id:event.pointerId,pointerType:event.pointerType,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,dragged:false,enabled:controls.enabled};
    controls.enabled=false;canvas.setPointerCapture(event.pointerId);canvas.focus({preventScroll:true});
    if(['canvas','pointer'].includes(target.region?.kind)){pointer.actionId=target.region.actionId;pointer.region=target.region;pointer.uv=target.uv;pointer.chart=target.chart;pointerToDocument('pointerdown',event,target);}
    stop(event);return true;
  }
  function move(event){
    if(!pointer||pointer.id!==event.pointerId)return false;
    if(pointer.actionId){if(Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>6)pointer.dragged=true;const target=hit(event);pointerToDocument('pointermove',event,target?.chart===pointer.chart?target:null);dirty=true;stop(event);return true;}
    const dx=event.clientX-pointer.lastX,dy=event.clientY-pointer.lastY;
    if(Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>6)pointer.dragged=true;
    if(pointer.dragged){node.root.rotation.y+=dx*.008;node.root.rotation.x+=dy*.008;node.root.updateMatrixWorld(true);}
    pointer.lastX=event.clientX;pointer.lastY=event.clientY;stop(event);return true;
  }
  function up(event){
    if(!pointer||pointer.id!==event.pointerId)return false;
    const before=pointer;
    if(pointer.actionId){const target=hit(event);pointerToDocument(event.type,event,target?.chart===pointer.chart?target:null);if(event.type==='pointerup'&&!pointer.dragged)pointerToDocument('click',event,target?.chart===pointer.chart?target:null);dirty=true;}
    pointer=null;controls.enabled=before.enabled;
    if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    if(event.type==='pointerup'&&!before.dragged&&!before.actionId){
      const target=hit(event);
      if(target){
        const actionId=target.region?.actionId,field=actionId&&semantic.getElement(actionId);
        if(field&&!target.region.disabled)edit(field,event);
        atlas.activate(target.chart,target.uv);dirty=true;
      }
    }
    stop(event);return true;
  }
  let wheelAt=0;
  function wheel(event){
    const target=hit(event);if(event.ctrlKey||!target)return false;
    if(['canvas','pointer'].includes(target.region?.kind)){
      semantic.dispatchWheel?.(target.region.actionId,{...target.region.subUV,deltaX:event.deltaX,deltaY:event.deltaY,deltaZ:event.deltaZ,deltaMode:event.deltaMode,shiftKey:event.shiftKey,altKey:event.altKey,metaKey:event.metaKey});dirty=true;stop(event);return true;
    }
    const now=performance.now();if(now-wheelAt>220&&Math.abs(event.deltaY)>2){atlas.scroll(event.deltaY);wheelAt=now;dirty=true;}
    stop(event);return true;
  }
  function key(event){
    if(event.key==='Escape'&&editor){finishEditing();canvas.focus();stop(event);return true;}
    if(event.target!==canvas)return false;
    const turns={ArrowLeft:[0,-.3],ArrowRight:[0,.3],ArrowUp:[-.3,0],ArrowDown:[.3,0]};
    if(turns[event.key]){node.root.rotation.x+=turns[event.key][0];node.root.rotation.y+=turns[event.key][1];stop(event);return true;}
    if(event.key==='PageDown'||event.key==='PageUp'){atlas.scroll(event.key==='PageDown'?1:-1);dirty=true;stop(event);return true;}
    return false;
  }
  function focusNative(event){
    if(event.target===editor?.field)return;
    const block=semantic.read().find(block=>block.element===event.target);
    if(block){
      atlas?.refresh();const revealed=atlas?.reveal?.(block.actionId??block.id);dirty=true;
      if(revealed){
        const region=revealed.region??revealed,chartIndex=revealed.chartIndex??region.chartIndex;
        if(Number.isInteger(chartIndex))orientChart(chartIndex,[region.x+region.width/2,1-region.y-region.height/2]);
      }
    }
    if(event.target?.matches?.('input,select,textarea')&&!element.closest('.assembly-accessible-text'))edit(event.target);
  }
  element.addEventListener('focusin',focusNative);
  element.addEventListener('keydown',key,true);
  canvas.addEventListener?.('keydown',key,true);
  sync();
  return {sync,hit,down,move,up,wheel,key,surfacePoint,orientChart,refresh(){dirty=true;sync();},
    get document(){return semantic;},get atlas(){return atlas;},
    snapshot(){return {engine:'mesh-uv-360',entityId:feature.id,bodyId:feature.id,coordinateSpace:'owning-mesh-uv',separatePanelFrame:false,canonicalOwners:1,interactiveSurfaceCount:node.surfaceCharts?.length??0,ownedByBody:mesh?.parent===node.root,rotation:node.root.rotation.toArray().slice(0,3),document:semantic.snapshot(),atlas:atlas?.snapshot(),mediaPixelMode:'native-embed-only'};},
    dispose(){
      if(disposed)return;disposed=true;finishEditing();
      if(pointer){
        if(pointer.actionId)pointerToDocument('pointercancel',{pointerId:pointer.id,pointerType:pointer.pointerType,button:0,buttons:0});
        controls.enabled=pointer.enabled;
        if(canvas.hasPointerCapture(pointer.id))canvas.releasePointerCapture(pointer.id);
        pointer=null;
      }
      element.removeEventListener('focusin',focusNative);element.removeEventListener('keydown',key,true);canvas.removeEventListener?.('keydown',key,true);semantic.dispose();if(mesh?.parent)mesh.material=previousMaterials;atlas?.dispose();node.surface360=false;node.surfaceReading=false;if(originalTabIndex===null)canvas.removeAttribute('tabindex');else canvas.setAttribute('tabindex',originalTabIndex);if(originalLabel===null)canvas.removeAttribute('aria-label');else canvas.setAttribute('aria-label',originalLabel);
    },
  };
}
