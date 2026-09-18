import {STUDIO_MODEL,STUDIO_OUTFITS,STUDIO_ROOMS} from '../domains/person-studio.js';
import {avatarBlink,avatarIdlePose} from '../domains/avatar-motion.js';

/** PERSON Ω avatar: the fully articulated procedural rig IS the avatar — head,
 *  torso, arms with elbows/hands/fingers, legs, all built from Three.js
 *  primitives in chibi proportions. It idles (breathing, blink, sway) and
 *  responds to clicks; no flat picture is shown. The reference hologram
 *  sprite was retired in Packet 226; its presentation APIs remain as
 *  state-keeping no-ops so face choices and agent tints keep working where
 *  they still apply (chess pieces, design records). */
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
    frame(.65,1.45,.42,gold,[0,0,0],g,.018);
    const cloth=material(item.color,.25,.5);
    const garment=box(.33,.75,.13,cloth,[0,-.05,0],g);
    box(.045,.74,.025,seam,[.105,-.05,.09],g);box(.045,.74,.025,seam,[-.105,-.05,.09],g);
    for(const side of [-1,1]){const sleeve=box(.12,.56,.13,cloth,[side*.23,.02,0],g);sleeve.rotation.z=side*.16;target(sleeve,{kind:'outfit',id:item.id});}
    target(garment,{kind:'outfit',id:item.id});garmentDisplays.push(g);
    // Each wardrobe display hangs in lens space with its own hologram ring.
    const displayRing=mesh(new THREE.TorusGeometry(.45,.016,8,56),ringBlue,[0,-.86,0],[1,1,1],g);displayRing.rotation.x=Math.PI/2;
  }

  // Articulated human. Stable facial geometry lives outside the outfit materials.
  const avatar=group('Reference-built avatar',[0,.55,0]);avatar.scale.setScalar(1.32);
  // Eye parts for the idle blink: collected at build so update() can drive them.
  const eyeBalls=[],eyelids=[];
  const skin=material(STUDIO_MODEL.skin,.02,.66),skinLight=material('#85563f',.02,.64),hair=material(STUDIO_MODEL.hair,.15,.72);
  const jacket=material(STUDIO_OUTFITS[0].color,.07,.65),trim=material(STUDIO_OUTFITS[0].trim,.8,.32);
  const shirt=material('#181a22',.01,.9),pants=material('#20232d',.04,.82),sole=material('#25252a',.1,.65);
  const eyes=material('#c3b4a4',0,.5),iris=material('#2a1a11',.05,.25),pupil=material('#050506',0,.25),lips=material('#4e2b25',0,.7);
  const joints={};
  const bone=(name,pos,owner)=>{const g=group(name,pos,owner);joints[name]=g;return g;};
  const hips=bone('root',[0,.94,0],avatar);
  sphere(pants,[0,.02,0],[.245,.17,.145],hips);
  const torso=bone('spine',[0,.12,0],hips);
  // Lathed torso includes waist, chest, shoulder taper rather than a scaled cube.
  const profile=[[.18,0],[.205,.1],[.22,.3],[.3,.61],[.295,.68],[.20,.75]];
  const torsoMesh=mesh(new THREE.LatheGeometry(profile.map(([x,y])=>new THREE.Vector2(x,y)),24),jacket,[0,0,0],[1,1,.63],torso);
  target(torsoMesh,{kind:'tab',id:'wardrobe'});
  box(.23,.57,.032,shirt,[0,.4,.182],torso);
  const belt=mesh(new THREE.CylinderGeometry(.213,.22,.07,24),dark,[0,.025,0],[1,1,.7],torso);
  box(.08,.06,.025,trim,[0,.025,.164],torso);
  for(const side of [-1,1]){
    const lapel=box(.080,.46,.035,jacket,[side*.13,.48,.185],torso);lapel.rotation.z=-side*.27;
    const piping=box(.009,.46,.012,trim,[side*.155,.48,.209],torso);piping.rotation.z=-side*.27;
    box(.011,.34,.015,trim,[side*.175,.20,.16],torso);
    const tail=box(.17,.53,.035,jacket,[side*.20,-.21,-.07],torso);tail.rotation.z=-side*.1;
    const edging=box(.012,.53,.043,trim,[side*.281,-.21,-.07],torso);edging.rotation.z=-side*.1;
    const pocket=box(.085,.06,.026,dark,[side*.20,.20,.165],torso);pocket.rotation.z=side*.07;
  }
  tube([[-.075,.72,.12],[-.09,.61,.22],[0,.48,.225],[.09,.61,.22],[.075,.72,.12]],.006,trim,torso);
  const emblem=mesh(new THREE.ConeGeometry(.029,.055,3),trim,[0,.45,.235],[1,1,.3],torso);emblem.rotation.z=Math.PI;
  const neck=bone('neck',[0,.765,0],torso);mesh(new THREE.CylinderGeometry(.068,.085,.14,20),skin,[0,.02,0],[1,1,1],neck);
  const head=bone('head',[0,.165,0],neck);
  const headMesh=sphere(skin,[0,.025,0],[.175,.225,.16],head);target(headMesh,{kind:'tab',id:'identity'});
  sphere(skin,[0,-.1,.025],[.145,.11,.138],head);
  sphere(skinLight,[0,-.075,.084],[.124,.073,.095],head);
  for(const side of [-1,1]){
    sphere(skin,[side*.174,.005,0],[.031,.068,.026],head);
    sphere(skinLight,[side*.110,-.013,.108],[.045,.041,.027],head);
    const eye=sphere(eyes,[side*.073,.034,.141],[.038,.016,.016],head);
    eye.userData.expressionPart='eye';eye.userData.baseScaleY=.016;eyeBalls.push(eye);
    sphere(iris,[side*.073,.034,.153],[.015,.015,.005],head);sphere(pupil,[side*.073,.034,.158],[.007,.008,.003],head);
    const brow=box(.074,.014,.02,hair,[side*.074,.071,.147],head);brow.rotation.z=-side*.10;
    const lid=sphere(skin,[side*.073,.052,.138],[.040,.012,.018],head);lid.rotation.z=-side*.03;eyelids.push(lid);
    sphere(hair,[side*.134,-.107,.059],[.026,.07,.055],head);
    eye.userData.expressionPart='eye';
  }
  sphere(skinLight,[0,-.006,.159],[.030,.064,.028],head);
  sphere(skin,[0,-.040,.184],[.037,.024,.033],head);
  for(const x of [-.029,.029])sphere(skin,[x,-.041,.176],[.017,.015,.017],head);
  sphere(lips,[0,-.094,.171],[.053,.013,.014],head);sphere(skinLight,[0,-.110,.169],[.046,.013,.013],head);
  sphere(hair,[0,-.159,.095],[.11,.031,.066],head);
  for(const x of [-.031,.031]){const mustache=sphere(hair,[x,-.080,.171],[.038,.009,.01],head);mustache.rotation.z=x>0?-.13:.13;}
  const scalp=sphere(hair,[0,.125,-.025],[.181,.158,.146],head);
  // Individual locs are tubes following permanent curves, not camera segmentation.
  for(let i=0;i<24;i++){
    const a=i*Math.PI*2/24,r=.146+(i%3)*.012,front=Math.sin(a)>.35;
    const side=Math.cos(a)<0?-1:1;
    const x=front?side*Math.max(.165,Math.abs(Math.cos(a)*r)):Math.cos(a)*r;
    const z=front?.075:Math.sin(a)*r;
    const length=.25+(i%5)*.045;
    tube([[x,.20,z-.02],[x*1.18,.17,z*1.09],[x*1.28,.04,z*1.20],[x*1.35,-length*.45,z*1.24],[x*1.36+.012,-length+.14,z*1.25]],.016+(i%2)*.003,hair,head);
    if(front&&i%2===0)tube([[side*.022,.261,.015],[side*.092,.233,.075],[side*.172,.13,.082],[side*.205,-.015,.065]],.016,hair,head);
  }
  for(const side of [-1,1]){
    const name=side<0?'left':'right';
    const arm=bone(name+'Arm',[side*.30,.62,0],torso);arm.rotation.z=side*.12;
    sphere(jacket,[side*.035,-.032,0],[.115,.123,.10],arm);
    mesh(new THREE.CapsuleGeometry(.086,.29,6,14),jacket,[side*.015,-.24,0],[1,1,.96],arm);
    box(.012,.21,.015,trim,[side*.094,-.19,.065],arm);
    const elbow=group(name+' elbow',[side*.026,-.45,.005],arm);elbow.rotation.x=-.09;
    mesh(new THREE.CapsuleGeometry(.072,.22,6,14),jacket,[0,-.16,0],[1,1,.94],elbow);
    mesh(new THREE.CylinderGeometry(.078,.077,.035,16),trim,[0,-.29,0],[1,1,1],elbow);
    const hand=bone(name+'Hand',[0,-.36,0],elbow);
    sphere(skin,[0,-.035,0],[.054,.082,.036],hand);
    for(let finger=0;finger<4;finger++){
      const digit=group(`${name} finger ${finger}`,[(finger-1.5)*.025,-.092,.004],hand);
      const length=.047+(finger===1?.012:0);
      mesh(new THREE.CapsuleGeometry(.010,length,3,7),skin,[0,-length*.45,0],[1,1,1],digit);
    }
    const thumb=mesh(new THREE.CapsuleGeometry(.016,.045,4,8),skin,[side*.052,-.03,.025],[1,1,1],hand);thumb.rotation.z=-side*.5;
    const leg=bone(name+'Leg',[side*.129,-.075,0],hips);
    mesh(new THREE.LatheGeometry([[.075,-.76],[.086,-.67],[.09,-.51],[.102,-.38],[.113,-.2],[.116,-.04],[.097,.07]].map(([x,y])=>new THREE.Vector2(x,y)),20),pants,[0,0,0],[1,1,.98],leg);
    box(.035,.13,.055,jacket,[0,-.4,.097],leg);
    box(.012,.59,.013,trim,[side*.104,-.35,.015],leg);
    sphere(dark,[0,-.788,.054],[.114,.105,.185],leg);
    box(.222,.035,.35,sole,[0,-.85,.055],leg);
    box(.226,.016,.355,trim,[0,-.825,.055],leg);
    for(let y=0;y<3;y++)box(.123,.01,.014,trim,[0,-.724-y*.026,.18-y*.013],leg);
  }
  // Lens space has no ground to receive shadows; the glow sprite and rings
  // carry the grounding read. Meshes neither cast nor receive.
  avatar.traverse(object=>{if(object.isMesh){object.castShadow=false;object.receiveShadow=false;}});
  // The articulated rig is the avatar: it stays fully visible and animated.
  // Packet 226 retired the reference-avatar hologram sprite (the flat AI
  // portrait picture). The rig carries identity/wardrobe tab targets itself;
  // `setAvatarFace`/`setHologramTint` below remain as state-keeping APIs for
  // the face-choice feature and agent designs, without a hologram to show.
  const avatarHologram=null;
  // Everything structural floats: the avatar, the lens-ring and the set
  // pieces bob gently in lens space (frozen under reduced motion). The
  // avatar's own bob/sway/glow/torso follow the shared avatarIdlePose motion
  // language (src/domains/avatar-motion.js); the set pieces keep their
  // per-piece floaters.
  const floaters=[{obj:lensRing,base:.46,amp:.06,speed:1.05,phase:0}];
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
    jacket.color.set(clothing.color);trim.color.set(clothing.trim);
    light.color.set(theme.light);light.emissive.set(theme.light);
    skyMat.color.set(theme.sky);skyMat.emissive.set(theme.sky);rim.color.set(theme.light);
    skyline.visible=room!=='ocean';moon.visible=room==='night';
    companionBody.scale.set(form==='spark' ? .10 : .17,form==='bird' ? .18 : .15,.12);
    rimFrame.visible=form==='drone';wings.forEach(w=>w.visible=form!=='spark');tail.visible=form!=='drone';
  }
  const restQuaternions=Object.fromEntries(Object.entries(joints).map(([name,j])=>[name,j.quaternion.clone()]));
  function update(dt,time,pose={joints:{}},reducedMotion=false){
    if(!layer.visible)return;
    for(const [name,joint] of Object.entries(joints)){
      const q=pose.joints?.[name];const targetQ=q?new THREE.Quaternion(...q):restQuaternions[name];
      joint.quaternion.slerp(targetQ,Math.min(1,dt*12));
    }
    // The avatar is alive even at rest: idle bob + sway-turn from the shared
    // motion language, breathing torso, a slow head drift, periodic blinks.
    const idle=avatarIdlePose({time,seed:0,reducedMotion});
    avatar.position.y=.55+idle.bobY;avatar.rotation.y=idle.swayY;
    torso.position.y=.12+idle.torso;
    glow.material.opacity=idle.glow;
    if(!reducedMotion){
      const breath=Math.sin(time*1.4);
      torso.scale.set(1-.006*breath,1+.012*breath,1-.006*breath);
      joints.head.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(time*.7+1)*.04,Math.sin(time*.5)*.06,0)));
    }else{torso.scale.set(1,1,1);}
    const openness=avatarBlink({time,seed:0,reducedMotion});
    for(const eye of eyeBalls)eye.scale.y=eye.userData.baseScaleY*openness;
    if(reducedMotion){for(const f of floaters)f.obj.position.y=f.base;}
    else{for(const f of floaters)f.obj.position.y=f.base+Math.sin(time*f.speed+f.phase)*f.amp;
      lensRing.rotation.y+=dt*.22;ringInner.rotation.y-=dt*.31;}
    companion.position.y=2.78+(reducedMotion?0:Math.sin(time*1.8)*.075);
    companion.rotation.y=reducedMotion?0:Math.sin(time*.8)*.14;
    wings.forEach((wing,i)=>{wing.rotation.z=(i===0?-1:1)*(.55+(form==='bird'&&!reducedMotion?Math.sin(time*5)*.35:0));});
  }
  function getSnapshot(){return {source:'person-studio-scene',modelId:STUDIO_MODEL.id,visible:layer.visible,outfitId:outfit,roomId:room,companionForm:form,jointNames:Object.keys(joints),meshCount:geometries.size,identityHeadGeometry:headMesh.geometry.uuid,geometryOnly:false,referenceImagesUsedAsTextures:false,rigVisible:true,avatarHologramPresent:false,avatarHologramUrl:avatarTextureUrl,avatarHologramTint:avatarHologramTint};}
  // Face choice state: the user's chosen avatar face — default Tumbo
  // character, Tumbo's own likeness, or their locally-styled photo. The
  // hologram sprite is retired, so this keeps the stored choice (chess
  // pieces and design records still wear it); the 3D rig is untouched.
  function setAvatarFace(url){
    if(typeof url!=='string'||!url.length)return avatarTextureUrl;
    avatarTextureUrl=url;
    return avatarTextureUrl;
  }
  let avatarHologramTint=null;
  // Muse Agent dressing: records the design tint for the avatar. The
  // hologram is retired so there is no hologram to tint; the value is kept
  // in the design record and snapshot.
  function setHologramTint(tint,opacity){
    avatarHologramTint=typeof tint==='string'&&tint?tint:null;
    return avatarHologramTint;
  }
  function destroy(){selectable.forEach(m=>{const i=targets.indexOf(m);if(i>=0)targets.splice(i,1);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());if(avatarHologram){avatarHologram.material.map?.dispose?.();avatarHologram.material.dispose?.();}layer.removeFromParent();}
  return {layer,avatar,joints,apply,update,getSnapshot,destroy,fingerprint,avatarHologram,setAvatarFace,setHologramTint,resolve:object=>object?.userData?.personStudioAction??null};
}
