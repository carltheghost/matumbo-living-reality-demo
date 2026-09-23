import {STUDIO_MODEL,STUDIO_OUTFITS,STUDIO_ROOMS} from '../domains/person-studio.js?v=20260922-cache2';
import {buildAgentSmithRig} from './agent-smith-rig.js?v=20260920-agent-smith';

/** AI-built likeness: Tumbo's approved avatar bust portrait (cinematic teal/violet
 *  rim light) drives the camera-facing hologram; the procedural rig stays as
 *  interaction targets. */
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
  const tube=(points,radius,mat,owner=layer)=>mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),18,radius,6,false),mat,[0,0,0],[1,1,1],owner);
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
    // Turn the plain rotating cubes into miniature floating fashion vitrines.
    const displayBack=box(.60,1.30,.045,dark,[0,.02,-.16],g);
    displayBack.material.emissive.set('#091827');
    frame(.65,1.45,.42,gold,[0,0,0],g,.018);
    const innerFrame=frame(.55,1.18,.05,seam,[0,.02,-.19],g,.012);
    const hangerRod=mesh(new THREE.CylinderGeometry(.012,.012,.42,12),gold,[0,.54,.03],[1,1,1],g);
    hangerRod.rotation.z=Math.PI/2;
    const hangerOrb=sphere(light,[-.25,.54,.03],[.028,.028,.028],g);
    const cloth=material(item.color,.35,.42,{emissive:item.color,emissiveIntensity:.08});
    const garment=box(.33,.75,.13,cloth,[0,-.05,.01],g);
    box(.045,.74,.025,seam,[.105,-.05,.09],g);box(.045,.74,.025,seam,[-.105,-.05,.09],g);
    // Shoulder details make each outfit read as an intentional garment, not a cube.
    for(const side of [-1,1]){const sleeve=box(.12,.56,.13,cloth,[side*.23,.02,.01],g);sleeve.rotation.z=side*.16;target(sleeve,{kind:'outfit',id:item.id});}
    const collar=mesh(new THREE.TorusGeometry(.075,.012,8,24),seam,[0,.31,.085],[1,1,1],g);collar.scale.set(.85,.7,1);collar.rotation.x=Math.PI/2;
    const centerBadge=sphere(ringGold,[0,-.34,.10],[.028,.028,.028],g);
    target(garment,{kind:'outfit',id:item.id});garmentDisplays.push(g);
    // Each wardrobe display has a floating nameplate, glow ring and orbiting light.
    const namePlate=box(.42,.12,.025,dark,[0,-.72,.04],g);
    const plateAccent=box(.24,.012,.032,light,[0,-.72,.058],g);
    const displayRing=mesh(new THREE.TorusGeometry(.45,.016,8,56),ringBlue,[0,-.86,0],[1,1,1],g);displayRing.rotation.x=Math.PI/2;
    const orbitLight=sphere(light,[.47,.12,.02],[.035,.035,.035],g);
    orbitLight.userData.orbitOffset=i*2.1;
    // Give each display a slightly different presentation angle while preserving
    // the click targets on the garment.
    g.rotation.y=(i-1)*.16;
  }

  // ---- Agent Smith: the in-world avatar character ----
  // Procedural Pixar-style build (agent-smith-rig.js) from the approved
  // reference: warm brown skin, short black hair, warm smile, brown suit,
  // tan shirt, brown tie. The rig stays fully visible — the old hologram
  // sprite is retired, so what you see is the character himself, floating.
  const avatar=group('Agent Smith',[0,.55,0]);
  const smith=buildAgentSmithRig(THREE,{seed:7});
  avatar.add(smith.group);
  const joints=smith.joints;
  // Lens space has no ground to receive shadows; the glow sprite and rings
  // carry the grounding read. Meshes neither cast nor receive.
  avatar.traverse(object=>{if(object.isMesh){object.castShadow=false;object.receiveShadow=false;}});
  // Click targets: the head opens the identity tab, the jacket opens
  // wardrobe (the same tab contract as before); the rest of the character
  // greets. three.js raycast ignores `visible`, so this keeps working even
  // if a mesh is ever hidden.
  for(const pick of smith.pickMeshes){
    const part=pick.userData.smithPart;
    target(pick,part==='head'?{kind:'tab',id:'identity'}:part==='torso'?{kind:'tab',id:'wardrobe'}:{kind:'greet'});
  }
  // Greet reactions: each greet() call starts the next reaction in the
  // cycle — wave, spin, jump — played on the rig joints in update().
  let greetState=null,greetIndex=0;
  const GREET_ORDER=Object.freeze(['wave','spin','jump']);
  const GREET_DURATIONS=Object.freeze({wave:1.6,spin:1.3,jump:1.0});
  function greet(){
    const kind=GREET_ORDER[greetIndex%GREET_ORDER.length];greetIndex++;
    greetState={kind,t:0};
    return kind;
  }
  function getGreetKind(){return greetState?.kind??null;}
  const avatarHologram=null; // retired: Agent Smith is the visible character
  // Everything structural floats: the avatar, the lens-ring and the set
  // pieces bob gently in lens space (frozen under reduced motion).
  const floaters=[{obj:avatar,base:.55,amp:.045,speed:1.15,phase:.6},{obj:lensRing,base:.46,amp:.06,speed:1.05,phase:0}];
  floaters.push({obj:sofa,base:.08,amp:.05,speed:.8,phase:1.2},{obj:desk,base:.65,amp:.045,speed:.9,phase:2.4});
  garmentDisplays.forEach((g,i)=>floaters.push({obj:g,base:1.8,amp:.05,speed:1.0,phase:2.9+i*.7}));
  // Freeze a geometry fingerprint in the bind pose, before clothes or motion
  // change. UUIDs, device quality, timestamps and transient poses are excluded.
  const identityGeometry=[];
  avatar.traverse(object=>{
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
  const tail=mesh(new THREE.ConeGeometry(.085,.14,4),seam,[0,-.22,0],[1,1,.4],companion);tail.rotation.z=Math.PI;
  const moon=sphere(material('#1b3860',.2,.7,{emissive:'#142a4d',emissiveIntensity:.6}),[-6,4.8,-13],[2.5,2.5,2.5]);

  let room='city',form='drone',outfit='obsidian';
  function apply(snapshot){
    const clothing=STUDIO_OUTFITS.find(v=>v.id===snapshot.outfitId)??STUDIO_OUTFITS[0];
    const theme=STUDIO_ROOMS.find(v=>v.id===snapshot.roomId)??STUDIO_ROOMS[0];
    outfit=clothing.id;room=theme.id;form=snapshot.companion;
    // Agent Smith keeps his canonical brown suit; the studio wardrobe
    // dresses the tie (and matching pocket square) in the outfit trim.
    smith.materials.cushion.color.set(clothing.trim);
    light.color.set(theme.light);light.emissive.set(theme.light);
    skyMat.color.set(theme.sky);skyMat.emissive.set(theme.sky);rim.color.set(theme.light);
    skyline.visible=room!=='ocean';moon.visible=room==='night';
    companionBody.scale.set(form==='spark' ? .10 : .17,form==='bird' ? .18 : .15,.12);
    rimFrame.visible=form==='drone';wings.forEach(w=>w.visible=form!=='spark');tail.visible=form!=='drone';
  }
  const _greetQ=new THREE.Quaternion(),_greetE=new THREE.Euler();
  function quatMul(j,x,y,z){if(!j)return;_greetE.set(x,y,z);_greetQ.setFromEuler(_greetE);j.quaternion.multiply(_greetQ);}
  function update(dt,time,pose={joints:{}},reducedMotion=false){
    if(!layer.visible)return;
    for(const [name,joint] of Object.entries(joints)){
      // Motion packets normally contain canonical quaternion arrays. A stale or
      // partially-restored pose must never crash the 3-D surface at this boundary.
      const q=pose?.joints?.[name];
      let targetQ=smith.rest[name];
      if(Array.isArray(q)&&q.length===4&&q.every(Number.isFinite)){
        targetQ=new THREE.Quaternion(q[0],q[1],q[2],q[3]);
      }else if(q&&typeof q==='object'&&Number.isFinite(q.x)&&Number.isFinite(q.y)&&Number.isFinite(q.z)&&Number.isFinite(q.w)){
        targetQ=new THREE.Quaternion(q.x,q.y,q.z,q.w);
      }
      joint.quaternion.slerp(targetQ,Math.min(1,dt*12));
    }
    // Breathing sway on the spine, then the float bobs below.
    joints.spine.position.y=.10+(reducedMotion?0:Math.sin(time*1.4)*.007);
    // Eye blink (eyes reopen under reduced motion).
    const blinkPhase=(time+2.1)%3.7;
    const openness=reducedMotion||blinkPhase>=.14?1:.12;
    for(const eye of smith.blinkers)eye.scale.y=eye.userData.baseScaleY*openness;
    // Greet reactions: wave / spin / jump, played on the rig joints.
    let greetLift=0;
    if(greetState&&!reducedMotion){
      greetState.t+=dt;
      const k=greetState.t/GREET_DURATIONS[greetState.kind];
      if(k>=1)greetState=null;
      else{
        const env=Math.sin(Math.min(1,k)*Math.PI);
        if(greetState.kind==='wave'){
          quatMul(joints.rightArm,0,0,2.2*env);
          quatMul(joints.rightElbow,0,0,-.4*env);
          quatMul(joints.rightHand,0,0,Math.sin(greetState.t*14)*.5*env);
          quatMul(joints.head,0,0,-.12*env);
          greetLift=.06*env;
        }else if(greetState.kind==='spin'){
          avatar.rotation.y+=dt*2*Math.PI/GREET_DURATIONS.spin;
          quatMul(joints.leftArm,0,0,-.9*env);
          quatMul(joints.rightArm,0,0,.9*env);
          quatMul(joints.head,0,.3*env,0);
          greetLift=.10*env;
        }else if(greetState.kind==='jump'){
          greetLift=.35*env;
          quatMul(joints.leftArm,0,0,-1.2*env);
          quatMul(joints.rightArm,0,0,1.2*env);
          quatMul(joints.leftLeg,.5*env,0,0);
          quatMul(joints.rightLeg,-.3*env,0,0);
          quatMul(joints.head,-.15*env,0,0);
        }
      }
    }
    if(reducedMotion){for(const f of floaters)f.obj.position.y=f.base;}
    else{for(const f of floaters)f.obj.position.y=f.base+Math.sin(time*f.speed+f.phase)*f.amp;
      // Agent Smith floats: gentle hover bob, slow rotational sway, and
      // the greet lift on top.
      avatar.position.y+=greetLift;
      avatar.rotation.y+=dt*.12;
      // Wardrobe vitrines rotate slowly like premium display stands.
      garmentDisplays.forEach((display,i)=>{
        display.rotation.y+=dt*(.16+i*.025);
        const orb=display.children.find(child=>child.userData.orbitOffset===i*2.1);
        if(orb){
          const a=time*.9+i*2.1;
          orb.position.x=Math.cos(a)*.47;
          orb.position.z=Math.sin(a)*.10;
          orb.position.y=.12+Math.sin(a)*.10;
        }
      });
      lensRing.rotation.y+=dt*.22;ringInner.rotation.y-=dt*.31;glow.material.opacity=.46+Math.sin(time*1.6)*.06;}
    companion.position.y=2.78+(reducedMotion?0:Math.sin(time*1.8)*.075);
    companion.rotation.y=reducedMotion?0:Math.sin(time*.8)*.14;
    wings.forEach((wing,i)=>{wing.rotation.z=(i===0?-1:1)*(.55+(form==='bird'&&!reducedMotion?Math.sin(time*5)*.35:0));});
  }
  function getSnapshot(){return {source:'person-studio-scene',modelId:STUDIO_MODEL.id,visible:layer.visible,referenceLook:'agent-smith-v1',outfitId:outfit,roomId:room,companionForm:form,jointNames:Object.keys(joints),meshCount:geometries.size,identityHeadGeometry:smith.headMesh.geometry.uuid,geometryOnly:false,referenceImagesUsedAsTextures:false,avatarHologramUrl:null,avatarHologramPresent:false,avatarHologramTint:avatarHologramTint};}
  // Avatar faces now dress the chess pieces; Agent Smith keeps his own
  // reference look, so this is a compatibility no-op that reports the
  // current URL. Presentation only.
  function setAvatarFace(url){
    if(typeof url!=='string'||!url.length)return avatarTextureUrl;
    avatarTextureUrl=url;
    return avatarTextureUrl;
  }
  let avatarHologramTint=null;
  // The hologram sprite is retired (Agent Smith is the visible character);
  // kept so older callers still get the stored tint back. Presentation only.
  function setHologramTint(tint,opacity){
    avatarHologramTint=typeof tint==='string'&&tint?tint:null;
    return avatarHologramTint;
  }
  function destroy(){selectable.forEach(m=>{const i=targets.indexOf(m);if(i>=0)targets.splice(i,1);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());try{smith.dispose();}catch{/* presentation only */}layer.removeFromParent();}
  return {layer,avatar,joints,apply,update,getSnapshot,destroy,fingerprint,avatarHologram,greet,getGreetKind,setAvatarFace,setHologramTint,resolve:object=>object?.userData?.personStudioAction??null};
}
