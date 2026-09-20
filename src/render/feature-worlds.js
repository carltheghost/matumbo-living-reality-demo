/**
 * Packet 233 — feature block worlds. Ported in Packet 240 (fidelity
 * restoration) with the adaptations noted inline: glass-style.js builders
 * replace the local glass recipe (named deliberate deviation), and the
 * shared double-tap.js detector disambiguates tap vs double-tap on the
 * feature-world canvas and the projected-label buttons.
 *
 * Double-clicking a Reality Lens cube travels INTO that feature's own block
 * world, rendered in the same visual language as the lens: bounded starfield,
 * translucent blue glass cubes, connection lines. Same recipe, own world.
 *
 * Top level is node-safe: THREE and the DOM are only touched inside
 * createFeatureWorlds(). The pure pieces below (constants, travel machine,
 * content adapters) are exported for unit tests.
 *
 * Contracts defined here:
 * - window.__TUMBO_FEATURE_WORLDS__ = {enter, exit}
 * - World Chess cube dispatches window CustomEvent 'world-chess:open'
 *   with detail {source:'feature-world', feature:<featureId>}
 * - Table Chess cube performs the onNavigate('arena') path (the existing
 *   arena feature UI / chess-arena console) via the injected onNavigate.
 *
 * Tap semantics (mirroring the block-world dive path): a single tap selects
 * immediately; a same-target, same-pointer-type second tap within 350ms/28px
 * performs the cube's action (enters/uses). The feature-world canvas uses
 * the shared detector for ALL pointer types — no native dblclick here, so
 * mouse and touch share one click path and can never double-fire.
 */
import {createWardrobeAtelier} from '../domains/wardrobe-atelier.js';
import {ARENA_GAME_MODES} from '../domains/arena-games.js';
import {ACADEMY_LESSONS} from '../domains/academy.js';
import {CONNECTED_CITY_DISTRICTS} from '../domains/connected-city.js?v=20260920-p240';
import {createContractAtelier} from '../domains/contract-atelier.js';
import {makeGlassCubeMaterial,glassEdgeMaterialParams} from './glass-style.js?v=20260920-p239';
import {createDoubleTapDetector} from './double-tap.js?v=20260920-p240';

/** Pure, node-testable world constants. */
export const FEATURE_WORLD_CONSTANTS={
  cubeSize:1.15,            // world-space edge of each content cube
  ringRadius:5.6,           // primary content ring radius
  ringStep:3.0,             // extra radius per overflow ring
  cubesPerRing:12,
  maxCubes:24,
  maxGlassOpacity:.5,       // glass never reads solid — hard cap
  coreGlassOpacity:.35,
  entryCamera:[0,6.8,15],   // camera pose inside a feature world
  entryTarget:[0,2,0],
  tweenSeconds:1.35,
};

/** Pure travel state machine: lens -> entering -> world -> exiting -> lens. */
export function createTravelMachine(){
  let state='lens',featureId=null;
  return {
    enter(id){
      if(!id||typeof id!=='string')return false;
      if(state==='entering'||state==='world')return false;
      featureId=id;state='entering';return true;
    },
    arrived(){
      if(state==='entering'){state='world';return true;}
      return false;
    },
    exit(){
      if(state==='world'||state==='entering'){state='exiting';return true;}
      return false;
    },
    returned(){
      if(state==='exiting'){state='lens';featureId=null;return true;}
      return false;
    },
    getSnapshot(){return {state,featureId,active:state!=='lens'};},
  };
}

const text=(value,fallback='')=>(typeof value==='string'&&value.trim()?value.trim().slice(0,90):fallback);
const cube=(id,label,summary,action,accent='blue')=>({id,label:text(label,'Untitled'),summary:text(summary,''),action:action??{kind:'info'},accent});

/** Labeled placeholder cubes — the fails-closed fallback when a domain is unavailable. */
export function placeholderCubes(featureId,count=3,worldLabel='Content'){
  const out=[];
  for(let i=0;i<count;i++)out.push(cube(`${featureId}:placeholder-${i}`,`${worldLabel} ${i+1}`,'Real content appears here when the feature provides it.',{kind:'info'}));
  return out;
}

