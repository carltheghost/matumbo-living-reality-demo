/** Unified glass-cube world. One Three.js design language: chunky volumetric
 * glass cubes — no flat label-constellation path.
 * - Far zoom merges the world into ONE giant glass block (the start view).
 * - Approaching springs cubes open; nested cubes inside spring open in turn.
 * - Per-cube traits are deterministic and local (visual uniqueness only).
 *   No chain, no wallet, no minting — projection only, never an authority. */
function hashString(value){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function traitRandom(seed){let state=(seed>>>0)||1;return ()=>{state=Math.imul(state^(state>>>15),2246822507);state=Math.imul(state^(state>>>13),3266489909);state^=state>>>16;return (state>>>0)/4294967296;};}
/** Deterministic visual traits per cube id. Same id → same traits, always. */
export function featureTraits(id){
  const rand=traitRandom(hashString(`matumbo-cube:${id}`));
  return {
    hueShift:(rand()-.5)*.14, satShift:(rand()-.5)*.18, lightShift:(rand()-.5)*.1,
    glassLight:(rand()-.5)*.12, glow:.7+rand()*.7,
    beaconVariant:Math.floor(rand()*3), trimCount:2+Math.floor(rand()*3),
    interiorSeed:Math.floor(rand()*1e9), phase:rand()*Math.PI*2,
  };
}
const BEACON_COLORS=['#ae2848','#d0a03c','#3fa9e0'];
export function buildRealityAssemblyScene({THREE,parent,features,targets=[]}){
  const layer=new THREE.Group();layer.name='Reality Assembly / shared feature projection';layer.visible=false;parent.add(layer);
  const geometry=new Set(),materials=new Set(),selectable=[],nodes=new Map();
  const makeMaterial=(color,extra={})=>{const value=new THREE.MeshStandardMaterial({color,metalness:.55,roughness:.4,...extra});materials.add(value);return value;};
  const gold=makeMaterial('#b89961',{metalness:.68,roughness:.28}),dark=makeMaterial('#14273c',{metalness:.32});
  const baseGlass=makeMaterial('#153954',{transparent:true,opacity:.5,depthWrite:false,roughness:.15,metalness:.1});
  const blue=makeMaterial('#5dafff',{emissive:'#147bc6',emissiveIntensity:1.35}),red=makeMaterial('#ae2848',{emissive:'#f02644',emissiveIntensity:1.8});
  const violet=makeMaterial('#8e6ccb',{emissive:'#65448a',emissiveIntensity:.7}),green=makeMaterial('#32695b');
  const unit=new THREE.BoxGeometry(1,1,1);geometry.add(unit);
  const colorById=id=>/person|rooms|social/.test(id)?violet:/world|gateway|sports/.test(id)?green:/asset|paycore|contract|ledger|t402/.test(id)?gold:blue;
  const mesh=(shape,material,position,scale,owner=layer)=>{geometry.add(shape);const m=new THREE.Mesh(shape,material);m.position.set(...position);m.scale.set(...scale);owner.add(m);return m;};
  const box=(size,position,material,owner=layer)=>mesh(unit,material,position,size,owner);
  const group=(name,owner=layer)=>{const g=new THREE.Group();g.name=name;owner.add(g);return g;};
  function frame(size,owner,material){
    const edgeGeometry=new THREE.EdgesGeometry(new THREE.BoxGeometry(size,size,size));geometry.add(edgeGeometry);
    const edgeMaterial=new THREE.LineBasicMaterial({color:material.color?material.color.getHex():material,transparent:true,opacity:.8});materials.add(edgeMaterial);
    const lines=new THREE.LineSegments(edgeGeometry,edgeMaterial);owner.add(lines);return lines;
  }
  function instances(items,material,owner){
    if(!items.length)return;
    const batch=new THREE.InstancedMesh(unit,material,items.length),matrix=new THREE.Object3D();
    items.forEach(([x,y,z,w,h,d],i)=>{matrix.position.set(x,y,z);matrix.scale.set(w,h,d);matrix.updateMatrix();batch.setMatrixAt(i,matrix.matrix);});
    batch.instanceMatrix.needsUpdate=true;owner.add(batch);return batch;
  }
  const gridVertices=[];
  for(let i=-24;i<=24;i+=6)for(let j=-8;j<=8;j+=8){
    gridVertices.push(-28,j,i,28,j,i,i,j,-28,i,j,28);
    if(i%8===0)gridVertices.push(i,-12,j*2,i,12,j*2);
  }
  const gridGeometry=new THREE.BufferGeometry();gridGeometry.setAttribute('position',new THREE.Float32BufferAttribute(gridVertices,3));geometry.add(gridGeometry);
  const gridMaterial=new THREE.LineBasicMaterial({color:'#265b7b',transparent:true,opacity:.04});materials.add(gridMaterial);
  const grid=new THREE.LineSegments(gridGeometry,gridMaterial);layer.add(grid);
  // Bounded deterministic star field, not a live astronomical catalogue.
  const points=[];for(let i=0;i<360;i++){const a=i*2.399963,b=((i*37)%181)/180*Math.PI,r=52+(i%7);points.push(Math.cos(a)*Math.sin(b)*r,Math.cos(b)*r,Math.sin(a)*Math.sin(b)*r);}
  const starGeometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry.add(starGeometry);
  const starMaterial=new THREE.PointsMaterial({color:'#92adc7',size:.06,transparent:true,opacity:.7,sizeAttenuation:true});materials.add(starMaterial);layer.add(new THREE.Points(starGeometry,starMaterial));
  layer.add(new THREE.HemisphereLight('#a8cfff','#08101a',1.1));
  const warm=new THREE.DirectionalLight('#fce2b6',2.4);warm.position.set(-7,14,10);layer.add(warm);

  // ONE giant block: the far-zoom / start view of the whole world.
  const worldBlock=group('world-block');worldBlock.visible=false;
  const wbGlass=makeMaterial('#1b4d6e',{transparent:true,opacity:0,depthWrite:false,roughness:.12,metalness:.15,emissive:'#0e5a8a',emissiveIntensity:.25});
  const wbEdgeMat=new THREE.LineBasicMaterial({color:'#7fd4ff',transparent:true,opacity:0});materials.add(wbEdgeMat);
  const wbCore=box([30,16,30],[0,2,0],wbGlass,worldBlock);wbCore.name='world-block/core';
  const wbEdgeGeo=new THREE.EdgesGeometry(new THREE.BoxGeometry(30,16,30));geometry.add(wbEdgeGeo);
  worldBlock.add(new THREE.LineSegments(wbEdgeGeo,wbEdgeMat));
  const wbRand=traitRandom(hashString('matumbo:world-block'));
  const wbCellMat=makeMaterial('#2a6d96',{transparent:true,opacity:0,depthWrite:false,roughness:.2});
  for(let i=0;i<8;i++){
    const s=2+wbRand()*3;
    const cell=box([s,s,s],[(wbRand()-.5)*22,2+(wbRand()-.5)*10,(wbRand()-.5)*22],wbCellMat,worldBlock);
    cell.name=`world-block/cell-${i}`;
  }

  const CORE=2.0,FACE=2.14,REST=CORE/2+.09;
  for(let index=0;index<features.length;index++){
    const feature=features[index],traits=featureTraits(feature.id),root=group(feature.id);
    const accentBase=colorById(feature.id);
    const accent=makeMaterial('#000000');accent.color.copy(accentBase.color).offsetHSL(traits.hueShift,traits.satShift,traits.lightShift);
    accent.emissive.copy(accentBase.emissive||new THREE.Color('#000000')).offsetHSL(traits.hueShift,0,traits.lightShift);
    accent.emissiveIntensity=(accentBase.emissiveIntensity||1)*traits.glow;
    const glass=makeMaterial('#153954',{transparent:true,opacity:.52,depthWrite:false,roughness:.15,metalness:.1});
    glass.color.offsetHSL(traits.hueShift,0,traits.glassLight);
    const scale=feature.id==='block-world'?2.2:feature.assemblyTier==='secondary'?.9:1.35;
    root.scale.setScalar(scale);
    const core=box([CORE,CORE,CORE],[0,0,0],dark,root);core.userData.assemblyId=feature.id;targets.push(core);selectable.push(core);
    frame(FACE,root,accent);
    const faces=[];
    for(const [axis,sign] of [[0,-1],[0,1],[1,-1],[1,1],[2,-1],[2,1]]){
      const pivot=group(`${feature.id}/face-${axis}-${sign}`,root),size=[FACE,FACE,FACE];size[axis]=.04;
      const center=[0,0,0];center[axis]=sign*REST;pivot.position.set(...center);
      const panel=box(size,[0,0,0],glass,pivot);panel.userData.assemblyId=feature.id;targets.push(panel);selectable.push(panel);
      faces.push({pivot,axis,sign,rest:sign*REST});
      for(let t=0;t<traits.trimCount;t++){
        const edge=-.87+t*(1.74/Math.max(1,traits.trimCount-1));
        const trimSize=[.02,.02,.02],trimPosition=[0,0,0];trimSize[(axis+1)%3]=FACE-.08;trimPosition[(axis+2)%3]=edge;
        box(trimSize,trimPosition,gold,pivot);
      }
    }
    const rand=traitRandom(traits.interiorSeed);
    const city=group(`${feature.id}/architectural-interior`,root),towers=[],lights=[],gardens=[];
    for(let k=0;k<17;k++){
      const x=(rand()*4-2)*.34,z=(rand()*4-2)*.34,h=.22+rand()*.85;
      towers.push([x,1+h/2,z,.19,h,.19]);
      lights.push([x-.095,1+h/2,z+.098,.015,h,.014]);
      if(k%3===0){towers.push([x,1.1+h,z,.07,.22,.07]);gardens.push([x+.12,1.15,z+.08,.13,.12,.14]);}
      for(let y=1;y<h*8;y++)lights.push([x,1.02+y*.09,z+.101,.14,.013,.012]);
    }
    instances(towers,dark,city);instances(lights,accent,city);instances(gardens,green,city);
    box([1.9,.1,1.9],[0,1.02,0],gold,city);
    // Recursive nesting: each inner cell is itself a glass cube that springs
    // open to reveal sub-cubes as you keep approaching.
    const inner=group(`${feature.id}/inner-cells`,root);inner.visible=false;
    const nested=[];
    const children=feature.sources?.length?feature.sources.slice(0,4):['navigation'];
    children.forEach((source,i)=>{
      const cellGroup=group(`${feature.id}/cell-${i}`,inner);
      const restX=(i-(children.length-1)/2)*.72;
      cellGroup.position.set(restX,0,CORE/2+.78);
      const cell=box([.5,.5,.5],[0,0,0],glass,cellGroup);
      cell.userData.assemblyId=feature.id;cell.userData.assemblySource=source;targets.push(cell);selectable.push(cell);
      frame(.56,cellGroup,accent);
      const subs=[];
      for(const [sx,sy,sz] of [[0,.48,0],[0,-.48,0],[.48,0,0]]){
        const sub=box([.17,.17,.17],[sx,sy,sz],accent,cellGroup);sub.visible=false;subs.push(sub);
      }
      nested.push({group:cellGroup,subs,open:0,restX});
    });
    const beaconMat=makeMaterial(BEACON_COLORS[traits.beaconVariant],{emissive:BEACON_COLORS[traits.beaconVariant],emissiveIntensity:1.8});
    const beacon=box([.14,.14,.14],[0,2.85,0],beaconMat,root);
    const beaconHot=makeMaterial('#f02644',{emissive:'#f02644',emissiveIntensity:2.2});
    const badge=box([.68,.8,.06],[0,0,CORE/2+.11],accent,root);badge.userData.assemblyId=feature.id;targets.push(badge);selectable.push(badge);
    // A geometric open-book/circuit marker, not a screenshot or text texture.
    box([.34,.03,.06],[0,.24,CORE/2+.16],blue,root);box([.34,.03,.06],[0,-.24,CORE/2+.16],blue,root);
    box([.03,.5,.06],[-.17,0,CORE/2+.16],blue,root);box([.03,.5,.06],[.17,0,CORE/2+.16],blue,root);
    nodes.set(feature.id,{root,core,faces,city,inner,nested,beacon,beaconHot,beaconMat,traits,open:0,goalOpen:0,position:new THREE.Vector3(),scale,feature});
  }
  const edges=features.filter(f=>f.id!=='block-world').map(f=>['block-world',f.id]);
  const connectionGeometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(edges.length*6),3));geometry.add(connectionGeometry);
  const connectionMaterial=new THREE.LineBasicMaterial({color:'#36a6d3',transparent:true,opacity:.34});materials.add(connectionMaterial);
  const connections=new THREE.LineSegments(connectionGeometry,connectionMaterial);connections.frustumCulled=false;layer.add(connections);
  let selected=null,hovered=null,mode='3d',viewState=null,focusId=null,lodBlend=0;
  const LOD_FAR=40;
  const projectedPosition=new THREE.Vector3(),scatterDirection=new THREE.Vector3();
  function apply(snapshot,{viewMode='3d',hoveredId=null}={}){
    viewState=snapshot;selected=snapshot.selectedId;hovered=hoveredId;mode=viewMode;
    snapshot.objects.forEach(object=>{
      const node=nodes.get(object.id);if(!node)return;
      node.position.set(...object.position);node.goalOpen=object.open?1:object.id===hovered?.23:0;
    });
    connectionMaterial.color.set(snapshot.mode==='proposed'?'#b194ed':snapshot.mode==='past'?'#9a9fae':'#36a6d3');
  }
  function update(dt,time,{reducedMotion=false,cameraDistance=0,cameraPosition=null}={}){
    const blend=reducedMotion?1:1-Math.exp(-dt*9);
    lodBlend+=((cameraDistance>LOD_FAR?1:0)-lodBlend)*blend;
    const showWorld=lodBlend>.5;
    worldBlock.visible=lodBlend>.02;
    wbGlass.opacity=lodBlend*.5;wbEdgeMat.opacity=lodBlend*.85;wbCellMat.opacity=lodBlend*.4;
    wbGlass.emissiveIntensity=.22+.14*Math.sin(time*.8);
    connections.visible=!showWorld;
    const buffer=connectionGeometry.attributes.position;
    for(const [id,node] of nodes){
      node.root.visible=!showWorld;
      if(showWorld)continue;
      const level=id===selected?1:id===hovered?.55:0;
      projectedPosition.copy(node.position);
      if(focusId&&id!==focusId){scatterDirection.copy(node.position).sub(nodes.get(focusId).position).normalize().multiplyScalar(6);projectedPosition.add(scatterDirection);}
      node.root.position.lerp(projectedPosition,blend);
      let proximityOpen=0,nodeDist=Infinity;
      if(cameraPosition){nodeDist=cameraPosition.distanceTo(node.root.position);proximityOpen=Math.max(0,Math.min(1,1-(nodeDist-9)/16))*.9;}
      const targetOpen=Math.max(node.goalOpen,proximityOpen);
      node.open+=(targetOpen-node.open)*blend;
      const targetScale=node.scale*(focusId&&id!==focusId?.72:1);node.root.scale.lerp(new THREE.Vector3(targetScale,targetScale,targetScale),blend);
      node.faces.forEach(({pivot,axis,sign,rest})=>{
        const property=['x','y','z'][axis];pivot.position[property]=rest+sign*node.open*.72;
        pivot.rotation.set(0,0,0);if(axis!==1)pivot.rotation[(axis===0?'z':'x')]=sign*node.open*.65;
      });
      node.core.scale.setScalar(1-node.open*.35);node.inner.visible=node.open>.12;
      for(const cell of node.nested){
        const goal=(node.open>.55&&nodeDist<22)?1:0;
        cell.open+=(goal-cell.open)*blend;
        cell.group.scale.setScalar(1+cell.open*.3);
        cell.group.position.set(cell.restX,cell.open*.4,CORE/2+.78+cell.open*.3);
        for(const sub of cell.subs)sub.visible=cell.open>.3;
      }
      node.city.position.y=node.open*.55;node.root.rotation.y=reducedMotion?0:Math.sin(time*.18+node.traits.phase)*.025;
      node.beacon.material=level?node.beaconHot:node.beaconMat;
    }
    if(!showWorld){edges.forEach(([from,to],i)=>{const a=nodes.get(from).root.position,b=nodes.get(to).root.position;buffer.setXYZ(i*2,a.x,a.y,a.z);buffer.setXYZ(i*2+1,b.x,b.y,b.z);});buffer.needsUpdate=true;}
    grid.material.opacity=mode==='4d'?.09:.035;
  }
  function getSnapshot(){return {geometryOnly:true,referenceImagesUsedAsTextures:false,nodeIds:[...nodes.keys()],nodeCount:nodes.size,edgeCount:edges.length,viewMode:mode,selectedId:selected,historyMode:viewState?.mode??'present',designedArchitecture:true,equalAxisCubes:true,lod:lodBlend>.5?'world-block':'features'};}
  return {layer,nodes,worldBlock,apply,update,getSnapshot,focus:id=>{focusId=nodes.has(id)?id:null;},resolve:object=>object?.userData?.assemblyId??null,
    destroy(){selectable.forEach(object=>{const i=targets.indexOf(object);if(i>=0)targets.splice(i,1);});geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());layer.removeFromParent();}};
}
