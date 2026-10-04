import {createRealitySurfaceController} from './reality-surface-controller.js?v=20261003-skin360';
import {createRealityWorkspace} from '../domains/reality-workspace.js?v=20261003-skin360';
import {REALITY_TAB_FORMS,REALITY_TAB_SIZE_MIN,REALITY_TAB_SIZE_MAX,resolveRealityTabPosition} from '../domains/reality-tab-layout.js?v=20261003-skin360';
import {REALITY_LENS_GROUPS,realityLensEngine,resolveRealityLensGroup} from '../domains/reality-lens-engine.js?v=20261003-skin360';
import {realityLensLabel,realityObjectSurfaceEngine} from '../domains/reality-object-engine.js?v=20261003-skin360';
import {lensSpaceLabel} from './reality-lens-chrome.js?v=20261003-skin360';
import {buildRealityAssemblyScene,LOD_FAR} from './reality-assembly-scene.js?v=20261003-skin360';
import {normalizeDesignDescriptor} from '../domains/creator-economy.js?v=20261003-skin360';
import {mountOrbitNavigation} from './orbit-navigation.js';

// The lens contains only equal-status feature tabs; no center cube or anchor.
export const CLEAN_LANDING_CAMERA={position:[36,25,110],target:[0,2,0],fov:60,mergeThreshold:LOD_FAR};

/** Fit a space inside the available viewport, including phone chrome. */
export function frameRealitySpace({bounds,width,height,fov=60,topInset=null,bottomInset=50}){
  const phone=width<700,safeTop=topInset??(phone?220:270),safeBottom=bottomInset;
  const safeWidth=Math.max(160,width-(phone?24:64)),safeHeight=Math.max(1,height-safeTop-safeBottom);
  const tangent=Math.tan(fov*Math.PI/360),aspect=width/height;
  // Fit the nearest extent of deep bodies, rather than their center plane.
  const readingDistance=Math.max(8,(bounds.height/2)/(tangent*safeHeight/height),(bounds.width/2)/(tangent*aspect*safeWidth/width))*(phone?1.06:1.08);
  const distance=readingDistance+Math.max(0,bounds.depth??0)/2;
  // The camera looks above the space center to leave room for its heading.
  const center=bounds.center??[0,1,0];
  const projectedHeight=bounds.height/(2*readingDistance*tangent)*height;
  // Width-limited phone layouts start below the heading instead of leaving a
  // large empty band between the heading and the first objects.
  const verticalOffset=phone?(safeTop+projectedHeight/2-height/2)/height*2*readingDistance*tangent:(safeTop-safeBottom)/height*readingDistance*tangent;
  return {target:[center[0],center[1]+verticalOffset,center[2]],distance};
}

/** Reading orientation belongs to the whole entity rig, never a loose panel. */
export function turnLivingSurfaceTowardCamera(objectRoot,cameraPosition){
  if(!objectRoot?.isObject3D||!cameraPosition||![cameraPosition.x,cameraPosition.y,cameraPosition.z].every(Number.isFinite))throw Error('Reading orientation needs an object and finite camera position');
  objectRoot.lookAt(cameraPosition);objectRoot.updateMatrixWorld(true);
}

/** Keep a mounted native player at a reading slot without moving its iframe. */
export function placeNativeMediaAtRect({THREE,object,camera,rect,width,height,distance=10}){
  if(!camera?.isPerspectiveCamera||!object||!rect||![rect.left,rect.top,rect.width,rect.height,width,height,distance].every(Number.isFinite)||rect.width<=0||rect.height<=0||width<=0||height<=0||distance<=camera.near)return false;
  camera.updateMatrixWorld();object.parent?.updateWorldMatrix(true,false);
  const unitsPerPixel=2*distance*Math.tan((camera.getEffectiveFOV?.()??camera.fov)*Math.PI/360)/height;
  const rotation=camera.getWorldQuaternion(new THREE.Quaternion());
  const right=new THREE.Vector3(1,0,0).applyQuaternion(rotation),up=new THREE.Vector3(0,1,0).applyQuaternion(rotation),forward=new THREE.Vector3(0,0,-1).applyQuaternion(rotation);
  const position=camera.getWorldPosition(new THREE.Vector3()).addScaledVector(forward,distance)
    .addScaledVector(right,(rect.left+rect.width/2-width/2)*unitsPerPixel)
    .addScaledVector(up,(height/2-rect.top-rect.height/2)*unitsPerPixel);
  const matrix=new THREE.Matrix4().compose(position,rotation,new THREE.Vector3().setScalar(unitsPerPixel));
  if(object.parent)matrix.premultiply(object.parent.matrixWorld.clone().invert());
  matrix.decompose(object.position,object.quaternion,object.scale);object.updateMatrixWorld(true);return true;
}

/** Disclose only an outer static overview, never contract terms/evidence. */
export function mountLivingSurfaceIntro(panel){
  const header=panel.querySelector(':scope > header, :scope > [id$="-head"]');
  const paragraph=header?.querySelector('p');
  if(!paragraph||paragraph.closest('details'))return null;
  const parent=paragraph.parentNode,details=panel.ownerDocument.createElement('details'),summary=panel.ownerDocument.createElement('summary');
  details.className='assembly-surface-intro';summary.textContent='About this object';
  parent.insertBefore(details,paragraph);details.append(summary,paragraph);
  let previous=null;
  return {
    setCompact(compact){if(previous===compact)return;previous=compact;details.dataset.compact=String(compact);details.open=!compact;},
    restore(){if(details.parentNode===parent&&paragraph.parentNode===details)parent.insertBefore(paragraph,details);details.remove();},
  };
}

// Keep every in-view feature label readable. When two projected tabs converge,
// shift only the DOM label into the nearest open screen-space pocket; the 3D
// tab stays put, and the cards do not turn into a web of permanent links.
export function placeAssemblyLabel({ndcX,ndcY,ndcZ,viewportWidth,viewportHeight,safeTop,safeBottom,labelWidth=120,labelHeight=27,occupied=[]}){
  if(!(ndcZ>-1&&ndcZ<1)||Math.abs(ndcX)>1.25||Math.abs(ndcY)>1.25)return {visible:false};
  const halfWidth=labelWidth/2,halfHeight=labelHeight/2,margin=8;
  const minX=margin+halfWidth,maxX=viewportWidth-margin-halfWidth,minY=safeTop+halfHeight,maxY=safeBottom-halfHeight;
  if(maxX<minX||maxY<minY)return {visible:false};
  const preferred={x:Math.min(Math.max((ndcX*.5+.5)*viewportWidth,minX),maxX),y:Math.min(Math.max((-ndcY*.5+.5)*viewportHeight,minY),maxY)};
  const clear=({x,y})=>{
    const bounds={left:x-halfWidth,right:x+halfWidth,top:y-halfHeight,bottom:y+halfHeight};
    return !occupied.some(other=>bounds.left<other.right+4&&bounds.right>other.left-4&&bounds.top<other.bottom+4&&bounds.bottom>other.top-4);
  };
  const placed=(position)=>({visible:true,...position,preferredX:preferred.x,preferredY:preferred.y,offset:Math.hypot(position.x-preferred.x,position.y-preferred.y)});
  if(clear(preferred))return placed(preferred);
  const stepX=labelWidth+10,stepY=labelHeight+10;
  for(let ring=1;ring<=8;ring++){
    const candidates=[
      [0,-ring*stepY],[0,ring*stepY],[ring*stepX,0],[-ring*stepX,0],
      [ring*stepX,-ring*stepY],[ring*stepX,ring*stepY],[-ring*stepX,ring*stepY],[-ring*stepX,-ring*stepY],
    ];
    for(const [dx,dy] of candidates){
      const candidate={x:Math.min(Math.max(preferred.x+dx,minX),maxX),y:Math.min(Math.max(preferred.y+dy,minY),maxY)};
      if(clear(candidate))return placed(candidate);
    }
  }
  return {visible:false};
}
export function assemblySideLabelPoint({position,cameraRight,halfWidth=0,side=1,gap=.48}={}){
  if(!Array.isArray(position)||position.length!==3||position.some(value=>!Number.isFinite(value)))throw Error('A spatial label needs a finite object position');
  if(!Array.isArray(cameraRight)||cameraRight.length!==3||cameraRight.some(value=>!Number.isFinite(value)))throw Error('A spatial label needs the camera side axis');
  if(!Number.isFinite(halfWidth)||halfWidth<0||!Number.isFinite(gap)||gap<0)throw Error('A spatial label needs a valid side clearance');
  const length=Math.hypot(...cameraRight);if(length<1e-8)throw Error('The camera side axis cannot be zero');
  const direction=side<0?-1:1,offset=halfWidth+gap;
  return position.map((value,index)=>Number((value+cameraRight[index]/length*direction*offset).toFixed(4)));
}

// A Lens overview is intentionally hierarchical: the domain object is visible
// first and its feature tabs only receive labels after the domain has opened.
// Without this gate invisible children leave a misleading cloud of detached
// words behind their parent object.
export function shouldShowRealityObjectLabel({node,activeGroupId=null,focusIsolated=false,selectedId=null,objectId=null}={}){
  if(!node?.isTab||node.root?.visible===false||focusIsolated)return false;
  if(activeGroupId&&activeGroupId!=='*'&&node.lensGroup!==activeGroupId)return false;
  if(objectId!==selectedId&&Number(node.contextOpacity??1)<.12)return false;
  return Number(node.tabReveal??1)>=.35;
}
// HUD chrome (header, toolbar, inspector panels) reserves screen space; the
// label band is whatever vertical space remains, so names slide along chrome
// edges instead of vanishing behind them.
export function computeLabelSafeBand(chromeRects,viewportHeight){
  let safeTop=8,safeBottom=viewportHeight-8;
  for(const rect of chromeRects){
    if(rect.bottom<viewportHeight/2&&rect.bottom+8>safeTop)safeTop=rect.bottom+8;
    else if(rect.top>=viewportHeight/2&&rect.top-8<safeBottom)safeBottom=rect.top-8;
  }
  if(safeBottom<safeTop+24){safeTop=8;safeBottom=viewportHeight-8;}
  return {safeTop,safeBottom};
}

