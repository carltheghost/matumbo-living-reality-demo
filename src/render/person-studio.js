import {createPersonStudioOwner,STUDIO_OUTFITS,STUDIO_ROOMS,STUDIO_COMPANIONS} from '../domains/person-studio.js';
import {buildPersonStudioScene} from './person-studio-scene.js?v=20260918-avatar-chess';
import {AVATAR_FACE_CHOICES,AVATAR_FACE_MAX_DIM,AVATAR_FLUFFY_BODY_TEMPLATE_URL,buildChibi,loadAvatarFaceChoice,resolveAvatarFaceUrl,saveAvatarFace,saveAvatarFaceChoice} from '../domains/avatar-style.js';

export function createPersonStudio({THREE,renderer,scene,camera,controls,world,targets,documentRoot=document,onNavigate,onFrame,onIntent,reducedMotion=false}) {
  let storage=null;try{storage=globalThis.localStorage;}catch{}
  const spatial=buildPersonStudioScene({THREE,parent:scene,targets,compact:innerWidth<700,avatarTextureUrl:resolveAvatarFaceUrl(storage)});
  const owner=createPersonStudioOwner({storage,modelFingerprint:spatial.fingerprint()});
  // A small procedural lighting environment gives real material reflections;
  // it is not a background image or a second application renderer.
  const environmentScene=new THREE.Scene();
  const envRoom=new THREE.Mesh(new THREE.BoxGeometry(12,10,12),new THREE.MeshBasicMaterial({color:'#4c5669',side:THREE.BackSide}));environmentScene.add(envRoom);
  const envLights=[];
  for(const [x,y,z,w,h,color] of [[-4,3,2,1.5,5,'#fff0d4'],[4,3,-2,1.5,5,'#b7d5ff'],[0,4,-3,7,1,'#f4e3c0']]){
    const panel=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));panel.position.set(x,y,z);panel.lookAt(0,1,0);environmentScene.add(panel);envLights.push(panel);
  }
  const pmrem=new THREE.PMREMGenerator(renderer);const environmentTarget=pmrem.fromScene(environmentScene,.04);pmrem.dispose();
  [envRoom,...envLights].forEach(m=>{m.geometry.dispose();m.material.dispose();});
  const stylesheet=documentRoot.createElement('link');stylesheet.rel='stylesheet';stylesheet.href=new URL('./person-studio.css',import.meta.url).href;documentRoot.head.append(stylesheet);
  const root=documentRoot.createElement('section');root.id='person-studio';root.hidden=true;root.setAttribute('aria-label','PERSON Ω personal room');
  root.innerHTML=`
    <header class="studio-topbar">
      <div class="studio-brand"><span class="studio-monogram" aria-hidden="true">M</span><div><strong>maTumbo</strong><small>People × worlds × possibility</small></div></div>
      <nav class="studio-tabs" role="tablist" aria-label="Personal space"><button data-tab="identity" role="tab">Profile</button><button data-tab="wardrobe" role="tab">Wardrobe</button><button data-tab="room" role="tab">Your room</button><button data-tab="presence" role="tab">Presence</button><button data-tab="companion" role="tab">Companion</button></nav>
      <div class="studio-top-right"><span class="studio-local">Local personal space</span><button type="button" data-world="reality-lens">Explore ↗</button></div>
    </header>
    <div class="studio-title"><span class="studio-kicker">01 / Person Ω</span><h1>The same you.<br><i>Everywhere.</i></h1><p>Your identity stays yours.<br>Dress it. Move it. Make this space your own.</p></div>
    <aside class="studio-identity"><span class="studio-kicker">Your persistent identity</span><h2 data-display-name>Your digital self</h2><p class="studio-lock" data-identity-lock>Awaiting your approval</p><p>Camera input controls motion.<br>Only you change the appearance.</p><dl><dt>Appearance</dt><dd data-version>Preview</dd><dt>Identity</dt><dd data-short-id>Not created</dd><dt>Storage</dt><dd data-storage>Not saved</dd></dl></aside>
    <aside class="studio-inspector" aria-label="Personal space controls">
      <section data-panel="identity" role="tabpanel"><span class="studio-kicker">Identity / by choice</span><h2>Make it yours.</h2><p>An original, stylized 3D avatar built from your design references. Approve this model to lock its identity; outfits remain yours to change.</p><form data-approve-form><label>Your display name<input name="displayName" type="text" maxlength="60" autocomplete="nickname" placeholder="Your name" required></label><button class="studio-primary" type="submit">Approve this avatar</button></form><div data-approved-actions hidden><button class="studio-primary" type="button" data-save>Save profile & look</button><button class="studio-secondary" type="button" data-export>Export profile</button><div class="studio-projection-record" data-identity-hash></div></div><div class="studio-face" data-face-block><span class="studio-kicker">Face / your look</span><h2>Whose face?</h2><p>Choose the face your avatar wears — here and on your chess pieces.</p><div class="studio-face-options" data-face-options></div><label class="studio-photo-upload">Use my photo<input type="file" accept="image/*" data-photo-input hidden></label><p class="studio-subtle">Your photo becomes your chibi — your likeness, simplified — on this device only. A look, not identity verification. Nothing is uploaded.</p></div><p class="studio-subtle">Local approval is not account verification or biometric enrollment. Nothing is uploaded.</p></section>
      <section data-panel="wardrobe" role="tabpanel" hidden><span class="studio-kicker">Wear your world</span><h2>A look of your own.</h2><p>Change the clothing. Keep the person.</p><div class="studio-outfits"></div><button class="studio-primary studio-secondary" type="button" data-save>Save this look</button><p class="studio-subtle">These are selectable 3D outfits, not owned marketplace products.</p></section>
      <section data-panel="room" role="tabpanel" hidden><span class="studio-kicker">Your space / your atmosphere</span><h2>Somewhere to belong.</h2><p>Same avatar. A different light, horizon and mood.</p><div class="studio-room-options"></div><button class="studio-secondary" type="button" data-center>Recenter the room</button></section>
      <section data-panel="presence" role="tabpanel" hidden><span class="studio-kicker">Identity persists / motion flows</span><h2>Move. Stay you.</h2><p>Test the articulated rig. These controls supply pose only—they cannot change the face, hair or clothing.</p><label>Head rotation<input data-head type="range" min="-0.75" max="0.75" step="0.01" value="0"></label><label>Raise left arm<input data-arm type="range" min="0" max="1.4" step="0.01" value="0"></label><button class="studio-secondary" data-rest type="button">Release to rest</button><button class="studio-secondary" data-xr type="button">Enter this room in VR</button><p class="studio-subtle">Camera-to-skeleton tracking and hardware XR validation remain pending. Manual pose requires an approved avatar.</p></section>
      <section data-panel="companion" role="tabpanel" hidden><span class="studio-kicker">Luna / one companion</span><h2>Always beside you.</h2><p>Choose its embodiment. The companion ID stays the same.</p><div class="studio-companion-options"></div><p data-companion-context></p><p class="studio-subtle">Local contextual guide. No AI model or conversation service is connected here yet.</p></section>
      <p class="studio-message" data-message role="status" aria-live="polite">Preparing your space…</p>
    </aside>
    <div class="studio-hint"><strong>Reference-built 3D / one living space</strong><span>Click your avatar to say hi · drag it to move it · drag empty space to orbit · scroll to approach</span><button data-clear-view type="button">Hide controls · explore</button></div>
    <footer class="studio-footer"><div class="studio-footer-title"><strong>One person. Connected places.</strong><small>Continue through the same Living Reality</small></div><nav class="studio-routes" aria-label="Connected features"><button data-world="block-world"><span>◇</span>Cube world</button><button data-world="rooms"><span>▣</span>Rooms</button><button data-world="contracts"><span>⌑</span>Contracts</button><button data-world="academy"><span>▤</span>Academy</button><button data-world="arena"><span>⌘</span>Arena</button><button data-world="world-events"><span>✧</span>World pulse</button></nav></footer>`;
  documentRoot.body.append(root);
  let active=false,tab='identity',savedCamera=null,message='',poseHeld=false;
  const find=selector=>root.querySelector(selector),all=selector=>[...root.querySelectorAll(selector)];
  const announce=text=>{message=text;find('[data-message]').textContent=text;};
  const guard=fn=>async()=>{try{await fn();}catch(e){announce(e.message);}};
  function setTab(next){
    if(!['identity','wardrobe','room','presence','companion'].includes(next))return;
    tab=next;all('[data-tab]').forEach(b=>{const selected=b.dataset.tab===tab;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});
    root.classList.remove('studio-clear-view');find('[data-clear-view]').textContent='Hide controls · explore';
    all('[data-panel]').forEach(p=>{p.hidden=p.dataset.panel!==tab;});
    announce(tab==='wardrobe'?'Choose an outfit to preview it on the same 3D person.':tab==='presence'?'Manual pose test · your identity remains locked.':'');
  }
  function render(snapshot){
    spatial.apply(snapshot);root.dataset.previewDirty=String(snapshot.dirty);
    find('[data-display-name]').textContent=snapshot.displayName||'Your digital self';
    find('[data-identity-lock]').textContent=snapshot.approved?'Identity locked · appearance by choice':'Awaiting your approval';
    find('[data-version]').textContent=snapshot.approved?`Version ${snapshot.avatar.appearance.version}`:'Preview';
    find('[data-short-id]').textContent=snapshot.avatar?.identity.avatarId.slice(-8)??'Not created';
    find('[data-storage]').textContent=snapshot.dirty?'Unsaved changes':snapshot.approved?'Saved on this browser':'Not saved';
    find('[data-approve-form]').hidden=snapshot.approved;find('[data-approved-actions]').hidden=!snapshot.approved;
    find('[data-identity-hash]').textContent=snapshot.approved?`AVATAR ${snapshot.avatar.identity.avatarId}\nIDENTITY ${snapshot.avatar.identity.identityHash.slice(0,24)}…`:'';
    all('[data-save]').forEach(b=>{b.disabled=!snapshot.approved||snapshot.loading;});
    all('[data-outfit]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.outfit===snapshot.outfitId)));
    all('[data-room]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.room===snapshot.roomId)));
    all('[data-companion]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.companion===snapshot.companion)));
    find('[data-companion-context]').textContent=`Luna · ${snapshot.companion}. This room uses the ${snapshot.roomId} theme; your selected outfit is ${snapshot.outfitId}.`;
    if(snapshot.error)announce(snapshot.error);
    onIntent?.('person-studio.changed',{approved:snapshot.approved,appearanceVersion:snapshot.avatar?.appearance.version??null,outfitId:snapshot.outfitId,roomId:snapshot.roomId,localOnly:true});
  }
  for(const outfit of STUDIO_OUTFITS){
    const b=documentRoot.createElement('button');b.type='button';b.className='studio-outfit';b.dataset.outfit=outfit.id;
    b.innerHTML=`<svg viewBox="0 0 70 90" aria-hidden="true"><path d="M22 10 10 18 3 52 14 56 23 34 19 82 33 82 35 36 37 82 51 82 47 34 56 56 67 52 60 18 48 10 42 6 35 16 28 6Z" fill="${outfit.color}" stroke="${outfit.trim}" stroke-width="1.5"/><path d="m27 12 6 19-5 21m15-40-6 19 5 21M35 17v57" fill="none" stroke="${outfit.trim}" stroke-width="1.3"/></svg><strong>${outfit.name}</strong><small>${outfit.subtitle}</small>`;
    b.onclick=guard(()=>{owner.chooseOutfit(outfit.id);announce(`${outfit.name} applied · identity unchanged. Save to keep this look.`);});find('.studio-outfits').append(b);
  }
  for(const room of STUDIO_ROOMS){const b=documentRoot.createElement('button');b.type='button';b.dataset.room=room.id;const name=documentRoot.createElement('strong'),caption=documentRoot.createElement('small');name.textContent=room.name;caption.textContent=room.caption;b.append(name,caption);b.onclick=guard(()=>{owner.chooseRoom(room.id);announce(`${room.name} · the same avatar stays with you.`);});find('.studio-room-options').append(b);}
  for(const form of STUDIO_COMPANIONS){const b=documentRoot.createElement('button');b.type='button';b.dataset.companion=form;b.textContent=form;b.onclick=guard(()=>{owner.chooseCompanion(form);announce('Companion form changed · companion identity preserved.');});find('.studio-companion-options').append(b);}
  // Face options: the default Tumbo character, Tumbo's own likeness, or the
  // user's own photo styled locally ("Become Tumbo"). The choice is worn by
  // the user's chess pieces and recorded with the avatar; the studio itself
  // shows the 3D rig. A photo never leaves the device.
  function refreshFacePressed(){
    const current=loadAvatarFaceChoice(storage);
    all('[data-face]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.face===current)));
  }
  function chooseFace(id){
    if(!saveAvatarFaceChoice(storage,id)){announce('Could not save the face choice on this browser.');return;}
    spatial.setAvatarFace(resolveAvatarFaceUrl(storage));
    refreshFacePressed();
    const choice=AVATAR_FACE_CHOICES.find(c=>c.id===id);
    announce(`${choice?choice.label:'Face'} selected · your avatar and chess pieces wear it now.`);
  }
  for(const choice of AVATAR_FACE_CHOICES){
    const b=documentRoot.createElement('button');b.type='button';b.className='studio-face-option';b.dataset.face=choice.id;
    const name=documentRoot.createElement('strong'),caption=documentRoot.createElement('small');
    name.textContent=choice.label;caption.textContent=choice.blurb;b.append(name,caption);
    b.onclick=choice.id==='your-photo'?()=>find('[data-photo-input]').click():guard(()=>chooseFace(choice.id));
    find('[data-face-options]').append(b);
  }
  refreshFacePressed();
  function loadPhotoImage(file){
    if(typeof globalThis.createImageBitmap==='function')return globalThis.createImageBitmap(file);
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file);
      const img=new Image();
      img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
      img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not read that image.'));};
      img.src=url;
    });
  }
  /** The fluffy body template is composited at a modest size: the chibi
   *  data URL must stay small enough for localStorage. Local asset only. */
  const CHIBI_TEMPLATE_MAX_DIM = 512;
  function loadTemplateImage(){
    return new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(new Error('Could not read the fluffy body template.'));
      img.src=AVATAR_FLUFFY_BODY_TEMPLATE_URL;
    });
  }
  async function buildChibiFromPhoto(file){
    const image=await loadPhotoImage(file);
    const template=await loadTemplateImage();
    try{
      const naturalW=image.width||image.naturalWidth,naturalH=image.height||image.naturalHeight;
      if(!naturalW||!naturalH)throw new Error('Could not read that image.');
      const scale=Math.min(1,AVATAR_FACE_MAX_DIM/Math.max(naturalW,naturalH));
      const w=Math.max(1,Math.round(naturalW*scale)),h=Math.max(1,Math.round(naturalH*scale));
      const canvas=documentRoot.createElement('canvas');canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(image,0,0,w,h);
      const photoData=ctx.getImageData(0,0,w,h);
      const tnW=template.naturalWidth||template.width,tnH=template.naturalHeight||template.height;
      if(!tnW||!tnH)throw new Error('Could not read the fluffy body template.');
      const tscale=Math.min(1,CHIBI_TEMPLATE_MAX_DIM/Math.max(tnW,tnH));
      const tw=Math.max(1,Math.round(tnW*tscale)),th=Math.max(1,Math.round(tnH*tscale));
      const tcanvas=documentRoot.createElement('canvas');tcanvas.width=tw;tcanvas.height=th;
      const tctx=tcanvas.getContext('2d',{willReadFrequently:true});
      tctx.drawImage(template,0,0,tw,th);
      const templateData=tctx.getImageData(0,0,tw,th);
      const chibi=buildChibi(templateData.data,tw,th,photoData.data,w,h);
      const out=documentRoot.createElement('canvas');out.width=tw;out.height=th;
      out.getContext('2d').putImageData(new ImageData(chibi.data,tw,th),0,0);
      return {photoDataURL:canvas.toDataURL('image/jpeg',0.85),stylizedDataURL:out.toDataURL('image/jpeg',0.85)};
    }finally{if(image.close)image.close();}
  }
  find('[data-photo-input]').addEventListener('change',guard(async e=>{
    const file=e.target.files&&e.target.files[0];
    e.target.value='';
    if(!file)return;
    announce('Building your chibi on this device…');
    const {photoDataURL,stylizedDataURL}=await buildChibiFromPhoto(file);
    if(!saveAvatarFace(storage,{photoDataURL,stylizedDataURL}))throw new Error('Could not keep the chibi on this browser — storage may be full or blocked.');
    chooseFace('your-photo');
  }));
  all('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
  find('.studio-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;const tabs=all('[data-tab]'),index=tabs.findIndex(b=>b.dataset.tab===tab),next=tabs[(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];setTab(next.dataset.tab);next.focus();e.preventDefault();});
  all('[data-world]').forEach(b=>b.onclick=guard(()=>{owner.projectInto(b.dataset.world);onNavigate?.(b.dataset.world);}));
  find('[data-approve-form]').addEventListener('submit',async e=>{
    e.preventDefault();const button=find('[data-approve-form] button');button.disabled=true;
    try{await owner.approve(find('[name=displayName]').value,true);owner.save();announce('Avatar approved and saved on this browser. Your identity is now locked.');}
    catch(error){announce(error.message);}finally{button.disabled=false;}
  });
  all('[data-save]').forEach(b=>b.onclick=guard(()=>{owner.save();announce('Saved on this browser · same identity, current look and room.');}));
  find('[data-export]').onclick=guard(()=>{const url=URL.createObjectURL(new Blob([owner.exportProfile()],{type:'application/json'}));const a=documentRoot.createElement('a');a.href=url;a.download='matumbo-person-profile.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);announce('Profile exported. Keep this file private if it contains your personal display name.');});
  const poseInput=()=>{try{owner.moveRig(Number(find('[data-head]').value),Number(find('[data-arm]').value));poseHeld=true;announce('Pose changes only · face, hair and outfit preserved.');}catch(e){announce(e.message);}};
  find('[data-head]').addEventListener('input',poseInput);find('[data-arm]').addEventListener('input',poseInput);
  find('[data-rest]').onclick=()=>{poseHeld=false;find('[data-head]').value='0';find('[data-arm]').value='0';announce('Tracking released · easing to the neutral pose.');};
  find('[data-center]').onclick=()=>{frameCamera();announce('Room view centered.');};
  find('[data-clear-view]').onclick=()=>{const hidden=root.classList.toggle('studio-clear-view');find('[data-clear-view]').textContent=hidden?'Show controls':'Hide controls · explore';};
  find('[data-xr]').onclick=()=>root.dispatchEvent(new CustomEvent('person-studio:enter-vr',{bubbles:true}));
  const unsubscribe=owner.subscribe(render);render(owner.getSnapshot());setTab('identity');
  owner.ready.then(s=>{render(s);if(!s.error)announce(s.approved?'Your saved identity and appearance have been restored.':'Explore the model. Approve it when you are ready to make it your local avatar.');});
  function frameCamera(){if(!active)return;const mobile=innerWidth<700;camera.fov=mobile?40:39;camera.position.set(mobile ? .2 : .15,mobile?2.4:2.6,mobile?8.8:6.6);controls.target.set(0,mobile?1.98:1.87,0);controls.minDistance=3;controls.maxDistance=16;camera.updateProjectionMatrix();controls.update();onFrame?.();}
  function open(){
    if(active)return;active=true;root.hidden=false;spatial.layer.visible=true;
    savedCamera={position:camera.position.clone(),target:controls.target.clone(),fov:camera.fov,min:controls.minDistance,max:controls.maxDistance,worldVisible:world.visible,environment:scene.environment,shadows:renderer.shadowMap.enabled,shadowType:renderer.shadowMap.type};
    scene.environment=environmentTarget.texture;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    world.visible=false;documentRoot.body.classList.add('person-studio-mode');frameCamera();
  }
  function close(){
    if(!active)return;active=false;poseHeld=false;root.hidden=true;spatial.layer.visible=false;documentRoot.body.classList.remove('person-studio-mode');
    if(savedCamera){camera.position.copy(savedCamera.position);controls.target.copy(savedCamera.target);camera.fov=savedCamera.fov;controls.minDistance=savedCamera.min;controls.maxDistance=savedCamera.max;world.visible=savedCamera.worldVisible;scene.environment=savedCamera.environment;renderer.shadowMap.enabled=savedCamera.shadows;renderer.shadowMap.type=savedCamera.shadowType;camera.updateProjectionMatrix();savedCamera=null;}
  }
  const resize=()=>frameCamera();globalThis.addEventListener('resize',resize);
  function selectObject(object){const action=spatial.resolve(object);if(!action)return false;if(action.kind==='tab')setTab(action.id);if(action.kind==='greet'){greetAvatar();}if(action.kind==='outfit'){owner.chooseOutfit(action.id);setTab('wardrobe');}return true;}
  const greetLines={wave:'A friendly wave.',spin:'A happy spin.',jump:'A little jump for joy.'};
  function greetAvatar(){const kind=spatial.greet?.();announce(greetLines[kind]??'Hello!');}
  let pointerStart=null,avatarDrag=null;
  const selectionRay=new THREE.Raycaster(),selectionPoint=new THREE.Vector2();
  // Drag the avatar on a horizontal plane at chest height; empty space keeps
  // orbiting via the controls.
  const dragPlane=new THREE.Plane(new THREE.Vector3(0,1,0),-1.6);
  const dragHit=new THREE.Vector3();
  const setPointer=event=>{const rect=renderer.domElement.getBoundingClientRect();selectionPoint.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);};
  const avatarHit=event=>{setPointer(event);selectionRay.setFromCamera(selectionPoint,camera);return selectionRay.intersectObjects(spatial.avatarPickMeshes,false).length>0;};
  const pointerDown=event=>{if(active&&event.button===0)pointerStart={id:event.pointerId,x:event.clientX,y:event.clientY,avatar:avatarHit(event)};};
  const pointerMove=event=>{
    if(!active||!pointerStart||event.pointerId!==pointerStart.id)return;
    if(pointerStart.avatar&&!avatarDrag&&Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>6){
      avatarDrag={id:event.pointerId};controls.enabled=false;
    }
    if(avatarDrag&&event.pointerId===avatarDrag.id){
      setPointer(event);selectionRay.setFromCamera(selectionPoint,camera);
      if(selectionRay.ray.intersectPlane(dragPlane,dragHit))spatial.setAvatarOffset(dragHit.x,dragHit.z);
    }
  };
  const pointerCancel=()=>{pointerStart=null;if(avatarDrag){avatarDrag=null;controls.enabled=true;}};
  const pointerUp=event=>{
    const start=pointerStart;pointerStart=null;
    const wasDrag=avatarDrag;avatarDrag=null;controls.enabled=true;
    if(!active||!start||event.pointerId!==start.id)return;
    if(wasDrag)return;
    if(Math.hypot(event.clientX-start.x,event.clientY-start.y)>6)return;
    if(start.avatar){greetAvatar();return;}
    setPointer(event);
    selectionRay.setFromCamera(selectionPoint,camera);
    const hit=selectionRay.intersectObjects(targets,false).find(item=>spatial.resolve(item.object));
    if(hit)selectObject(hit.object);
  };
  renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointermove',pointerMove);renderer.domElement.addEventListener('pointerup',pointerUp);renderer.domElement.addEventListener('pointercancel',pointerCancel);
  return {open,close,get active(){return active;},resolve:spatial.resolve,selectObject,
    chooseOutfit:(id)=>owner.chooseOutfit(id),
    setHologramTint:(tint,opacity)=>spatial.setHologramTint?.(tint,opacity),
    getEnvironmentTexture:()=>environmentTarget.texture,
    getSnapshot:()=>({...owner.getSnapshot(),opened:active,tab,spatial:spatial.getSnapshot()}),
    getContribution:owner.contribution,
    update(dt,time){if(!active)return;if(poseHeld)owner.moveRig(Number(find('[data-head]').value),Number(find('[data-arm]').value));spatial.update(dt,time,owner.getPose(),reducedMotion);},
    destroy(){close();unsubscribe();spatial.destroy();environmentTarget.dispose();root.remove();stylesheet.remove();globalThis.removeEventListener('resize',resize);renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointermove',pointerMove);renderer.domElement.removeEventListener('pointerup',pointerUp);renderer.domElement.removeEventListener('pointercancel',pointerCancel);}};
}
