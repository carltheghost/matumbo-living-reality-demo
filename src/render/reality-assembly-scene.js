/** Reference-inspired architecture over existing feature IDs. All city details
 * are designed geometry, never measurements of a real city or invented users. */
export function buildRealityAssemblyScene({THREE,parent,features,targets=[]}){
  const layer=new THREE.Group();layer.name='Reality Assembly / shared feature projection';layer.visible=false;parent.add(layer);
  const geometry=new Set(),materials=new Set(),selectable=[],nodes=new Map();
  const makeMaterial=(color,extra={})=>{const value=new THREE.MeshStandardMaterial({color,metalness:.55,roughness:.4,...extra});materials.add(value);return value;};
  const gold=makeMaterial('#b89961',{metalness:.68,roughness:.28}),dark=makeMaterial('#14273c',{metalness:.32}),glass=makeMaterial('#153954',{transparent:true,opacity:.44,depthWrite:false});
  const blue=makeMaterial('#5dafff',{emissive:'#147bc6',emissiveIntensity:1.35}),red=makeMaterial('#ae2848',{emissive:'#f02644',emissiveIntensity:1.8});
  const violet=makeMaterial('#8e6ccb',{emissive:'#65448a',emissiveIntensity:.7}),green=makeMaterial('#32695b');
  const unit=new THREE.BoxGeometry(1,1,1);geometry.add(unit);
  const colorById=id=>/person|rooms|social/.test(id)?violet:/world|gateway|sports/.test(id)?green:/asset|paycore|contract|ledger|t402/.test(id)?gold:blue;
  const mesh=(shape,material,position,scale,owner=layer)=>{geometry.add(shape);const m=new THREE.Mesh(shape,material);m.position.set(...position);m.scale.set(...scale);owner.add(m);return m;};
  const box=(size,position,material,owner=layer)=>mesh(unit,material,position,size,owner);
  const group=(name,owner=layer)=>{const g=new THREE.Group();g.name=name;owner.add(g);return g;};
  function frame(size,owner,material=blue){
    const edgeGeometry=new THREE.EdgesGeometry(new THREE.BoxGeometry(size,size,size));geometry.add(edgeGeometry);
    const edgeMaterial=new THREE.LineBasicMaterial({color:material.color,transparent:true,opacity:.66});materials.add(edgeMaterial);
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
  for(let index=0;index<features.length;index++){
    const feature=features[index],root=group(feature.id),accent=colorById(feature.id),scale=feature.id==='block-world'?1.8:feature.assemblyTier==='secondary'?.72:1.1;
    root.scale.setScalar(scale);
    const core=box([1.68,1.68,1.68],[0,0,0],dark,root);core.userData.assemblyId=feature.id;targets.push(core);selectable.push(core);
    frame(1.86,root,accent);
    const faces=[];
    for(const [axis,sign] of [[0,-1],[0,1],[1,-1],[1,1],[2,-1],[2,1]]){
      const pivot=group(`${feature.id}/face-${axis}-${sign}`,root),size=[1.8,1.8,1.8];size[axis]=.035;
      const center=[0,0,0];center[axis]=sign*.925;pivot.position.set(...center);
      const panel=box(size,[0,0,0],glass,pivot);panel.userData.assemblyId=feature.id;targets.push(panel);selectable.push(panel);
      faces.push({pivot,axis,sign,rest:sign*.925});
      for(const edge of [-.87,.87]){
        const trimSize=[.02,.02,.02],trimPosition=[0,0,0];trimSize[(axis+1)%3]=1.78;trimPosition[(axis+2)%3]=edge;
        box(trimSize,trimPosition,gold,pivot);
      }
    }
    const city=group(`${feature.id}/architectural-interior`,root),towers=[],lights=[],gardens=[];
    for(let k=0;k<17;k++){
      const x=((k*7)%5-2)*.31,z=((k*3)%5-2)*.31,h=.22+((k*11+index*3)%10)*.085;
      towers.push([x,.84+h/2,z,.19,h,.19]);
      lights.push([x-.095,.84+h/2,z+.098,.015,h,.014]);
      if(k%3===0){towers.push([x,.84+h+.1,z,.07,.22,.07]);gardens.push([x+.12,.97,z+.08,.13,.12,.14]);}
      for(let y=1;y<h*8;y++)lights.push([x,.9+y*.09,z+.101,.14,.013,.012]);
    }
    instances(towers,dark,city);instances(lights,accent,city);instances(gardens,green,city);
    box([1.76,.10,1.76],[0,.87,0],gold,city);
    const inner=group(`${feature.id}/inner-cells`,root);inner.visible=false;
    const children=feature.sources?.length?feature.sources.slice(0,4):['navigation'];
    children.forEach((source,i)=>{
      const cell=box([.40,.40,.40],[(i-(children.length-1)/2)*.52,0,1.4],accent,inner);cell.userData.assemblyId=feature.id;cell.userData.assemblySource=source;targets.push(cell);selectable.push(cell);
    });
    const beacon=box([.12,.12,.12],[0,2.40,0],red,root);
    const badge=box([.57,.67,.05],[0,0,.973],accent,root);badge.userData.assemblyId=feature.id;targets.push(badge);selectable.push(badge);
    // A geometric open-book/circuit marker, not a screenshot or text texture.
    box([.30,.025,.055],[0,.20,1.011],blue,root);box([.30,.025,.055],[0,-.20,1.011],blue,root);
    box([.025,.42,.055],[-.15,0,1.011],blue,root);box([.025,.42,.055],[.15,0,1.011],blue,root);
    nodes.set(feature.id,{root,core,faces,city,inner,beacon,open:0,goalOpen:0,position:new THREE.Vector3(),scale,feature});
  }
  const edges=features.filter(f=>f.id!=='block-world').map(f=>['block-world',f.id]);
  const connectionGeometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(edges.length*6),3));geometry.add(connectionGeometry);
  const connectionMaterial=new THREE.LineBasicMaterial({color:'#36a6d3',transparent:true,opacity:.34});materials.add(connectionMaterial);
  const connections=new THREE.LineSegments(connectionGeometry,connectionMaterial);connections.frustumCulled=false;layer.add(connections);
  let selected=null,hovered=null,mode='3d',viewState=null,focusId=null;
  const projectedPosition=new THREE.Vector3(),scatterDirection=new THREE.Vector3();
  function apply(snapshot,{viewMode='3d',hoveredId=null}={}){
    viewState=snapshot;selected=snapshot.selectedId;hovered=hoveredId;mode=viewMode;
    snapshot.objects.forEach(object=>{
      const node=nodes.get(object.id);if(!node)return;
      node.position.set(...object.position);node.goalOpen=object.open?1:object.id===hovered?.23:0;
    });
    connectionMaterial.color.set(snapshot.mode==='proposed'?'#b194ed':snapshot.mode==='past'?'#9a9fae':'#36a6d3');
  }
  function update(dt,time,{reducedMotion=false}={}){
    const blend=reducedMotion?1:1-Math.exp(-dt*9);
    for(const [id,node] of nodes){
      const level=id===selected?1:id===hovered?.55:0;
      projectedPosition.copy(node.position);
      if(focusId&&id!==focusId){scatterDirection.copy(node.position).sub(nodes.get(focusId).position).normalize().multiplyScalar(6);projectedPosition.add(scatterDirection);}
      node.root.position.lerp(projectedPosition,blend);node.open+=(node.goalOpen-node.open)*blend;
      const targetScale=node.scale*(focusId&&id!==focusId?.72:1);node.root.scale.lerp(new THREE.Vector3(targetScale,targetScale,targetScale),blend);
      node.faces.forEach(({pivot,axis,sign,rest})=>{
        const property=['x','y','z'][axis];pivot.position[property]=rest+sign*node.open*.72;
        pivot.rotation.set(0,0,0);if(axis!==1)pivot.rotation[(axis===0?'z':'x')]=sign*node.open*.65;
      });
      node.core.scale.setScalar(1-node.open*.35);node.inner.visible=node.open>.12;
      node.city.position.y=node.open*.55;node.root.rotation.y=reducedMotion?0:Math.sin(time*.18+node.scale)*.025;
      node.beacon.material=level?red:gold;
    }
    const buffer=connectionGeometry.attributes.position;
    edges.forEach(([from,to],i)=>{const a=nodes.get(from).root.position,b=nodes.get(to).root.position;buffer.setXYZ(i*2,a.x,a.y,a.z);buffer.setXYZ(i*2+1,b.x,b.y,b.z);});buffer.needsUpdate=true;
    grid.material.opacity=mode==='4d'?.09:.035;
  }
  function getSnapshot(){return {geometryOnly:true,referenceImagesUsedAsTextures:false,nodeIds:[...nodes.keys()],nodeCount:nodes.size,edgeCount:edges.length,viewMode:mode,selectedId:selected,historyMode:viewState?.mode??'present',designedArchitecture:true,equalAxisCubes:true};}
  return {layer,nodes,apply,update,getSnapshot,focus:id=>{focusId=nodes.has(id)?id:null;},resolve:object=>object?.userData?.assemblyId??null,
    destroy(){selectable.forEach(object=>{const i=targets.indexOf(object);if(i>=0)targets.splice(i,1);});geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());layer.removeFromParent();}};
}