export function createRealityAssembly({THREE,renderer,scene,camera,controls,world,targets,features,relationships={},onNavigate,onSpaceNavigate=()=>{},onFrame,onPanelFrame=()=>{},onActiveChange=()=>{},readFeature=()=>null,environmentTexture=null,reducedMotion=false}){
  // Initial density only; the optical composer sizes a reading skin from
  // its actual projection. Geometry owns the surface; text never gets scaled
  // down to fit an arbitrary desktop raster.
  const SURFACE_PIXELS_PER_UNIT=160;
  const shapeLabels=Object.fromEntries(Object.entries(REALITY_TAB_FORMS).map(([id,form])=>[id,form.label]));
  const shapeOptions=Object.entries(REALITY_TAB_FORMS).map(([id])=>`<option value="${id}">${shapeLabels[id]??id}</option>`).join('');
  const primary=['block-world','contracts','person','rooms','academy','world-events','multi-sport-events','asset-market'];
  const ordered=[...features].sort((a,b)=>{const aIndex=primary.indexOf(a.id),bIndex=primary.indexOf(b.id);return (aIndex<0?100:aIndex)-(bIndex<0?100:bIndex);});
  // Feature windows sit in six semantic clusters along a widening spatial
  // funnel. The former central cube is now an ordinary spherical feature tab.
  const defaultForms={worlds:'cube',people:'sphere',network:'cube',value:'cylinder',agents:'torus',experiences:'triangular-prism'};
  const groupMembers=new Map();
  for(const feature of ordered){
    const groupId=resolveRealityLensGroup(feature.id),members=groupMembers.get(groupId)??[];
    members.push(feature);groupMembers.set(groupId,members);
  }
  const groupOffsets=new Map([...groupMembers].map(([groupId,members])=>[groupId,new Map(members.map((feature,index)=>[feature.id,index]))]));
  const labelFor=feature=>feature?.label??realityLensLabel(feature);
  const copyFor=value=>String(value??'');
  const visibleId=id=>String(id);
  const placedPositions=ordered.map((feature,i)=>{
    const groupId=resolveRealityLensGroup(feature.id),members=groupMembers.get(groupId)??[feature],index=groupOffsets.get(groupId)?.get(feature.id)??0;
    const {position}=realityLensEngine.placeInFunnel({id:feature.id,index,count:members.length,groupId});
    return {
      id:feature.id,
      position,
      lensGroup:groupId,
      shape:defaultForms[groupId]??'cube',size:1,
    };
  });
  // Start with the authored Lens sequence, then gently resolve only real
  // body collisions.  The solver moves sideways from the Lens axis, so the
  // near -> middle -> far order stays legible rather than becoming a pile.
  const initialLayout=realityLensEngine.relaxLayout(placedPositions);
  const positions=initialLayout.objects;
  const workspace=createRealityWorkspace({objects:positions,selectedId:ordered[0]?.id,rootLabel:'Una Realitas'});
  let owner=workspace.timeline;
  let creatorDesign=null,creatorBackground=null;
  // Capture only geometry actually touched by a design. Later edits to other
  // objects remain the user's work rather than reverting to startup defaults.
  const creatorBaseShapes=new Map();
  const creatorAppliedShapes=new Map();
  const sideRealityByFeature=new Map();
  const sideRealityKey=(parentId,featureId)=>`${parentId}\u0000${featureId}`;
  const initialShapes=new Map(positions.map(object=>[object.id,object.shape]));
  const spatial=buildRealityAssemblyScene({THREE,parent:scene,features:ordered.map((feature,i)=>({...feature,label:labelFor(feature),description:copyFor(feature.description),boundary:copyFor(feature.boundary),sources:(feature.sources??[]).map(copyFor),assemblyTier:'tab',lensGroup:positions[i]?.lensGroup??'worlds',initialTabShape:initialShapes.get(feature.id),initialPosition:positions[i]?.position})),targets,relationships});
  spatial.setSpaceViewport?.({width:innerWidth,height:innerHeight});
  spatial.setSpaceView?.(null);
  spatial.setActiveGroup(null);
  const featureMap=new Map(features.map(feature=>[feature.id,feature]));
  const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href=new URL('./reality-assembly.css?v=20261003-skin360',import.meta.url).href;document.head.append(stylesheet);
  const root=document.createElement('section');root.id='reality-assembly';root.hidden=true;root.setAttribute('aria-label','Reality Lens spatial assembly');
  root.innerHTML=`<header class="assembly-header"><a class="assembly-brand" href="?feature=reality-lens"><span aria-hidden="true">◇</span><div>maTumbo<small>People × planet × possibility</small></div></a><nav aria-label="Assembly navigation"><button data-home>Explore</button><button data-enter-person>Your space</button><button data-enter-contracts>Contracts</button><button data-grid>Block World</button></nav><form class="assembly-quick-find" data-quick-find role="search"><label><span>Find object</span><input data-quick-search type="search" autocomplete="off" placeholder="Search YouTube, agents…" aria-label="Find a Reality Lens object"></label><button type="submit">Locate</button></form><button data-clean>Hide panels</button></header>
  <aside class="assembly-directory"><p class="assembly-eyebrow">Reality Lens Ω</p><h1>Many worlds.<br><em>One reality.</em></h1><p class="assembly-intro">Explore the same universe across space and depth.<br>Every window is a real, rearrangeable tab.</p><label class="assembly-search-label">Find a connected feature<input data-search placeholder="Search worlds, contracts…" type="search"></label><nav class="assembly-catalog" aria-label="Feature objects"></nav><p class="assembly-note">Designed 3D feature previews.<br>Only the selected feature opens its connected controls.</p></aside>
  <div class="assembly-labels" aria-label="Spatial feature labels"></div>
  <div class="assembly-world-label" data-world-label hidden>One quiet point · scroll, pinch, or move Travel to enter</div>
  <aside class="assembly-inspector" aria-label="Selected tab inspector"><header><span class="assembly-eyebrow">Reality Lens · selected tab</span><button data-fold-inspector aria-label="Minimize inspector">−</button></header><div class="assembly-inspector-body"><div class="assembly-object-symbol" aria-hidden="true">◇</div><h2 data-title></h2><p data-description></p><div class="assembly-tags"><span data-mode>Present</span><span>Same feature identity</span></div><dl><dt>Feature</dt><dd data-object-id></dd><dt>Position · x / y / z</dt><dd data-coordinate></dd><dt>State</dt><dd data-open-state></dd><dt>Source refs</dt><dd data-source-count></dd></dl><section class="assembly-tab-controls" data-tab-controls><h3>Tab shape &amp; movement</h3><p data-anchor-note hidden>Block World is the fixed central cube anchor.</p><label>Shape<select data-tab-shape>${shapeOptions}</select></label><label>Size<input data-tab-size type="range" min="${REALITY_TAB_SIZE_MIN}" max="${REALITY_TAB_SIZE_MAX}" step="0.05" value="1" aria-label="Spatial tab size"></label><div class="assembly-lock-row"><button data-lock-toggle>Lock tab</button><span data-lock-state>Mutable</span></div><p>Move by axis · one tap at a time</p><div class="assembly-nudges" aria-label="Move tab in three dimensions"><button data-nudge-axis="x" data-nudge-step="-1">X −</button><button data-nudge-axis="x" data-nudge-step="1">X +</button><button data-nudge-axis="y" data-nudge-step="-1">Y −</button><button data-nudge-axis="y" data-nudge-step="1">Y +</button><button data-nudge-axis="z" data-nudge-step="-1">Z −</button><button data-nudge-axis="z" data-nudge-step="1">Z +</button></div><p class="assembly-note" data-edit-note>Choose Move, then drag a tab; hold Shift while dragging to travel through depth.</p></section><div class="assembly-actions"><button data-open>Expand tab</button><button data-side-reality>Enter side reality</button><button data-focus>Approach</button><button data-enter class="assembly-primary">Enter feature ↗</button></div><h3>Connected source references</h3><div data-sources></div><p class="assembly-note" data-boundary></p><p class="assembly-source-detail" data-source-detail></p></div></aside>
  <div class="assembly-selection-hint" data-hover-label>Hover to peek · click to select · double-click to expand</div>
  <footer class="assembly-toolbar"><div class="assembly-view"><span class="assembly-eyebrow">View</span><button data-view="3d" aria-pressed="true">3D</button><button data-view="4d" aria-pressed="false">4D · time</button></div><div class="assembly-tools"><button data-interaction="orbit" aria-pressed="true">Orbit</button><button data-interaction="move" aria-pressed="false">Move tabs</button><button data-open-secondary>Expand / close</button><button data-home>Overview</button></div><label class="assembly-travel">Travel<input data-travel type="range" min="3" max="220" value="173" step="1" aria-label="Move the viewpoint closer or farther"></label><div class="assembly-timeline"><label>Observed local history<input data-time type="range" min="0" max="0" value="0" step="1" aria-label="Recorded view frame"></label><span data-time-label>No previous observations</span><button data-present>Present</button></div><button data-export>Export history</button></footer>
  <section class="assembly-branches" hidden aria-label="Proposed branches"><div><span class="assembly-eyebrow">4D = space + observed time / proposed states</span><p>History is read-only. Proposed layouts do not change the present.</p></div><form data-branch-form><label class="assembly-sr-only" for="assembly-branch-name">Proposed branch name</label><input id="assembly-branch-name" name="branchName" maxlength="60" required placeholder="Name a proposed branch"><button class="assembly-primary">Create branch</button></form><label>View branch<select data-branch-select><option value="present">Present</option></select></label></section>
  <p class="assembly-status" data-status role="status" aria-live="polite"></p>
`;
  const cssSurfaceHost=document.createElement('div');cssSurfaceHost.className='assembly-css3d-host';cssSurfaceHost.setAttribute('aria-label','Interactive surfaces attached to selected object');root.prepend(cssSurfaceHost);
  document.body.append(root);
  let css3dRenderer=null,CSS3DObject=null,mountedSurface=null,css3dFailed=false,destroyed=false;
  const resizeCss3d=()=>{if(!css3dRenderer)return;css3dRenderer.setSize(innerWidth,innerHeight);if(active&&mountedSurface){focus();syncNativeMedia(mountedSurface,true);}};
  import('three/addons/renderers/CSS3DRenderer.js').then(module=>{
    if(destroyed)return;
    CSS3DObject=module.CSS3DObject;
    css3dRenderer=new module.CSS3DRenderer();
    css3dRenderer.domElement.className='assembly-css3d-renderer';
    css3dRenderer.domElement.setAttribute('aria-label','Interactive object surfaces');
    cssSurfaceHost.append(css3dRenderer.domElement);resizeCss3d();
    if(mountedSurface)materializeSurfaceObjects(mountedSurface);
  }).catch(()=>{css3dFailed=true;if(mountedSurface)materializeSurfaceObjects(mountedSurface);});
  window.addEventListener('resize',resizeCss3d);
  let lastAssemblyFocus=null,resizeFocusUntil=0;
  root.addEventListener('focusin',event=>{lastAssemblyFocus=event.target;});
  // Feature owners may use the same data attributes as the Assembly. Keep
  // renderer controls scoped to this owner even after a live skin is moved in.
  let movingControls=null;
  const all=selector=>[...new Set([...root.querySelectorAll(selector),...(movingControls?.querySelectorAll(selector)??[])])].filter(element=>!element.closest('.reality-lens-feature-panel,.assembly-wrap-fallback')||element.closest('[data-object-tools=true]'));
  // Inspector controls travel into the owning object's CSS3D front. Keep
  // their original references so hovering another object can still update
  // them while they are temporarily outside the screen-space root.
  const controlReferences=new Map();
  const find=selector=>{
    if(controlReferences.has(selector))return controlReferences.get(selector);
    const element=all(selector)[0]??null;
    if(element)controlReferences.set(selector,element);
    return element;
  };
  const directory=find('.assembly-directory');directory.id='assembly-feature-directory';
  const directoryToggle=document.createElement('button');directoryToggle.type='button';directoryToggle.dataset.directoryToggle='';directoryToggle.textContent='Spaces';directoryToggle.setAttribute('aria-label','Find an object');directoryToggle.setAttribute('aria-controls',directory.id);directoryToggle.setAttribute('aria-expanded','false');find('.assembly-header').append(directoryToggle);
  const directoryClose=document.createElement('button');directoryClose.type='button';directoryClose.dataset.directoryClose='';directoryClose.textContent='Close';directory.prepend(directoryClose);
  const selectedSurface=find('.assembly-inspector');selectedSurface.hidden=true;
  movingControls=selectedSurface;
  find('.assembly-brand small').textContent='Reality Lens Ω';
  find('.assembly-directory .assembly-eyebrow').textContent='Spaces';
  find('.assembly-directory h1').innerHTML='One space<br><em>at a time.</em>';
  find('.assembly-intro').innerHTML='Choose a space, then open a feature.<br>The other objects stay where you left them.';
  find('.assembly-search-label').firstChild.textContent='Find a feature ';
  find('[data-search]').placeholder='YouTube, chess, contracts…';
  find('[data-quick-find] label span').textContent='Find';
  find('[data-quick-search]').placeholder='YouTube, agents…';
  find('.assembly-catalog').setAttribute('aria-label','Reality Lens feature spaces');
  find('.assembly-directory .assembly-note').innerHTML='Each feature keeps its own state.<br>Open one when you need it.';
  find('.assembly-header [data-home]').textContent='Overview';
  find('[data-enter-person]').textContent='Your space';find('[data-enter-contracts]').textContent='Contracts';find('[data-grid]').textContent='Block World';
  find('[data-enter-person]').setAttribute('aria-label','Your space');find('[data-enter-contracts]').setAttribute('aria-label','Contracts');find('[data-grid]').textContent='Block World';find('[data-grid]').setAttribute('aria-label','Block World');
  find('[data-clean]').textContent='Details';find('[data-clean]').setAttribute('aria-label','Show or hide selected object details');
  find('[data-world-label]').textContent='Your world · scroll or pinch to explore';
  find('[data-hover-label]').textContent='Drag the field to orbit · tap an object to open';
  find('.assembly-inspector .assembly-eyebrow').textContent='Selected object';
  find('.assembly-tab-controls h3').textContent='Shape & movement';
  find('[data-anchor-note]').textContent='This object is fixed in place.';
  find('[data-lock-toggle]').textContent='Lock';find('[data-focus]').textContent='Approach';find('[data-side-reality]').textContent='New side reality';
  find('[data-enter]').textContent='Open feature';find('[data-open]').textContent='Expand';find('[data-open-secondary]').textContent='Expand / Close';
  all('.assembly-inspector h3')[1].textContent='Connected sources';
  find('.assembly-toolbar [data-home]').textContent='Home';find('.assembly-toolbar [data-view="4d"]').textContent='4D · history';find('.assembly-toolbar [data-view="3d"]').textContent='3D';
  find('.assembly-toolbar .assembly-view .assembly-eyebrow').textContent='View';
  find('[data-present]').textContent='Present';find('[data-export]').textContent='Export';
  const readout=document.createElement('div');readout.className='assembly-size-readout';readout.innerHTML='<span>Size</span><strong data-size-readout>1.0×</strong><small>Scroll over the object to resize</small>';
  find('[data-tab-size]').closest('label').replaceWith(readout);find('.assembly-nudges').remove();
  find('.assembly-travel').remove();find('[data-interaction="orbit"]').remove();find('[data-interaction="move"]').textContent='Arrange';
  find('[data-edit-note]').textContent='Drag to arrange. Hold Shift to move through depth. Scroll over an object to resize.';
  all('.assembly-inspector dt').forEach((term,index)=>{term.textContent=['Feature','Position · x / y / z','State','Sources'][index]??term.textContent;});
  const objectSymbol=find('.assembly-object-symbol'),objectTitle=find('[data-title]'),objectDescription=find('[data-description]'),objectHero=document.createElement('div'),objectCopy=document.createElement('div'),stageBadge=document.createElement('span');
  objectHero.className='assembly-object-hero';objectCopy.className='assembly-object-copy';stageBadge.className='assembly-stage-badge';stageBadge.dataset.stageBadge='';
  objectCopy.append(stageBadge,objectTitle,objectDescription);objectHero.append(objectSymbol,objectCopy);find('.assembly-inspector-body').prepend(objectHero);
  find('.assembly-inspector').setAttribute('aria-label','Selected object details');
  find('[data-fold-inspector]').setAttribute('aria-label','Minimize selected object details');
  find('[data-tab-shape]').setAttribute('aria-label','Change object shape');
  const textView=document.createElement('button');textView.type='button';textView.textContent='Text view';textView.dataset.surfaceTextView='';textView.setAttribute('aria-pressed','false');
  textView.onclick=()=>{const shown=root.classList.toggle('assembly-accessible-text');renderer.domElement.classList.toggle('reality-text-view-world',shown);textView.setAttribute('aria-pressed',String(shown));textView.textContent=shown?'Object view':'Text view';if(mountedSurface){const skin=mountedSurface.front;for(const [key,value] of Object.entries(shown?{left:'50%',top:'var(--surface-reading-top,160px)',transform:'translateX(-50%)',width:'min(760px, calc(100vw - 28px))','max-height':'calc(100dvh - var(--surface-reading-top,160px) - 50px)',overflow:'auto'}:{left:'-12000px',top:'0',transform:'none',width:'760px','max-height':'none',overflow:'visible'}))skin.style.setProperty(key,value,'important');syncNativeMedia(mountedSurface,true);}};find('.assembly-header').append(textView);
  const surfaceHelp=document.createElement('p');surfaceHelp.className='assembly-surface-help';surfaceHelp.textContent='Drag to turn · tap the surface · scroll to browse';root.append(surfaceHelp);

  find('[data-lock-toggle]').setAttribute('aria-label','Lock or unlock this object');
  find('[data-enter]').setAttribute('aria-label','Open the selected feature');
  find('[data-directory-toggle]').setAttribute('aria-label','Find a feature');
  directory.hidden=true;
  const toolbar=find('.assembly-toolbar');toolbar.id='assembly-view-controls';toolbar.hidden=true;
  const toolbarSizeObserver=new ResizeObserver(()=>{
    root.style.setProperty('--assembly-toolbar-height',`${Math.ceil(toolbar.getBoundingClientRect().height)}px`);
  });
  toolbarSizeObserver.observe(toolbar);
  const viewToggle=document.createElement('button');viewToggle.type='button';viewToggle.textContent='View';viewToggle.dataset.viewTools='';viewToggle.setAttribute('aria-controls',toolbar.id);viewToggle.setAttribute('aria-expanded','false');find('.assembly-header').append(viewToggle);
  const emptySearch=document.createElement('p');emptySearch.className='assembly-search-empty';emptySearch.textContent='No matching features. Try another name.';emptySearch.hidden=true;find('.assembly-catalog').after(emptySearch);
  const contextBar=document.createElement('div');contextBar.className='assembly-space-context';
  contextBar.innerHTML='<button type="button" data-space-back hidden>← Back to spaces</button><div><p data-space-kicker>YOUR CONNECTED UNIVERSE</p><h1 data-space-title>A little space for everything.</h1><p data-space-copy>Choose a world. Open an object. Keep your place.</p><nav class="assembly-space-pages" aria-label="Objects in this space" hidden><button type="button" data-space-prev aria-label="Previous objects">←</button><span data-space-page-count></span><button type="button" data-space-next aria-label="Next objects">→</button></nav></div>';
  const breadcrumbs=document.createElement('nav');breadcrumbs.className='assembly-breadcrumbs';breadcrumbs.setAttribute('aria-label','Your place in Reality Lens');
  breadcrumbs.innerHTML='<button type="button" data-crumb-home>Home</button><span aria-hidden="true">/</span><button type="button" data-crumb-space hidden></button><span data-crumb-divider aria-hidden="true" hidden>/</span><strong data-crumb-feature></strong>';
  contextBar.prepend(breadcrumbs);root.append(contextBar);
  find('.assembly-brand').onclick=event=>{event.preventDefault();onNavigate?.('reality-lens');overview();};
  find('[data-crumb-home]').onclick=()=>{onNavigate?.('reality-lens');overview();};
  find('[data-crumb-space]').onclick=()=>{if(activeLensGroup&&activeLensGroup!=='*')exploreGroup(activeLensGroup);};
  const allObjects=document.createElement('button');allObjects.type='button';allObjects.textContent='All objects';allObjects.dataset.allObjects='';find('.assembly-tools').append(allObjects);
  const updateSpaceContext=(groupId,featureId=null)=>{
    const groupLabel=groupId&&groupId!=='*'?lensSpaceLabel(groupId):null;
    root.dataset.spaceView=featureId?'feature':groupId==='*'?'all':groupId?'space':'gateway';
    breadcrumbs.hidden=!groupId&&!featureId;find('[data-crumb-space]').hidden=!groupLabel;find('[data-crumb-space]').textContent=groupLabel??'';find('[data-crumb-space]').disabled=!featureId;find('[data-crumb-divider]').hidden=!featureId;find('[data-crumb-feature]').textContent=featureId?labelFor(featureMap.get(featureId)):'';
    find('[data-space-kicker]').textContent=featureId?(groupLabel??'REALITY LENS'):groupLabel?'YOUR CONNECTED UNIVERSE':'REALITY LENS';
    find('[data-space-title]').textContent=featureId?labelFor(featureMap.get(featureId)):groupLabel??(groupId==='*'?'Your whole universe.':'A little space for everything.');
    find('[data-space-copy]').textContent=featureId?'Your object is open. Its space stays where you left it.':groupLabel?`${groupMembers.get(groupId)?.length??0} ${groupId==='network'?'tools':'objects'} · choose one to open.`:groupId==='*'?'The full assembly. Use Spaces to return to a quieter view.':'Choose a world. Open an object. Keep your place.';
    // Breadcrumbs own the visible return path. Keep the existing back action
    // for Escape without a second button covering Home at the same position.
    find('[data-space-back]').hidden=true;
    find('[data-space-back]').textContent=featureId&&groupLabel?`← ${groupLabel}`:'← Back to spaces';
    find('[data-clean]').disabled=!featureId&&groupId!=='*';
    updateSpacePages();
  };
  function updateSpacePages(){
    const page=spatial.getSpacePage?.(),pager=find('.assembly-space-pages');
    pager.hidden=root.dataset.spaceView!=='space'||!page||page.pageCount<2;
    if(!page)return;
    find('[data-space-page-count]').textContent=`${page.page*page.pageSize+1}–${Math.min(page.total,(page.page+1)*page.pageSize)} of ${page.total}`;
    find('[data-space-prev]').disabled=page.page===0;find('[data-space-next]').disabled=page.page>=page.pageCount-1;
  }
  function changeSpacePage(delta){const page=spatial.getSpacePage?.();if(!page)return;spatial.focus(null);spatial.setSpacePage?.(page.page+delta);updateSpacePages();frameSpace(activeLensGroup);render();}
  find('[data-space-prev]').onclick=()=>changeSpacePage(-1);find('[data-space-next]').onclick=()=>changeSpacePage(1);
  function setViewTools(open,{restoreFocus=false}={}){
    toolbar.hidden=!open;viewToggle.setAttribute('aria-expanded',String(open));
    root.classList.toggle('assembly-tools-open',open);document.body.classList.toggle('mobile-view-open',open);
    if(open){setDirectory(false);selectedSurface.hidden=true;root.classList.add('assembly-clean');root.classList.remove('assembly-object-focused');find('[data-clean]').textContent='Details';}
    find('.assembly-branches').hidden=!open||viewMode!=='4d';
    if(restoreFocus)viewToggle.focus({preventScroll:true});
  }
  viewToggle.onclick=()=>setViewTools(toolbar.hidden,{restoreFocus:true});
  function setDirectory(open,{restoreFocus=false,focusSearch=true}={}){
    directory.hidden=!open;
    root.classList.toggle('assembly-directory-open',open);directoryToggle.setAttribute('aria-expanded',String(open));
    if(open){setViewTools(false);selectedSurface.hidden=true;root.classList.remove('assembly-clean','assembly-object-focused');find('[data-clean]').textContent='Details';if(focusSearch)find('[data-search]').focus();}
    else if(restoreFocus)directoryToggle.focus({preventScroll:true});
  }
  directoryToggle.onclick=()=>setDirectory(!root.classList.contains('assembly-directory-open'),{restoreFocus:true});directoryClose.onclick=()=>setDirectory(false,{restoreFocus:true});
  const resizeFocus=()=>{
    if(root.hidden)return;
    const focused=lastAssemblyFocus;
    if(!focused||![document.body,focused].includes(document.activeElement))return;
    resizeFocusUntil=performance.now()+250;
    if(innerWidth<700&&directory.contains(focused))setDirectory(true);
    const restore=()=>{if(root.hidden)return;if(focused.classList.contains('assembly-node-label'))focused.hidden=false;focused.focus({preventScroll:true});if(directory.contains(focused))focused.scrollIntoView({block:'nearest'});};
    restore();requestAnimationFrame(restore);
  };
  window.addEventListener('resize',resizeFocus);
  let active=false,saved=null,viewMode='3d',interaction='orbit',hovered=null,pointer=null,focusTarget=null,focusPosition=null,inspectorFolded=false,activeLensGroup=null;
  const labels=new Map(),catalog=new Map(),catalogSections=new Map();
  for(const domain of REALITY_LENS_GROUPS){
    const members=groupMembers.get(domain.id)??[];if(!members.length)continue;
    const section=document.createElement('section');section.className='assembly-catalog-group';section.dataset.domain=domain.id;
    const header=document.createElement('button');header.type='button';header.className='assembly-domain-toggle';header.setAttribute('aria-expanded','false');
    const title=document.createElement('span');title.textContent=lensSpaceLabel(domain.id);
    const count=document.createElement('small');count.textContent=String(members.length);
    header.append(title,count);
    const children=document.createElement('div');children.className='assembly-domain-features';children.hidden=true;
    section.append(header,children);find('.assembly-catalog').append(section);
    const record={section,header,children,label:lensSpaceLabel(domain.id),open:false};catalogSections.set(domain.id,record);
    header.onclick=()=>{
      for(const other of catalogSections.values())if(other!==record){other.open=false;other.children.hidden=true;other.header.setAttribute('aria-expanded','false');}
      record.open=!record.open;children.hidden=!record.open;header.setAttribute('aria-expanded',String(record.open));
      if(record.open)exploreGroup(domain.id,{closeDirectory:false});
      else if(activeLensGroup===domain.id)overview();
      render();
    };
  }
  const ray=new THREE.Raycaster(),point=new THREE.Vector2(),screenPoint=new THREE.Vector3(),labelRight=new THREE.Vector3(),dragPlane=new THREE.Plane(),dragPoint=new THREE.Vector3(),dragNormal=new THREE.Vector3();
  const say=message=>{find('[data-status]').textContent=copyFor(message);};
  const guard=fn=>(...args)=>{try{return fn(...args);}catch(error){say(error.message);return null;}};
  const orbitNavigation=mountOrbitNavigation({host:toolbar,
    readCamera:()=>({position:camera.position.toArray(),target:controls.target.toArray(),minDistance:Math.max(3,controls.minDistance??3),maxDistance:controls.maxDistance??220}),
    onChange:next=>{if(!active)return;focusTarget=null;focusPosition=null;mountedSurface?.controller?.holdRotation?.();camera.position.fromArray(next.position);controls.target.fromArray(next.target);controls.update();onFrame?.();},
  });
  const currentObject=()=>owner.getSnapshot().objects.find(object=>object.id===owner.getSnapshot().selectedId);
  function snapshot(){const record=mountedSurface,node=record&&spatial.nodes.get(record.featureId);return {...owner.getSnapshot(),active,viewMode,interaction,spaceId:activeLensGroup,spaceView:root.dataset.spaceView,camera:{position:camera.position.toArray(),target:controls.target.toArray(),fov:camera.fov,aspect:camera.aspect,near:camera.near,far:camera.far},spatial:spatial.getSnapshot(),liveObject:record?{...(record.controller?.snapshot()??record.binding),panelId:record.livePanel?.id??null}:null,layoutDiagnostics:initialLayout.diagnostics,reality:workspace.getSnapshot()};}
  function describeSurface(options){
    const surface=realityObjectSurfaceEngine.describe(options),feature=options.feature;
    return {...surface,label:labelFor(feature),description:copyFor(feature.description),boundary:copyFor(feature.boundary),summary:copyFor(options.summary||'Open this object to use its connected feature.'),stageLabel:['Overview','Identity','Sources','Details'][options.stage??0],state:options.object.locked?'Locked':options.object.open?'Open':'Ready to open',sourceRefs:(feature.sources??[]).map(copyFor)};
  }
  function makeFallbackFront(feature,object){
    const surface=describeSurface({feature,object,stage:spatial.nodes.get(feature.id)?.revealStage??0,summary:readFeature(feature.id)?.summary});
    const page=document.createElement('article');page.className='assembly-wrap-face assembly-wrap-fallback';page.dataset.face='front';page.dataset.objectShape=surface.shape;
    const eyebrow=document.createElement('small'),title=document.createElement('h2'),body=document.createElement('p'),detail=document.createElement('p'),button=document.createElement('button');
    eyebrow.textContent='LIVING SURFACE · REALITY LENS';title.textContent=surface.label;body.textContent=surface.description||surface.summary;detail.textContent=surface.boundary;button.type='button';button.textContent='OPEN HERE';button.addEventListener('click',()=>onNavigate?.(feature.id,'reality-assembly'));
    page.append(eyebrow,title,body,detail,button);return page;
  }
  function materializeSurfaceObjects(record){
    if(!record)return;
    const node=spatial.nodes.get(record.featureId);if(!node)return;
    if(!record.controller){
      record.front.classList.add('reality-surface-semantic-owner');
      for(const [key,value] of Object.entries({position:'fixed',left:'-12000px',top:'0',right:'auto',bottom:'auto',width:'760px',height:'auto','max-height':'none','max-width':'760px',transform:'none','clip-path':'none',overflow:'visible',contain:'none','container-type':'normal','backdrop-filter':'none',filter:'none',perspective:'none','transform-style':'flat',isolation:'auto'}))record.front.style.setProperty(key,value,'important');
      cssSurfaceHost.append(record.front);
      record.controller=createRealitySurfaceController({THREE,node,element:record.front,feature:featureMap.get(record.featureId),renderer,camera,controls,onStatus:say});
      record.objects=[node.tabMesh];
    }
    // Cross-origin browser video is an explicit planar media exception. Keep
    // one player, attached once, while search and actions live on mesh UVs.
    if(CSS3DObject&&!record.media){
      const frame=record.front.querySelector('iframe[data-yt-frame]');
      if(frame){
        const parent=frame.parentNode,next=frame.nextSibling,style=frame.getAttribute('style');
        const slot=document.createElement('div');slot.className='assembly-native-media-slot';slot.setAttribute('aria-hidden','true');slot.hidden=true;parent.insertBefore(slot,frame);
        const notice=document.createElement('p');notice.dataset.surfaceMediaNotice='true';notice.textContent='YouTube video uses one native browser area. Rotate this body for search, results and controls.';parent.insertBefore(notice,frame);
        const object3d=new CSS3DObject(frame);node.root.add(object3d);
        for(const [key,value] of Object.entries({width:'640px',height:'360px',border:'0',background:'#020810','backface-visibility':'hidden','pointer-events':'auto'}))frame.style.setProperty(key,value,'important');
        record.media={frame,parent,next,style,object3d,notice,slot,layout:'object'};
      }
    }
  }
  function sizeAndPlaceSurface(record){
    if(!record)return;
    const node=spatial.nodes.get(record.featureId);if(!node)return;
    record.controller?.sync();record.binding=node.surfaceBinding??record.binding;record.objects=[node.tabMesh];
    record.shape=node.shape;node.surfaceStretch=[1,1,1];root.dataset.readingProjection='mesh-360';
    if(record.media){
      const {object3d,frame,slot}=record.media,form=REALITY_TAB_FORMS[node.shape],textMode=root.classList.contains('assembly-accessible-text');
      const hasSource=frame.getAttribute('src')!=='about:blank';
      if(slot.hidden===hasSource)slot.hidden=!hasSource;
      frame.style.visibility=hasSource?'visible':'hidden';
      // Mount the blank iframe in its stable CSS3D parent before first play.
      // Deferring that DOM move until selection recreates its browsing context.
      if(!hasSource){object3d.visible=true;return;}
      // A deliberate play selection must load even while the body is turned
      // away. Loading lazy media from an offscreen original owner can stall it.
      if(hasSource&&frame.loading!=='eager')frame.loading='eager';
      if(textMode){
        const rect=slot.getBoundingClientRect(),reader=record.front.getBoundingClientRect();
        const clip={top:Math.max(0,reader.top-rect.top,-rect.top),right:Math.max(0,rect.right-reader.right,rect.right-innerWidth),bottom:Math.max(0,rect.bottom-reader.bottom,rect.bottom-innerHeight),left:Math.max(0,reader.left-rect.left,-rect.left)};
        object3d.visible=hasSource&&clip.top+clip.bottom<rect.height&&clip.left+clip.right<rect.width&&placeNativeMediaAtRect({THREE,object:object3d,camera,rect,width:innerWidth,height:innerHeight});
        for(const [key,value] of Object.entries({width:`${rect.width}px`,height:`${rect.height}px`,'min-height':'0','clip-path':`inset(${clip.top}px ${clip.right}px ${clip.bottom}px ${clip.left}px)`}))frame.style.setProperty(key,value,'important');
        record.media.layout='text';return;
      }
      if(record.media.layout!=='object'){
        for(const [key,value] of Object.entries({width:'640px',height:'360px','min-height':'0','clip-path':'none'}))frame.style.setProperty(key,value,'important');
        record.media.layout='object';
      }
      object3d.scale.setScalar(form.width*.82/640);object3d.position.set(0,0,form.depth/2+.004);object3d.rotation.set(0,0,0);object3d.updateMatrixWorld(true);
      const facing=new THREE.Vector3(0,0,1).applyQuaternion(node.root.getWorldQuaternion(new THREE.Quaternion()));
      const toward=camera.getWorldPosition(new THREE.Vector3()).sub(object3d.getWorldPosition(new THREE.Vector3())).normalize();
      object3d.visible=hasSource&&facing.dot(toward)>.08;
    }
  }
  // Native reading layout must respond even when the expensive world renderer
  // is paused by the freeze guard. This only updates projection and DOM ink.
  function syncNativeMedia(record,force=false){
    if(!record?.media||record!==mountedSurface||(!force&&!root.classList.contains('assembly-accessible-text')))return;
    camera.updateMatrixWorld();sizeAndPlaceSurface(record);css3dRenderer?.render(scene,camera);
  }
  function clearFeatureSurface(){
    const record=mountedSurface;if(!record)return false;mountedSurface=null;
    record.controller?.dispose();record.front.classList.remove('reality-surface-semantic-owner');
    if(record.media){const {frame,parent,next,style,object3d,notice,slot}=record.media;object3d.removeFromParent();if(next?.parentNode===parent)parent.insertBefore(frame,next);else parent.append(frame);if(style===null)frame.removeAttribute('style');else frame.setAttribute('style',style);notice.remove();slot.remove();}
    renderer.domElement.classList.remove('reality-text-view-world');
    root.classList.remove('assembly-accessible-text');textView.setAttribute('aria-pressed','false');textView.textContent='Text view';
    if(record.tools){
      record.toolsRestore.parent.append(selectedSurface);record.tools.remove();selectedSurface.removeAttribute('data-object-tools');
      if(record.toolsRestore.style===null)selectedSurface.removeAttribute('style');else selectedSurface.setAttribute('style',record.toolsRestore.style);
      selectedSurface.hidden=true;
    }
    record.flowObserver?.disconnect();
    if(record.onNativeScroll)record.front.removeEventListener('scroll',record.onNativeScroll);
    if(record.onNativeEdit)for(const event of ['click','input','change','toggle'])record.front.removeEventListener(event,record.onNativeEdit,true);
    record.intro?.restore();
    record.front.querySelectorAll('[data-surface-flow]').forEach(element=>element.removeAttribute('data-surface-flow'));
    const node=spatial.nodes.get(record.featureId);if(node){node.surfaceReading=false;node.surfaceStretch=[1,1,1];if(node.indicator)node.indicator.visible=true;}
    record.metadata?.remove();
    for(const surface of record.surfaces){surface.object3d?.removeFromParent();surface.element.remove();}
    if(record.livePanel){
      const panel=record.livePanel,restore=record.restore;
      if(!restore.hadLensClass)panel.classList.remove('reality-lens-feature-panel');
      if(restore.shape===null)panel.removeAttribute('data-object-shape');else panel.setAttribute('data-object-shape',restore.shape);
      if(restore.lensAttached===null)panel.removeAttribute('data-lens-surface-attached');else panel.setAttribute('data-lens-surface-attached',restore.lensAttached);
      if(restore.style===null)panel.removeAttribute('style');else panel.setAttribute('style',restore.style);
      if(restore.panelSpace===null)panel.removeAttribute('data-panel-space');else panel.setAttribute('data-panel-space',restore.panelSpace);
      if(restore.compact===null)panel.removeAttribute('data-compact');else panel.setAttribute('data-compact',restore.compact);
      if(restore.noPanelDrag===null)panel.removeAttribute('data-no-panel-drag');else panel.setAttribute('data-no-panel-drag',restore.noPanelDrag);
      if(restore.parent){if(restore.next?.parentNode===restore.parent)restore.parent.insertBefore(panel,restore.next);else restore.parent.append(panel);}
      document.dispatchEvent(new CustomEvent('matumbo:reality-lens-surface-attachment',{detail:{panelId:panel.id,attached:false}}));
    }
    root.classList.remove('assembly-has-live-object-surface');
    if(record.fallback)record.front.remove();
    return true;
  }
  function mountFeatureSurface(featureId,panel=null){
    const feature=featureMap.get(featureId),node=spatial.nodes.get(featureId),object=owner.getSnapshot().objects.find(item=>item.id===featureId);
    if(!feature||!node||!object)return false;
    if(mountedSurface?.featureId===featureId&&mountedSurface.livePanel===panel)return true;
    clearFeatureSurface();
    const livePanel=panel&&!panel.hidden?panel:null,fallback=!livePanel,front=livePanel??makeFallbackFront(feature,object),detail=readFeature(featureId),surface=describeSurface({feature,object,stage:node.revealStage??0,summary:detail?.summary,readOnly:owner.getSnapshot().mode==='past'});
    const binding=realityObjectSurfaceEngine.primarySurfaceBinding({featureId,objectId:object.id,shape:surface.shape}),initialFace=binding.interactionFace;
    const restore=livePanel?{parent:livePanel.parentNode,next:livePanel.nextSibling,style:livePanel.getAttribute('style'),shape:livePanel.getAttribute('data-object-shape'),lensAttached:livePanel.getAttribute('data-lens-surface-attached'),panelSpace:livePanel.getAttribute('data-panel-space'),compact:livePanel.getAttribute('data-compact'),noPanelDrag:livePanel.getAttribute('data-no-panel-drag'),hadLensClass:livePanel.classList.contains('reality-lens-feature-panel')} : null;
    if(livePanel){
      livePanel.classList.add('reality-lens-feature-panel');livePanel.dataset.lensSurfaceAttached='true';livePanel.dataset.objectShape=surface.shape;
      // The world rig owns movement. Legacy floating-panel capture must not
      // steal native disclosure taps or scrolling from its attached skin.
      livePanel.dataset.noPanelDrag='true';
      livePanel.style.position='absolute';livePanel.style.inset='auto';livePanel.style.left='auto';livePanel.style.right='auto';livePanel.style.top='auto';livePanel.style.bottom='auto';livePanel.style.margin='0';livePanel.style.transformOrigin='50% 50%';livePanel.style.setProperty('--lens-surface-width',`${Math.round(initialFace.width*SURFACE_PIXELS_PER_UNIT)}px`);livePanel.style.setProperty('--lens-surface-height',`${Math.round(initialFace.height*SURFACE_PIXELS_PER_UNIT)}px`);livePanel.style.setProperty('--lens-surface-clip',realityObjectSurfaceEngine.clipPath(surface.shape));
      document.dispatchEvent(new CustomEvent('matumbo:reality-lens-surface-attachment',{detail:{panelId:livePanel.id,attached:true}}));
    }
    // Provenance belongs to the same reading skin. Five extra browser cards
    // wrapped round an object duplicated content and occluded the real UI.
    const metadata=document.createElement('details');metadata.className='assembly-surface-provenance';
    const summary=document.createElement('summary');summary.textContent='Object · sources & connections';metadata.append(summary);
    const identity=document.createElement('p');identity.textContent=`${surface.label} · ${visibleId(feature.id)} · same world entity`;metadata.append(identity);
    const provenance=document.createElement('p');provenance.textContent=surface.sourceRefs.join(' · ')||'No source references registered.';metadata.append(provenance);
    const boundary=document.createElement('p');boundary.textContent=surface.boundary;metadata.append(boundary);
    for(const id of (relationships[feature.id]??[]).filter(id=>featureMap.has(id)).slice(0,6)){
      const link=document.createElement('button');link.type='button';link.textContent=labelFor(featureMap.get(id));link.onclick=()=>onNavigate?.(id,'reality-assembly');metadata.append(link);
    }
    const tools=document.createElement('details');tools.className='assembly-object-tools';
    const toolsSummary=document.createElement('summary');toolsSummary.textContent='Object tools · shape & size';tools.append(toolsSummary);
    const toolsRestore={parent:selectedSurface.parentNode,style:selectedSurface.getAttribute('style')};
    selectedSurface.dataset.objectTools='true';selectedSurface.removeAttribute('style');selectedSurface.hidden=false;tools.append(selectedSurface);
    front.append(tools,metadata);
    tools.addEventListener('toggle',()=>{if(mountedSurface?.tools===tools){selectedSurface.hidden=false;find('[data-clean]').textContent=tools.open?'Close details':'Details';}});
    const surfaces=[{id:'front',element:front,object3d:null}];
    mountedSurface={featureId,binding,livePanel,restore,fallback,front,metadata,tools,toolsRestore,surfaces,objects:[],shape:null,composition:null,intro:livePanel?mountLivingSurfaceIntro(livePanel):null};
    const nativeRecord=mountedSurface;
    nativeRecord.onNativeScroll=()=>syncNativeMedia(nativeRecord);
    nativeRecord.onNativeEdit=()=>requestAnimationFrame(()=>syncNativeMedia(nativeRecord));
    front.addEventListener('scroll',nativeRecord.onNativeScroll,{passive:true});
    for(const event of ['click','input','change','toggle'])front.addEventListener(event,nativeRecord.onNativeEdit,true);
    // Discover structure, not feature names. The algorithm therefore also
    // handles older ID-styled consoles and future schema-generated controls.
    const annotateFlow=()=>{
      for(const element of front.querySelectorAll('*')){
        if(element.hasAttribute('data-surface-flow'))continue;
        const style=getComputedStyle(element);
        if(style.display==='grid'||style.display==='inline-grid')element.dataset.surfaceFlow='grid';
        else if((style.display==='flex'||style.display==='inline-flex')&&style.flexDirection==='row')element.dataset.surfaceFlow='row';
      }
    };
    const flowObserver=new MutationObserver(changes=>{if(changes.some(change=>[...change.addedNodes].some(node=>node.nodeType===1)))annotateFlow();});
    flowObserver.observe(front,{childList:true,subtree:true});mountedSurface.flowObserver=flowObserver;
    requestAnimationFrame(()=>{if(mountedSurface?.front===front)annotateFlow();});
    root.classList.add('assembly-has-live-object-surface');selectedSurface.hidden=false;materializeSurfaceObjects(mountedSurface);sizeAndPlaceSurface(mountedSurface);
    say('Drag the object to turn it. Tap its controls. Scroll for more contents. Text view provides the original accessible controls.');
    return true;
  }
  function createSideReality(featureId){
    const key=sideRealityKey(workspace.activeId,featureId),existing=sideRealityByFeature.get(key);
    if(existing)return existing;
    const feature=featureMap.get(featureId),branch=workspace.fork({label:feature.label+' · Side Reality',metadata:{featureId},selectedId:featureId});
    owner=workspace.timeline;
    sideRealityByFeature.set(key,branch.id);
    return branch.id;
  }
  function ensureSideReality(featureId){
    const source=workspace.getCurrentNode(),sourceFeature=source.state?.featureId;
    const explicitlyRelated=source.kind==='side'&&sourceFeature&&sourceFeature!=='block-world'&&featureId!=='block-world'
      &&((relationships[sourceFeature]??[]).includes(featureId)||(relationships[featureId]??[]).includes(sourceFeature));
    if(explicitlyRelated){
      const siblingKey=sideRealityKey(source.parentId,featureId),sibling=sideRealityByFeature.get(siblingKey);
      if(sibling){workspace.connect(source.id,sibling,{type:'portal',bidirectional:true});return sibling;}
      // Materialize the related feature beside the current reality, then add
      // a direct portal so travel does not route through the root anchor.
      workspace.travel(source.parentId);owner=workspace.timeline;
      const siblingId=createSideReality(featureId);
      workspace.connect(source.id,siblingId,{type:'portal',bidirectional:true});
      return siblingId;
    }
    return createSideReality(featureId);
  }
  function enterSideReality(featureId,{announce=true,renderNow=true}={}){
    const id=ensureSideReality(featureId);
    if(workspace.activeId!==id)workspace.travel(id);
    owner=workspace.timeline;
    if(renderNow)render();
    if(announce)say(`${labelFor(featureMap.get(featureId))} · independent side reality; the previous reality keeps its state.`);
  }
  function returnToParentReality({announce=true,renderNow=true}={}){
    const current=workspace.getCurrentNode(),parent=current.parentId?workspace.getNode(current.parentId):null;
    if(!workspace.returnToParent())return false;
    owner=workspace.timeline;
    if(renderNow)render();
    if(announce)say('Returned to the parent reality. The side reality keeps its state.');
    return true;
  }
  function syncActiveReality(){
    workspace.sync();
  }
  function render(){
    const state=owner.getSnapshot(),feature=featureMap.get(state.selectedId),object=state.objects.find(item=>item.id===state.selectedId);
    spatial.apply(state,{viewMode,hoveredId:hovered});
    const detail=readFeature(feature.id),surface=describeSurface({feature,object,stage:spatial.getSnapshot().selectedStage,summary:detail?.summary,readOnly:state.mode==='past'});
    find('[data-title]').textContent=labelFor(feature);find('[data-description]').textContent=copyFor(surface.description);
    find('[data-stage-badge]').textContent=`${['Overview','Identity','Sources','Details'][surface.stage]} · ${shapeLabels[surface.shape]??surface.shape}`;
    objectSymbol.textContent=({phone:'▯',square:'▦',rectangle:'▭',sphere:'◉',cylinder:'◍',cube:'⬡',wave:'∿'})[surface.shape]??'◇';
    find('[data-object-id]').textContent=visibleId(feature.id);find('[data-coordinate]').textContent=surface.positionLabel;
    find('[data-open-state]').textContent=object.anchor?'Fixed':object.locked?'Locked':object.open?'Open':'Closed';
    const anchor=object.anchor===true,immutable=object.locked===true,editingDisabled=anchor||immutable||state.mode==='past';
    find('[data-anchor-note]').hidden=!anchor;
    const shapeInput=find('[data-tab-shape]');shapeInput.value=object.shape;shapeInput.disabled=!surface.controls.canReshape||editingDisabled;
    find('[data-size-readout]').textContent=`${object.size.toFixed(1)}× · ${immutable?'Locked':'Movable'}`;
    const lockButton=find('[data-lock-toggle]');lockButton.textContent=immutable?'Unlock':'Lock';lockButton.disabled=!surface.controls.canLock||state.mode==='past';
    find('[data-lock-state]').textContent=anchor?'Fixed':immutable?'Locked':'Movable';
    find('[data-edit-note]').textContent=anchor?'This object stays fixed in place.':state.mode==='past'?'History is read-only. Return to Present to edit.':immutable?'Unlock the object to change its shape or position.':'Drag to arrange · hold Shift for depth · scroll over the object to resize.';
    const activeReality=workspace.getCurrentNode();
    find('[data-mode]').textContent=state.mode==='past'?'History · read-only':state.mode==='proposed'?'Proposed layout':'Present · local';
    find('[data-source-count]').textContent=String(surface.sourceCount);find('[data-boundary]').textContent=surface.boundary;
    const sourceContainer=find('[data-sources]');sourceContainer.replaceChildren();
    for(const source of surface.sourceRefs.length?surface.sourceRefs:['Feature navigator']){const code=document.createElement('code');code.textContent=copyFor(source);sourceContainer.append(code);}
    find('[data-source-detail]').textContent=detail?.summary||feature.description;
    all('[data-open],[data-open-secondary]').forEach(button=>{button.disabled=state.mode==='past';});find('[data-open]').textContent=object.open?'Close':'Expand';
    const sideId=sideRealityByFeature.get(sideRealityKey(workspace.activeId,state.selectedId));
    const sideButton=find('[data-side-reality]');
    const sameFeatureSide=activeReality.kind==='side'&&activeReality.state?.featureId===state.selectedId;
    const parentReality=activeReality.parentId?workspace.getNode(activeReality.parentId):null;
    sideButton.textContent=sameFeatureSide?`Return to ${parentReality?.label??'parent reality'}`:sideId?`Enter ${labelFor(feature)}`:'New side reality';
    sideButton.disabled=state.mode==='past';
    find('[data-object-id]').textContent=visibleId(feature.id)+' · '+activeReality.id;
    for(const [id,button] of catalog)button.setAttribute('aria-current',String(id===state.selectedId));
    for(const [id,label] of labels){label.classList.toggle('is-selected',id===state.selectedId);label.classList.toggle('is-hovered',id===hovered);}
    const slider=find('[data-time]');slider.max=String(state.frames.length-1);slider.value=String(state.mode==='past'?state.frames.findIndex(frame=>frame.revision===state.frameCursor):state.frames.length-1);
    const frame=state.frames[Number(slider.value)];find('[data-time-label]').textContent=state.mode==='proposed'?'User-proposed branch':`${new Date(frame.observedAt).toLocaleTimeString()} · ${frame.action}`;
    find('.assembly-branches').hidden=toolbar.hidden||viewMode!=='4d';find('.assembly-timeline').hidden=viewMode!=='4d';find('[data-export]').hidden=viewMode!=='4d';find('.assembly-timeline').classList.toggle('is-expanded',viewMode==='4d');
    const branchSelect=find('[data-branch-select]');branchSelect.replaceChildren(new Option('Present','present'));
    state.branches.forEach(branch=>branchSelect.add(new Option(branch.label,branch.id)));branchSelect.value=state.branchId??'present';
    root.dataset.previewDirty=String(state.revision>0||state.branches.length>0);
    root.dataset.historyMode=state.mode;
  }
  function select(id,{approach=true,revealInspector=false}={}){
    if(!featureMap.has(id))return false;
    if(id==='reality-lens'){overview();return true;}
    owner.select(id);activeLensGroup=resolveRealityLensGroup(id);spatial.setSpaceView?.(activeLensGroup);spatial.setActiveGroup(activeLensGroup);spatial.focus(id);updateSpaceContext(activeLensGroup,id);if(approach)focus();
    // Selecting an object must reveal its own attached living surface, not
    // force the old detached inspector over the scene. The central inspector
    // remains available through the Objectum toggle for deliberate inspection.
    selectedSurface.hidden=!revealInspector;
    root.classList.toggle('assembly-object-focused',revealInspector);
    root.classList.toggle('assembly-clean',!revealInspector);
    find('[data-clean]').textContent=revealInspector?'Close details':'Details';
    render();say(`${labelFor(featureMap.get(id))} selected.`);
  }
  let framedSpaceInsets=null;
  function measureSpaceInsets(){
    const heading=contextBar.getBoundingClientRect(),hint=find('.assembly-selection-hint').getBoundingClientRect();
    return {topInset:Math.max(innerWidth<700?220:270,heading.height>0?heading.bottom+22:0),
      bottomInset:Math.max(50,hint.height>0?innerHeight-hint.top+18:0)};
  }
  function frameSpace(groupId){
    spatial.setSpaceViewport?.({width:innerWidth,height:innerHeight});
    const bounds=spatial.getSpaceBounds?.(groupId);if(!bounds)return;updateSpacePages();
    // Reserve the measured heading, breadcrumb and pager, including wrapped
    // phone copy. A fixed 220px band allowed the bodies to cover the heading.
    framedSpaceInsets=measureSpaceInsets();
    const frame=frameRealitySpace({bounds,width:innerWidth,height:innerHeight,fov:camera.fov,...framedSpaceInsets});
    focusTarget=new THREE.Vector3(...frame.target);focusPosition=focusTarget.clone().add(new THREE.Vector3(0,0,frame.distance));onFrame?.();
  }
  function exploreGroup(groupId,{closeDirectory=true,updateLocation=true}={}){
    const record=catalogSections.get(groupId);if(!record)return;
    clearFeatureSurface();activeLensGroup=groupId;spatial.focus(null);spatial.setSpaceView?.(groupId);spatial.setActiveGroup(groupId);updateSpaceContext(groupId);frameSpace(groupId);
    if(closeDirectory)setDirectory(false);
    if(root.classList.contains('assembly-directory-open')){record.children.hidden=false;record.header.setAttribute('aria-expanded','true');record.section.scrollIntoView?.({block:'nearest'});}
    if(updateLocation)onSpaceNavigate(groupId);render();say(`${record.label} · choose an object to open.`);
  }
  function toggle(){const object=currentObject(),nextOpen=!object.open;
    if(nextOpen){
      const activeReality=workspace.getCurrentNode();
      if(!(activeReality.kind==='side'&&activeReality.state?.featureId===object.id))enterSideReality(object.id,{announce:false,renderNow:false});
      owner.setOpen(object.id,true);
    }else{
      owner.setOpen(object.id,false);
      const activeReality=workspace.getCurrentNode();
      if(activeReality.kind==='side'&&activeReality.state?.featureId===object.id)returnToParentReality({announce:false,renderNow:false});
    }
    render();say(`${labelFor(featureMap.get(object.id))} · ${nextOpen?'open':'closed'} · same feature identity.`);
  }
  function focus(){
    const object=currentObject(),mobile=innerWidth<700,position=new THREE.Vector3(...(spatial.getObjectPosition?.(object.id)?.toArray?.()??object.position)),node=spatial.nodes.get(object.id);
    // Camera distance follows the actual body volume and focus scale. A user
    // can intentionally enlarge an object, but a large cylinder no longer
    // turns into an accidental full-screen tube when selected.
    const projection={...realityObjectSurfaceEngine.readingProjection({shape:object.shape??'rectangle',viewportWidth:innerWidth,viewportHeight:innerHeight}),stretch:[1,1,1]};
    if(node)node.surfaceStretch=[1,1,1];
    root.dataset.readingProjection=projection.mode;
    const frame=realityObjectSurfaceEngine.readingFrame({
      shape:object.shape??'rectangle',size:object.size??1,
      approachScale:(node?.scale??1)*realityLensEngine.profile.focus.maxScale,
      viewportWidth:innerWidth,viewportHeight:innerHeight,fov:camera.fov,
      stretch:projection.stretch,safeTop:projection.safeTop,safeBottom:projection.safeBottom,safeSide:projection.safeSide,maxDistance:Math.max(12,Math.min(190,(controls.maxDistance??220)-4)),
    });
    const outward=camera.position.clone().sub(controls.target);if(outward.length()<1)outward.set(54,36,164);outward.normalize().multiplyScalar(frame.distance);
    const opticalOffset=camera.up.clone().multiplyScalar(-frame.targetYOffset);
    focusTarget=position.clone().add(opticalOffset);focusPosition=position.clone().add(outward).add(opticalOffset);spatial.focus(object.id);onFrame?.();
  }
  function overview(){
    clearFeatureSurface();
    setDirectory(false);setViewTools(false);selectedSurface.hidden=true;root.classList.add('assembly-clean');root.classList.remove('assembly-object-focused');find('[data-clean]').textContent='Details';
    activeLensGroup=null;
    spatial.setSpaceView?.(null);updateSpaceContext(null);
    spatial.setActiveGroup(null);
    focusTarget=new THREE.Vector3(...CLEAN_LANDING_CAMERA.target);
    focusPosition=new THREE.Vector3(...CLEAN_LANDING_CAMERA.position);
    spatial.focus(null);
    frameSpace(null);
    onFrame?.();
  }
  find('[data-space-back]').onclick=()=>{const groupId=activeLensGroup,wasFeature=root.dataset.spaceView==='feature';if(wasFeature&&groupId&&groupId!=='*')exploreGroup(groupId);else{onNavigate?.('reality-lens');overview();}};
  allObjects.onclick=()=>{clearFeatureSurface();activeLensGroup='*';spatial.setSpaceView?.('*');spatial.setActiveGroup('*');spatial.focus(null);setViewTools(false);updateSpaceContext('*');focusTarget=new THREE.Vector3(...CLEAN_LANDING_CAMERA.target);focusPosition=new THREE.Vector3(...CLEAN_LANDING_CAMERA.position);onFrame?.();render();};
  const reframeSpace=()=>{if(!active)return;if(root.dataset.spaceView==='feature')focus();else if(activeLensGroup!=='*')frameSpace(activeLensGroup);};window.addEventListener('resize',reframeSpace);
  const spaceChromeObserver=new ResizeObserver(()=>{
    if(!active||activeLensGroup==='*'||root.dataset.spaceView==='feature')return;
    const next=measureSpaceInsets();
    // Hover copy can change only the hint's width. That must not recenter an
    // intentionally orbited camera when the reserved vertical space is equal.
    if(!framedSpaceInsets||Math.abs(next.topInset-framedSpaceInsets.topInset)>1||Math.abs(next.bottomInset-framedSpaceInsets.bottomInset)>1)frameSpace(activeLensGroup);
  });
  spaceChromeObserver.observe(contextBar);spaceChromeObserver.observe(find('.assembly-selection-hint'));
  function setMode(mode){viewMode=mode;all('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===mode)));render();}
  function setInteraction(next){interaction=next;all('[data-interaction]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.interaction===next));button.textContent=next==='move'?'Finish arranging':'Arrange';});say(next==='move'?'Drag an object. Hold Shift to move through depth.':'Drag the field to orbit. Scroll to travel.');}
  function moveBy(axis,steps){
    const object=currentObject();if(object.anchor||object.locked)throw Error(object.anchor?'This object is fixed in place.':'Unlock this object first.');
    const axisIndex={x:0,y:1,z:2}[axis],next=[...object.position];next[axisIndex]=Math.max(-60,Math.min(60,next[axisIndex]+steps));
    owner.move(object.id,next);syncActiveReality();render();
  }
  const enter=(id=owner.getSnapshot().selectedId)=>onNavigate?.(id);
  function activateObjectTab(id){
    select(id);
    const state=owner.getSnapshot(),object=state.objects.find(item=>item.id===id);
    if(object&&!object.open&&state.mode==='present'){
      owner.setOpen(id,true);syncActiveReality();render();
    }
    enter(id);
  }
  const spatialGroupLabels=new Map();
  function placeNativeTarget(label,object,contour){
    if(!contour?.length&&object.geometry){
      object.geometry.computeBoundingBox();const {min,max}=object.geometry.boundingBox;
      contour=[[min.x,min.y,max.z],[max.x,min.y,max.z],[max.x,max.y,max.z],[min.x,max.y,max.z]];
    }
    if(!contour?.length){label.hidden=true;return;}
    const points=contour.map(point=>object.localToWorld(new THREE.Vector3(...point)).project(camera).toArray());
    const region=realityObjectSurfaceEngine.hitRegion({points,viewportWidth:innerWidth,viewportHeight:innerHeight});
    label.hidden=!region.visible;if(!region.visible)return;
    label.dataset.nativeTarget='true';label.style.left=`${region.left+region.width/2}px`;label.style.top=`${region.top+region.height/2}px`;
    label.style.width=`${region.width}px`;label.style.height=`${region.height}px`;label.style.clipPath=region.clipPath;
    // DOM labels supply keyboard focus. Physical taps always use mesh picking,
    // including home-space torus holes and triangular silhouettes.
    label.style.pointerEvents=interaction==='move'||object.userData?.objectTabOwner||object.userData?.realityLensGroup?'none':'';
  }
  for(const domain of REALITY_LENS_GROUPS){
    const members=groupMembers.get(domain.id)??[];if(!members.length)continue;
    const label=document.createElement('button');label.type='button';label.className='assembly-group-label';label.textContent=`${lensSpaceLabel(domain.id)} · ${members.length}`;label.setAttribute('aria-label',`Explore ${lensSpaceLabel(domain.id)} · ${members.length} features`);
    label.onclick=()=>exploreGroup(domain.id);
    find('.assembly-labels').append(label);spatialGroupLabels.set(domain.id,label);
  }
  for(const feature of ordered){
    const groupId=resolveRealityLensGroup(feature.id),domain=catalogSections.get(groupId);
    const visibleLabel=labelFor(feature),button=document.createElement('button');button.type='button';button.textContent=visibleLabel;button.onclick=guard(()=>{select(feature.id);if(interaction!=='move')enter(feature.id);if(root.classList.contains('assembly-directory-open'))setDirectory(false,{restoreFocus:true});});(domain?.children??find('.assembly-catalog')).append(button);catalog.set(feature.id,button);
    const label=document.createElement('button');label.type='button';label.className='assembly-node-label';label.textContent=visibleLabel;label.dataset.group=groupId;label.setAttribute('aria-label',`Open ${visibleLabel}`);label.onclick=guard(()=>{select(feature.id);if(interaction!=='move')enter(feature.id);});label.onpointerenter=()=>{hovered=feature.id;render();};label.onpointerleave=()=>{hovered=null;render();};find('.assembly-labels').append(label);labels.set(feature.id,label);
  }
  const catalogSearch=find('[data-search]'),quickSearch=find('[data-quick-search]');
  const applySearch=queryValue=>{
    const query=String(queryValue??'').toLowerCase().trim();
    if(catalogSearch.value!==queryValue)catalogSearch.value=queryValue;
    if(quickSearch.value!==queryValue)quickSearch.value=queryValue;
    for(const [id,button] of catalog){
      const groupId=resolveRealityLensGroup(id),record=catalogSections.get(groupId),featureMatch=`${featureMap.get(id).label} ${labelFor(featureMap.get(id))} ${id}`.toLowerCase().includes(query),groupMatch=Boolean(query&&record?.label.toLowerCase().includes(query));
      button.hidden=Boolean(query&&!featureMatch&&!groupMatch);
      if(query&&groupMatch&&record)record.children.hidden=false;
    }
    for(const [groupId,record] of catalogSections){
      const anyVisible=[...catalog].some(([id,button])=>resolveRealityLensGroup(id)===groupId&&!button.hidden);
      record.section.hidden=Boolean(query&&!anyVisible);
      if(query&&anyVisible){record.children.hidden=false;record.header.setAttribute('aria-expanded','true');}
      else if(!query){record.children.hidden=!record.open;record.header.setAttribute('aria-expanded',String(record.open));}
    }
    emptySearch.hidden=[...catalog.values()].some(button=>!button.hidden);
  };
  const selectSearchResult=()=>{
    if(!quickSearch.value.trim()){setDirectory(true);catalogSearch.focus();return false;}
    const first=[...catalog].find(([,button])=>!button.hidden)?.[0];
    if(!first){say('No matching features. Try another name.');return false;}
    select(first);setDirectory(false);enter(first);return true;
  };
  catalogSearch.oninput=event=>applySearch(event.target.value);
  quickSearch.onfocus=()=>setDirectory(true,{focusSearch:false});
  quickSearch.oninput=event=>{setDirectory(true,{focusSearch:false});applySearch(event.target.value);};
  find('[data-quick-find]').onsubmit=event=>{event.preventDefault();selectSearchResult();};
  all('[data-home]').forEach(button=>button.onclick=()=>{enter('reality-lens');overview();});find('[data-focus]').onclick=focus;
  all('[data-open],[data-open-secondary]').forEach(button=>button.onclick=guard(toggle));
  find('[data-tab-shape]').onchange=guard(event=>{const object=currentObject();owner.configure(object.id,{shape:event.target.value});syncActiveReality();render();if(mountedSurface)focus();say('Tab reshaped. Its identity and feature connection stayed the same.');});
  find('[data-lock-toggle]').onclick=guard(()=>{const object=currentObject();owner.setLocked(object.id,!object.locked);syncActiveReality();render();say(object.locked?'Object unlocked. You can move it.':'Object locked. Shape and position stay fixed.');});
  find('[data-side-reality]').onclick=guard(()=>{const id=owner.getSnapshot().selectedId,current=workspace.getCurrentNode();if(current.kind==='side'&&current.state?.featureId===id)returnToParentReality();else enterSideReality(id);});
  find('[data-enter]').onclick=()=>enter();
  find('[data-enter-person]').onclick=()=>onNavigate?.('person');find('[data-enter-contracts]').onclick=()=>onNavigate?.('contracts');find('[data-grid]').onclick=()=>onNavigate?.('block-world');
  all('[data-view]').forEach(button=>button.onclick=()=>setMode(button.dataset.view));all('[data-interaction]').forEach(button=>button.onclick=()=>setInteraction(interaction==='move'?'orbit':'move'));
  find('[data-present]').onclick=()=>{owner.goTo('present');render();say('Returned to the unchanged present layout.');};
  find('[data-time]').oninput=guard(event=>{const index=Number(event.target.value),frame=owner.getSnapshot().frames[index];setMode('4d');owner.goTo(frame.revision);render();say('Inspecting recorded local history. Editing is disabled here.');});
  find('[data-branch-form]').onsubmit=guard(event=>{event.preventDefault();owner.propose(find('#assembly-branch-name').value);find('#assembly-branch-name').value='';render();say('Proposed branch created from the inspected frame. The present remains unchanged.');});
  find('[data-branch-select]').onchange=guard(event=>{if(event.target.value==='present')owner.goTo('present');else owner.viewBranch(event.target.value);render();});
  find('[data-export]').onclick=()=>{const url=URL.createObjectURL(new Blob([owner.exportHistory()],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download='matumbo-local-layout-history.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);say('Exported local layout history; no account, market or wallet state is included.');};
  function showObjectDetails(visible){
    if(!mountedSurface?.tools){selectedSurface.hidden=true;return false;}
    selectedSurface.hidden=false;mountedSurface.tools.open=Boolean(visible);
    find('[data-clean]').textContent=visible?'Close details':'Details';
    if(visible){render();mountedSurface.tools.scrollIntoView({block:'nearest'});}
    return true;
  }
  find('[data-clean]').onclick=()=>{const visible=!mountedSurface?.tools?.open;setDirectory(false);setViewTools(false);showObjectDetails(visible);};
  const inspectorBody=find('.assembly-inspector-body');inspectorBody.id='assembly-inspector-content';
  const inspectorToggle=find('[data-fold-inspector]');inspectorToggle.setAttribute('aria-controls',inspectorBody.id);inspectorToggle.setAttribute('aria-expanded','true');
  const compactSelection=document.createElement('span');compactSelection.className='assembly-compact-selection';compactSelection.hidden=true;find('.assembly-inspector header').append(compactSelection);
  function foldInspector(folded){inspectorFolded=folded;inspectorBody.hidden=folded;root.classList.toggle('assembly-inspector-folded',folded);inspectorToggle.textContent=folded?'+':'−';inspectorToggle.setAttribute('aria-expanded',String(!folded));inspectorToggle.setAttribute('aria-label',folded?'Expand inspector':'Minimize inspector');compactSelection.hidden=!folded;compactSelection.textContent=featureMap.get(owner.getSnapshot().selectedId).label;}
  inspectorToggle.onclick=()=>foldInspector(!inspectorFolded);
  const locate=event=>{const rect=renderer.domElement.getBoundingClientRect();point.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(point,camera);return ray.intersectObjects([...targets,...(spatial.groupTargets??[])],false).find(hit=>{const group=spatial.resolveGroup?.(hit.object);if(group)return spatial.groupParents.get(group)?.root.visible&&hit.object.visible;const id=spatial.resolve(hit.object);return id&&spatial.nodes.get(id)?.root.visible&&hit.object.visible;})??null;};
  const resizeOnScroll=guard(event=>{
    if(!active||event.ctrlKey||event.target?.closest?.('.assembly-inspector,[data-orbit-dial]'))return;
    if(interaction!=='move'&&mountedSurface?.controller?.wheel(event))return;
    const overFeatureSurface=event.target?.closest?.('.reality-lens-feature-panel[data-lens-surface-attached=true],.assembly-wrap-face');
    if(overFeatureSurface&&!event.shiftKey)return;
    const hit=locate(event),id=spatial.resolve(hit?.object),object=id&&owner.getSnapshot().objects.find(item=>item.id===id);
    if(!object?.id||object.anchor||object.locked||owner.getSnapshot().mode==='past')return;
    const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1);
    if(!Number.isFinite(delta)||Math.abs(delta)<1)return;
    const next=Math.max(REALITY_TAB_SIZE_MIN,Math.min(REALITY_TAB_SIZE_MAX,object.size*Math.exp(-delta*.0012)));
    if(Math.abs(next-object.size)<.005)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    owner.configure(id,{size:next});syncActiveReality();render();
    say(`${labelFor(featureMap.get(id))} · ${next.toFixed(1)}× · size updated.`);
  });
  const down=guard(event=>{
    if(!active||event.button!==0)return;
    if(interaction!=='move'&&mountedSurface?.controller?.down(event))return;
    const hit=locate(event),id=spatial.resolve(hit?.object);pointer={id:event.pointerId,x:event.clientX,y:event.clientY,objectId:id,groupId:spatial.resolveGroup?.(hit?.object),move:false};
    if(interaction==='move'&&id&&owner.getSnapshot().mode!=='past'){
      select(id,{approach:false});const object=currentObject();
      if(object.anchor||object.locked){say(object.anchor?'This object is fixed in place.':'Unlock this object before moving it.');return;}
      camera.getWorldDirection(dragNormal);dragPlane.setFromNormalAndCoplanarPoint(dragNormal,new THREE.Vector3(...object.position));
      if(ray.ray.intersectPlane(dragPlane,dragPoint)){pointer.move=true;pointer.origin=object.position;pointer.hit=dragPoint.clone();pointer.next=object.position;pointer.startY=event.clientY;pointer.cameraForward=dragNormal.clone();controls.enabled=false;renderer.domElement.setPointerCapture(event.pointerId);event.stopImmediatePropagation();event.preventDefault();}
    }
  });
  const downOnObjectSurface=guard(event=>{
    if(interaction!=='move'||event.button!==0||!event.target?.closest?.('.reality-lens-feature-panel[data-lens-surface-attached=true],.assembly-wrap-face'))return;
    if(event.target?.closest?.('button,a,input,textarea,select,summary,iframe,[contenteditable="true"]'))return;
    down(event);
  });
  cssSurfaceHost.addEventListener('pointerdown',downOnObjectSurface,true);
  const move=guard(event=>{
    if(!active)return;if(mountedSurface?.controller?.move(event))return;const hit=locate(event);
    if(pointer?.move&&pointer.id===event.pointerId){
      if(ray.ray.intersectPlane(dragPlane,dragPoint)){
        const delta=dragPoint.clone().sub(pointer.hit),proposed=new THREE.Vector3(...pointer.origin).add(delta);
        if(event.shiftKey)proposed.addScaledVector(pointer.cameraForward,-(event.clientY-pointer.startY)*.055);
        const next=[proposed.x,proposed.y,proposed.z].map(value=>Math.max(-60,Math.min(60,value)));
        const state=owner.getSnapshot(),safePosition=resolveRealityTabPosition(pointer.objectId,next,state.objects);pointer.next=safePosition;
        spatial.apply({...state,objects:state.objects.map(object=>object.id===pointer.objectId?{...object,position:safePosition}:object)},{viewMode,hoveredId:pointer.objectId});
      }return;
    }
    const id=spatial.resolve(hit?.object);if(id!==hovered){hovered=id;render();find('[data-hover-label]').textContent=id?`${labelFor(featureMap.get(id))} · tap to open`:'Drag the field to orbit · tap an object to open';}
  });
  const release=guard(event=>{
    if(active&&mountedSurface?.controller?.up(event))return;
    if(!active||!pointer||event.pointerId!==pointer.id)return;const previous=pointer;pointer=null;controls.enabled=true;
    if(previous.move){if(event.type==='pointerup'){owner.move(previous.objectId,previous.next);syncActiveReality();}render();say(event.type==='pointerup'?'Layout move recorded. Use 4D to inspect it through time.':'Move cancelled.');return;}
    if(event.type==='pointerup'&&previous.groupId&&Math.hypot(event.clientX-previous.x,event.clientY-previous.y)<7){exploreGroup(previous.groupId);return;}
    if(event.type==='pointerup'&&previous.objectId&&Math.hypot(event.clientX-previous.x,event.clientY-previous.y)<7){if(interaction!=='move')activateObjectTab(previous.objectId);else select(previous.objectId,{approach:false});}
  });
  const keys=guard(event=>{
    if(active&&mountedSurface?.controller?.key(event))return;
    if(active&&event.key==='Escape'&&!toolbar.hidden){setViewTools(false,{restoreFocus:true});event.preventDefault();return;}
    if(event.target?.closest?.('[data-orbit-dial]'))return;
    if(active&&event.key.toLowerCase()==='f'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.repeat&&!/input|textarea|select/i.test(event.target?.tagName)&&!event.target?.isContentEditable){setDirectory(directory.hidden,{restoreFocus:true});event.preventDefault();return;}
    if(active&&event.key==='Escape'&&root.classList.contains('assembly-directory-open')){setDirectory(false,{restoreFocus:true});event.preventDefault();return;}
    if(!active||/input|textarea|select/i.test(event.target?.tagName))return;
    if(event.target?.closest?.('button,a,summary,[contenteditable="true"]')&&event.key==='Enter')return;
    if(event.key==='Escape'){if(root.dataset.spaceView==='feature')find('[data-space-back]').click();else{onNavigate?.('reality-lens');overview();}return;}
    if(event.key==='Enter'){enter();event.preventDefault();return;}
    if(interaction!=='move')return;
    const nudges={ArrowLeft:['x',-.5],ArrowRight:['x',.5],ArrowUp:['y',.5],ArrowDown:['y',-.5],PageUp:['z',.5],PageDown:['z',-.5]},nudge=nudges[event.key];
    if(nudge){moveBy(...nudge);event.preventDefault();}
  });
  const canvas=renderer.domElement;canvas.addEventListener('pointerdown',down,true);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);canvas.addEventListener('wheel',resizeOnScroll,{capture:true,passive:false});root.addEventListener('wheel',resizeOnScroll,{capture:true,passive:false});document.addEventListener('keydown',keys);
  let activeLensMode=false;
  function open({lensMode=false,featureId=null}={}){
    if(active)return;active=true;saved={position:camera.position.clone(),target:controls.target.clone(),fov:camera.fov,min:controls.minDistance,max:controls.maxDistance,worldVisible:world.visible,fog:scene.fog,environment:scene.environment,background:scene.background};
    root.hidden=false;onActiveChange(true);
    // Panels start CLOSED: the default view is a clean spatial universe.
    // The user materializes the directory / inspector with the header
    // toggles ("Objectum", "Invenire", inspector fold); nothing
    // auto-opens large over the 3D view.
    root.classList.add('assembly-clean');find('[data-clean]').textContent='Details';selectedSurface.hidden=true;setDirectory(false);setViewTools(false);
    activeLensMode=Boolean(lensMode);spatial.setLensMode(activeLensMode);spatial.layer.visible=true;world.visible=false;scene.fog=activeLensMode?null:new THREE.FogExp2('#030911',.009);scene.background=spatial.backdrop;document.body.classList.add('assembly-mode');
    scene.environment=environmentTexture;
    camera.fov=CLEAN_LANDING_CAMERA.fov;camera.updateProjectionMatrix();controls.minDistance=.45;controls.maxDistance=220;
    if(featureId&&featureId!=='reality-lens'&&featureMap.has(featureId))select(featureId);else overview();
    camera.position.copy(focusPosition);controls.target.copy(focusTarget);focusPosition=null;focusTarget=null;controls.update();render();
  }
  function close(){
    if(!active)return;setDirectory(false);setViewTools(false);active=false;onActiveChange(false);pointer=null;controls.enabled=true;root.hidden=true;spatial.layer.visible=false;document.body.classList.remove('assembly-mode');
    clearFeatureSurface();
    spatial.setLensMode(false);activeLensMode=false;
    if(saved){camera.position.copy(saved.position);controls.target.copy(saved.target);camera.fov=saved.fov;camera.updateProjectionMatrix();controls.minDistance=saved.min;controls.maxDistance=saved.max;world.visible=saved.worldVisible;scene.fog=saved.fog;scene.environment=saved.environment;scene.background=saved.background;saved=null;}
  }
  render();
  const selectionObserver=new MutationObserver(()=>{compactSelection.textContent=objectTitle.textContent;});selectionObserver.observe(objectTitle,{childList:true});
  return {open,close,openSpace:exploreGroup,overview,closePanels(){setDirectory(false);setViewTools(false);showObjectDetails(false);root.classList.add('assembly-clean');},get active(){return active;},getSnapshot:snapshot,resolve:spatial.resolve,focusFeature(id){if(!featureMap.has(id))return false;if(!active)open({lensMode:true,featureId:id});else select(id);return true;},mountFeatureSurface,clearFeatureSurface,setInspectorVisible:showObjectDetails,
    applyCreatorDesign(input){
      const descriptor=input===null?null:normalizeDesignDescriptor(input);
      if(owner.getSnapshot().mode!=='present')throw Error('Return to the present before applying a design');
      const state=owner.getSnapshot(),unknown=(descriptor?.objects??[]).filter(item=>!featureMap.has(item.id));
      const shapeFor=new Map((descriptor?.objects??[]).filter(item=>featureMap.has(item.id)).map(item=>[item.id,item.shape]));
      if(descriptor?.surface){const ids=descriptor.surface.scope==='all'?state.objects.map(item=>item.id):[state.selectedId];for(const id of ids)shapeFor.set(id,descriptor.surface.shape);}
      // Validate all targets before changing any geometry; locked objects retain their authored form.
      for(const object of state.objects)if(!object.locked&&!object.anchor){
        const requested=shapeFor.get(object.id),previous=creatorAppliedShapes.get(object.id);
        if(requested){
          if(!previous||object.shape!==previous)creatorBaseShapes.set(object.id,object.shape);
          if(requested!==object.shape)owner.configure(object.id,{shape:requested});
          creatorAppliedShapes.set(object.id,requested);
        }else if(previous){
          const original=creatorBaseShapes.get(object.id);
          if(object.shape===previous&&original&&original!==object.shape)owner.configure(object.id,{shape:original});
          creatorAppliedShapes.delete(object.id);creatorBaseShapes.delete(object.id);
        }
      }
      creatorDesign=descriptor;creatorBackground=descriptor?new THREE.Color(descriptor.palette.background):null;spatial.setCreatorAppearance(descriptor);
      root.dataset.creatorNavigation=descriptor?.navigation??'guided';root.dataset.creatorDensity=descriptor?.density??'comfortable';
      root.style.setProperty('--creator-accent',descriptor?.palette.accent??'#39b9ff');root.style.setProperty('--creator-background',descriptor?.palette.background??'#07111f');
      document.body.classList.toggle('ourplace-designed',Boolean(descriptor));
      document.body.style.setProperty('--ourplace-accent',descriptor?.palette.accent??'#39b9ff');
      syncActiveReality();render();reframeSpace();
      if(active)scene.background=creatorBackground??spatial.backdrop;
      return {applied:true,descriptor,uninstalledObjects:unknown.map(item=>item.id),stepsRequireExplicitInteraction:true,simulation:true};
    },
    getCreatorDesign(){return creatorDesign;},
    getSpaceObject(id){return spatial.groupParents.get(id)?.entry??null;},
    getSurfaceController(){return mountedSurface?.controller??null;},

    getFeatureObject(id){const node=spatial.nodes.get(id);return node?{root:node.root,feature:featureMap.get(id),get shape(){return node.shape;}}:null;},
    getPanelAnchor(featureId){
      const node=spatial.nodes.get(featureId),object=owner.getSnapshot().objects.find(item=>item.id===featureId);if(!node||!object)return null;
      const distance=Math.max(.45,camera.position.distanceTo(node.root.position));
      const fitted=realityObjectSurfaceEngine.fitPanel({shape:object.shape??'rectangle',size:object.size??1,approachScale:(node.root.scale.x||1)/Math.max(.01,object.size??1),distance,viewportWidth:innerWidth,viewportHeight:innerHeight,fov:camera.fov,safeWidth:36,safeHeight:190,inset:0});
      screenPoint.copy(node.root.position);screenPoint.project(camera);
      if(screenPoint.z<=-1||screenPoint.z>=1||Math.abs(screenPoint.x)>1.2||Math.abs(screenPoint.y)>1.2)return null;
      const {width,height}=fitted;
      const centerX=(screenPoint.x*.5+.5)*innerWidth,centerY=(-.5*screenPoint.y+.5)*innerHeight;
      // centered-surfaces adds 24px to anchorX; offset it so the real feature
      // panel settles over the selected object instead of beside the object.
      return {anchorX:centerX-width/2-24,anchorY:centerY,width,height,shape:object.shape??'rectangle',aspectRatio:fitted.aspectRatio};
    },
    selectObject(object){const id=spatial.resolve(object);if(!id)return false;activateObjectTab(id);return true;},
    update(dt,time){
      if(!active)return;
      if(focusTarget&&!renderer.xr.isPresenting){const blend=reducedMotion?1:1-Math.exp(-dt*6);controls.target.lerp(focusTarget,blend);camera.position.lerp(focusPosition,blend);if(camera.position.distanceTo(focusPosition)<.02){focusTarget=null;focusPosition=null;}}
      const cameraDistance=camera.position.distanceTo(controls.target);
      const creatorReduced=reducedMotion||Boolean(creatorDesign&&creatorDesign.motion!=='full');
      if(creatorBackground)scene.background=creatorBackground;
      spatial.update(dt,creatorDesign?.motion==='off'?0:time,{reducedMotion:creatorReduced,cameraDistance,cameraPosition:camera.position});spatial.layer.updateMatrixWorld(true);camera.updateMatrixWorld();
      cssSurfaceHost.hidden=Boolean(renderer.xr?.isPresenting);
      if(mountedSurface&&!cssSurfaceHost.hidden){materializeSurfaceObjects(mountedSurface);sizeAndPlaceSurface(mountedSurface);css3dRenderer?.render(scene,camera);}
      if(root.dataset.spaceView==='feature')onPanelFrame(owner.getSnapshot().selectedId);
      if(!toolbar.hidden)orbitNavigation.update();
      const overlaps=(a,b)=>a.left<b.right+4&&a.right>b.left-4&&a.top<b.bottom+4&&a.bottom>b.top-4;
      const occupied=[...all('.assembly-header,.assembly-directory,.assembly-inspector,.assembly-toolbar,.assembly-branches,.assembly-space-context,.assembly-selection-hint,.assembly-world-label,.assembly-status'),...document.querySelectorAll('body.assembly-mode #immersive-toolbar')].filter(element=>!element.hidden&&getComputedStyle(element).display!=='none'&&getComputedStyle(element).visibility!=='hidden').map(element=>element.getBoundingClientRect());
    const selectedId=owner.getSnapshot().selectedId;
      if(performance.now()<resizeFocusUntil&&document.activeElement===document.body&&lastAssemblyFocus?.classList.contains('assembly-node-label')){lastAssemblyFocus.hidden=false;lastAssemblyFocus.focus({preventScroll:true});}
      // A moving projection must not hide the DOM control holding keyboard focus.
      // Pin its current screen position until blur; other labels yield to it.
      const calmView=spatial.getSnapshot().calmMode;
      const focusedLabel=calmView?null:[...labels.values()].find(label=>label===document.activeElement&&!label.hidden);
      if(focusedLabel){
        let bounds=focusedLabel.getBoundingClientRect();
        if(bounds.left<8||bounds.right>innerWidth-8||bounds.top<8||bounds.bottom>innerHeight-8||occupied.some(rect=>overlaps(bounds,rect))){
          const w=bounds.width,h=bounds.height;
          let placement=null;
          for(let y=8;y+h<=innerHeight-8&&!placement;y+=h+8)for(let x=8;x+w<=innerWidth-8;x+=w+8){const candidate={left:x,top:y,right:x+w,bottom:y+h};if(!occupied.some(rect=>overlaps(candidate,rect))){placement=candidate;break;}}
          if(placement){focusedLabel.style.left=`${placement.left+w/2}px`;focusedLabel.style.top=`${placement.top+h/2}px`;bounds=focusedLabel.getBoundingClientRect();}
          else if(innerWidth<700){directoryToggle.focus({preventScroll:true});say('No free label space. Use Find a world to inspect the selected object.');focusedLabel.hidden=true;}
        }
        occupied.push(bounds);
      }
      const spatialState=spatial.getSnapshot(),lod=spatialState.lod,worldLabel=find('[data-world-label]');
      worldLabel.hidden=lod!=='nucleus';
      if(lod==='nucleus'){for(const [,label] of labels)label.hidden=true;for(const [,label] of spatialGroupLabels)label.hidden=true;}
      else{
      // Selected and hovered labels get first choice of screen-space slots.
      const {safeTop,safeBottom}=computeLabelSafeBand(occupied,innerHeight);
      const orderedLabels=[...labels].sort(([a],[b])=>(a===selectedId?-2:a===hovered?-1:0)-(b===selectedId?-2:b===hovered?-1:0)),acceptedLabelBounds=[];
      for(const [id,label] of orderedLabels){
        if(label===focusedLabel)continue;
        // Labels are quiet navigation affordances, not captions floating in
        // front of a living object. The object surface owns its name in focus.
        if(spatialState.focusIsolated){label.hidden=true;continue;}
        const node=spatial.nodes.get(id);if(!node){label.hidden=true;continue;}
        if(!shouldShowRealityObjectLabel({node,activeGroupId:activeLensGroup,focusIsolated:spatialState.focusIsolated,selectedId,objectId:id})){label.hidden=true;continue;}
        if(spatialState.calmMode){placeNativeTarget(label,node.root,node.surfaceOutline??node.surfaceBinding?.contour);continue;}
        delete label.dataset.nativeTarget;label.style.removeProperty('width');label.style.removeProperty('height');label.style.removeProperty('clip-path');label.style.removeProperty('pointer-events');
        labelRight.setFromMatrixColumn(camera.matrixWorld,0).normalize();
        const form=REALITY_TAB_FORMS[node.shape],side=node.revealOrder%2===0?1:-1;
        const labelPosition=spatialState.calmMode?node.root.position.toArray():assemblySideLabelPoint({position:node.root.position.toArray(),cameraRight:labelRight.toArray(),halfWidth:node.isTab?((form?.width??1.2)*(node.root.scale.x||node.size||1))/2:Math.max(.7,node.scale*.55),side,gap:node.isTab?.58:.46});
        screenPoint.set(...labelPosition).project(camera);
        label.hidden=false;
        const measured=label.getBoundingClientRect();
        const placement=placeAssemblyLabel({ndcX:screenPoint.x,ndcY:screenPoint.y,ndcZ:screenPoint.z,viewportWidth:innerWidth,viewportHeight:innerHeight,safeTop,safeBottom,labelWidth:measured.width,labelHeight:measured.height,occupied:[...occupied,...acceptedLabelBounds]});
        if(!placement.visible){label.hidden=true;continue;}
        label.style.left=`${placement.x}px`;label.style.top=`${placement.y}px`;
        const bounds=label.getBoundingClientRect();
        if(occupied.some(rect=>overlaps(bounds,rect))||acceptedLabelBounds.some(rect=>overlaps(bounds,rect))){label.hidden=true;continue;}
        acceptedLabelBounds.push(bounds);
        label.style.zIndex=id===selectedId?'3':id===hovered?'2':'1';
      }
      for(const [groupId,label] of spatialGroupLabels){
        if(spatialState.focusIsolated){label.hidden=true;continue;}
        const groupPosition=spatial.getGroupPosition(groupId),marker=spatial.groupParents.get(groupId);
        if(!groupPosition||!marker?.root.visible||activeLensGroup===groupId){label.hidden=true;continue;}
        if(spatialState.calmMode){placeNativeTarget(label,marker.entry,marker.entry.userData.nativeOutline);continue;}
        delete label.dataset.nativeTarget;label.style.removeProperty('width');label.style.removeProperty('height');label.style.removeProperty('clip-path');label.style.removeProperty('pointer-events');
        labelRight.setFromMatrixColumn(camera.matrixWorld,0).normalize();
        const groupIndex=REALITY_LENS_GROUPS.findIndex(group=>group.id===groupId),groupSide=groupIndex%2===0?-1:1;
        if(spatialState.calmMode)screenPoint.copy(groupPosition).project(camera);
        else screenPoint.set(...assemblySideLabelPoint({position:groupPosition.toArray(),cameraRight:labelRight.toArray(),halfWidth:2.7,side:groupSide,gap:.55})).project(camera);
        label.hidden=false;const measured=label.getBoundingClientRect();
        const placement=placeAssemblyLabel({ndcX:screenPoint.x,ndcY:screenPoint.y,ndcZ:screenPoint.z,viewportWidth:innerWidth,viewportHeight:innerHeight,safeTop,safeBottom,labelWidth:measured.width,labelHeight:measured.height,occupied:[...occupied,...acceptedLabelBounds]});
        if(!placement.visible){label.hidden=true;continue;}
        label.style.left=`${placement.x}px`;label.style.top=`${placement.y}px`;
        const bounds=label.getBoundingClientRect();
        if(occupied.some(rect=>overlaps(bounds,rect))||acceptedLabelBounds.some(rect=>overlaps(bounds,rect))){label.hidden=true;continue;}
        acceptedLabelBounds.push(bounds);label.style.zIndex='1';
      }
      }
    },
    destroy(){close();destroyed=true;orbitNavigation.destroy();clearFeatureSurface();window.removeEventListener('resize',resizeCss3d);window.removeEventListener('resize',resizeFocus);window.removeEventListener('resize',reframeSpace);selectionObserver.disconnect();toolbarSizeObserver.disconnect();spaceChromeObserver.disconnect();spatial.destroy();root.remove();stylesheet.remove();cssSurfaceHost.removeEventListener('pointerdown',downOnObjectSurface,true);canvas.removeEventListener('pointerdown',down,true);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',release);canvas.removeEventListener('pointercancel',release);canvas.removeEventListener('wheel',resizeOnScroll,true);root.removeEventListener('wheel',resizeOnScroll,true);document.removeEventListener('keydown',keys);}};
}
