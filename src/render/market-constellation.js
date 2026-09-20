import * as THREE from 'three';
import {
  GLASS_BASE_HEX,
  glassTintFor,
  glassEdgeMaterialParams,
  makeGlassCubeMaterial,
  makeConnectionLines,
  makeStarfield,
  addGlassLighting,
} from './glass-style.js?v=20260920-p239';

/** Geometry is a view, never the authority for contract records. Packet 239:
 * the covenant graph uses one glass-block language — every contract/pool node
 * is a translucent blue glass cube, edges are connection lines. */
export function mountMarketConstellation({host,onSelect}) {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));host.append(renderer.domElement);
  renderer.domElement.style.cssText='width:100%;height:100%;touch-action:none';
  renderer.domElement.setAttribute('aria-label','Contract cubes. Drag to orbit, wheel to zoom. Normal-view buttons provide keyboard selection.');
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.1,300),group=new THREE.Group();scene.add(group);
  addGlassLighting(THREE,scene);
  scene.add(makeStarfield(THREE));
  let meshes=[],yaw=.5,pitch=.5,distance=12,visible=true,pointer=null;
  const raycaster=new THREE.Raycaster();
  // One cube style: shared unit geometry, canonical glass, glowing edge frame.
  const unit=new THREE.BoxGeometry(1.2,1.2,1.2);
  const glowGeo=new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1));
  const glowNormal=new THREE.LineBasicMaterial(glassEdgeMaterialParams());
  const glowSelected=new THREE.LineBasicMaterial(glassEdgeMaterialParams({color:'#ffcf8a',opacity:1}));
  const glassMaterial=makeGlassCubeMaterial(THREE,GLASS_BASE_HEX);
  const faceMaterial=makeGlassCubeMaterial(THREE,glassTintFor('#5dafff',.55),{opacity:.45});
  function glassEdgeMesh(selected){
    const marker=new THREE.LineSegments(glowGeo,selected?glowSelected:glowNormal);
    marker.name='market-constellation/glow-frame';
    marker.renderOrder=4;
    marker.scale.set(1.2,1.2,1.2);
    return marker;
  }
  function dispose(){group.traverse(o=>{if(o.geometry&&o.geometry!==unit&&o.geometry!==glowGeo)o.geometry?.dispose();if(o.material&&o.material!==glassMaterial&&o.material!==faceMaterial&&o.material!==glowNormal&&o.material!==glowSelected)o.material?.dispose();});group.clear();}
  function update(records,selected){dispose();meshes=[];const positions=new Map();let row=0;
    function place(record,depth){positions.set(record.id,new THREE.Vector3(depth*2.2,0,row++*2));for(const child of records.filter(r=>r.parentId===record.id))place(child,depth+1);}
    records.filter(r=>!r.parentId).forEach(r=>place(r,0));
    const center=new THREE.Vector3();for(const p of positions.values())center.add(p);if(positions.size)center.divideScalar(positions.size);for(const p of positions.values())p.sub(center);
    for(const record of records){
      const isSelected=record.id===selected;
      const mesh=new THREE.Mesh(unit,glassMaterial);
      mesh.position.copy(positions.get(record.id));mesh.userData.id=record.id;group.add(mesh);meshes.push(mesh);
      mesh.add(glassEdgeMesh(isSelected));
      // Selection opens six face panels like petals around the immutable core.
      if(isSelected)for(const [x,y,z] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
        const face=new THREE.Mesh(new THREE.BoxGeometry(x?.08:.95,y?.08:.95,z?.08:.95),faceMaterial);face.position.set(x*1.05,y*1.05,z*1.05);mesh.add(face);
      }
    }
    // Every parent → child link is a connection line, never a multicolor bar.
    const linkPairs=[];
    for(const record of records)if(record.parentId&&positions.has(record.parentId))linkPairs.push([positions.get(record.parentId),positions.get(record.id)]);
    if(linkPairs.length)group.add(makeConnectionLines(THREE,linkPairs));
    host.dataset.objectIds=JSON.stringify(records.map(r=>r.id));host.dataset.selectedId=selected||'';draw();
  }
  function draw(){if(!visible||host.hidden)return;const width=host.clientWidth,height=host.clientHeight;if(!width||!height)return;renderer.setSize(width,height,false);camera.aspect=width/height;camera.position.set(distance*Math.sin(yaw)*Math.cos(pitch),distance*Math.sin(pitch),distance*Math.cos(yaw)*Math.cos(pitch));camera.lookAt(0,0,0);camera.updateProjectionMatrix();renderer.render(scene,camera);}
  renderer.domElement.addEventListener('pointerdown',e=>{pointer={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY};renderer.domElement.setPointerCapture(e.pointerId);});
  renderer.domElement.addEventListener('pointermove',e=>{if(!pointer)return;yaw-=(e.clientX-pointer.lastX)*.008;pitch=Math.max(-1.3,Math.min(1.3,pitch+(e.clientY-pointer.lastY)*.008));pointer.lastX=e.clientX;pointer.lastY=e.clientY;draw();});
  renderer.domElement.addEventListener('pointerup',e=>{if(!pointer)return;const moved=Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y);pointer=null;if(moved>5)return;const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera);const hit=raycaster.intersectObjects(meshes,false)[0];if(hit)onSelect(hit.object.userData.id);});
  renderer.domElement.addEventListener('pointercancel',()=>{pointer=null;});
  renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();distance=Math.max(3,Math.min(200,distance+e.deltaY*.01));draw();},{passive:false});
  const observer=new ResizeObserver(draw);observer.observe(host);draw();
  addEventListener('pagehide',()=>{observer.disconnect();dispose();unit.dispose();glowGeo.dispose();glowNormal.dispose();glowSelected.dispose();glassMaterial.dispose();faceMaterial.dispose();renderer.dispose();},{once:true});
  return {update,setVisible(value){visible=value;draw();},getSnapshot(){const bounds=renderer.domElement.getBoundingClientRect();return {ids:meshes.map(m=>m.userData.id),targets:meshes.map(mesh=>{const point=mesh.position.clone().project(camera);return {id:mesh.userData.id,x:bounds.left+(point.x+1)*bounds.width/2,y:bounds.top+(1-point.y)*bounds.height/2};})};}};
}
