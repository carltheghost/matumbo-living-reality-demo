/** Unified glass-cube world. One Three.js design language: chunky volumetric
 * glass cubes — no flat label-constellation path.
 * - EXTREME far zoom merges the world into ONE giant CLEAN glass block: inner
 *   detail fades out across the merge until only the empty pulsing cube
 *   remains. The constellation stays distinct through the whole normal
 *   zoom-out range.
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
/** The constellation stays distinct through the whole normal zoom-out range;
 * only EXTREME far zoom (beyond this camera distance) merges the world into
 * ONE giant clean pulsing glass block. The merged cube's inner mini-cubes
 * fade out across the transition and are gone at full merge. */
export const LOD_FAR=160;
export function buildRealityAssemblyScene({THREE,parent,features,targets=[]}){
  const layer=new THREE.Group();layer.name='Reality Assembly / shared feature projection';layer.visible=false;parent.add(layer);
  const geometry=new Set(),materials=new Set(),selectable=[],nodes=new Map();
  const makeMaterial=(color,extra={})=>{const value=new THREE.MeshStandardMaterial({color,metalness:.55,roughness:.4,...extra});materials.add(value);return value;};
  const gold=makeMaterial('#b89961',{metalness:.68,roughness:.28}),dark=makeMaterial('#14273c',{metalness:.32});
  const baseGlass=makeMaterial('#153954',{transparent:true,opacity:.5,depthWrite:false,roughness:.15,metalness:.1});
  const blue=makeMaterial('#5dafff',{emissive:'#147bc6',emissiveIntensity:1.35}),red=makeMaterial('#ae2848',{emissive:'#f02644',emissiveIntensity:1.8});
  const violet=makeMaterial('#8e6ccb',{emissive:'#65448a',emissiveIntensity:.7}),green=makeMaterial('#32695b');
  const unit=new THREE.BoxGeometry(1,1,1);geometry.add(unit);
  // Advanced constellation layer: subtle orbital rings, luminous inner cores,
  // and moving signal particles make the graph feel alive while remaining a
  // pure renderer projection over the same feature identities.
  const haloGeometry=new THREE.TorusGeometry(1.28,.012,8,48);geometry.add(haloGeometry);
  const innerHaloGeometry=new THREE.TorusGeometry(.86,.008,6,36);geometry.add(innerHaloGeometry);
  const coreGeometry=new THREE.SphereGeometry(.16,12,12);geometry.add(coreGeometry);
  const signalGeometry=new THREE.SphereGeometry(.045,8,8);geometry.add(signalGeometry);
  const haloMaterials=new Map();
  const haloMaterialFor=(color)=>{
    const key=color?.getHexString?.()??String(color);
    if(!haloMaterials.has(key)){
      const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.22,depthWrite:false,blending:THREE.AdditiveBlending});
      materials.add(material);haloMaterials.set(key,material);
    }
    return haloMaterials.get(key);
  };
  const signalMaterial=new THREE.MeshBasicMaterial({color:'#86ecff',transparent:true,opacity:.52,depthWrite:false,blending:THREE.AdditiveBlending});
  materials.add(signalMaterial);
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

  // ONE giant block: the extreme far-zoom view of the whole world.
  // The approved clean-root camera parks at ~175 units (beyond LOD_FAR), but
  // the scene fog (FogExp2 .009, tuned for the ≤76-unit constellation range)
  // would fog 92% of the cube away at that distance and leave a black canvas.
  // The merged cube is exempt from fog so the single clean glass cube stays
  // visible; the constellation keeps its fog untouched.
  const worldBlock=group('world-block');worldBlock.visible=false;
  const wbGlass=makeMaterial('#1b4d6e',{transparent:true,opacity:0,depthWrite:false,roughness:.12,metalness:.15,emissive:'#0e5a8a',emissiveIntensity:.25,fog:false});
  const wbEdgeMat=new THREE.LineBasicMaterial({color:'#7fd4ff',transparent:true,opacity:0,fog:false});materials.add(wbEdgeMat);
  const wbCore=box([30,16,30],[0,2,0],wbGlass,worldBlock);wbCore.name='world-block/core';
  const wbEdgeGeo=new THREE.EdgesGeometry(new THREE.BoxGeometry(30,16,30));geometry.add(wbEdgeGeo);
  worldBlock.add(new THREE.LineSegments(wbEdgeGeo,wbEdgeMat));
  const wbHalo=new THREE.Mesh(new THREE.TorusGeometry(17.2,.035,8,64),haloMaterialFor(new THREE.Color('#58d9ff')));geometry.add(wbHalo.geometry);wbHalo.name='world-block/outer-halo';wbHalo.rotation.x=Math.PI/2;wbHalo.renderOrder=-1;worldBlock.add(wbHalo);
  const wbRand=traitRandom(hashString('matumbo:world-block'));
  const wbCellMat=makeMaterial('#2a6d96',{transparent:true,opacity:0,depthWrite:false,roughness:.2,fog:false});
  const wbCells=[];
  for(let i=0;i<8;i++){
    const s=2+wbRand()*3;
    const cell=box([s,s,s],[(wbRand()-.5)*22,2+(wbRand()-.5)*10,(wbRand()-.5)*22],wbCellMat,worldBlock);
    cell.name=`world-block/cell-${i}`;wbCells.push(cell);
  }
  // The extreme far-zoom cube is still a real six-sided object, not a blank
  // translucent shell. Each side gets its own colored door/window treatment so
  // the merged world retains the same materialized block language as the
  // close-up feature cubes.
  const wbFaceColors=['#48d7ff','#7ff0b7','#c59cff','#ffd166','#ff7188','#72a7ff'];
  const wbFaceSystems=[];
  const wbFrameMat=makeMaterial('#d9f7ff',{transparent:true,opacity:0,emissive:'#7fdfff',emissiveIntensity:.75,metalness:.7,roughness:.16,fog:false});
  [[0,-1],[0,1],[1,-1],[1,1],[2,-1],[2,1]].forEach(([axis,sign],faceIndex)=>{
    const face=group(`world-block/face-${axis}-${sign}`,worldBlock);
    const accent=wbFaceColors[faceIndex];
    const panelMat=makeMaterial(accent,{transparent:true,opacity:0,depthWrite:false,emissive:accent,emissiveIntensity:.95,metalness:.16,roughness:.2,fog:false});
    const glowMat=makeMaterial(accent,{transparent:true,opacity:0,depthWrite:false,emissive:accent,emissiveIntensity:1.65,metalness:.05,roughness:.18,fog:false});
    const panelDepth=.08;
    const panelSize=axis===1?[10,panelDepth,8]:axis===0?[panelDepth,7,9]:[10,7,panelDepth];
    const panelPos=[0,0,0];
    panelPos[axis]=sign*((axis===1?8:15)+.08);
    if(axis===1)panelPos[1]+=sign*.15; else panelPos[1]=1;
    const panel=box(panelSize,panelPos,panelMat,face);panel.name=`world-block/face-${axis}-${sign}/window`;
    const glowSize=axis===1?[6,.045,4.4]:axis===0?[.045,4.8,5.2]:[6,4.8,.045];
    const glowPos=[0,0,0];glowPos[axis]=sign*((axis===1?8:15)+.135);if(axis!==1)glowPos[1]=1;
    box(glowSize,glowPos,glowMat,face);
    const frameOuter=sign*((axis===1?8:15)+.18);
    const bars=[];
    if(axis===1){
      bars.push([[8.9,.05,.05],[frameOuter,1,3.75]],[[8.9,.05,.05],[frameOuter,1,-3.75]],[[.05,.05,7.6],[frameOuter,1,0]]);
    }else if(axis===0){
      bars.push([[.05,6.7,.05],[frameOuter,4.5,0]],[[.05,6.7,.05],[frameOuter,-2.5,0]],[[.05,.05,8.8],[frameOuter,1,4.4]],[[.05,.05,8.8],[frameOuter,1,-4.4]]);
    }else{
      bars.push([[8.9,.05,.05],[0,4.5,frameOuter]],[[8.9,.05,.05],[0,-2.5,frameOuter]],[[.05,6.7,.05],[4.45,1,frameOuter]],[[.05,6.7,.05],[-4.45,1,frameOuter]]);
    }
    bars.forEach(([size,pos],i)=>{const bar=box(size,pos,wbFrameMat,face);bar.name=`world-block/face-${axis}-${sign}/frame-${i}`;});
    const mini=axis===1?[[3.6,.22,2.7],[-3.6,.22,2.7],[3.6,.22,-2.7]]:axis===0?[[.22,3.7,3.9],[.22,3.7,-3.9],[.22,-2.1,3.9]]:[[3.6,2.7,.22],[-3.6,2.7,.22],[3.6,-2.1,.22]];
    mini.forEach((pos,i)=>{const mat=makeMaterial(['#7fdfff','#b892ff','#79f0b8'][i],{transparent:true,opacity:0,emissive:['#2ec9ff','#8050ff','#36d78f'][i],emissiveIntensity:.9,metalness:.3,roughness:.2,fog:false});box([.55,.55,.55],pos,mat,face);});
    wbFaceSystems.push({face,panelMaterial:panelMat,glowMaterial:glowMat,frameMaterial:wbFrameMat,phase:faceIndex*.9});
  });

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
    // Every cube gets the same intentional visual grammar: an orbital halo,
    // inner ring, luminous core and small corner pylons. These are decoration
    // only, so rotated and non-rotated cubes remain equally legible.
    const haloMat=haloMaterialFor(accent.color);
    const halo=new THREE.Mesh(haloGeometry,haloMat);halo.name=feature.id+'/halo';halo.scale.setScalar(.92);halo.renderOrder=-1;root.add(halo);
    const innerHalo=new THREE.Mesh(innerHaloGeometry,haloMaterialFor(accent.color));innerHalo.name=feature.id+'/inner-halo';innerHalo.rotation.x=Math.PI/2;innerHalo.scale.setScalar(.95);root.add(innerHalo);
    const glowCore=new THREE.Mesh(coreGeometry,haloMaterialFor(accent.color));glowCore.name=feature.id+'/glow-core';glowCore.renderOrder=1;root.add(glowCore);
    const cornerPositions=[[.96,.96,.96],[-.96,.96,.96],[.96,-.96,.96],[-.96,-.96,.96],[.96,.96,-.96],[-.96,.96,-.96],[.96,-.96,-.96],[-.96,-.96,-.96]];
    const cornerMat=makeMaterial(accent.color,{emissive:accent.color,emissiveIntensity:.65,metalness:.5,roughness:.2});
    cornerPositions.forEach((pos,i)=>{const pin=box([.085,.085,.085],pos,cornerMat,root);pin.name=feature.id+'/corner-'+i;});
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

    // The central/root cube is not a blank box. Each of its six faces gets
    // the same local-cube visual language: a colored door, a frame, and
    // three smaller attached blocks. Each side gets a different accent.
    if(feature.id==='block-world'){
      const faceColors=['#48d7ff','#7ff0b7','#c59cff','#ffd166','#ff7188','#72a7ff'];
      faces.forEach(({pivot,axis,sign},faceIndex)=>{
        const accentColor=faceColors[faceIndex%faceColors.length];
        const faceMat=makeMaterial(accentColor,{emissive:accentColor,emissiveIntensity:1.15,metalness:.18,roughness:.22});
        const depth=axis===1?.06:.055;
        const doorSize=axis===1?[.62,depth,.62]:axis===0?[depth,.82,.62]:[.62,.82,depth];
        const doorPos=[0,0,0];doorPos[axis]=sign*(depth*.62+.035);
        const door=box(doorSize,doorPos,faceMat,pivot);
        door.name=`${feature.id}/face-${axis}-${sign}/door`;
        door.userData.assemblyId=feature.id;
        const frameMat=makeMaterial('#d9f7ff',{emissive:'#7fdfff',emissiveIntensity:.7,metalness:.7,roughness:.16});
        const front=sign*(depth*.95+.07);
        if(axis===1){
          box([.72,.035,.035],[0,front,.37],frameMat,pivot);
          box([.72,.035,.035],[0,front,-.37],frameMat,pivot);
          box([.035,.035,.72],[-.37,front,0],frameMat,pivot);
          box([.035,.035,.72],[.37,front,0],frameMat,pivot);
        }else if(axis===0){
          box([.055,.9,.035],[front,.45,.0],frameMat,pivot);
          box([.055,.9,.035],[front,-.45,.0],frameMat,pivot);
          box([.055,.035,.72],[front,0,.37],frameMat,pivot);
          box([.055,.035,.72],[front,0,-.37],frameMat,pivot);
        }else{
          box([.035,.9,.055],[.37,.45,front],frameMat,pivot);
          box([.035,.9,.055],[-.37,.45,front],frameMat,pivot);
          box([.72,.035,.055],[0,.45,front],frameMat,pivot);
          box([.72,.035,.055],[0,-.45,front],frameMat,pivot);
        }
        const miniMats=[
          makeMaterial('#7fdfff',{emissive:'#2ec9ff',emissiveIntensity:.85,metalness:.35,roughness:.2}),
          makeMaterial('#b892ff',{emissive:'#8050ff',emissiveIntensity:.8,metalness:.3,roughness:.2}),
          makeMaterial('#79f0b8',{emissive:'#36d78f',emissiveIntensity:.8,metalness:.3,roughness:.2}),
        ];
        const miniPositions=axis===1
          ? [[-.78,sign*.12,.78],[.78,sign*.12,.78],[.78,sign*.12,-.78]]
          : axis===0
            ? [[sign*.12,.78,.78],[sign*.12,.78,-.78],[sign*.12,-.78,.78]]
            : [[.78,.78,sign*.12],[-.78,.78,sign*.12],[.78,-.78,sign*.12]];
        miniPositions.forEach((pos,i)=>{
          const mini=box([.22,.22,.22],pos,miniMats[i],pivot);
          mini.name=`${feature.id}/face-${axis}-${sign}/block-${i}`;
          mini.userData.assemblyId=feature.id;
        });
      });
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
    nodes.set(feature.id,{root,core,faces,city,inner,nested,beacon,beaconHot,beaconMat,halo,innerHalo,glowCore,traits,open:0,goalOpen:0,position:new THREE.Vector3(),scale,feature});
  }
  const edges=features.filter(f=>f.id!=='block-world').map(f=>['block-world',f.id]);
  const connectionGeometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(edges.length*6),3));geometry.add(connectionGeometry);
  const connectionMaterial=new THREE.LineBasicMaterial({color:'#36a6d3',transparent:true,opacity:.34});materials.add(connectionMaterial);
  const connections=new THREE.LineSegments(connectionGeometry,connectionMaterial);connections.frustumCulled=false;layer.add(connections);
  let selected=null,hovered=null,mode='3d',viewState=null,focusId=null,lodBlend=0;
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
    wbGlass.opacity=lodBlend*.5;wbEdgeMat.opacity=lodBlend*.85;
    // The merged far-zoom cube is CLEAN: inner mini-cubes fade out across the
    // transition and are fully hidden once the merge completes, leaving only
    // the empty pulsing glass cube (wbCore) and its edge frame (wbEdgeMat).
    wbCellMat.opacity=(1-lodBlend)*.4;
    for(const wbCell of wbCells)wbCell.visible=lodBlend<=.5;
    wbGlass.emissiveIntensity=.22+.14*Math.sin(time*.8);
    if(wbHalo){wbHalo.rotation.z=reducedMotion?0:time*.075;wbHalo.scale.setScalar(1+.018*Math.sin(time*.65));}
    wbFaceSystems.forEach(({face,panelMaterial,glowMaterial,frameMaterial,phase})=>{
      const pulse=.82+.18*Math.sin(time*.72+phase);
      panelMaterial.opacity=lodBlend*.72;
      glowMaterial.opacity=lodBlend*.32*pulse;
      frameMaterial.opacity=lodBlend*.72;
      face.visible=lodBlend>.02;
      panelMaterial.emissiveIntensity=.8+.28*pulse;
    });
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
      node.city.position.y=node.open*.55;
      if(node.halo){node.halo.rotation.z=reducedMotion?0:time*.11+node.traits.phase;node.halo.scale.setScalar(.9+.055*Math.sin(time*.8+node.traits.phase));}
      if(node.innerHalo){node.innerHalo.rotation.y=reducedMotion?0:time*.16-node.traits.phase*.4;}
      if(node.glowCore){node.glowCore.scale.setScalar(.92+.12*Math.sin(time*1.25+node.traits.phase)*.5+node.open*.08);}
      node.root.rotation.y=reducedMotion?0:Math.sin(time*.18+node.traits.phase)*.025;
      node.beacon.material=level?node.beaconHot:node.beaconMat;
    }
    if(!showWorld){edges.forEach(([from,to],i)=>{const a=nodes.get(from).root.position,b=nodes.get(to).root.position;buffer.setXYZ(i*2,a.x,a.y,a.z);buffer.setXYZ(i*2+1,b.x,b.y,b.z);});buffer.needsUpdate=true;}
    grid.material.opacity=mode==='4d'?.09:.035;
  }
  function getSnapshot(){return {geometryOnly:true,referenceImagesUsedAsTextures:false,nodeIds:[...nodes.keys()],nodeCount:nodes.size,edgeCount:edges.length,viewMode:mode,selectedId:selected,historyMode:viewState?.mode??'present',designedArchitecture:true,equalAxisCubes:true,lod:lodBlend>.5?'world-block':'features'};}
  return {layer,nodes,worldBlock,apply,update,getSnapshot,focus:id=>{focusId=nodes.has(id)?id:null;},resolve:object=>object?.userData?.assemblyId??null,
    destroy(){selectable.forEach(object=>{const i=targets.indexOf(object);if(i>=0)targets.splice(i,1);});geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());layer.removeFromParent();}};
}
