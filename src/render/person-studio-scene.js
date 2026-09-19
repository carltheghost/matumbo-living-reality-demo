import {STUDIO_MODEL,STUDIO_OUTFITS,STUDIO_ROOMS} from '../domains/person-studio.js';
import {resolveFaceDecalUrl} from '../domains/avatar-style.js';
import {AVATAR_GREET} from '../domains/avatar-motion.js';
import {updateTumboChibiRig} from './tumbo-chibi-rig.js';
import {buildTumboFluffyRig} from './tumbo-fluffy-rig.js?v=20260919-fluffy-tumbo';

/** PERSON Ω avatar: the fluffy Tumbo mascot IS the avatar.
 *
 * The user compared the smooth-shaded chibi rig against their canonical
 * fluffy Tumbo reference and rejected it — "do they look the same? no."
 * This scene now mounts the dedicated fluffy rig
 * (src/render/tumbo-fluffy-rig.js): a plush-brown fur-shell body, cream
 * face patch, bead eyes, tiny :3 mouth, grey over-ear headphones, and
 * black locs poking out around them — the mascot from their reference,
 * not an approximation.
 *
 * The joint hierarchy and names are identical to the chibi rig, so the
 * shared updateTumboChibiRig() drives every animation unchanged. All
 * Packet 227 interactions are preserved — click cycles wave → spin →
 * jump, drag moves the avatar with a walk cycle, reduced motion freezes
 * to a gentle wave. Wardrobe tints the headphone cushions (white/teal).
 * The lens-space set (rings, glow, city, sofa, desk, wardrobe displays,
 * Luna) is unchanged; only the avatar body is replaced. */
