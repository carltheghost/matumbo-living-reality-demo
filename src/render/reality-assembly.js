import {createRealityWorkspace} from '../domains/reality-workspace.js?v=20260923-spatial-tabs16';
import {REALITY_TAB_FORMS,REALITY_TAB_SIZE_MIN,REALITY_TAB_SIZE_MAX,resolveRealityTabPosition} from '../domains/reality-tab-layout.js?v=20260923-spatial-tabs16';
import {REALITY_LENS_GROUPS,realityLensEngine,resolveRealityLensGroup} from '../domains/reality-lens-engine.js?v=20260923-lens-engine9';
import {realityLensCopy,realityLensLabel,realityObjectSurfaceEngine} from '../domains/reality-object-engine.js?v=20260923-object-surface6';
import {buildRealityAssemblyScene,LOD_FAR} from './reality-assembly-scene.js?v=20260923-spatial-tabs21';

// The lens contains only equal-status feature tabs; no center cube or anchor.
export const CLEAN_LANDING_CAMERA={position:[36,25,110],target:[0,2,0],fov:60,mergeThreshold:LOD_FAR};

/** Reading orientation belongs to the whole entity rig, never a loose panel. */
export function turnLivingSurfaceTowardCamera(objectRoot,cameraPosition){
  if(!objectRoot?.isObject3D||!cameraPosition||![cameraPosition.x,cameraPosition.y,cameraPosition.z].every(Number.isFinite))throw Error('Reading orientation needs an object and finite camera position');
  objectRoot.lookAt(cameraPosition);objectRoot.updateMatrixWorld(true);
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

export function createRealityAssembly({THREE,renderer,scene,camera,controls,world,targets,features,relationships={},onNavigate,onFrame,onPanelFrame=()=>{},onActiveChange=()=>{},readFeature=()=>null,environmentTexture=null,reducedMotion=false}){
  // Initial density only; the optical composer sizes a reading skin from
  // its actual projection. Geometry owns the surface; text never gets scaled
  // down to fit an arbitrary desktop raster.
  const SURFACE_PIXELS_PER_UNIT=160;
  const latinShapes={phone:'Telephonum',square:'Quadratum',rectangle:'Rectangulum',sphere:'Sphaera',cylinder:'Cylindrus',cube:'Cubus',wave:'Unda'};
  const shapeOptions=Object.entries(REALITY_TAB_FORMS).map(([id])=>`<option value="${id}">${latinShapes[id]??id}</option>`).join('');
  const primary=['block-world','contracts','person','rooms','academy','world-events','multi-sport-events','asset-market'];
  const ordered=[...features].sort((a,b)=>{const aIndex=primary.indexOf(a.id),bIndex=primary.indexOf(b.id);return (aIndex<0?100:aIndex)-(bIndex<0?100:bIndex);});
  // Feature windows sit in six semantic clusters along a widening spatial
  // funnel. The former central cube is now an ordinary spherical feature tab.
  const defaultForms=['sphere','phone','rectangle','square','wave','cylinder'];
  const groupMembers=new Map();
  for(const feature of ordered){
    const groupId=resolveRealityLensGroup(feature.id),members=groupMembers.get(groupId)??[];
    members.push(feature);groupMembers.set(groupId,members);
  }
  const groupOffsets=new Map([...groupMembers].map(([groupId,members])=>[groupId,new Map(members.map((feature,index)=>[feature.id,index]))]));
  const labelFor=feature=>realityLensLabel(feature);
  const copyFor=value=>realityLensCopy(value);
  const visibleId=id=>id==='block-world'?'materia':String(id).replace(/(^|-)world(?=-|$)/gi,'$1locus');
  const placedPositions=ordered.map((feature,i)=>{
    const groupId=resolveRealityLensGroup(feature.id),members=groupMembers.get(groupId)??[feature],index=groupOffsets.get(groupId)?.get(feature.id)??0;
    const {position}=realityLensEngine.placeInFunnel({id:feature.id,index,count:members.length,groupId});
    return {
      id:feature.id,
      position,
      lensGroup:groupId,
      shape:defaultForms[i%defaultForms.length],size:1,
    };
  });
  // Start with the authored Lens sequence, then gently resolve only real
  // body collisions.  The solver moves sideways from the Lens axis, so the
  // near -> middle -> far order stays legible rather than becoming a pile.
  const initialLayout=realityLensEngine.relaxLayout(placedPositions);
  const positions=initialLayout.objects;
  const workspace=createRealityWorkspace({objects:positions,selectedId:ordered[0]?.id,rootLabel:'Una Realitas'});
  let owner=workspace.timeline;
  const sideRealityByFeature=new Map();
  const sideRealityKey=(parentId,featureId)=>`${parentId}\u0000${featureId}`;
  const initialShapes=new Map(positions.map(object=>[object.id,object.shape]));
  const spatial=buildRealityAssemblyScene({THREE,parent:scene,features:ordered.map((feature,i)=>({...feature,label:labelFor(feature),description:copyFor(feature.description),boundary:copyFor(feature.boundary),sources:(feature.sources??[]).map(copyFor),assemblyTier:'tab',lensGroup:positions[i]?.lensGroup??'worlds',initialTabShape:initialShapes.get(feature.id),initialPosition:positions[i]?.position})),targets,relationships});
  spatial.setActiveGroup(null);
  const featureMap=new Map(features.map(feature=>[feature.id,feature]));
  const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href=`${new URL('./reality-assembly.css',import.meta.url).href}?v=20260924-aspectus1`;document.head.append(stylesheet);
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
  const resizeCss3d=()=>{if(!css3dRenderer)return;css3dRenderer.setSize(innerWidth,innerHeight);if(active&&mountedSurface)focus();};
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
  const all=selector=>[...root.querySelectorAll(selector)],find=selector=>root.querySelector(selector);
  const directory=find('.assembly-directory');directory.id='assembly-feature-directory';
  const directoryToggle=document.createElement('button');directoryToggle.type='button';directoryToggle.dataset.directoryToggle='';directoryToggle.textContent='Invenire';directoryToggle.setAttribute('aria-label','Find an object');directoryToggle.setAttribute('aria-controls',directory.id);directoryToggle.setAttribute('aria-expanded','false');find('.assembly-header').append(directoryToggle);
  const directoryClose=document.createElement('button');directoryClose.type='button';directoryClose.dataset.directoryClose='';directoryClose.textContent='Claude';directory.prepend(directoryClose);
  const selectedSurface=find('.assembly-inspector');selectedSurface.hidden=true;
  find('.assembly-brand small').textContent='Homines · natura · possibilitas';
  find('.assembly-directory .assembly-eyebrow').textContent='Oculus Realitatis Ω';
  find('.assembly-directory h1').innerHTML='Plura loca.<br><em>Una realitas.</em>';
  find('.assembly-intro').innerHTML='Elige unum obiectum; appropinqua ut aperias.<br>Magnifica obiectum ad eius superficiem evolvendam.';
  find('.assembly-search-label').firstChild.textContent='Quaere obiectum ';
  find('[data-search]').placeholder='Quaere obiecta…';
  find('[data-quick-find] label span').textContent='Invenire';
  find('[data-quick-search]').placeholder='YouTube, agentia…';
  find('.assembly-catalog').setAttribute('aria-label','Reality Lens objecta');
  find('.assembly-directory .assembly-note').innerHTML='Tabulae locales · una identitas per obiectum.<br>Ingredere ut aperias verum instrumentum.';
  find('.assembly-header [data-home]').textContent='Explora';
  find('[data-enter-person]').textContent='Meum spatium';find('[data-enter-contracts]').textContent='Foedera';find('[data-grid]').textContent='Cubus';
  find('[data-enter-person]').setAttribute('aria-label','Meum spatium');find('[data-enter-contracts]').setAttribute('aria-label','Foedera');find('[data-grid]').textContent='Materia';find('[data-grid]').setAttribute('aria-label','Materia');
  find('[data-clean]').textContent='Objectum';find('[data-clean]').setAttribute('aria-label','Ostende vel cela superficiem electam');
  find('[data-world-label]').textContent='Unum punctum · scrolla vel preme ut accedas';
  find('[data-hover-label]').textContent='Spatium: iter · obiectum: magnitudo · clic: ingredere';
  find('.assembly-inspector .assembly-eyebrow').textContent='Oculus Realitatis · instrumentum apertum';
  find('.assembly-tab-controls h3').textContent='Mutabilitas';
  find('[data-anchor-note]').textContent='Instrumentum fixum.';
  find('[data-lock-toggle]').textContent='Fige';find('[data-focus]').textContent='Apropinqua';find('[data-side-reality]').textContent='Nova realitas';
  find('[data-enter]').textContent='Ingredere ↗';find('[data-open]').textContent='Aperi';find('[data-open-secondary]').textContent='Expand / Close';
  all('.assembly-inspector h3')[1].textContent='Fontes eiusdem instrumenti';
  find('.assembly-toolbar [data-home]').textContent='Home';find('.assembly-toolbar [data-view="4d"]').textContent='IV · tempus';find('.assembly-toolbar [data-view="3d"]').textContent='III';
  find('.assembly-toolbar .assembly-view .assembly-eyebrow').textContent='Aspectus';
  find('[data-present]').textContent='Present';find('[data-export]').textContent='Export';
  const readout=document.createElement('div');readout.className='assembly-size-readout';readout.innerHTML='<span>Magnitudo</span><strong data-size-readout>1.0×</strong><small>Scrolla super obiectum</small>';
  find('[data-tab-size]').closest('label').replaceWith(readout);find('.assembly-nudges').remove();
  find('.assembly-travel').remove();find('[data-interaction="orbit"]').remove();find('[data-interaction="move"]').textContent='Arrange';
  find('[data-edit-note]').textContent='Trahe ad disponendum; Shift-trahe per profunditatem. Scrolla obiectum ad augendum.';
  all('.assembly-inspector dt').forEach((term,index)=>{term.textContent=['Identitas','Positio · x / y / z','Status','Fontes'][index]??term.textContent;});
  const objectSymbol=find('.assembly-object-symbol'),objectTitle=find('[data-title]'),objectDescription=find('[data-description]'),objectHero=document.createElement('div'),objectCopy=document.createElement('div'),stageBadge=document.createElement('span');
  objectHero.className='assembly-object-hero';objectCopy.className='assembly-object-copy';stageBadge.className='assembly-stage-badge';stageBadge.dataset.stageBadge='';
  objectCopy.append(stageBadge,objectTitle,objectDescription);objectHero.append(objectSymbol,objectCopy);find('.assembly-inspector-body').prepend(objectHero);
  find('.assembly-inspector').setAttribute('aria-label','Superficies interactivum obiecti');
  find('[data-fold-inspector]').setAttribute('aria-label','Minue hanc superficiem');
  find('[data-tab-shape]').setAttribute('aria-label','Muta formam obiecti');
  find('[data-lock-toggle]').setAttribute('aria-label','Fige vel libera hoc obiectum');
  find('[data-enter]').setAttribute('aria-label','Ingredere in verum instrumentum');
  find('[data-directory-toggle]').setAttribute('aria-label','Invenire instrumentum');
  function setDirectory(open,{restoreFocus=false}={}){
    root.classList.toggle('assembly-directory-open',open);directoryToggle.setAttribute('aria-expanded',String(open));
     if(open){root.classList.remove('assembly-clean','assembly-object-focused');find('[data-search]').focus();}
    else if(restoreFocus)directoryToggle.focus();
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
    const title=document.createElement('span');title.textContent=domain.label;
    const count=document.createElement('small');count.textContent=String(members.length);
    header.append(title,count);
    const children=document.createElement('div');children.className='assembly-domain-features';children.hidden=true;
    section.append(header,children);find('.assembly-catalog').append(section);
    const record={section,header,children,label:domain.label,open:false};catalogSections.set(domain.id,record);
    header.onclick=()=>{
      record.open=!record.open;children.hidden=!record.open;header.setAttribute('aria-expanded',String(record.open));
      if(record.open){activeLensGroup=domain.id;spatial.setActiveGroup(domain.id);}
      else if(activeLensGroup===domain.id){activeLensGroup=null;spatial.setActiveGroup(null);}
      render();
    };
  }
  const ray=new THREE.Raycaster(),point=new THREE.Vector2(),screenPoint=new THREE.Vector3(),labelRight=new THREE.Vector3(),dragPlane=new THREE.Plane(),dragPoint=new THREE.Vector3(),dragNormal=new THREE.Vector3();
  const say=message=>{find('[data-status]').textContent=copyFor(message);};
  const guard=fn=>(...args)=>{try{return fn(...args);}catch(error){say(error.message);return null;}};
  const currentObject=()=>owner.getSnapshot().objects.find(object=>object.id===owner.getSnapshot().selectedId);
  function snapshot(){return {...owner.getSnapshot(),active,viewMode,interaction,camera:{position:camera.position.toArray(),target:controls.target.toArray()},spatial:spatial.getSnapshot(),layoutDiagnostics:initialLayout.diagnostics,reality:workspace.getSnapshot()};}
  function faceText(face,feature,surface,detail){
    if(face==='back')return {eyebrow:'CONTINUATIO · IDEM INSTRUMENTUM',title:surface.label,body:surface.description||surface.summary,detail:surface.boundary};
    if(face==='left')return {eyebrow:'STATUS · LOCALIS',title:surface.state,body:detail?.summary||'Status ex instrumento locali, non ex titulo decorativo.',detail:`Forma ${latinShapes[surface.shape]??surface.shape} · ${surface.size.toFixed(1)}×`};
    if(face==='right')return {eyebrow:'CONEXIONES · INSTRUMENTA',title:'Instrumenta propinqua',body:surface.summary,detail:(relationships[feature.id]??[]).slice(0,4).map(id=>featureMap.has(id)?labelFor(featureMap.get(id)):id).join(' · ')||'Nullae nexus locales adhuc definiti.'};
    if(face==='top')return {eyebrow:'IDENTITAS · SUPERFICIES',title:visibleId(feature.id),body:`${surface.label} · ${latinShapes[surface.shape]??surface.shape}`,detail:`${surface.sourceCount} fontes conexi`};
    return {eyebrow:'PROVENIENTIA · LIMES',title:`${surface.sourceCount} source references`,body:surface.sourceRefs.slice(0,3).join(' · ')||'No source references registered.',detail:surface.boundary};
  }
  function buildFaceElement(face,feature,surface,detail){
    const page=document.createElement('article');page.className='assembly-wrap-face';page.dataset.face=face;page.dataset.objectShape=surface.shape;
    const copy=faceText(face,feature,surface,detail),eyebrow=document.createElement('small'),title=document.createElement('h3'),body=document.createElement('p'),detailLine=document.createElement('p');
    eyebrow.textContent=copy.eyebrow;title.textContent=copy.title;body.textContent=copy.body;detailLine.className='assembly-wrap-detail';detailLine.textContent=copy.detail;
    page.append(eyebrow,title,body,detailLine);
    if(face==='right'){
      const related=(relationships[feature.id]??[]).filter(id=>featureMap.has(id)).slice(0,4),actions=document.createElement('div');actions.className='assembly-wrap-actions';
      related.forEach(id=>{const button=document.createElement('button');button.type='button';button.textContent=labelFor(featureMap.get(id));button.addEventListener('click',()=>onNavigate?.(id,'reality-assembly'));actions.append(button);});
      if(related.length)page.append(actions);
    }
    return page;
  }
  function makeFallbackFront(feature,object){
    const surface=realityObjectSurfaceEngine.describe({feature,object,stage:spatial.nodes.get(feature.id)?.revealStage??0,summary:readFeature(feature.id)?.summary});
    const page=document.createElement('article');page.className='assembly-wrap-face assembly-wrap-fallback';page.dataset.face='front';page.dataset.objectShape=surface.shape;
    const eyebrow=document.createElement('small'),title=document.createElement('h2'),body=document.createElement('p'),detail=document.createElement('p'),button=document.createElement('button');
    eyebrow.textContent='SUPERFICIES VIVA · REALITAS LENS';title.textContent=surface.label;body.textContent=surface.description||surface.summary;detail.textContent=surface.boundary;button.type='button';button.textContent='APERIRE HIC';button.addEventListener('click',()=>onNavigate?.(feature.id,'reality-assembly'));
    page.append(eyebrow,title,body,detail,button);return page;
  }
  function materializeSurfaceObjects(record){
    if(css3dFailed&&record){
      cssSurfaceHost.dataset.surfaceFallback='true';if(record.front.parentNode!==cssSurfaceHost)cssSurfaceHost.append(record.front);
      record.front.setAttribute('aria-label','Accessible reading mode: 3D surface renderer unavailable');
      return;
    }
    if(!CSS3DObject||!record||record.objects.length)return;
    const node=spatial.nodes.get(record.featureId);if(!node)return;
    node.surfaceReading=true;
    for(const surface of record.surfaces){
      const object3d=new CSS3DObject(surface.element);object3d.name=`Reality Lens live surface · ${record.featureId} · ${surface.id}`;
      object3d.scale.setScalar(1/SURFACE_PIXELS_PER_UNIT);node.root.add(object3d);surface.object3d=object3d;
    }
    record.objects=record.surfaces.map(surface=>surface.object3d);record.shape=null;
  }
  function sizeAndPlaceSurface(record){
    if(!record||!CSS3DObject)return;
    const node=spatial.nodes.get(record.featureId),feature=featureMap.get(record.featureId),data=owner.getSnapshot().objects.find(item=>item.id===record.featureId);
    if(!node||!feature||!data)return;
    const shape=data.shape??'rectangle',layout=realityObjectSurfaceEngine.wrapLayout(shape),detail=readFeature(record.featureId),stage=spatial.nodes.get(record.featureId)?.revealStage??0;
    const surface=realityObjectSurfaceEngine.describe({feature,object:data,stage,summary:detail?.summary,readOnly:owner.getSnapshot().mode==='past'});
    const cameraWorld=camera.getWorldPosition(new THREE.Vector3()),lensState=spatial.getSnapshot();
    // Turn the entire object, including its volume, seams and interaction
    // skin. A disconnected camera-facing panel would violate ownership.
    turnLivingSurfaceTowardCamera(node.root,cameraWorld);camera.updateMatrixWorld();
    const primary=layout[0],facePoint=node.root.localToWorld(new THREE.Vector3(...primary.position));
    const projection=realityObjectSurfaceEngine.readingProjection({shape,viewportWidth:innerWidth,viewportHeight:innerHeight});
    node.surfaceStretch=projection.stretch;
    root.dataset.readingProjection=projection.mode;
    record.intro?.setCompact(projection.mode!=='desktop');
    const composition=realityObjectSurfaceEngine.compose({shape,worldScale:node.root.scale.x,verticalScale:node.root.scale.y,distance:Math.max(.1,cameraWorld.distanceTo(facePoint)),viewportWidth:innerWidth,viewportHeight:innerHeight,fov:camera.fov});
    const densityChanged=!record.composition||Math.abs(composition.pixelsPerUnit-record.composition.pixelsPerUnit)/record.composition.pixelsPerUnit>.04||Math.abs(composition.pixelsPerUnitY-record.composition.pixelsPerUnitY)/record.composition.pixelsPerUnitY>.04;
    if(record.shape!==shape||densityChanged){
      record.shape=shape;
      record.composition=composition;
      record.surfaces.forEach(item=>{
        const face=layout.find(candidate=>candidate.id===item.id);if(!face)return;
        const density=composition.pixelsPerUnit;
        item.element.style.width=`${Math.round(face.width*density)}px`;item.element.style.height=`${Math.round(face.height*composition.pixelsPerUnitY)}px`;
        item.object3d?.scale.set(1/density,1/composition.pixelsPerUnitY,1/density);
        item.element.dataset.objectShape=shape;
        item.element.dataset.surfaceMode=composition.mode;
        item.element.style.setProperty('--lens-surface-clip',realityObjectSurfaceEngine.clipPath(shape));
        item.element.style.setProperty('--surface-inset',`${composition.inset}px`);
        if(item.id==='front'&&record.livePanel){
          record.livePanel.style.setProperty('--lens-surface-width',`${Math.round(face.width*density)}px`);
          record.livePanel.style.setProperty('--lens-surface-height',`${Math.round(face.height*composition.pixelsPerUnitY)}px`);
          record.livePanel.dataset.compact=String(composition.columns===1);
        }
      });
    }
    record.surfaces.forEach(item=>{
      const face=layout.find(candidate=>candidate.id===item.id),object3d=item.object3d;if(!face||!object3d)return;
      object3d.position.set(...face.position);object3d.rotation.set(...face.rotation);object3d.updateMatrixWorld(true);
      const faceWorld=object3d.getWorldPosition(new THREE.Vector3()),normal=new THREE.Vector3(0,0,1).applyQuaternion(object3d.getWorldQuaternion(new THREE.Quaternion())).normalize();
      const towardCamera=cameraWorld.clone().sub(faceWorld).normalize(),facesCamera=normal.dot(towardCamera)>.06;
      object3d.visible=realityObjectSurfaceEngine.shouldShowFace({faceId:item.id,facesCamera,focusIsolated:lensState.focusIsolated,focusedId:lensState.focusedId,featureId:record.featureId,stage:node.revealStage??0,objectVisible:node.root.visible});
      if(item.id!=='front'){
        item.element.style.opacity=String(.58+.42*Math.min(1,node.open??0));
        const copy=faceText(item.id,feature,surface,detail),[eyebrow,title,body,detailLine]=item.element.children;
        if(eyebrow?.textContent!==copy.eyebrow)eyebrow.textContent=copy.eyebrow;
        if(title?.textContent!==copy.title)title.textContent=copy.title;
        if(body?.textContent!==copy.body)body.textContent=copy.body;
        if(detailLine?.textContent!==copy.detail)detailLine.textContent=copy.detail;
      }
      if(item.id==='front'&&record.fallback){
        const title=item.element.querySelector('h2'),body=item.element.querySelector('p'),text=surface.description||surface.summary;
        if(title&&title.textContent!==surface.label)title.textContent=surface.label;
        if(body&&body.textContent!==text)body.textContent=text;
      }
    });
  }
  function clearFeatureSurface(){
    const record=mountedSurface;if(!record)return false;mountedSurface=null;
    record.flowObserver?.disconnect();
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
    const livePanel=panel&&!panel.hidden?panel:null,fallback=!livePanel,front=livePanel??makeFallbackFront(feature,object),detail=readFeature(featureId),surface=realityObjectSurfaceEngine.describe({feature,object,stage:node.revealStage??0,summary:detail?.summary,readOnly:owner.getSnapshot().mode==='past'});
    const initialFace=realityObjectSurfaceEngine.wrapLayout(surface.shape)[0];
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
    front.append(metadata);
    const surfaces=[{id:'front',element:front,object3d:null}];
    mountedSurface={featureId,livePanel,restore,fallback,front,metadata,surfaces,objects:[],shape:null,composition:null,intro:livePanel?mountLivingSurfaceIntro(livePanel):null};
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
    root.classList.add('assembly-has-live-object-surface');selectedSurface.hidden=true;materializeSurfaceObjects(mountedSurface);sizeAndPlaceSurface(mountedSurface);
    if(css3dFailed)say('Accessible reading mode: the 3D surface renderer is unavailable. Your feature controls still work.');
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
    if(announce)say(`${labelFor(featureMap.get(featureId))} · realitas lateralis independens; prior integra manet.`);
  }
  function returnToParentReality({announce=true,renderNow=true}={}){
    const current=workspace.getCurrentNode(),parent=current.parentId?workspace.getNode(current.parentId):null;
    if(!workspace.returnToParent())return false;
    owner=workspace.timeline;
    if(renderNow)render();
    if(announce)say('Ad realitatem priorem rediit; status lateralis manet.');
    return true;
  }
  function syncActiveReality(){
    workspace.sync();
  }
  function render(){
    const state=owner.getSnapshot(),feature=featureMap.get(state.selectedId),object=state.objects.find(item=>item.id===state.selectedId);
    spatial.apply(state,{viewMode,hoveredId:hovered});
    const detail=readFeature(feature.id),surface=realityObjectSurfaceEngine.describe({feature,object,stage:spatial.getSnapshot().selectedStage,summary:detail?.summary,readOnly:state.mode==='past'});
    find('[data-title]').textContent=labelFor(feature);find('[data-description]').textContent=copyFor(surface.description);
    find('[data-stage-badge]').textContent=`${surface.stageLabel} · ${latinShapes[surface.shape]??surface.shape}`;
    objectSymbol.textContent=({phone:'▯',square:'▦',rectangle:'▭',sphere:'◉',cylinder:'◍',cube:'⬡',wave:'∿'})[surface.shape]??'◇';
    find('[data-object-id]').textContent=visibleId(feature.id);find('[data-coordinate]').textContent=surface.positionLabel;
    find('[data-open-state]').textContent=surface.state;
    const anchor=object.anchor===true,immutable=object.locked===true,editingDisabled=anchor||immutable||state.mode==='past';
    find('[data-anchor-note]').hidden=!anchor;
    const shapeInput=find('[data-tab-shape]');shapeInput.value=object.shape;shapeInput.disabled=!surface.controls.canReshape||editingDisabled;
    find('[data-size-readout]').textContent=`${object.size.toFixed(1)}× · ${immutable?'Immutabilis':'Mutabilis'}`;
    const lockButton=find('[data-lock-toggle]');lockButton.textContent=immutable?'Muta':'Fige';lockButton.disabled=!surface.controls.canLock||state.mode==='past';
    find('[data-lock-state]').textContent=anchor?'Fixum':immutable?'Immutabilis':'Mutabilis';
    find('[data-edit-note]').textContent=anchor?'Instrumentum fixum manet.':state.mode==='past'?'Historia sola legitur · redi ad Praesens.':immutable?'Libera instrumentum ut formam vel situm mutare possis.':'Trahe ad disponendum · Shift-trahe per profunditatem · super obiectum volve ad augendum.';
    const activeReality=workspace.getCurrentNode();
    find('[data-mode]').textContent=state.mode==='past'?'Praeteritum · sola lectio':state.mode==='proposed'?'Propositum · non vivum':'Praesens · localis';
    find('[data-source-count]').textContent=String(surface.sourceCount);find('[data-boundary]').textContent=surface.boundary;
    const sourceContainer=find('[data-sources]');sourceContainer.replaceChildren();
    for(const source of surface.sourceRefs.length?surface.sourceRefs:['Navigatio instrumentorum']){const code=document.createElement('code');code.textContent=copyFor(source);sourceContainer.append(code);}
    find('[data-source-detail]').textContent=surface.summary;
    all('[data-open],[data-open-secondary]').forEach(button=>{button.disabled=state.mode==='past';});find('[data-open]').textContent=object.open?'Claude':'Aperi';
    const sideId=sideRealityByFeature.get(sideRealityKey(workspace.activeId,state.selectedId));
    const sideButton=find('[data-side-reality]');
    const sameFeatureSide=activeReality.kind==='side'&&activeReality.state?.featureId===state.selectedId;
    const parentReality=activeReality.parentId?workspace.getNode(activeReality.parentId):null;
    sideButton.textContent=sameFeatureSide?`Redi · ${parentReality?.label??'realitas prior'}`:sideId?`Ingredere · ${labelFor(feature)}`:'Nova realitas';
    sideButton.disabled=state.mode==='past';
    find('[data-object-id]').textContent=visibleId(feature.id)+' · '+activeReality.id;
    for(const [id,button] of catalog)button.setAttribute('aria-current',String(id===state.selectedId));
    for(const [id,label] of labels){label.classList.toggle('is-selected',id===state.selectedId);label.classList.toggle('is-hovered',id===hovered);}
    const slider=find('[data-time]');slider.max=String(state.frames.length-1);slider.value=String(state.mode==='past'?state.frames.findIndex(frame=>frame.revision===state.frameCursor):state.frames.length-1);
    const frame=state.frames[Number(slider.value)];find('[data-time-label]').textContent=state.mode==='proposed'?'User-proposed branch':`${new Date(frame.observedAt).toLocaleTimeString()} · ${frame.action}`;
    find('.assembly-branches').hidden=viewMode!=='4d';find('.assembly-timeline').classList.toggle('is-expanded',viewMode==='4d');
    const branchSelect=find('[data-branch-select]');branchSelect.replaceChildren(new Option('Present','present'));
    state.branches.forEach(branch=>branchSelect.add(new Option(branch.label,branch.id)));branchSelect.value=state.branchId??'present';
    root.dataset.previewDirty=String(state.revision>0||state.branches.length>0);
    root.dataset.historyMode=state.mode;
  }
  function select(id,{approach=true,revealInspector=false}={}){
    owner.select(id);activeLensGroup=null;spatial.setActiveGroup('*');spatial.focus(id);if(approach)focus();
    // Selecting an object must reveal its own attached living surface, not
    // force the old detached inspector over the scene. The central inspector
    // remains available through the Objectum toggle for deliberate inspection.
    selectedSurface.hidden=!revealInspector;
    root.classList.toggle('assembly-object-focused',revealInspector);
    root.classList.toggle('assembly-clean',!revealInspector);
    find('[data-clean]').textContent=revealInspector?'Celare':'Objectum';
    render();say(`${labelFor(featureMap.get(id))} · superficiem vivam aperire.`);
  }
  function exploreGroup(groupId){
    const record=catalogSections.get(groupId);if(!record)return;
    activeLensGroup=groupId;spatial.setActiveGroup(groupId);
    if(root.classList.contains('assembly-directory-open')){record.open=true;record.children.hidden=false;record.header.setAttribute('aria-expanded','true');record.section.scrollIntoView?.({block:'nearest'});}
    render();say(`${record.label} · tabulam spatialem elige.`);
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
    render();say(`${labelFor(featureMap.get(object.id))} · ${nextOpen?'apertum':'clausum'} · eadem identitas.`);
  }
  function focus(){
    const object=currentObject(),mobile=innerWidth<700,position=new THREE.Vector3(...object.position),node=spatial.nodes.get(object.id);
    // Camera distance follows the actual body volume and focus scale. A user
    // can intentionally enlarge an object, but a large cylinder no longer
    // turns into an accidental full-screen tube when selected.
    const projection=realityObjectSurfaceEngine.readingProjection({shape:object.shape??'rectangle',viewportWidth:innerWidth,viewportHeight:innerHeight});
    if(node)node.surfaceStretch=projection.stretch;
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
    activeLensGroup=null;
    spatial.setActiveGroup(null);
    focusTarget=new THREE.Vector3(...CLEAN_LANDING_CAMERA.target);
    focusPosition=new THREE.Vector3(...CLEAN_LANDING_CAMERA.position);
    spatial.focus(null);
    onFrame?.();
  }
  function setMode(mode){viewMode=mode;all('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===mode)));render();}
  function setInteraction(next){interaction=next;all('[data-interaction]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.interaction===next));button.textContent=next==='move'?'Fini disponere':'Disponde';});say(next==='move'?'Trahe obiectum; Shift-trahe per profunditatem.':'Trahe ad circumferentiam · scrolla ad iter.');}
  function moveBy(axis,steps){
    const object=currentObject();if(object.anchor||object.locked)throw Error(object.anchor?'Objectum fixum est.':'Primum hoc instrumentum libera.');
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
  for(const domain of REALITY_LENS_GROUPS){
    const members=groupMembers.get(domain.id)??[];if(!members.length)continue;
    const label=document.createElement('button');label.type='button';label.className='assembly-group-label';label.textContent=`${domain.label} · ${members.length}`;label.setAttribute('aria-label',`Explora ${domain.label} · ${members.length} instrumenta`);
    label.onclick=()=>exploreGroup(domain.id);
    find('.assembly-labels').append(label);spatialGroupLabels.set(domain.id,label);
  }
  for(const feature of ordered){
    const groupId=resolveRealityLensGroup(feature.id),domain=catalogSections.get(groupId);
    const visibleLabel=labelFor(feature),button=document.createElement('button');button.type='button';button.textContent=visibleLabel;button.onclick=guard(()=>{select(feature.id);if(interaction!=='move')enter(feature.id);if(root.classList.contains('assembly-directory-open'))setDirectory(false,{restoreFocus:true});});(domain?.children??find('.assembly-catalog')).append(button);catalog.set(feature.id,button);
    const label=document.createElement('button');label.type='button';label.className='assembly-node-label';label.textContent=visibleLabel;label.dataset.group=groupId;label.setAttribute('aria-label',`Aperi ${visibleLabel} · instrumentum`);label.onclick=guard(()=>{select(feature.id);if(interaction!=='move')enter(feature.id);});label.onpointerenter=()=>{hovered=feature.id;render();};label.onpointerleave=()=>{hovered=null;render();};find('.assembly-labels').append(label);labels.set(feature.id,label);
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
      if(query&&anyVisible){record.open=true;record.children.hidden=false;record.header.setAttribute('aria-expanded','true');}
      else if(!query)record.children.hidden=!record.open;
    }
  };
  const selectSearchResult=()=>{
    if(!quickSearch.value.trim()){setDirectory(true);catalogSearch.focus();return false;}
    const first=[...catalog].find(([,button])=>!button.hidden)?.[0];
    if(!first){say('Nullum obiectum inventum.');return false;}
    select(first);setDirectory(false);enter(first);return true;
  };
  catalogSearch.oninput=event=>applySearch(event.target.value);
  quickSearch.onfocus=()=>setDirectory(true);
  quickSearch.oninput=event=>{setDirectory(true);applySearch(event.target.value);};
  find('[data-quick-find]').onsubmit=event=>{event.preventDefault();selectSearchResult();};
  all('[data-home]').forEach(button=>button.onclick=overview);find('[data-focus]').onclick=focus;
  all('[data-open],[data-open-secondary]').forEach(button=>button.onclick=guard(toggle));
  find('[data-tab-shape]').onchange=guard(event=>{const object=currentObject();owner.configure(object.id,{shape:event.target.value});syncActiveReality();render();if(mountedSurface)focus();say('Tab reshaped. Its identity and feature connection stayed the same.');});
  find('[data-lock-toggle]').onclick=guard(()=>{const object=currentObject();owner.setLocked(object.id,!object.locked);syncActiveReality();render();say(object.locked?'Mutabile · obiectum apertum ad motum.':'Immutabile · positio et forma fixa.');});
  find('[data-side-reality]').onclick=guard(()=>{const id=owner.getSnapshot().selectedId,current=workspace.getCurrentNode();if(current.kind==='side'&&current.state?.featureId===id)returnToParentReality();else enterSideReality(id);});
  find('[data-enter]').onclick=enter;
  find('[data-enter-person]').onclick=()=>onNavigate?.('person');find('[data-enter-contracts]').onclick=()=>onNavigate?.('contracts');find('[data-grid]').onclick=()=>onNavigate?.('block-world');
  all('[data-view]').forEach(button=>button.onclick=()=>setMode(button.dataset.view));all('[data-interaction]').forEach(button=>button.onclick=()=>setInteraction(interaction==='move'?'orbit':'move'));
  find('[data-present]').onclick=()=>{owner.goTo('present');render();say('Returned to the unchanged present layout.');};
  find('[data-time]').oninput=guard(event=>{const index=Number(event.target.value),frame=owner.getSnapshot().frames[index];setMode('4d');owner.goTo(frame.revision);render();say('Inspecting recorded local history. Editing is disabled here.');});
  find('[data-branch-form]').onsubmit=guard(event=>{event.preventDefault();owner.propose(find('#assembly-branch-name').value);find('#assembly-branch-name').value='';render();say('Proposed branch created from the inspected frame. The present remains unchanged.');});
  find('[data-branch-select]').onchange=guard(event=>{if(event.target.value==='present')owner.goTo('present');else owner.viewBranch(event.target.value);render();});
  find('[data-export]').onclick=()=>{const url=URL.createObjectURL(new Blob([owner.exportHistory()],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download='matumbo-local-layout-history.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);say('Exported local layout history; no account, market or wallet state is included.');};
  find('[data-clean]').onclick=()=>{selectedSurface.hidden=!selectedSurface.hidden;root.classList.toggle('assembly-object-focused',!selectedSurface.hidden);if(!selectedSurface.hidden)root.classList.remove('assembly-clean');else root.classList.add('assembly-clean');find('[data-clean]').textContent=selectedSurface.hidden?'Objectum':'Celare';if(!selectedSurface.hidden)render();};
  const inspectorBody=find('.assembly-inspector-body');inspectorBody.id='assembly-inspector-content';
  const inspectorToggle=find('[data-fold-inspector]');inspectorToggle.setAttribute('aria-controls',inspectorBody.id);inspectorToggle.setAttribute('aria-expanded','true');
  const compactSelection=document.createElement('span');compactSelection.className='assembly-compact-selection';compactSelection.hidden=true;find('.assembly-inspector header').append(compactSelection);
  function foldInspector(folded){inspectorFolded=folded;inspectorBody.hidden=folded;root.classList.toggle('assembly-inspector-folded',folded);inspectorToggle.textContent=folded?'+':'−';inspectorToggle.setAttribute('aria-expanded',String(!folded));inspectorToggle.setAttribute('aria-label',folded?'Expand inspector':'Minimize inspector');compactSelection.hidden=!folded;compactSelection.textContent=featureMap.get(owner.getSnapshot().selectedId).label;}
  inspectorToggle.onclick=()=>foldInspector(!inspectorFolded);
  const locate=event=>{const rect=renderer.domElement.getBoundingClientRect();point.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(point,camera);return ray.intersectObjects(targets,false).find(hit=>{const id=spatial.resolve(hit.object);return id&&spatial.nodes.get(id)?.root.visible&&hit.object.visible;})??null;};
  const resizeOnScroll=guard(event=>{
    if(!active||event.ctrlKey||event.target?.closest?.('.assembly-inspector'))return;
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
    say(`${labelFor(featureMap.get(id))} · ${next.toFixed(1)}× · magnitudo mutata.`);
  });
  const down=guard(event=>{
    if(!active||event.button!==0)return;
    const hit=locate(event),id=spatial.resolve(hit?.object);pointer={id:event.pointerId,x:event.clientX,y:event.clientY,objectId:id,move:false};
    if(interaction==='move'&&id&&owner.getSnapshot().mode!=='past'){
      select(id,{approach:false});const object=currentObject();
      if(object.anchor||object.locked){say(object.anchor?'Objectum fixum est.':'Instrumentum immutabile est; prius libera.');return;}
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
    if(!active)return;const hit=locate(event);
    if(pointer?.move&&pointer.id===event.pointerId){
      if(ray.ray.intersectPlane(dragPlane,dragPoint)){
        const delta=dragPoint.clone().sub(pointer.hit),proposed=new THREE.Vector3(...pointer.origin).add(delta);
        if(event.shiftKey)proposed.addScaledVector(pointer.cameraForward,-(event.clientY-pointer.startY)*.055);
        const next=[proposed.x,proposed.y,proposed.z].map(value=>Math.max(-60,Math.min(60,value)));
        const state=owner.getSnapshot(),safePosition=resolveRealityTabPosition(pointer.objectId,next,state.objects);pointer.next=safePosition;
        spatial.apply({...state,objects:state.objects.map(object=>object.id===pointer.objectId?{...object,position:safePosition}:object)},{viewMode,hoveredId:pointer.objectId});
      }return;
    }
    const id=spatial.resolve(hit?.object);if(id!==hovered){hovered=id;render();find('[data-hover-label]').textContent=id?`${labelFor(featureMap.get(id))} · clicca ut instrumentum aperias`:'Spatium: iter · obiectum: magnitudo · clic: ingredere';}
  });
  const release=guard(event=>{
    if(!active||!pointer||event.pointerId!==pointer.id)return;const previous=pointer;pointer=null;controls.enabled=true;
    if(previous.move){if(event.type==='pointerup'){owner.move(previous.objectId,previous.next);syncActiveReality();}render();say(event.type==='pointerup'?'Layout move recorded. Use 4D to inspect it through time.':'Move cancelled.');return;}
    if(event.type==='pointerup'&&previous.objectId&&Math.hypot(event.clientX-previous.x,event.clientY-previous.y)<7){if(interaction!=='move')activateObjectTab(previous.objectId);else select(previous.objectId,{approach:false});}
  });
  const keys=guard(event=>{
    if(active&&event.key==='Escape'&&root.classList.contains('assembly-directory-open')){setDirectory(false,{restoreFocus:true});event.preventDefault();return;}
    if(!active||/input|textarea|select/i.test(event.target?.tagName))return;
    if(event.target?.closest?.('button,a,summary,[contenteditable="true"]')&&event.key==='Enter')return;
    if(event.key==='Escape'){overview();return;}
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
    root.classList.add('assembly-clean');find('[data-clean]').textContent='Objectum';selectedSurface.hidden=true;
    activeLensMode=Boolean(lensMode);spatial.setLensMode(activeLensMode);spatial.layer.visible=true;world.visible=false;scene.fog=activeLensMode?null:new THREE.FogExp2('#030911',.009);if(activeLensMode)scene.background=spatial.backdrop;document.body.classList.add('assembly-mode');
    scene.environment=environmentTexture;
    camera.fov=CLEAN_LANDING_CAMERA.fov;camera.updateProjectionMatrix();controls.minDistance=.45;controls.maxDistance=220;
    if(featureId&&featureMap.has(featureId))select(featureId);else overview();
    camera.position.copy(focusPosition);controls.target.copy(focusTarget);focusPosition=null;focusTarget=null;controls.update();render();
  }
  function close(){
    if(!active)return;setDirectory(false);active=false;onActiveChange(false);pointer=null;controls.enabled=true;root.hidden=true;spatial.layer.visible=false;document.body.classList.remove('assembly-mode');
    clearFeatureSurface();
    spatial.setLensMode(false);activeLensMode=false;
    if(saved){camera.position.copy(saved.position);controls.target.copy(saved.target);camera.fov=saved.fov;camera.updateProjectionMatrix();controls.minDistance=saved.min;controls.maxDistance=saved.max;world.visible=saved.worldVisible;scene.fog=saved.fog;scene.environment=saved.environment;scene.background=saved.background;saved=null;}
  }
  render();
  const selectionObserver=new MutationObserver(()=>{compactSelection.textContent=find('[data-title]').textContent;});selectionObserver.observe(find('[data-title]'),{childList:true});
  return {open,close,get active(){return active;},getSnapshot:snapshot,resolve:spatial.resolve,focusFeature(id){if(!featureMap.has(id))return false;if(!active)open({lensMode:true,featureId:id});else select(id);return true;},mountFeatureSurface,clearFeatureSurface,setInspectorVisible(visible){selectedSurface.hidden=!visible;root.classList.toggle('assembly-object-focused',Boolean(visible));root.classList.toggle('assembly-clean',!visible);find('[data-clean]').textContent=visible?'Celare':'Objectum';if(visible)render();},
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
      spatial.update(dt,time,{reducedMotion,cameraDistance,cameraPosition:camera.position});spatial.layer.updateMatrixWorld(true);camera.updateMatrixWorld();
      cssSurfaceHost.hidden=Boolean(renderer.xr?.isPresenting);
      if(mountedSurface&&!cssSurfaceHost.hidden){materializeSurfaceObjects(mountedSurface);sizeAndPlaceSurface(mountedSurface);css3dRenderer?.render(scene,camera);}
      onPanelFrame(owner.getSnapshot().selectedId);
      const overlaps=(a,b)=>a.left<b.right+4&&a.right>b.left-4&&a.top<b.bottom+4&&a.bottom>b.top-4;
      const occupied=[...all('.assembly-header,.assembly-directory,.assembly-inspector,.assembly-toolbar,.assembly-branches,.assembly-selection-hint,.assembly-world-label,.assembly-status'),...document.querySelectorAll('body.assembly-mode #immersive-toolbar')].filter(element=>!element.hidden&&getComputedStyle(element).display!=='none'&&getComputedStyle(element).visibility!=='hidden').map(element=>element.getBoundingClientRect());
    const selectedId=owner.getSnapshot().selectedId;
    const focusedNode=spatial.nodes.get(selectedId),focusedObject=owner.getSnapshot().objects.find(object=>object.id===selectedId);
    if(!selectedSurface.hidden&&focusedNode&&focusedObject){
      const distance=Math.max(.45,camera.position.distanceTo(focusedNode.position));
      const projected=realityObjectSurfaceEngine.projectedBounds({shape:focusedObject.shape??'cube',size:focusedObject.size??1,approachScale:(focusedNode.root.scale.x||1)/Math.max(.01,focusedObject.size??1),distance,viewportHeight:innerHeight,fov:camera.fov});
      const fitted=realityObjectSurfaceEngine.fitPanel({shape:focusedObject.shape??'rectangle',size:focusedObject.size??1,approachScale:(focusedNode.root.scale.x||1)/Math.max(.01,focusedObject.size??1),distance,viewportWidth:innerWidth,viewportHeight:innerHeight,fov:camera.fov,safeWidth:28,safeHeight:210,inset:0});
      const width=fitted.width,height=fitted.height;
      screenPoint.copy(focusedNode.root.position);screenPoint.project(camera);
      const centerX=(screenPoint.x*.5+.5)*innerWidth,centerY=(-screenPoint.y*.5+.5)*innerHeight;
      selectedSurface.style.left=`${Math.max(14,Math.min(innerWidth-width-14,centerX-width/2))}px`;
      selectedSurface.style.top=`${Math.max(88,Math.min(innerHeight-height-160,centerY-height/2))}px`;
      selectedSurface.style.right='auto';selectedSurface.style.bottom='auto';selectedSurface.style.width=`${width}px`;selectedSurface.style.height=`${height}px`;
      selectedSurface.style.maxHeight=`${height}px`;
      selectedSurface.dataset.shape=focusedObject.shape??'cube';
    }
      if(performance.now()<resizeFocusUntil&&document.activeElement===document.body&&lastAssemblyFocus?.classList.contains('assembly-node-label')){lastAssemblyFocus.hidden=false;lastAssemblyFocus.focus({preventScroll:true});}
      // A moving projection must not hide the DOM control holding keyboard focus.
      // Pin its current screen position until blur; other labels yield to it.
      const focusedLabel=[...labels.values()].find(label=>label===document.activeElement&&!label.hidden);
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
        labelRight.setFromMatrixColumn(camera.matrixWorld,0).normalize();
        const form=REALITY_TAB_FORMS[node.shape],side=node.revealOrder%2===0?1:-1;
        const labelPosition=assemblySideLabelPoint({position:node.root.position.toArray(),cameraRight:labelRight.toArray(),halfWidth:node.isTab?((form?.width??1.2)*(node.root.scale.x||node.size||1))/2:Math.max(.7,node.scale*.55),side,gap:node.isTab?.58:.46});
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
        labelRight.setFromMatrixColumn(camera.matrixWorld,0).normalize();
        const groupIndex=REALITY_LENS_GROUPS.findIndex(group=>group.id===groupId),groupSide=groupIndex%2===0?-1:1;
        screenPoint.set(...assemblySideLabelPoint({position:groupPosition.toArray(),cameraRight:labelRight.toArray(),halfWidth:2.7,side:groupSide,gap:.55})).project(camera);
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
    destroy(){close();destroyed=true;clearFeatureSurface();window.removeEventListener('resize',resizeCss3d);window.removeEventListener('resize',resizeFocus);selectionObserver.disconnect();spatial.destroy();root.remove();stylesheet.remove();cssSurfaceHost.removeEventListener('pointerdown',downOnObjectSurface,true);canvas.removeEventListener('pointerdown',down,true);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',release);canvas.removeEventListener('pointercancel',release);canvas.removeEventListener('wheel',resizeOnScroll,true);root.removeEventListener('wheel',resizeOnScroll,true);document.removeEventListener('keydown',keys);}};
}
