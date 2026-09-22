import {createRealityTimeline} from '../domains/reality-timeline.js';
import {buildRealityAssemblyScene,LOD_FAR} from './reality-assembly-scene.js';

// Approved clean-root start pose: the camera parks beyond LOD_FAR so the
// world boots as ONE single merged glass cube — nothing else in the 3D scene.
// Moving/zooming inward springs the constellation open. The pose distance must
// stay above LOD_FAR (pinned by tests/reality-assembly-start-view.test.mjs).
export const CLEAN_LANDING_CAMERA={position:[0,34,172],target:[0,2,0],mergeThreshold:LOD_FAR};

// A block's name must survive camera rotation: a label is hidden only when its
// cube is behind the camera or outside the projectable frustum. Anything
// projectable stays visible — it is clamped into the visible band instead of
// being culled for overlapping another label or HUD chrome.
export function placeAssemblyLabel({ndcX,ndcY,ndcZ,viewportWidth,viewportHeight,safeTop,safeBottom}){
  if(!(ndcZ>-1&&ndcZ<1)||Math.abs(ndcX)>1.25||Math.abs(ndcY)>1.25)return {visible:false};
  const x=Math.min(Math.max((ndcX*.5+.5)*viewportWidth,8),viewportWidth-8);
  const y=Math.min(Math.max((-ndcY*.5+.5)*viewportHeight,safeTop),safeBottom);
  return {visible:true,x,y};
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

export function createRealityAssembly({THREE,renderer,scene,camera,controls,world,targets,features,onNavigate,onFrame,readFeature=()=>null,environmentTexture=null,reducedMotion=false}){
  const primary=['block-world','contracts','person','rooms','academy','world-events','multi-sport-events','asset-market'];
  const ordered=[...features].sort((a,b)=>{const aIndex=primary.indexOf(a.id),bIndex=primary.indexOf(b.id);return (aIndex<0?100:aIndex)-(bIndex<0?100:bIndex);});
  // Final canonical spacing: the core cube has breathing room around it;
  // primary worlds sit on a 10.5-unit ring and secondary worlds on a 20.5-unit
  // ring so labels/connections remain legible instead of collapsing together.
  const positions=ordered.map((feature,i)=>{
    if(i===0)return {id:feature.id,position:[0,2,0]};
    const outer=i>=8;
    const outerCount=Math.max(1,ordered.length-8);
    const angle=(outer?(i-8)/outerCount:(i-1)/7)*Math.PI*2-Math.PI/2;
    const radius=outer?20.5:10.5;
    return {
      id:feature.id,
      position:[
        Math.cos(angle)*radius,
        outer?Math.sin(angle*3)*3.5-1:Math.sin(angle*2)*2.4+1,
        Math.sin(angle)*radius*.72,
      ],
    };
  });
  const owner=createRealityTimeline({objects:positions});
  const spatial=buildRealityAssemblyScene({THREE,parent:scene,features:ordered.map((feature,i)=>({...feature,assemblyTier:i===0?'core':i<8?'primary':'secondary'})),targets});
  const featureMap=new Map(features.map(feature=>[feature.id,feature]));
  const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href=new URL('./reality-assembly.css',import.meta.url).href;document.head.append(stylesheet);
  const root=document.createElement('section');root.id='reality-assembly';root.hidden=true;root.setAttribute('aria-label','Reality Lens spatial assembly');
  root.innerHTML=`<header class="assembly-header"><a class="assembly-brand" href="?feature=reality-lens"><span aria-hidden="true">◇</span><div>maTumbo<small>People × planet × possibility</small></div></a><nav aria-label="Assembly navigation"><button data-home>Explore</button><button data-enter-person>Your space</button><button data-enter-contracts>Contracts</button><button data-grid>Cube editor</button></nav><button data-clean>Hide panels</button></header>
  <aside class="assembly-directory"><p class="assembly-eyebrow">Reality Lens Ω</p><h1>Many worlds.<br><em>One reality.</em></h1><p class="assembly-intro">Open a world. Follow a connection.<br>Stay with the same object through time.</p><label class="assembly-search-label">Find a connected feature<input data-search placeholder="Search worlds, contracts…" type="search"></label><nav class="assembly-catalog" aria-label="Feature objects"></nav><p class="assembly-note">Designed 3D architecture.<br>Feature routes, not real cities or online populations.</p></aside>
  <div class="assembly-labels" aria-label="Spatial feature labels"></div>
  <div class="assembly-world-label" data-world-label hidden>maTumbo Living Reality Ω · one world — scroll or pinch to approach</div>
  <aside class="assembly-inspector" aria-label="Selected object"><header><span class="assembly-eyebrow">Object inspector</span><button data-fold-inspector aria-label="Minimize inspector">−</button></header><div class="assembly-inspector-body"><div class="assembly-object-symbol" aria-hidden="true">◇</div><h2 data-title></h2><p data-description></p><div class="assembly-tags"><span data-mode>Present</span><span>Same feature identity</span></div><dl><dt>Object ID</dt><dd data-object-id></dd><dt>Coordinates</dt><dd data-coordinate></dd><dt>View state</dt><dd data-open-state></dd><dt>Sources</dt><dd data-source-count></dd></dl><div class="assembly-actions"><button data-open>Open cube</button><button data-focus>Approach</button><button data-enter class="assembly-primary">Enter feature ↗</button></div><h3>Connected source references</h3><div data-sources></div><p class="assembly-note" data-boundary></p><p class="assembly-source-detail" data-source-detail></p></div></aside>
  <div class="assembly-selection-hint" data-hover-label>Hover to peek · click to select · double-click to open</div>
  <footer class="assembly-toolbar"><div class="assembly-view"><span class="assembly-eyebrow">View</span><button data-view="3d" aria-pressed="true">3D</button><button data-view="4d" aria-pressed="false">4D · time</button></div><div class="assembly-tools"><button data-interaction="orbit" aria-pressed="true">Orbit</button><button data-interaction="move" aria-pressed="false">Move</button><button data-open-secondary>Open / close</button><button data-home>Overview</button></div><div class="assembly-timeline"><label>Observed local history<input data-time type="range" min="0" max="0" value="0" step="1" aria-label="Recorded view frame"></label><span data-time-label>No previous observations</span><button data-present>Present</button></div><button data-export>Export history</button></footer>
  <section class="assembly-branches" hidden aria-label="Proposed branches"><div><span class="assembly-eyebrow">4D = space + observed time / proposed states</span><p>History is read-only. Proposed layouts do not change the present.</p></div><form data-branch-form><label class="assembly-sr-only" for="assembly-branch-name">Proposed branch name</label><input id="assembly-branch-name" name="branchName" maxlength="60" required placeholder="Name a proposed branch"><button class="assembly-primary">Create branch</button></form><label>View branch<select data-branch-select><option value="present">Present</option></select></label></section>
  <p class="assembly-status" data-status role="status" aria-live="polite"></p>`;
  document.body.append(root);
  let lastAssemblyFocus=null,resizeFocusUntil=0;
  root.addEventListener('focusin',event=>{lastAssemblyFocus=event.target;});
  const all=selector=>[...root.querySelectorAll(selector)],find=selector=>root.querySelector(selector);
  const directory=find('.assembly-directory');directory.id='assembly-feature-directory';
  const directoryToggle=document.createElement('button');directoryToggle.type='button';directoryToggle.dataset.directoryToggle='';directoryToggle.textContent='Find a world';directoryToggle.setAttribute('aria-controls',directory.id);directoryToggle.setAttribute('aria-expanded','false');find('.assembly-header').append(directoryToggle);
  const directoryClose=document.createElement('button');directoryClose.type='button';directoryClose.dataset.directoryClose='';directoryClose.textContent='Close directory';directory.prepend(directoryClose);
  function setDirectory(open,{restoreFocus=false}={}){
    root.classList.toggle('assembly-directory-open',open);directoryToggle.setAttribute('aria-expanded',String(open));
    if(open){root.classList.remove('assembly-clean');find('[data-clean]').textContent='Hide panels';find('[data-search]').focus();}
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
  let active=false,saved=null,viewMode='3d',interaction='orbit',hovered=null,pointer=null,focusTarget=null,focusPosition=null,inspectorFolded=false;
  const labels=new Map(),catalog=new Map();
  const ray=new THREE.Raycaster(),point=new THREE.Vector2(),screenPoint=new THREE.Vector3(),dragPlane=new THREE.Plane(),dragPoint=new THREE.Vector3();
  const say=message=>{find('[data-status]').textContent=message;};
  const guard=fn=>(...args)=>{try{return fn(...args);}catch(error){say(error.message);return null;}};
  const currentObject=()=>owner.getSnapshot().objects.find(object=>object.id===owner.getSnapshot().selectedId);
  function snapshot(){return {...owner.getSnapshot(),active,viewMode,interaction,camera:{position:camera.position.toArray(),target:controls.target.toArray()},spatial:spatial.getSnapshot()};}
  function render(){
    const state=owner.getSnapshot(),feature=featureMap.get(state.selectedId),object=state.objects.find(item=>item.id===state.selectedId);
    spatial.apply(state,{viewMode,hoveredId:hovered});
    find('[data-title]').textContent=feature.label;find('[data-description]').textContent=feature.description;
    find('[data-object-id]').textContent=feature.id;find('[data-coordinate]').textContent=object.position.map(n=>n.toFixed(1)).join(' / ');
    find('[data-open-state]').textContent=object.open?'Open · interior exposed':'Closed';find('[data-mode]').textContent=state.mode==='past'?'Recorded past':state.mode==='proposed'?'Proposed · not live':'Present · local view';
    find('[data-source-count]').textContent=String(feature.sources?.length??0);find('[data-boundary]').textContent=feature.boundary;
    const sourceContainer=find('[data-sources]');sourceContainer.replaceChildren();
    for(const source of feature.sources?.length?feature.sources:['Feature navigation']){const code=document.createElement('code');code.textContent=source;sourceContainer.append(code);}
    const detail=readFeature(feature.id);find('[data-source-detail]').textContent=detail?.summary??'Open this feature for its controls and source evidence. No provider request is made by inspecting its cube.';
    all('[data-open],[data-open-secondary]').forEach(button=>{button.disabled=state.mode==='past';});find('[data-open]').textContent=object.open?'Close cube':'Open cube';
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
  function select(id){owner.select(id);render();say(`${featureMap.get(id).label} selected. Open the cube to reveal its interior or enter the feature.`);}
  function toggle(){const object=currentObject();owner.setOpen(object.id,!object.open);render();say(`${object.open?'Closed':'Opened'} ${featureMap.get(object.id).label} · same object ID.`);}
  function focus(){
    const object=currentObject(),mobile=innerWidth<700,position=new THREE.Vector3(...object.position);
    const outward=new THREE.Vector3(position.x,0,position.z);if(outward.length()<1)outward.set(.15,0,1);outward.normalize().multiplyScalar(mobile?11:9);outward.y=3.2;
    focusTarget=position.clone();focusPosition=position.clone().add(outward);spatial.focus(object.id);onFrame?.();
  }
  function overview(){
    focusTarget=new THREE.Vector3(0,2,0);
    focusPosition=new THREE.Vector3(innerWidth<700?10:7,innerWidth<700?24:17,innerWidth<700?92:76);
    spatial.focus(null);
    onFrame?.();
  }
  function setMode(mode){viewMode=mode;all('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===mode)));render();}
  function setInteraction(next){interaction=next;all('[data-interaction]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.interaction===next)));say(next==='move'?'Drag a cube to move its local layout. Arrow keys move the selected cube; Page Up / Down changes its height.':'Drag to orbit. Scroll or pinch to approach.');}
  const enter=()=>onNavigate?.(owner.getSnapshot().selectedId);
  for(const feature of ordered){
    const button=document.createElement('button');button.type='button';button.textContent=feature.label;button.onclick=guard(()=>{select(feature.id);focus();if(root.classList.contains('assembly-directory-open'))setDirectory(false,{restoreFocus:true});});find('.assembly-catalog').append(button);catalog.set(feature.id,button);
    const label=document.createElement('button');label.type='button';label.className='assembly-node-label';label.textContent=feature.label;label.setAttribute('aria-label',`Inspect ${feature.label}`);label.onclick=guard(()=>select(feature.id));label.ondblclick=guard(()=>{select(feature.id);toggle();focus();});label.onpointerenter=()=>{hovered=feature.id;render();};label.onpointerleave=()=>{hovered=null;render();};find('.assembly-labels').append(label);labels.set(feature.id,label);
  }
  find('[data-search]').oninput=event=>{const query=event.target.value.toLowerCase().trim();for(const [id,button] of catalog)button.hidden=!`${featureMap.get(id).label} ${id}`.toLowerCase().includes(query);};
  all('[data-home]').forEach(button=>button.onclick=overview);find('[data-focus]').onclick=focus;
  all('[data-open],[data-open-secondary]').forEach(button=>button.onclick=guard(toggle));find('[data-enter]').onclick=enter;
  find('[data-enter-person]').onclick=()=>onNavigate?.('person');find('[data-enter-contracts]').onclick=()=>onNavigate?.('contracts');find('[data-grid]').onclick=()=>onNavigate?.('block-world');
  all('[data-view]').forEach(button=>button.onclick=()=>setMode(button.dataset.view));all('[data-interaction]').forEach(button=>button.onclick=()=>setInteraction(button.dataset.interaction));
  find('[data-present]').onclick=()=>{owner.goTo('present');render();say('Returned to the unchanged present layout.');};
  find('[data-time]').oninput=guard(event=>{const index=Number(event.target.value),frame=owner.getSnapshot().frames[index];setMode('4d');owner.goTo(frame.revision);render();say('Inspecting recorded local history. Editing is disabled here.');});
  find('[data-branch-form]').onsubmit=guard(event=>{event.preventDefault();owner.propose(find('#assembly-branch-name').value);find('#assembly-branch-name').value='';render();say('Proposed branch created from the inspected frame. The present remains unchanged.');});
  find('[data-branch-select]').onchange=guard(event=>{if(event.target.value==='present')owner.goTo('present');else owner.viewBranch(event.target.value);render();});
  find('[data-export]').onclick=()=>{const url=URL.createObjectURL(new Blob([owner.exportHistory()],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download='matumbo-local-layout-history.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);say('Exported local layout history; no account, market or wallet state is included.');};
  find('[data-clean]').onclick=event=>{const clean=root.classList.toggle('assembly-clean');event.target.textContent=clean?'Show panels':'Hide panels';};
  const inspectorBody=find('.assembly-inspector-body');inspectorBody.id='assembly-inspector-content';
  const inspectorToggle=find('[data-fold-inspector]');inspectorToggle.setAttribute('aria-controls',inspectorBody.id);inspectorToggle.setAttribute('aria-expanded','true');
  const compactSelection=document.createElement('span');compactSelection.className='assembly-compact-selection';compactSelection.hidden=true;find('.assembly-inspector header').append(compactSelection);
  function foldInspector(folded){inspectorFolded=folded;inspectorBody.hidden=folded;root.classList.toggle('assembly-inspector-folded',folded);inspectorToggle.textContent=folded?'+':'−';inspectorToggle.setAttribute('aria-expanded',String(!folded));inspectorToggle.setAttribute('aria-label',folded?'Expand inspector':'Minimize inspector');compactSelection.hidden=!folded;compactSelection.textContent=featureMap.get(owner.getSnapshot().selectedId).label;}
  inspectorToggle.onclick=()=>foldInspector(!inspectorFolded);
  const locate=event=>{const rect=renderer.domElement.getBoundingClientRect();point.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(point,camera);return ray.intersectObjects(targets,false).find(hit=>spatial.resolve(hit.object))??null;};
  const down=guard(event=>{
    if(!active||event.button!==0)return;
    const hit=locate(event),id=spatial.resolve(hit?.object);pointer={id:event.pointerId,x:event.clientX,y:event.clientY,objectId:id,move:false};
    if(interaction==='move'&&id&&owner.getSnapshot().mode!=='past'){
      select(id);const object=currentObject();dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0,1,0),new THREE.Vector3(...object.position));
      if(ray.ray.intersectPlane(dragPlane,dragPoint)){pointer.move=true;pointer.origin=object.position;pointer.hit=dragPoint.clone();pointer.next=object.position;controls.enabled=false;renderer.domElement.setPointerCapture(event.pointerId);event.stopImmediatePropagation();event.preventDefault();}
    }
  });
  const move=guard(event=>{
    if(!active)return;const hit=locate(event);
    if(pointer?.move&&pointer.id===event.pointerId){
      if(ray.ray.intersectPlane(dragPlane,dragPoint)){
        const delta=dragPoint.clone().sub(pointer.hit),next=[Math.max(-24,Math.min(24,pointer.origin[0]+delta.x)),pointer.origin[1],Math.max(-24,Math.min(24,pointer.origin[2]+delta.z))];
        pointer.next=next;const state=owner.getSnapshot();spatial.apply({...state,objects:state.objects.map(object=>object.id===pointer.objectId?{...object,position:next}:object)},{viewMode,hoveredId:pointer.objectId});
      }return;
    }
    const id=spatial.resolve(hit?.object);if(id!==hovered){hovered=id;render();find('[data-hover-label]').textContent=id?`${featureMap.get(id).label} · click to inspect / double-click to open`:'Hover to peek · click to select · double-click to open';}
  });
  const release=guard(event=>{
    if(!active||!pointer||event.pointerId!==pointer.id)return;const previous=pointer;pointer=null;controls.enabled=true;
    if(previous.move){if(event.type==='pointerup')owner.move(previous.objectId,previous.next);render();say(event.type==='pointerup'?'Layout move recorded. Use 4D to inspect it through time.':'Move cancelled.');return;}
    if(event.type==='pointerup'&&previous.objectId&&Math.hypot(event.clientX-previous.x,event.clientY-previous.y)<7)select(previous.objectId);
  });
  const double=guard(event=>{if(!active)return;const hit=locate(event),id=spatial.resolve(hit?.object);if(id){select(id);toggle();focus();}});
  const keys=guard(event=>{
    if(active&&event.key==='Escape'&&root.classList.contains('assembly-directory-open')){setDirectory(false,{restoreFocus:true});event.preventDefault();return;}
    if(!active||/input|textarea|select/i.test(event.target?.tagName))return;
    if(event.target?.closest?.('button,a,[contenteditable="true"]')&&event.key==='Enter')return;
    if(event.key==='Escape'){overview();return;}
    if(event.key==='Enter'){toggle();event.preventDefault();return;}
    if(interaction!=='move')return;
    const deltas={ArrowLeft:[-.5,0,0],ArrowRight:[.5,0,0],ArrowUp:[0,0,-.5],ArrowDown:[0,0,.5],PageUp:[0,.5,0],PageDown:[0,-.5,0]},delta=deltas[event.key];
    if(delta){const object=currentObject();owner.move(object.id,object.position.map((n,i)=>n+delta[i]));render();event.preventDefault();}
  });
  const canvas=renderer.domElement;canvas.addEventListener('pointerdown',down,true);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);canvas.addEventListener('dblclick',double);document.addEventListener('keydown',keys);
  function open(){
    if(active)return;active=true;saved={position:camera.position.clone(),target:controls.target.clone(),fov:camera.fov,min:controls.minDistance,max:controls.maxDistance,worldVisible:world.visible,fog:scene.fog,environment:scene.environment};
    root.hidden=false;
    // Panels start CLOSED: the default view is the clean constellation of
    // cubes. The user materializes the directory / inspector with the header
    // toggles ("Show panels", "Find a world", inspector fold); nothing
    // auto-opens large over the 3D view.
    root.classList.add('assembly-clean');find('[data-clean]').textContent='Show panels';
    spatial.layer.visible=true;world.visible=false;scene.fog=new THREE.FogExp2('#030911',.009);document.body.classList.add('assembly-mode');
    scene.environment=environmentTexture;
    camera.fov=48;camera.updateProjectionMatrix();controls.minDistance=3;controls.maxDistance=220;overview();camera.position.copy(focusPosition);controls.target.copy(focusTarget);focusPosition=null;focusTarget=null;controls.update();render();
  }
  function close(){
    if(!active)return;setDirectory(false);active=false;pointer=null;controls.enabled=true;root.hidden=true;spatial.layer.visible=false;document.body.classList.remove('assembly-mode');
    if(saved){camera.position.copy(saved.position);controls.target.copy(saved.target);camera.fov=saved.fov;camera.updateProjectionMatrix();controls.minDistance=saved.min;controls.maxDistance=saved.max;world.visible=saved.worldVisible;scene.fog=saved.fog;scene.environment=saved.environment;saved=null;}
  }
  render();
  const selectionObserver=new MutationObserver(()=>{compactSelection.textContent=find('[data-title]').textContent;});selectionObserver.observe(find('[data-title]'),{childList:true});
  return {open,close,get active(){return active;},getSnapshot:snapshot,resolve:spatial.resolve,selectObject(object){const id=spatial.resolve(object);if(!id)return false;select(id);toggle();return true;},
    update(dt,time){
      if(!active)return;
      if(focusTarget&&!renderer.xr.isPresenting){const blend=reducedMotion?1:1-Math.exp(-dt*6);controls.target.lerp(focusTarget,blend);camera.position.lerp(focusPosition,blend);if(camera.position.distanceTo(focusPosition)<.02){focusTarget=null;focusPosition=null;}}
      const cameraDistance=camera.position.distanceTo(controls.target);
      spatial.update(dt,time,{reducedMotion,cameraDistance,cameraPosition:camera.position});spatial.layer.updateMatrixWorld(true);camera.updateMatrixWorld();
      const overlaps=(a,b)=>a.left<b.right+4&&a.right>b.left-4&&a.top<b.bottom+4&&a.bottom>b.top-4;
      const occupied=all('.assembly-header,.assembly-directory,.assembly-inspector,.assembly-toolbar,.assembly-branches').filter(element=>!element.hidden&&getComputedStyle(element).display!=='none'&&getComputedStyle(element).visibility!=='hidden').map(element=>element.getBoundingClientRect());
      const selectedId=owner.getSnapshot().selectedId;
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
      const lod=spatial.getSnapshot().lod,worldLabel=find('[data-world-label]');
      worldLabel.hidden=lod!=='world-block';
      if(lod==='world-block'){for(const [,label] of labels)label.hidden=true;}
      else{
      // Block names survive camera rotation: nothing is culled for overlapping
      // another label or HUD chrome. A projectable label is always shown,
      // clamped into the visible safe band so it slides along chrome edges
      // instead of vanishing behind them.
      const {safeTop,safeBottom}=computeLabelSafeBand(occupied,innerHeight);
      const orderedLabels=[...labels].sort(([a],[b])=>(a===selectedId?-2:a===hovered?-1:0)-(b===selectedId?-2:b===hovered?-1:0));
      for(const [id,label] of orderedLabels){
        if(label===focusedLabel)continue;
        const node=spatial.nodes.get(id);if(!node){label.hidden=true;continue;}
        screenPoint.copy(node.root.position);screenPoint.y-=1.55*node.scale;screenPoint.project(camera);
        const placement=placeAssemblyLabel({ndcX:screenPoint.x,ndcY:screenPoint.y,ndcZ:screenPoint.z,viewportWidth:innerWidth,viewportHeight:innerHeight,safeTop,safeBottom});
        if(!placement.visible){label.hidden=true;continue;}
        label.hidden=false;label.style.left=`${placement.x}px`;label.style.top=`${placement.y}px`;
        // Keep the full pill inside the safe band after centering.
        const bounds=label.getBoundingClientRect();
        let dx=0,dy=0;
        if(bounds.left<8)dx=8-bounds.left;else if(bounds.right>innerWidth-8)dx=innerWidth-8-bounds.right;
        if(bounds.top<safeTop)dy=safeTop-bounds.top;else if(bounds.bottom>safeBottom)dy=safeBottom-bounds.bottom;
        if(dx||dy){label.style.left=`${placement.x+dx}px`;label.style.top=`${placement.y+dy}px`;}
        label.style.zIndex=id===selectedId?'3':id===hovered?'2':'1';
      }
      }
    },
    destroy(){close();window.removeEventListener('resize',resizeFocus);selectionObserver.disconnect();spatial.destroy();root.remove();stylesheet.remove();canvas.removeEventListener('pointerdown',down,true);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',release);canvas.removeEventListener('pointercancel',release);canvas.removeEventListener('dblclick',double);document.removeEventListener('keydown',keys);}};
}