export function buildPersonStudioScene({THREE,parent,targets=[],compact=false,avatarTextureUrl='assets/avatar/fluffy-body-template.webp'}) {
  const layer=new THREE.Group();layer.name='PERSON Ω / open lens space';parent.add(layer);layer.visible=false;
  const materials=new Set(),geometries=new Set(),selectable=[];
  const material=(color,metalness=.2,roughness=.5,extra={})=>{const m=new THREE.MeshStandardMaterial({color,metalness,roughness,...extra});materials.add(m);return m;};
  const gold=material('#caa766',.85,.28),dark=material('#0d141e',.65,.26),blue=material('#12243c',.5,.35);
  const seam=material('#e7c784',.55,.35,{emissive:'#bb8140',emissiveIntensity:.25});
  const light=material('#82c9ff',.1,.4,{emissive:'#63a9fa',emissiveIntensity:1.3});
  const mesh=(geometry,mat,position=[0,0,0],scale=[1,1,1],owner=layer)=>{
    geometries.add(geometry);const m=new THREE.Mesh(geometry,mat);m.position.set(...position);m.scale.set(...scale);owner.add(m);return m;
  };
  const box=(w,h,d,mat,pos,owner=layer)=>mesh(new THREE.BoxGeometry(w,h,d),mat,pos,[1,1,1],owner);
  // Identity geometry is identical across device sizes. Only environmental
  // rendering quality (such as shadow resolution) may change with the viewport.
  const sphere=(mat,pos,scale,owner=layer)=>mesh(new THREE.SphereGeometry(1,24,18),mat,pos,scale,owner);
  const group=(name,pos=[0,0,0],owner=layer)=>{const g=new THREE.Group();g.name=name;g.position.set(...pos);owner.add(g);return g;};
  function target(object,action){object.userData.personStudioAction=action;targets.push(object);selectable.push(object);}
  function frame(w,h,d,mat,pos,owner=layer,thickness=.025){
    const g=group('Architectural cube frame',pos,owner);
    for(const x of [-w/2,w/2])for(const z of [-d/2,d/2])box(thickness,h,thickness,mat,[x,0,z],g);
    for(const y of [-h/2,h/2])for(const z of [-d/2,d/2])box(w,thickness,thickness,mat,[0,y,z],g);
    for(const x of [-w/2,w/2])for(const y of [-h/2,h/2])box(thickness,thickness,d,mat,[x,y,0],g);
    return g;
  }

  // Floorless lens space: no ground plane, no grid inlays, nothing to stand on.
  // The avatar and the floating set pieces hang in open Reality Lens space;
  // lens energy (the glow sprite and hologram rings) grounds them instead.
  const roomLight=new THREE.HemisphereLight('#a9c7fa','#483128',1.6);layer.add(roomLight);
  const key=new THREE.DirectionalLight('#ffe4bd',2.2);key.position.set(-3,6,6);layer.add(key);
  // Lens space has no ground to receive shadows, so shadow casting is disabled;
  // the glow sprite under the avatar carries the grounding read instead.
  key.castShadow=false;
  const rim=new THREE.DirectionalLight('#659fff',2.4);rim.position.set(4,4,-5);layer.add(rim);
  for(const x of [-7.5,-4.7,4.7,7.5]){
    box(.18,7,.32,dark,[x,3.5,-5]);box(.035,6.8,.34,seam,[x+.12,3.45,-5]);
    box(.12,.13,12,gold,[x,6,-.4]);box(.025,.045,11,light,[x+.15,5.96,-.4]);
  }
  for(const y of [0,3.4,6.1]){box(18,.11,.25,gold,[0,y,-6]);box(18,.035,.28,light,[0,y-.12,-6]);}
  const skyMat=material('#071e3e',0,1,{emissive:'#071e3e',emissiveIntensity:.7,side:THREE.DoubleSide});
  box(44,15,.05,skyMat,[0,5,-18]);
  const skyline=group('Designed city horizon',[0,0,-15]);
  const cityBatches=[[],[],[]];
  for(let i=0;i<36;i++){
    const x=(i-17.5)*.82,h=1.6+((i*19)%17)*.26,w=.3+(i%3)*.15;
    cityBatches[0].push([w,h,w,x,h/2,Math.sin(i)*.8]);
    cityBatches[1].push([.035,h+.4,.035,x,h/2+.2,Math.sin(i)*.8]);
    for(let y=.3;y<h;y+=.42)cityBatches[2].push([w*.65,.025,.015,x,y,Math.sin(i)*.8+w/2+.01]);
  }
  cityBatches.forEach((items,index)=>{
    const geometry=new THREE.BoxGeometry(1,1,1);geometries.add(geometry);
    const batch=new THREE.InstancedMesh(geometry,[blue,seam,light][index],items.length),transform=new THREE.Object3D();
    items.forEach(([w,h,d,x,y,z],i)=>{transform.position.set(x,y,z);transform.scale.set(w,h,d);transform.updateMatrix();batch.setMatrixAt(i,transform.matrix);});
    batch.instanceMatrix.needsUpdate=true;skyline.add(batch);
  });
  // Floating hologram lens-ring replaces the old inlaid plinth: glowing rings,
  // no flat surface. A soft radial glow sprite reads as lens energy, not a floor.
  const lensRing=group('Hologram lens-ring',[0,.46,0]);
  const ringBlue=material('#7fc4ff',.1,.35,{emissive:'#5fb0ff',emissiveIntensity:1.7,transparent:true,opacity:.92});
  const ringGold=material('#e7c784',.1,.35,{emissive:'#caa766',emissiveIntensity:1.25,transparent:true,opacity:.88});
  const ringOuter=mesh(new THREE.TorusGeometry(1.34,.032,12,96),ringBlue,[0,0,0],[1,1,1],lensRing);ringOuter.rotation.x=Math.PI/2;
  const ringInner=mesh(new THREE.TorusGeometry(1.04,.02,10,80),ringGold,[0,.03,0],[1,1,1],lensRing);ringInner.rotation.x=Math.PI/2;
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3;sphere(ringGold,[Math.cos(a)*1.34,0,Math.sin(a)*1.34],[.055,.055,.055],lensRing);}
  // Procedural radial gradient (no canvas/DOM needed, so node tests work too).
  const glowTexture=(()=>{const size=128,data=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const dx=x/(size-1)*2-1,dy=y/(size-1)*2-1,d=Math.min(1,Math.hypot(dx,dy)),fall=Math.pow(1-d,2.4),i=(y*size+x)*4;
      data[i]=126;data[i+1]=184;data[i+2]=255;data[i+3]=Math.round(fall*255);}
    const tex=new THREE.DataTexture(data,size,size);tex.needsUpdate=true;return tex;})();
  geometries.add(glowTexture);
  const glowMaterial=new THREE.SpriteMaterial({map:glowTexture,transparent:true,opacity:.5,depthWrite:false,blending:THREE.AdditiveBlending});materials.add(glowMaterial);
  const glow=new THREE.Sprite(glowMaterial);glow.name='Lens energy glow';glow.position.set(0,.30,0);glow.scale.set(3.6,3.6,1);layer.add(glow);
  // The identity plate now floats at the front of the lens-ring, keeping its tab target.
  const idPlate=box(.72,.16,.025,dark,[0,.32,1.02]);idPlate.rotation.x=-.12;target(idPlate,{kind:'tab',id:'identity'});
  for(const x of [-.36,.36]){const tick=box(.018,.1,.012,seam,[x,.32,1.038]);tick.rotation.x=-.12;}

  const sofa=group('Personal room / seating',[-3.5,.08,-2.5]);
  box(2.25,.35,.82,dark,[0,.22,0],sofa);box(2.25,.6,.16,blue,[0,.69,-.35],sofa);
  for(const x of [-1.04,1.04]){box(.18,.65,.9,dark,[x,.42,0],sofa);box(.02,.68,.92,gold,[x+.11,.43,0],sofa);}
  for(const x of [-.63,0,.63])box(.59,.15,.66,blue,[x,.45,.07],sofa);
  // Hologram ring under the floating sofa: lens language, no floor.
  const sofaRing=mesh(new THREE.TorusGeometry(1.05,.022,10,72),ringBlue,[0,-.06,0],[1,1,1],sofa);sofaRing.rotation.x=Math.PI/2;
  const desk=group('Personal room / console',[-3,.65,.5]);box(1.3,.07,.8,dark,[0,0,0],desk);frame(1.32,.07,.82,gold,[0,0,0],desk);
  for(const x of [-.5,.5])box(.04,.65,.5,gold,[x,-.34,0],desk);
  const deskScreen=box(.6,.4,.04,blue,[0,.22,-.15],desk);deskScreen.rotation.x=-.2;target(deskScreen,{kind:'tab',id:'room'});
  // Hologram ring under the floating console, matching the sofa's lens language.
  const deskRing=mesh(new THREE.TorusGeometry(.78,.02,10,64),ringGold,[0,-.42,0],[1,1,1],desk);deskRing.rotation.x=Math.PI/2;

  // Clothing display objects are clickable, connected to the same wardrobe owner.
  const garmentDisplays=[];
  for(let i=0;i<3;i++){
    const item=STUDIO_OUTFITS[i],g=group(`Wardrobe display / ${item.name}`,[2.5+i*.78,1.8,-3.25]);
    frame(.65,1.45,.42,gold,[0,0,0],g,.018);
    const cloth=material(item.color,.25,.5);
    const garment=box(.33,.75,.13,cloth,[0,-.05,0],g);
    box(.045,.74,.025,seam,[.105,-.05,.09],g);box(.045,.74,.025,seam,[-.105,-.05,.09],g);
    for(const side of [-1,1]){const sleeve=box(.12,.56,.13,cloth,[side*.23,.02,0],g);sleeve.rotation.z=side*.16;target(sleeve,{kind:'outfit',id:item.id});}
    target(garment,{kind:'outfit',id:item.id});garmentDisplays.push(g);
    // Earmuff swatch: the outfit's muff tint reads on the display frame.
    sphere(material(item.muffs??'#f5f2ea',.02,1),[.24,.62,0],[.07,.07,.07],g);
    // Each wardrobe display hangs in lens space with its own hologram ring.
    const displayRing=mesh(new THREE.TorusGeometry(.45,.016,8,56),ringBlue,[0,-.86,0],[1,1,1],g);displayRing.rotation.x=Math.PI/2;
  }

  // ---- The avatar: the fluffy Tumbo mascot rig ----
  // Fur-shell plush body built by the fluffy rig module — the mascot from
  // the user's reference, not the smooth-shaded chibi. Wardrobe tints the
  // headphone cushions live through the rig's material handle; the fur
  // stays canon brown. The personal portrait decal still mounts on the
  // forehead when one is saved locally.
  const avatar=group('Reference-built avatar',[0,.55,0]);
  const FLUFFY_STUDIO_SCALE=1.35;
  const safeStorage=()=>{try{return globalThis.localStorage??null;}catch{return null;}};
  let rig=null,rigDecalMats=[];
  function mountRig(){
    rigDecalMats=[];
    const built=buildTumboFluffyRig(THREE,{
      seed:0,
      muffColor:STUDIO_OUTFITS[0].muffs??'#5f646c',
      faceDecalUrl:resolveFaceDecalUrl(safeStorage()),
      decalRegistry:rigDecalMats,
    });
    built.group.scale.setScalar(FLUFFY_STUDIO_SCALE);
    avatar.add(built.group);
    built.group.traverse(object=>{if(object.isMesh){object.castShadow=false;object.receiveShadow=false;}});
    return built;
  }
  rig=mountRig();
  // Every rig mesh is clickable for greet/drag (Packet 227): the wrapper
  // raycasts this list, so clicks and drags land on the avatar itself.
  const avatarPickMeshes=[];
  function collectPickMeshes(){
    avatarPickMeshes.length=0;
    rig.group.traverse(object=>{if(object.isMesh)avatarPickMeshes.push(object);});
  }
  collectPickMeshes();
  // A soft presence light travels with the avatar so the rig reads as the
  // hero of the lens space against the darker set pieces.
  const presenceLight=new THREE.PointLight('#9fd8ff',14,10,1.8);
  presenceLight.position.set(0,3.2,1.6);avatar.add(presenceLight);
  // Everything structural floats: the avatar, the lens-ring and the set
  // pieces bob gently in lens space (frozen under reduced motion). The
  // avatar's own bob/sway/glow/walk follow the fluffy rig update; the
  // set pieces keep their per-piece floaters.
  const floaters=[{obj:lensRing,base:.46,amp:.06,speed:1.05,phase:0}];
  floaters.push({obj:sofa,base:.08,amp:.05,speed:.8,phase:1.2},{obj:desk,base:.65,amp:.045,speed:.9,phase:2.4});
  garmentDisplays.forEach((g,i)=>floaters.push({obj:g,base:1.8,amp:.05,speed:1.0,phase:2.9+i*.7}));
  // Freeze a geometry fingerprint in the bind pose, before clothes or motion
  // change. UUIDs, device quality, timestamps and transient poses are excluded.
  // Taken once from the initial mount: a face-decal refresh adds only a
  // portrait texture, never new identity geometry.
  const identityGeometry=[];
  rig.group.traverse(object=>{
    const entry={name:object.name,position:object.position.toArray(),quaternion:object.quaternion.toArray(),scale:object.scale.toArray()};
    if(object.geometry){entry.vertices=Array.from(object.geometry.attributes.position.array);entry.indices=object.geometry.index?Array.from(object.geometry.index.array):null;}
    identityGeometry.push(entry);
  });
  const identityBytes=new TextEncoder().encode(JSON.stringify({model:STUDIO_MODEL,geometry:identityGeometry}));
  let identityDigest=null;
  async function fingerprint(cryptoRoot=globalThis.crypto){
    if(!identityDigest)identityDigest=cryptoRoot.subtle.digest('SHA-256',identityBytes).then(bytes=>[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join(''));
    return identityDigest;
  }

  // Stable companion entity; forms are presentation only, no AI connection is implied.
  const companion=group('Luna / local companion',[1.18,2.78,.38]);
  const companionBody=sphere(dark,[0,0,0],[.17,.15,.12],companion);
  target(companionBody,{kind:'tab',id:'companion'});
  const rimFrame=frame(.36,.31,.27,gold,[0,0,0],companion,.014);
  const wings=[];
  for(const side of [-1,1]){
    sphere(light,[side*.063,.024,.114],[.029,.042,.012],companion);
    const wing=box(.18,.08,.035,gold,[side*.24,.035,0],companion);wing.rotation.z=side*.55;wings.push(wing);
  }
  const companionTail=mesh(new THREE.ConeGeometry(.085,.14,4),seam,[0,-.22,0],[1,1,.4],companion);companionTail.rotation.z=Math.PI;
  const moon=sphere(material('#1b3860',.2,.7,{emissive:'#142a4d',emissiveIntensity:.6}),[-6,4.8,-13],[2.5,2.5,2.5]);

  let room='city',form='drone',outfit='obsidian';
  let muffColor=STUDIO_OUTFITS[0].muffs??'#f5f2ea';
  function apply(snapshot){
    const clothing=STUDIO_OUTFITS.find(v=>v.id===snapshot.outfitId)??STUDIO_OUTFITS[0];
    const theme=STUDIO_ROOMS.find(v=>v.id===snapshot.roomId)??STUDIO_ROOMS[0];
    outfit=clothing.id;room=theme.id;form=snapshot.companion;
    // Wardrobe tints the fluffy rig's headphone cushions live: grey default,
    // white/teal options. The fur stays canon brown — the mascot wears no
    // hoodie in the reference.
    muffColor=clothing.muffs??'#5f646c';rig.materials.cushion.color.set(muffColor);
    light.color.set(theme.light);light.emissive.set(theme.light);
    skyMat.color.set(theme.sky);skyMat.emissive.set(theme.sky);rim.color.set(theme.light);
    skyline.visible=room!=='ocean';moon.visible=room==='night';
    companionBody.scale.set(form==='spark' ? .10 : .17,form==='bird' ? .18 : .15,.12);
    rimFrame.visible=form==='drone';wings.forEach(w=>w.visible=form!=='spark');companionTail.visible=form!=='drone';
  }
  // Greet reactions (Packet 227): each greet() call starts the next reaction
  // in the AVATAR_GREET cycle — wave, spin, jump. The rig plays them as its
  // wave / spin / hop modes.
  let greetState=null,greetIndex=0;
  function greet(){
    const kind=AVATAR_GREET.order[greetIndex%AVATAR_GREET.order.length];greetIndex++;
    greetState={kind,t:0};
    return kind;
  }
  function getGreetKind(){return greetState?.kind??null;}
  // Drag-to-move (Packet 227): the wrapper sets a target offset on the lens
  // floor plane; update() eases the avatar toward it with the rig's walk
  // cycle and a smooth turn toward the travel direction. Clamped to the
  // personal space.
  const AVATAR_DRAG_RADIUS=3.4;
  const AVATAR_BASE_Y=.55;
  const avatarTarget={x:0,z:0},avatarCurrent={x:0,z:0};
  let heading=0;
  function setAvatarOffset(x,z){
    if(!Number.isFinite(x)||!Number.isFinite(z))return {x:avatarTarget.x,z:avatarTarget.z};
    const r=Math.hypot(x,z),k=r>AVATAR_DRAG_RADIUS?AVATAR_DRAG_RADIUS/r:1;
    avatarTarget.x=x*k;avatarTarget.z=z*k;
    return {x:avatarTarget.x,z:avatarTarget.z};
  }
  const poseQuat=(x,y,z,w)=>new THREE.Quaternion(x,y,z,w);
  function update(dt,time,pose={joints:{}},reducedMotion=false){
    if(!layer.visible)return;
    // Drag-to-move: ease toward the target, walk while travelling, turn to
    // face the travel direction, drift back to facing forward at rest.
    const dx=avatarTarget.x-avatarCurrent.x,dz=avatarTarget.z-avatarCurrent.z;
    const travel=Math.hypot(dx,dz);
    if(!reducedMotion&&travel>0.0005){
      const step=Math.min(1,dt*7);
      avatarCurrent.x+=dx*step;avatarCurrent.z+=dz*step;
    }else{avatarCurrent.x=avatarTarget.x;avatarCurrent.z=avatarTarget.z;}
    const moving=!reducedMotion&&travel>0.06;
    // Choose the rig's overlay mode: greet reaction > walk > idle.
    let mode='idle',modeT=0;
    if(greetState){
      // Reduced motion keeps the greeting to a gentle wave: no spin, no hop.
      const kind=reducedMotion?'wave':greetState.kind;
      greetState.t+=dt;
      modeT=greetState.t;mode=kind==='jump'?'hop':kind;
      const durations={wave:AVATAR_GREET.durations.wave,spin:AVATAR_GREET.durations.spin,jump:AVATAR_GREET.durations.jump};
      if(greetState.t>=durations[greetState.kind])greetState=null;
    }else if(moving){
      mode='walk';modeT=time;
    }
    const rigOut=updateTumboChibiRig(THREE,rig,{time,seed:0,reducedMotion,mode,modeT});
    // Presence-tab pose overrides: the identity-locked motion channel drives
    // the head yaw and the left arm raise, applied after the rig's reset.
    const poseJoints=pose.joints??{};
    if(poseJoints.head)rig.joints.head.quaternion.slerp(poseQuat(...poseJoints.head),Math.min(1,dt*12));
    if(poseJoints.leftArm)rig.joints.armLeft.quaternion.slerp(poseQuat(...poseJoints.leftArm),Math.min(1,dt*12));
    const turnTo=targetAngle=>{let d=targetAngle-heading;while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;return d;};
    heading+=turnTo(moving?Math.atan2(dx,dz):0)*Math.min(1,dt*(moving?6:2));
    avatar.position.set(avatarCurrent.x,AVATAR_BASE_Y+rigOut.bobY+rigOut.lift,avatarCurrent.z);
    // The spin reaction's turn comes back from the rig (a full 2π over the
    // mode duration), matching the old mannequin's spinAngle behavior.
    avatar.rotation.y=rigOut.swayY+heading+rigOut.turn;
    glow.material.opacity=rigOut.glow;
    if(reducedMotion){for(const f of floaters)f.obj.position.y=f.base;}
    else{for(const f of floaters)f.obj.position.y=f.base+Math.sin(time*f.speed+f.phase)*f.amp;
      lensRing.rotation.y+=dt*.22;ringInner.rotation.y-=dt*.31;}
    companion.position.y=2.78+(reducedMotion?0:Math.sin(time*1.8)*.075);
    companion.rotation.y=reducedMotion?0:Math.sin(time*.8)*.14;
    wings.forEach((wing,i)=>{wing.rotation.z=(i===0?-1:1)*(.55+(form==='bird'&&!reducedMotion?Math.sin(time*5)*.35:0));});
  }
  function getSnapshot(){return {source:'person-studio-scene',modelId:STUDIO_MODEL.id,visible:layer.visible,outfitId:outfit,roomId:room,companionForm:form,jointNames:Object.keys(rig.joints),meshCount:avatarPickMeshes.length+geometries.size,geometryOnly:false,referenceImagesUsedAsTextures:false,rigVisible:true,referenceLook:'tumbo-fluffy-v1',earmuffColor:muffColor,tumboDecalPresent:rig.hasFaceDecal,avatarHologramPresent:false,avatarHologramUrl:avatarTextureUrl,avatarHologramTint:avatarHologramTint,greetKind:getGreetKind(),avatarOffset:{x:avatarTarget.x,z:avatarTarget.z},avatarPickMeshCount:avatarPickMeshes.length};}
  // Face choice state: the user's chosen avatar face — default Tumbo
  // character, Tumbo's own likeness, or their locally-styled photo. The
  // personal portrait (choice 'your-photo' plus a saved portrait) is worn
  // as the chibi head's forehead decal; otherwise the geometric Tumbo face
  // is the whole read. Refreshing rebuilds the rig — the same pattern the
  // chess arena uses on appearance refresh — so the decal lands on the
  // shared rig without forking it. The identity fingerprint is unaffected:
  // a decal is a portrait texture, not identity geometry.
  function setAvatarFace(url){
    if(typeof url!=='string'||!url.length)return avatarTextureUrl;
    avatarTextureUrl=url;
    refreshRigFace();
    return avatarTextureUrl;
  }
  function refreshRigFace(){
    const old=rig,oldDecals=rigDecalMats;
    rig=mountRig();
    collectPickMeshes();
    old.group.removeFromParent();
    try{old.dispose?.();}catch{/* noop */}
    oldDecals.forEach(material=>{try{material.map?.dispose?.();}catch{}try{material.dispose?.();}catch{}});
  }
  let avatarHologramTint=null;
  // Muse Agent dressing: records the design tint for the avatar. The
  // hologram is retired so there is no hologram to tint; the value is kept
  // in the design record and snapshot.
  function setHologramTint(tint,opacity){
    avatarHologramTint=typeof tint==='string'&&tint?tint:null;
    return avatarHologramTint;
  }
  function destroy(){
    selectable.forEach(m=>{const i=targets.indexOf(m);if(i>=0)targets.splice(i,1);});
    geometries.forEach(g=>{try{g.dispose?.();}catch{}});
    materials.forEach(m=>{try{m.dispose?.();}catch{}});
    try{rig.dispose?.();}catch{/* fluffy rig owns its geometries/materials */}
    rigDecalMats.forEach(material=>{try{material.map?.dispose?.();}catch{}try{material.dispose?.();}catch{}});
    layer.removeFromParent();
  }
  return {layer,avatar,joints:rig.joints,apply,update,getSnapshot,destroy,fingerprint,avatarHologram:null,avatarPickMeshes,greet,getGreetKind,setAvatarOffset,setAvatarFace,setHologramTint,resolve:object=>object?.userData?.personStudioAction??null};
}