function safeArray(fn){try{const value=fn();return Array.isArray(value)?value:[];}catch{return [];}}
function navigateCubes(featureId,count,title,accent='blue',note=''){
  return placeholderCubes(featureId,count,title).map(item=>({...item,action:{kind:'navigate',feature:featureId},summary:note||`Double-click to open the full ${title.toLowerCase()} feature.`}));
}

/**
 * Pure content adapters: feature id + stubbed domain access -> cube descriptors.
 * Every read is defensive; failures fall back to labeled placeholder cubes.
 *
 * domains shape (all optional):
 *   {wardrobe:{listOutfits,equipOutfit}, arenaModes:[], contracts:{list},
 *    lessons:[], districts:[]}
 */
export function adaptFeatureContent(featureId,domains={}){
  try{
    switch(featureId){
      case 'wardrobe':
      case 'wardrobe-atelier':{
        const outfits=safeArray(()=>domains.wardrobe?.listOutfits());
        if(!outfits.length)return placeholderCubes('wardrobe',3,'Outfit');
        return outfits.slice(0,FEATURE_WORLD_CONSTANTS.maxCubes).map(outfit=>cube(
          `outfit:${outfit.id??outfit.key??'unknown'}`,
          outfit.name??outfit.label??'Outfit',
          outfit.equipped?'Equipped now — double-click to keep wearing it.':'Double-click to equip this outfit.',
          {kind:'wardrobe-equip',outfitId:outfit.id??outfit.key},
          'violet'));
      }
      case 'arena':{
        const modes=safeArray(()=>domains.arenaModes);
        const cubes=[
          cube('arena:world-chess','World Chess','Avatar chess on a full 3D board among the blocks — double-click to play.',{kind:'world-chess-open'},'gold'),
          cube('arena:table-chess','Table Chess','The classic arena chess console — double-click to open.',{kind:'navigate',feature:'arena'},'gold'),
        ];
        for(const mode of modes){
          if(/chess/i.test(String(mode?.id??'')))continue;
          cubes.push(cube(`arena:${mode.id}`,mode.label??mode.id,mode.summary??mode.subtitle??'Double-click to open the arena.',{kind:'navigate',feature:'arena'},'blue'));
          if(cubes.length>=FEATURE_WORLD_CONSTANTS.maxCubes)break;
        }
        return cubes;
      }
      case 'contracts':{
        const contracts=safeArray(()=>domains.contracts?.list());
        if(!contracts.length)return navigateCubes('contracts',3,'Contract','gold','Simulated points only — double-click to open the contracts feature.');
        return contracts.slice(0,FEATURE_WORLD_CONSTANTS.maxCubes).map(contract=>cube(
          `contract:${contract.id??'unknown'}`,
          contract.title??contract.label??contract.name??'Contract',
          'Simulated points only — double-click to inspect in the contracts feature.',
          {kind:'navigate',feature:'contracts'},
          'gold'));
      }
      case 'academy':{
        const lessons=safeArray(()=>domains.lessons);
        if(!lessons.length)return navigateCubes('academy',3,'Course','green');
        return lessons.slice(0,FEATURE_WORLD_CONSTANTS.maxCubes).map(lesson=>cube(
          `academy:${lesson.id}`,lesson.label??lesson.id,lesson.summary??'Double-click to open the academy.',
          {kind:'navigate',feature:'academy'},'green'));
      }
      case 'connected-city':{
        const districts=safeArray(()=>domains.districts);
        if(!districts.length)return navigateCubes('connected-city',4,'District','green');
        return districts.slice(0,FEATURE_WORLD_CONSTANTS.maxCubes).map(district=>cube(
          `city:${district.id}`,district.label??district.id,district.summary??'Double-click to open the connected city.',
          {kind:'navigate',feature:'connected-city'},'green'));
      }
      case 'person':{
        return [
          cube('person:avatar','Avatar','Your local avatar — double-click to open the person studio.',{kind:'navigate',feature:'person'},'violet'),
          cube('person:wardrobe','Wardrobe','Outfits and looks — double-click to open.',{kind:'navigate',feature:'wardrobe-atelier'},'violet'),
          cube('person:rooms','Rooms','Your spaces — double-click to open.',{kind:'navigate',feature:'rooms'},'violet'),
        ];
      }
      case 'rooms':return navigateCubes('rooms',4,'Room','violet');
      case 'block-world':return navigateCubes('block-world',3,'Block','blue');
      // Provider-driven features: never invent records — show entry cubes that
      // open the full feature so the provider can be refreshed there.
      case 'world-events':return navigateCubes('world-events',4,'Signal','blue','Provider observations load in the full feature — double-click to open it and refresh.');
      case 'multi-sport-events':return navigateCubes('multi-sport-events',4,'Event','green','Provider records load in the full feature — double-click to open it and refresh.');
      case 'asset-market':return navigateCubes('asset-market',4,'Asset','gold','Market records load in the full feature — double-click to open it and refresh.');
      default:return navigateCubes(featureId||'feature',3,'World','blue');
    }
  }catch{
    return placeholderCubes(featureId||'feature',3);
  }
}

