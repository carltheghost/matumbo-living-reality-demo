/** A single renderer/scene and the existing domain actions across desktop, VR and AR. */
export function createImmersiveSession({THREE,renderer,scene,camera,controls,targets,onSelect,documentRoot=document,navigatorRoot=navigator}) {
  let session=null,starting=false,restore=null;
  const rig=new THREE.Group();scene.add(rig);
  const ray=new THREE.Raycaster(),rotation=new THREE.Matrix4();
  const toolbar=documentRoot.createElement('div');toolbar.id='immersive-toolbar';
  toolbar.style.cssText='position:fixed;right:12px;top:8px;z-index:110;display:flex;gap:6px;flex-wrap:wrap;max-width:calc(100vw - 24px);background:#091723;padding:6px;border:1px solid #4e788f;border-radius:8px;font:12px system-ui;color:#d9efff';
  const status=documentRoot.createElement('span');status.setAttribute('role','status');status.textContent='Same world · XR';
  const buttons=[];
  function button(title,fn){const b=documentRoot.createElement('button');b.type='button';b.textContent=title;b.onclick=fn;toolbar.append(b);buttons.push(b);return b;}
  const vr=button('Enter VR',()=>start('immersive-vr'));
  const ar=button('Enter AR',()=>start('immersive-ar'));
  const leave=button('Exit XR',()=>session?.end());leave.hidden=true;toolbar.append(status);documentRoot.body.append(toolbar);
  renderer.xr.enabled=true;
  const controllers=[0,1].map(i=>{
    const controller=renderer.xr.getController(i);rig.add(controller);
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-1)]),new THREE.LineBasicMaterial({color:0xee455c}));
    line.scale.z=25;controller.add(line);
    controller.addEventListener('select',()=>{
      controller.updateWorldMatrix(true,false);rotation.identity().extractRotation(controller.matrixWorld);
      ray.ray.origin.setFromMatrixPosition(controller.matrixWorld);ray.ray.direction.set(0,0,-1).applyMatrix4(rotation);
      const hit=ray.intersectObjects(targets,false).find(h=>{let o=h.object;while(o){if(!o.visible)return false;o=o.parent;}return true;});
      if(hit)onSelect(hit.object);
    });
    return controller;
  });
  function reset(){
    if(restore){camera.position.copy(restore.position);camera.quaternion.copy(restore.quaternion);rig.remove(camera);if(restore.parent)restore.parent.add(camera);controls.enabled=restore.controlsEnabled;scene.background=restore.background;renderer.setClearAlpha(restore.alpha);rig.position.set(0,0,0);restore=null;}
    session=null;starting=false;leave.hidden=true;vr.disabled=false;ar.disabled=false;status.textContent='Desktop · same world retained';
  }
  async function start(mode){
    if(session||starting)return false;
    if(!navigatorRoot.xr?.requestSession){status.textContent='WebXR unavailable on this browser/device';return false;}
    starting=true;vr.disabled=true;ar.disabled=true;
    try{
      // The permission request happens directly in the user's click handler.
      session=await navigatorRoot.xr.requestSession(mode,{optionalFeatures:['local-floor','hand-tracking','dom-overlay'],domOverlay:{root:documentRoot.body}});
      restore={position:camera.position.clone(),quaternion:camera.quaternion.clone(),parent:camera.parent,controlsEnabled:controls.enabled,background:scene.background,alpha:renderer.getClearAlpha()};
      rig.position.copy(camera.position);rig.add(camera);camera.position.set(0,0,0);controls.enabled=false;
      if(mode==='immersive-ar'){scene.background=null;renderer.setClearAlpha(0);}
      renderer.xr.setReferenceSpaceType('local');session.addEventListener('end',reset,{once:true});
      await renderer.xr.setSession(session);
      starting=false;leave.hidden=false;status.textContent=`${mode==='immersive-ar'?'AR':'VR'} · point + pinch / trigger to open cube`;
      return true;
    }catch(error){const failed=session;try{await failed?.end();}catch{}reset();status.textContent=`XR not started: ${error.name||'unavailable'}`;return false;}
  }
  return {start,get active(){return Boolean(session);},get session(){return session;},destroy:async()=>{await session?.end();toolbar.remove();controllers.forEach(c=>{for(const child of c.children){child.geometry?.dispose();child.material?.dispose();}});scene.remove(rig);}};
}