/** Real domain access, built defensively — any failure leaves that slot empty
 * so the adapter falls back to placeholder cubes (fails closed). */
function createDefaultDomains(){
  const domains={};
  try{domains.wardrobe=createWardrobeAtelier({seed:'local-wardrobe'});}catch{}
  try{domains.arenaModes=ARENA_GAME_MODES;}catch{}
  try{domains.contracts=createContractAtelier({seed:'local-contracts'});}catch{}
  try{domains.lessons=ACADEMY_LESSONS;}catch{}
  try{domains.districts=CONNECTED_CITY_DISTRICTS;}catch{}
  return domains;
}

const ACCENT_COLORS={blue:'#5dafff',gold:'#d0a03c',violet:'#8e6ccb',green:'#3fa97e',red:'#f02644'};

export function createFeatureWorlds({THREE,renderer,scene,camera,controls,onNavigate,onFrame,reducedMotion=false,features=[],domains,onEnter,onExit}={}){
  const dom=domains??createDefaultDomains();
  const machine=createTravelMachine();
  const featureMap=new Map(features.map(feature=>[feature.id,feature]));
  const C=FEATURE_WORLD_CONSTANTS;

  // --- Tiny shared glass recipe: the canon glass-style.js builders.
  // Packet 240 named deliberate deviation: the 233-local glass()/edgeMaterial()
  // are replaced by the canon builders. Node-verified: makeGlassCubeMaterial
  // emits the identical params the local glass() did; edgeMaterial now uses
  // the canon glassEdgeMaterialParams (adds depthWrite:false — the 233 local
  // omitted it; the canon recipe is the standard, killing recipe drift).
  const geometries=new Set(),materials=new Set();
  const track=(value,set)=>{set.add(value);return value;};
  const unit=track(new THREE.BoxGeometry(1,1,1),geometries);
  const glass=(tint='#153954',opacity=C.maxGlassOpacity)=>{
    const material=track(makeGlassCubeMaterial(THREE,tint,{opacity}),materials);
    return material;
  };
  const edgeMaterial=color=>track(new THREE.LineBasicMaterial(glassEdgeMaterialParams({color})),materials);
  const accentMaterial=hex=>track(new THREE.MeshStandardMaterial({color:hex,emissive:hex,emissiveIntensity:1.2}),materials);
  const edgeBox=(size,color)=>{
    const geo=track(new THREE.BoxGeometry(size,size,size),geometries);
    const edges=new THREE.LineSegments(track(new THREE.EdgesGeometry(geo),geometries),edgeMaterial(color));
    return edges;
  };
  const disposeObject=object=>{
    if(object.geometry&&object.geometry!==unit&&object.geometry!==starGeometry){geometries.delete(object.geometry);object.geometry.dispose();}
    const mats=Array.isArray(object.material)?object.material:[object.material];
    for(const mat of mats){if(mat&&mat!==starMaterial){materials.delete(mat);mat.dispose?.();}}
  };

  const layer=new THREE.Group();layer.name='Feature Worlds';layer.visible=false;scene.add(layer);
  // Bounded starfield — deterministic, no live catalogue.
  const starPoints=[];
  for(let i=0;i<220;i++){const a=i*2.399963,b=((i*37)%181)/180*Math.PI,r=26+(i%5);starPoints.push(Math.cos(a)*Math.sin(b)*r,Math.cos(b)*r,Math.sin(a)*Math.sin(b)*r);}
  const starGeometry=track(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(starPoints,3)),geometries);
  const starMaterial=track(new THREE.PointsMaterial({color:'#92adc7',size:.06,transparent:true,opacity:.7,sizeAttenuation:true}),materials);
  layer.add(new THREE.Points(starGeometry,starMaterial));
  layer.add(new THREE.HemisphereLight('#a8cfff','#08101a',1.1));
  const warm=new THREE.DirectionalLight('#fce2b6',2.2);warm.position.set(-6,12,9);layer.add(warm);

  // --- DOM overlay: breadcrumb, title, info, projected labels ---
  const styleEl=document.createElement('style');
  styleEl.textContent=`
    .feature-world{position:fixed;inset:0;pointer-events:none;z-index:200;font-family:inherit;}
    /* z-200: above the Reality Assembly UI (its root stacking context is
       z-105) so the back button, title and projected labels are never
       occluded or unclickable; below the story drawer (z-900) and the
       dive chips (z-1200), which stay usable above the world. The root is
       pointer-events:none so assembly controls still receive clicks. */
    .feature-world [data-back]{position:absolute;top:112px;left:14px;pointer-events:auto;background:rgba(10,26,40,.72);border:1px solid rgba(125,212,255,.5);color:#cfe9ff;border-radius:10px;padding:9px 14px;font-size:14px;cursor:pointer;backdrop-filter:blur(6px);}
    /* top:112px (not 14px): the assembly header (z-105) and the draggable
       city-journey panel (z-9000) both occupy the top-left corner of the
       shared viewport; the back button sits below them so it stays
       clickable by mouse and touch. */
    .feature-world [data-back]:hover{background:rgba(20,50,80,.85);}
    .feature-world [data-world-title]{position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;color:#eaf6ff;text-shadow:0 1px 8px #000;pointer-events:none;}
    .feature-world [data-world-title] h2{margin:0;font-size:20px;font-weight:600;}
    .feature-world [data-world-title] p{margin:2px 0 0;font-size:12px;opacity:.75;max-width:52ch;}
    .feature-world [data-world-info]{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);max-width:min(92vw,560px);text-align:center;color:#d8ecff;background:rgba(8,20,32,.66);border:1px solid rgba(125,212,255,.3);border-radius:10px;padding:8px 14px;font-size:13px;pointer-events:none;}
    .feature-world [data-world-hint]{position:absolute;left:50%;bottom:64px;transform:translateX(-50%);color:#9fc4e8;font-size:12px;pointer-events:none;text-shadow:0 1px 6px #000;}
    .feature-world-label{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;background:rgba(8,20,32,.62);border:1px solid rgba(125,212,255,.35);color:#d8ecff;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;white-space:nowrap;backdrop-filter:blur(4px);}
    .feature-world-label.is-selected{border-color:#ffd479;color:#fff;}
    .feature-world-label.is-hovered{border-color:#7fd4ff;}
  `;
  document.head.append(styleEl);
  const root=document.createElement('section');root.className='feature-world';root.hidden=true;root.setAttribute('aria-label','Feature block world');
  root.innerHTML=`<button type="button" data-back>← Reality Lens</button>
    <div data-world-title><h2></h2><p></p></div>
    <div data-world-hint>Hover to peek · click to select · double-click to use</div>
    <div data-world-info></div>
    <div data-world-labels></div>`;
  document.body.append(root);
  const backButton=root.querySelector('[data-back]');
  const titleEl=root.querySelector('[data-world-title] h2'),subtitleEl=root.querySelector('[data-world-title] p');
  const infoEl=root.querySelector('[data-world-info]'),labelsEl=root.querySelector('[data-world-labels]');
  backButton.onclick=()=>exit();

  // --- World content ---
  let cubeNodes=[],connectionLines=null,hubMesh=null,tween=null,currentFeatureId=null;
  let hoveredId=null,selectedId=null;
  const ray=new THREE.Raycaster(),point=new THREE.Vector2(),screenPoint=new THREE.Vector3();
  const raycastMeshes=()=>cubeNodes.map(node=>node.mesh);
  const locate=event=>{
    const rect=renderer.domElement.getBoundingClientRect();
    point.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    ray.setFromCamera(point,camera);
    const hit=ray.intersectObjects(raycastMeshes(),false)[0];
    return hit?hit.object.userData.worldCubeId:null;
  };
  const nodeById=id=>cubeNodes.find(node=>node.cube.id===id);
  const say=message=>{infoEl.textContent=message;};

  function buildWorld(featureId,content){
    clearWorld();
    const feature=featureMap.get(featureId);
    titleEl.textContent=feature?.label??featureId;
    subtitleEl.textContent=feature?.description??'Its own block system, in the same glass language.';
    const glassMat=glass(),hubGlass=glass('#1b4d6e');
    // Central hub cube for this feature's world.
    hubMesh=new THREE.Mesh(unit,hubGlass);hubMesh.scale.setScalar(C.cubeSize*1.5);hubMesh.position.set(0,2,0);layer.add(hubMesh);
    const hubEdges=edgeBox(C.cubeSize*1.5,'#7fd4ff');
    hubEdges.position.copy(hubMesh.position);layer.add(hubEdges);cubeNodes.push({hub:true,edges:hubEdges});
    content.forEach((cubeDef,index)=>{
      const ring=Math.floor(index/C.cubesPerRing),inRing=index%C.cubesPerRing;
      const perRing=Math.min(C.cubesPerRing,content.length-ring*C.cubesPerRing);
      const angle=(inRing/perRing)*Math.PI*2-Math.PI/2;
      const radius=C.ringRadius+ring*C.ringStep;
      const accent=ACCENT_COLORS[cubeDef.accent]??ACCENT_COLORS.blue;
      const mesh=new THREE.Mesh(unit,glass(accent,C.maxGlassOpacity*.94));
      mesh.scale.setScalar(C.cubeSize);
      const baseY=2+ring*.6;
      mesh.position.set(Math.cos(angle)*radius,baseY,Math.sin(angle)*radius*.8);
      mesh.userData.worldCubeId=cubeDef.id;
      layer.add(mesh);
      const edges=edgeBox(C.cubeSize,accent);
      edges.position.copy(mesh.position);layer.add(edges);
      const beacon=new THREE.Mesh(unit,accentMaterial(accent));beacon.scale.setScalar(.14);beacon.position.set(mesh.position.x,baseY+C.cubeSize*.8,mesh.position.z);layer.add(beacon);
      const label=document.createElement('button');label.type='button';label.className='feature-world-label';label.textContent=cubeDef.label;
      // Projected labels are plain HTML buttons — ondblclick doesn't fire on
      // mobile, so the shared 350ms/28px detector disambiguates here. Single
      // tap selects immediately; double-tap selects + performs (enters/uses).
      const labelTap=createDoubleTapDetector({
        onSingleTap:()=>selectCube(cubeDef.id),
        onDoubleTap:()=>{const node=nodeById(cubeDef.id);selectCube(cubeDef.id);if(node)performCubeAction(node.cube.action,node.cube);},
      });
      label.addEventListener('click',event=>labelTap.tap(cubeDef.id,event));
      label.onpointerenter=()=>{hoveredId=cubeDef.id;refreshLabels();say(`${cubeDef.label} — ${cubeDef.summary||'double-click to use'}`);};
      label.onpointerleave=()=>{hoveredId=null;refreshLabels();};
      labelsEl.append(label);
      cubeNodes.push({cube:cubeDef,mesh,edges,beacon,label,baseY,phase:index*.7});
    });
    // Connection lines: hub to every content cube.
    const positions=new Float32Array(cubeNodes.filter(node=>!node.hub).length*6);
    const connectionGeometry=track(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3)),geometries);
    connectionLines=new THREE.LineSegments(connectionGeometry,track(new THREE.LineBasicMaterial({color:'#36a6d3',transparent:true,opacity:.34}),materials));
    connectionLines.frustumCulled=false;layer.add(connectionLines);
    refreshLabels();
    say(`${content.length} ${content.length===1?'cube':'cubes'} in this world — hover to peek, double-click a cube to use it.`);
  }

  function clearWorld(){
    for(const label of labelsEl.querySelectorAll('.feature-world-label'))label.remove();
    cubeNodes=[];connectionLines=null;hubMesh=null;hoveredId=null;selectedId=null;
    for(let i=layer.children.length-1;i>=0;i--){
      const child=layer.children[i];
      if(child.isPoints||child.isLight)continue;
      layer.remove(child);
      disposeObject(child);
    }
  }

  function selectCube(id){
    selectedId=id;
    const node=nodeById(id);
    refreshLabels();
    if(node)say(`${node.cube.label} — ${node.cube.summary||'double-click to use'}`);
  }

  function refreshLabels(){
    for(const node of cubeNodes){
      if(node.hub||!node.label)continue;
      node.label.classList.toggle('is-selected',node.cube.id===selectedId);
      node.label.classList.toggle('is-hovered',node.cube.id===hoveredId);
    }
  }

  /** Double-click performs the cube's action. */
  function performCubeAction(action,cubeDef){
    if(!action||!cubeDef)return;
    switch(action.kind){
      case 'world-chess-open':{
        say(`${cubeDef.label} — opening World Chess…`);
        if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('world-chess:open',{detail:{source:'feature-world',feature:currentFeatureId}}));
        break;
      }
      case 'navigate':{
        const target=action.feature||currentFeatureId;
        exit();
        if(typeof onNavigate==='function')onNavigate(target);
        break;
      }
      case 'wardrobe-equip':{
        try{
          const result=dom.wardrobe?.equipOutfit?.(action.outfitId);
          say(result?`${cubeDef.label} equipped.`:`Could not equip ${cubeDef.label} — the wardrobe refused it.`);
        }catch(error){
          say('The wardrobe is unavailable right now — nothing was changed.');
        }
        break;
      }
      default:
        say(cubeDef.summary||cubeDef.label);
    }
  }

  const easeInOut=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
  const ENTRY_POS=new THREE.Vector3(...C.entryCamera),ENTRY_TGT=new THREE.Vector3(...C.entryTarget);

  function enter(featureId){
    if(!THREE||!machine.enter(featureId))return false;
    // studio<->world visibility invariant (Packet 240): entering a feature
    // world closes the studio if it is open. The studio restores its own
    // camera on close; the travel tween below then starts from that pose.
    try{if(typeof window!=='undefined'&&window.__TUMBO_PERSON_STUDIO__?.active)window.__TUMBO_PERSON_STUDIO__.close();}catch{}
    currentFeatureId=featureId;
    const content=adaptFeatureContent(featureId,dom);
    layer.visible=true;root.hidden=false;
    buildWorld(featureId,content);
    tween={from:camera.position.clone(),fromTarget:controls.target.clone(),t:reducedMotion?Infinity:0};
    controls.enabled=false;
    if(reducedMotion){camera.position.copy(ENTRY_POS);controls.target.copy(ENTRY_TGT);tween=null;controls.enabled=true;machine.arrived();onFrame?.();}
    onEnter?.(featureId);
    return true;
  }

  function exit(){
    if(!machine.exit())return false;
    controls.enabled=true;
    tween=null;
    layer.visible=false;root.hidden=true;
    clearWorld();
    currentFeatureId=null;
    machine.returned();
    onExit?.();
    return true;
  }

  function update(dt,time){
    const snapshot=machine.getSnapshot();
    if(!snapshot.active)return;
    if(tween){
      tween.t+=dt/C.tweenSeconds;
      const k=easeInOut(Math.min(1,Math.max(0,tween.t)));
      camera.position.lerpVectors(tween.from,ENTRY_POS,k);
      controls.target.lerpVectors(tween.fromTarget,ENTRY_TGT,k);
      camera.lookAt(controls.target);
      if(tween.t>=1){tween=null;controls.enabled=true;machine.arrived();onFrame?.();}
    }
    if(!reducedMotion){
      for(const node of cubeNodes){
        if(node.hub)continue;
        node.mesh.position.y=node.baseY+Math.sin(time*.6+node.phase)*.07;
        node.mesh.rotation.y=Math.sin(time*.18+node.phase)*.05;
        node.edges.position.copy(node.mesh.position);
        node.beacon.position.y=node.mesh.position.y+C.cubeSize*.8;
      }
      if(hubMesh)hubMesh.rotation.y=Math.sin(time*.15)*.06;
    }
    // Project content labels; hide labels behind the camera or off-screen.
    for(const node of cubeNodes){
      if(node.hub||!node.label)continue;
      screenPoint.copy(node.mesh.position);screenPoint.y-=C.cubeSize*.95;screenPoint.project(camera);
      if(screenPoint.z<=-1||screenPoint.z>=1||Math.abs(screenPoint.x)>1||Math.abs(screenPoint.y)>.92){node.label.hidden=true;continue;}
      node.label.hidden=false;
      node.label.style.left=`${(screenPoint.x*.5+.5)*innerWidth}px`;
      node.label.style.top=`${(-screenPoint.y*.5+.5)*innerHeight}px`;
    }
    // Refresh hub-to-cube connection lines.
    if(connectionLines){
      const buffer=connectionLines.geometry.attributes.position;
      let i=0;
      for(const node of cubeNodes){
        if(node.hub||!hubMesh)continue;
        buffer.setXYZ(i*2,hubMesh.position.x,hubMesh.position.y,hubMesh.position.z);
        buffer.setXYZ(i*2+1,node.mesh.position.x,node.mesh.position.y,node.mesh.position.z);
        i++;
      }
      buffer.needsUpdate=true;
    }
    controls.update?.();
    camera.updateMatrixWorld();
  }

  function getSnapshot(){
    return {...machine.getSnapshot(),featureId:currentFeatureId,cubeCount:cubeNodes.filter(node=>!node.hub).length,selectedId,geometryOnly:true,referenceImagesUsedAsTextures:false};
  }

  function destroy(){
    if(machine.getSnapshot().active)exit();
    geometries.forEach(geometry=>geometry.dispose());
    materials.forEach(material=>material.dispose());
    layer.removeFromParent();
    styleEl.remove();root.remove();
    canvas?.removeEventListener('pointermove',hover);
    canvas?.removeEventListener('pointerdown',press);
    canvas?.removeEventListener('pointerup',tap);
  }

  const hover=event=>{
    if(!machine.getSnapshot().active)return;
    const id=locate(event);
    if(id!==hoveredId){
      hoveredId=id;refreshLabels();
      const node=id?nodeById(id):null;
      say(node?`${node.cube.label} — ${node.cube.summary||'double-click to use'}`:'Hover to peek · click to select · double-click to use');
    }
  };
  const press=event=>{
    if(!machine.getSnapshot().active||event.button!==0)return;
    const id=locate(event);
    if(id)selectCube(id);
  };
  // Canvas tap disambiguation via the shared detector for ALL pointer types
  // (dive-path parity): press (pointerdown) selects immediately; a qualifying
  // second tap performs the cube's action. No native dblclick on this canvas,
  // so mouse and touch share one click path and can never double-fire.
  const canvasTap=createDoubleTapDetector({
    onSingleTap:()=>{},
    onDoubleTap:event=>{
      if(!machine.getSnapshot().active)return;
      const id=locate(event);
      if(!id)return;
      const node=nodeById(id);
      selectCube(id);
      if(node)performCubeAction(node.cube.action,node.cube);
    },
  });
  const tap=event=>{
    if(!machine.getSnapshot().active)return;
    canvasTap.tap(locate(event)??'',event);
  };
  const canvas=renderer?.domElement;
  canvas?.addEventListener('pointermove',hover);
  canvas?.addEventListener('pointerdown',press);
  canvas?.addEventListener('pointerup',tap);

  const api={enter,exit,update,getSnapshot,destroy};
  if(typeof window!=='undefined')window.__TUMBO_FEATURE_WORLDS__=api;
  return api;
}
