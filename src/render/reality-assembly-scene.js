import {REALITY_TAB_FORMS} from '../domains/reality-tab-layout.js?v=20260923-spatial-tabs14';
import {REALITY_LENS_GROUPS,realityLensEngine,resolveRealityLensGroup} from '../domains/reality-lens-engine.js?v=20260923-lens-engine4';

/** Shape-changing, image-bearing feature tabs only; the former central cube is
 * now the same status and geometry as every other Reality Lens object. */
function hashString(value){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function traitRandom(seed){let state=(seed>>>0)||1;return ()=>{state=Math.imul(state^(state>>>15),2246822507);state=Math.imul(state^(state>>>13),3266489909);state^=state>>>16;return (state>>>0)/4294967296;};}
/** Deterministic local color and motion traits. */
export function featureTraits(id){
  const rand=traitRandom(hashString(`matumbo-cube:${id}`));
  return {
    hueShift:(rand()-.5)*.14, satShift:(rand()-.5)*.18, lightShift:(rand()-.5)*.1,
    glassLight:(rand()-.5)*.12, glow:.7+rand()*.7,
    beaconVariant:Math.floor(rand()*3), trimCount:2+Math.floor(rand()*3),
    interiorSeed:Math.floor(rand()*1e9), phase:rand()*Math.PI*2,
  };
}
const BEACON_COLORS=['#98664f','#d0a03c','#5b8991'];
/** At this distance and beyond, the user sees only the small central anchor. */
export const LOD_FAR=160;
export const LENS_UNFOLD_END=64;
export function createRealityLensBackdrop(THREE,width=512,height=256){
  const data=new Uint8Array(width*height*4);
  const clamp=value=>Math.max(0,Math.min(255,Math.round(value)));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=x/(width-1),v=y/(height-1),bandDistance=(v-(.52-.2*(u-.5)))/.17;
    const band=Math.exp(-.5*bandDistance*bandDistance);
    const bloom=(cx,cy,sx,sy)=>Math.exp(-.5*((u-cx)/sx)**2-.5*((v-cy)/sy)**2);
    const blue=bloom(.52,.49,.23,.3),teal=bloom(.78,.66,.16,.21),violet=bloom(.2,.27,.17,.23),warm=bloom(.36,.61,.12,.13);
    const grain=(Math.sin(x*12.9898+y*78.233)*43758.5453)%1;
    const offset=(y*width+x)*4;
    data[offset]=clamp(3+band*5+blue*5+teal*3+violet*5+warm*5+grain*.8);
    data[offset+1]=clamp(5+band*12+blue*11+teal*14+violet*4+warm*7+grain*1.4);
    data[offset+2]=clamp(13+band*27+blue*22+teal*27+violet*23+warm*13+grain*2);
    data[offset+3]=255;
  }
  const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.UnsignedByteType);
  texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
  return texture;
}
function roundedPanelShape(THREE,width,height,radius){
  const x=-width/2,y=-height/2,r=Math.min(radius,width/3,height/3),shape=new THREE.Shape();
  shape.moveTo(x+r,y);shape.lineTo(x+width-r,y);shape.quadraticCurveTo(x+width,y,x+width,y+r);
  shape.lineTo(x+width,y+height-r);shape.quadraticCurveTo(x+width,y+height,x+width-r,y+height);
  shape.lineTo(x+r,y+height);shape.quadraticCurveTo(x,y+height,x,y+height-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);
  return shape;
}
function wavePanelShape(THREE,width,height){
  const shape=new THREE.Shape(),steps=28;
  for(let i=0;i<=steps;i++){
    const x=-width/2+width*i/steps,y=height/2+Math.sin(i/steps*Math.PI*4)*height*.075;
    if(i===0)shape.moveTo(x,y);else shape.lineTo(x,y);
  }
  for(let i=steps;i>=0;i--){const x=-width/2+width*i/steps,y=-height/2+Math.sin(i/steps*Math.PI*4+Math.PI)*height*.075;shape.lineTo(x,y);}
  shape.closePath();return shape;
}
function tabSurfaceDepth(node,x,y,extra=.012){
  const form=REALITY_TAB_FORMS[node.shape]??REALITY_TAB_FORMS.rectangle;
  if(node.shape==='sphere'){
    const radius=Math.min(form.width,form.height,form.depth)/2;
    return Math.sqrt(Math.max(.01,radius*radius-x*x-y*y))+extra;
  }
  if(node.shape==='cylinder'){
    const radius=Math.min(form.width,form.depth)/2;
    return Math.sqrt(Math.max(.01,radius*radius-x*x))+extra;
  }
  return (node.shape==='cube'?form.depth/2:form.depth)+extra;
}
function positionEmbeddedData(node){
  const form=REALITY_TAB_FORMS[node.shape]??REALITY_TAB_FORMS.rectangle;
  const sourceSlots=[[-.25*form.width,-.06*form.height],[.25*form.width,-.06*form.height],[-.25*form.width,-.18*form.height],[.25*form.width,-.18*form.height]];
  node.sourceObjects?.forEach((object,index)=>{
    const [x,y]=sourceSlots[index]??[0,-.18*form.height];
    object.position.set(x,y,tabSurfaceDepth(node,x,y,.028));object.scale.setScalar(.44);
  });
  const detailSlots=[[-.17*form.width,-.34*form.height],[0,-.34*form.height],[.17*form.width,-.34*form.height]];
  node.nestedObjects?.forEach((object,index)=>{
    const [x,y]=detailSlots[index]??[0,-.34*form.height];
    object.position.set(x,y,tabSurfaceDepth(node,x,y,.05));object.scale.setScalar(.62);
  });
}
function drawFeatureArtwork(THREE,feature,color,shapeName){
  const canvas=globalThis.document?.createElement?.('canvas');
  if(!canvas)return null;
  canvas.width=768;canvas.height=512;
  const ctx=canvas.getContext('2d');if(!ctx)return null;
  const hex=color?.getHexString?`#${color.getHexString()}`:'#52c8ed';
  if(shapeName==='phone'){
    canvas.width=512;canvas.height=896;
    const portrait=canvas.getContext('2d'),margin=30,width=452;
    portrait.beginPath();portrait.roundRect(8,8,496,880,44);portrait.clip();
    const fill=portrait.createLinearGradient(0,0,512,896);fill.addColorStop(0,'#102538');fill.addColorStop(.5,'#07131f');fill.addColorStop(1,'#0d1b27');portrait.fillStyle=fill;portrait.fillRect(0,0,512,896);
    portrait.fillStyle='#8ca99f';portrait.font='600 13px system-ui,sans-serif';portrait.letterSpacing='1.5px';portrait.fillText('REALITY LENS  /  SUPERFICIES VIVA',margin,48,width);
    portrait.fillStyle=hex;portrait.fillRect(margin,68,width,2);
    portrait.fillStyle='#dbe1d9';portrait.font='600 30px system-ui,sans-serif';portrait.letterSpacing='-.4px';portrait.fillText(String(feature.id==='block-world'?'Cubus centralis':feature.label??feature.id).replace(/\bworlds?\b/gi,'locus').slice(0,25),margin,123,width);
    portrait.fillStyle='#94aaa1';portrait.font='600 12px ui-monospace,monospace';portrait.letterSpacing='.8px';portrait.fillText(String(feature.id??'').replace(/(^|-)world(?=-|$)/gi,'$1locus').toUpperCase().slice(0,36),margin,150,width);
    portrait.fillStyle='#adbbb2';portrait.font='17px system-ui,sans-serif';portrait.letterSpacing='0px';
    const wrapPortrait=(text,x,y,maxWidth,lineHeight,maxLines)=>{const words=String(text??'').replace(/\s+/g,' ').split(' ');let line='',lines=0;for(const word of words){const next=line?`${line} ${word}`:word;if(portrait.measureText(next).width>maxWidth&&line){portrait.fillText(line,x,y+lines*lineHeight);line=word;if(++lines>=maxLines)return;}else line=next;}if(line&&lines<maxLines)portrait.fillText(line,x,y+lines*lineHeight);};
    wrapPortrait(String(feature.description??'Aperi hoc obiectum ad inspiciendum.').replace(/\bworlds?\b/gi,'loca'),margin,190,width,25,4);
    portrait.strokeStyle='#526960';portrait.globalAlpha=.7;portrait.beginPath();portrait.moveTo(margin,308);portrait.lineTo(482,308);portrait.stroke();portrait.globalAlpha=1;
    portrait.fillStyle='#c0a46f';portrait.font='600 12px ui-monospace,monospace';portrait.letterSpacing='1px';portrait.fillText('FONTES CONEXI  ·  IDEM ID',margin,342);
    const refs=(feature.sources??[]).slice(0,5).map(source=>String(source).replace(/\bworlds?\b/gi,'loci')),chips=refs.length?refs:['SUPERFICIES LOCALIS'];
    chips.forEach((source,index)=>{const y=360+index*55;portrait.fillStyle='#0b1c27';portrait.strokeStyle='rgba(139,166,143,.34)';portrait.beginPath();portrait.roundRect(margin,y,width,44,9);portrait.fill();portrait.stroke();portrait.fillStyle=index===0?'#c3a46a':'#6d9b94';portrait.fillRect(margin+13,y+19,7,7);portrait.fillStyle='#b8c4bb';portrait.font='500 13px ui-monospace,monospace';portrait.letterSpacing='.2px';portrait.fillText(String(source).slice(0,38),margin+31,y+27,width-42);});
    const boundaryY=390+chips.length*55;portrait.fillStyle='#91a49a';portrait.font='15px system-ui,sans-serif';wrapPortrait(String(feature.boundary??'Aspectus localis.').replace(/\bworlds?\b/gi,'loca'),margin,boundaryY,width,21,5);
    portrait.fillStyle='#c1a26b';portrait.fillRect(margin,839,72,2);portrait.fillStyle='#a3b0a5';portrait.font='600 11px ui-monospace,monospace';portrait.letterSpacing='.45px';portrait.fillText('CLICCA · MAGNIFICA · PERCURRE',margin,864,width);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
  }
  const clipRound=(x,y,w,h,r)=>{
    ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();ctx.clip();
  };
  if(['phone','square','rectangle','cylinder'].includes(shapeName))clipRound(8,8,752,496,shapeName==='phone'?46:28);
  else if(shapeName==='sphere'){ctx.beginPath();ctx.ellipse(384,256,378,248,0,0,Math.PI*2);ctx.clip();}
  else if(shapeName==='wave'){
    ctx.beginPath();for(let i=0;i<=96;i++){const x=8+i/96*752,y=18+Math.sin(i/96*Math.PI*4)*22;if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
    for(let i=96;i>=0;i--){const x=8+i/96*752,y=494+Math.sin(i/96*Math.PI*4+Math.PI)*22;ctx.lineTo(x,y);}ctx.closePath();ctx.clip();
  }
  const background=ctx.createLinearGradient(0,0,768,512);background.addColorStop(0,'rgba(12,34,50,.96)');background.addColorStop(.55,'rgba(5,15,27,.9)');background.addColorStop(1,'rgba(12,24,43,.82)');ctx.fillStyle=background;ctx.fillRect(0,0,768,512);
  const glow=ctx.createLinearGradient(430,90,735,235);glow.addColorStop(0,hex+'36');glow.addColorStop(.55,hex+'12');glow.addColorStop(1,'transparent');ctx.fillStyle=glow;ctx.fillRect(390,60,378,250);
  for(let i=0;i<34;i++){
    const x=(i*137+31)%768,y=(i*89+17)%512,r=1+(i%3);
    ctx.globalAlpha=.08+(i%5)*.025;ctx.fillStyle=i%4===0?'#c9ad72':'#6c9493';ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha=1;ctx.fillStyle='rgba(5,15,27,.42)';ctx.strokeStyle=hex+'45';ctx.lineWidth=1;
  ctx.beginPath();ctx.roundRect(548,116,150,90,10);ctx.fill();ctx.stroke();
  const bars=[.38,.67,.48,.9,.58,.76,.42,.64,.86,.52,.73,.46];
  bars.forEach((height,index)=>{ctx.fillStyle=index===7?'#c5a86c':'#628d87';ctx.globalAlpha=.36+(index%3)*.12;ctx.fillRect(562+index*10,190-height*56,4,height*56);});
  ctx.globalAlpha=1;ctx.strokeStyle='rgba(179,161,119,.52)';ctx.beginPath();ctx.moveTo(560,194);ctx.lineTo(690,194);ctx.stroke();
  ctx.fillStyle='#90b5a9';ctx.font='600 15px system-ui, sans-serif';ctx.letterSpacing='2.5px';ctx.fillText('REALITY LENS  /  SUPERFICIES VIVA',38,48);
  ctx.fillStyle='#d1d9d1';ctx.font='600 34px system-ui, sans-serif';ctx.letterSpacing='-.4px';
  const title=String(feature.id==='block-world'?'Cubus centralis':feature.label??feature.id).replace(/\bworlds?\b/gi,'locus').slice(0,30);ctx.fillText(title,38,116,640);
  ctx.fillStyle='#899d98';ctx.font='600 11px ui-monospace, monospace';ctx.letterSpacing='1.1px';ctx.fillText(String(feature.id??'').replace(/(^|-)world(?=-|$)/gi,'$1locus').toUpperCase().slice(0,46),40,142,650);
  ctx.fillStyle='#a9b9b2';ctx.font='16px system-ui, sans-serif';ctx.letterSpacing='0px';
  const wrap=(value,x,y,width,lineHeight,maxLines)=>{const words=String(value??'').replace(/\s+/g,' ').split(' ');let line='',lines=0;for(const word of words){const next=line?`${line} ${word}`:word;if(ctx.measureText(next).width>width&&line){ctx.fillText(line,x,y+lines*lineHeight);line=word;if(++lines>=maxLines)return;}else line=next;}if(line&&lines<maxLines)ctx.fillText(line,x,y+lines*lineHeight);};
  wrap(String(feature.description??'Aperi obiectum ad aspectum localem.').replace(/\bworlds?\b/gi,'loca'),40,176,665,23,2);
  ctx.strokeStyle='#6d8175';ctx.globalAlpha=.55;ctx.beginPath();ctx.moveTo(40,232);ctx.lineTo(728,232);ctx.stroke();ctx.globalAlpha=1;
  ctx.fillStyle='#b69b67';ctx.font='600 11px ui-monospace, monospace';ctx.letterSpacing='1.2px';ctx.fillText('FONTES CONEXI · IDEM ID',40,260);
  const sources=(feature.sources??[]).slice(0,4).map(source=>String(source).replace(/\bworlds?\b/gi,'loci'));
  const chips=sources.length?sources:['SUPERFICIES LOCALIS'];
  chips.forEach((source,index)=>{
    const x=index%2?394:40,y=278+Math.floor(index/2)*48,w=334,h=38;
    ctx.fillStyle='rgba(9,23,31,.74)';ctx.strokeStyle='rgba(139,166,143,.32)';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(x,y,w,h,8);ctx.fill();ctx.stroke();
    ctx.fillStyle=index===0?'#c3a46a':'#6d9b94';ctx.beginPath();ctx.arc(x+15,y+19,3.2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#aebbb1';ctx.font='500 13px ui-monospace, monospace';ctx.letterSpacing='.2px';ctx.fillText(String(source).slice(0,34),x+28,y+23,w-40);
  });
  ctx.fillStyle='#8fa19a';ctx.font='15px system-ui, sans-serif';ctx.letterSpacing='0px';
  wrap(String(feature.boundary??'Aspectus localis.').replace(/\bworlds?\b/gi,'loca'),40,396,675,20,2);
  ctx.fillStyle='#b49a67';ctx.fillRect(40,446,88,2);ctx.fillStyle='#96a79e';ctx.font='600 11px ui-monospace, monospace';ctx.letterSpacing='1px';
  ctx.fillText('CLICCA · MAGNIFICA OBIECTUM · PERCURRE SPATIUM',40,474,690);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}
export function buildRealityAssemblyScene({THREE,parent,features,targets=[],relationships={}}){
  // Feature IDs are the identity boundary for a reality tab. A duplicate
  // record must never create a second rendered copy of that same reality.
  const uniqueFeatures=[],seenFeatureIds=new Set();
  for(const feature of features??[]){
    if(!feature?.id||seenFeatureIds.has(feature.id))continue;
    seenFeatureIds.add(feature.id);uniqueFeatures.push(feature);
  }
  features=uniqueFeatures;
  const layer=new THREE.Group();layer.name='Reality Assembly / shared feature projection';layer.visible=false;parent.add(layer);
  const geometry=new Set(),materials=new Set(),textures=new Set(),selectable=new Set(),nodes=new Map();
  const backdrop=createRealityLensBackdrop(THREE);textures.add(backdrop);
  let approachBlend=0;
  const makeMaterial=(color,extra={})=>{const value=new THREE.MeshStandardMaterial({color,metalness:.42,roughness:.53,...extra});materials.add(value);return value;};
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
  const actorGeometry=new THREE.SphereGeometry(.075,8,8);geometry.add(actorGeometry);
  const pulseGeometry=new THREE.RingGeometry(.11,.16,12);geometry.add(pulseGeometry);
  const haloMaterials=new Map();
  const haloMaterialFor=(color)=>{
    const key=color?.getHexString?.()??String(color);
    if(!haloMaterials.has(key)){
      const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.22,depthWrite:false,blending:THREE.AdditiveBlending});
      materials.add(material);haloMaterials.set(key,material);
    }
    return haloMaterials.get(key);
  };
  const signalMaterial=new THREE.MeshBasicMaterial({color:'#82bdc9',transparent:true,opacity:.3,depthWrite:false,blending:THREE.AdditiveBlending});
  materials.add(signalMaterial);
  const actorMaterial=new THREE.MeshStandardMaterial({color:'#afcbd0',emissive:'#34859a',emissiveIntensity:.58,metalness:.15,roughness:.32});
  materials.add(actorMaterial);
  const pulseMaterial=new THREE.MeshBasicMaterial({color:'#80b9c5',transparent:true,opacity:.2,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});
  materials.add(pulseMaterial);
  const colorById=id=>id==='block-world'?gold:/person|rooms|social/.test(id)?violet:/world|gateway|sports/.test(id)?green:/asset|paycore|contract|ledger|t402/.test(id)?gold:blue;
  const mesh=(shape,material,position,scale,owner=layer)=>{geometry.add(shape);const m=new THREE.Mesh(shape,material);m.position.set(...position);m.scale.set(...scale);owner.add(m);return m;};
  const box=(size,position,material,owner=layer)=>mesh(unit,material,position,size,owner);
  const group=(name,owner=layer)=>{const g=new THREE.Group();g.name=name;owner.add(g);return g;};
  function prepareFadeMaterials(node){
    node.fadeMaterials??=new Set();node.fadeMap??=new Map();
    node.root.traverse(child=>{
      if(!child.material)return;
      const mapMaterial=material=>{
        if(material.userData?.realityLensFadeOwner===node.feature.id){node.fadeMaterials.add(material);return material;}
        if(node.fadeMap.has(material))return node.fadeMap.get(material);
        const faded=material.clone();faded.userData={...faded.userData,realityLensFadeOwner:node.feature.id,realityLensBaseOpacity:material.opacity??1,realityLensFadeSource:material};
        faded.transparent=true;faded.depthWrite=false;faded.needsUpdate=true;materials.add(faded);node.fadeMaterials.add(faded);node.fadeMap.set(material,faded);return faded;
      };
      child.material=Array.isArray(child.material)?child.material.map(mapMaterial):mapMaterial(child.material);
    });
  }
  function setNodeOpacity(node,opacity){
    const alpha=Math.max(0,Math.min(1,opacity));node.contextOpacity=alpha;
    for(const material of node.fadeMaterials??[])material.opacity=(material.userData.realityLensBaseOpacity??1)*alpha;
  }
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
  const funnelGuide=group('reality-lens/widening-funnel');funnelGuide.visible=false;
  const funnelGuideMaterial=new THREE.LineBasicMaterial({color:'#77979a',transparent:true,opacity:.1,depthWrite:false});materials.add(funnelGuideMaterial);
  const surface=realityLensEngine.profile.funnel;
  for(let rib=0;rib<8;rib++){
    const angle=rib/8*Math.PI*2;
    const points=[realityLensEngine.surfacePoint({depth:surface.nearDepth,angle}).position,realityLensEngine.surfacePoint({depth:surface.farDepth,angle}).position];
    const railGeometry=new THREE.BufferGeometry().setFromPoints(points);geometry.add(railGeometry);funnelGuide.add(new THREE.Line(railGeometry,funnelGuideMaterial));
  }
  for(let ring=1;ring<=5;ring++){
    const depth=surface.nearDepth+(surface.farDepth-surface.nearDepth)*ring/5,points=[];
    for(let step=0;step<72;step++)points.push(realityLensEngine.surfacePoint({depth,angle:step/72*Math.PI*2}).position);
    const ringGeometry=new THREE.BufferGeometry().setFromPoints(points);geometry.add(ringGeometry);funnelGuide.add(new THREE.LineLoop(ringGeometry,funnelGuideMaterial));
  }
  // Bounded deterministic star field, not a live astronomical catalogue.
  const points=[];for(let i=0;i<620;i++){const a=i*2.399963,b=((i*37)%181)/180*Math.PI,r=70+(i%15)*3.2;points.push(Math.cos(a)*Math.sin(b)*r,Math.cos(b)*r,Math.sin(a)*Math.sin(b)*r);}
  const starGeometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry.add(starGeometry);
  const starMaterial=new THREE.PointsMaterial({color:'#c5a768',size:.12,transparent:true,opacity:.38,sizeAttenuation:true});materials.add(starMaterial);layer.add(new THREE.Points(starGeometry,starMaterial));
  layer.add(new THREE.HemisphereLight('#96b2bf','#08101a',.72));
  const warm=new THREE.DirectionalLight('#d7b66b',1.16);warm.position.set(-7,14,10);layer.add(warm);

  // Empty compatibility group: Reality Lens never swaps in a giant far object.
  const worldBlock=group('world-block');worldBlock.visible=false;
  // Retired giant-cube experiment: keep the draw code dormant during rollout.
  if(false){
  // Retired prototype: keep its old draw code disabled so Reality Lens uses
  // the ordinary-size nucleus at every zoom level, never a giant second box.
  if(false){
  const wbGlass=makeMaterial('#1b4d6e',{transparent:true,opacity:0,depthWrite:false,roughness:.12,metalness:.15,emissive:'#0e5a8a',emissiveIntensity:.25,fog:false});
  const wbEdgeMat=new THREE.LineBasicMaterial({color:'#7fd4ff',transparent:true,opacity:0,fog:false});materials.add(wbEdgeMat);
  const wbCore=box([30,16,30],[0,2,0],wbGlass,worldBlock);wbCore.name='world-block/core';
  const wbEdgeGeo=new THREE.EdgesGeometry(new THREE.BoxGeometry(30,16,30));geometry.add(wbEdgeGeo);
  worldBlock.add(new THREE.LineSegments(wbEdgeGeo,wbEdgeMat));
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
    const miniActors=[];
    mini.forEach((pos,i)=>{const mat=makeMaterial(['#7fdfff','#b892ff','#79f0b8'][i],{transparent:true,opacity:0,emissive:['#2ec9ff','#8050ff','#36d78f'][i],emissiveIntensity:.9,metalness:.3,roughness:.2,fog:false});const miniMesh=box([.55,.55,.55],pos,mat,face);miniMesh.userData.actorIndex=i;miniActors.push(miniMesh);});
    const faceActors=[];
    for(let actorIndex=0;actorIndex<3;actorIndex++){
      const actor=mesh(actorGeometry,actorMaterial,[0,0,0],[1,1,1],face);
      actor.userData.actorIndex=actorIndex;faceActors.push(actor);
    }
    wbFaceSystems.push({face,panelMaterial:panelMat,glowMaterial:glowMat,frameMaterial:wbFrameMat,phase:faceIndex*.9,axis,sign,miniActors,faceActors});
  });

  }
  }
  const CORE=1.45,FACE=1.55,REST=CORE/2+.09;
  let lensMode=false;
  const tabShapes=Object.keys(REALITY_TAB_FORMS),tabSelectable=new Set();
  function makeTabForm(node,shapeName){
    const form=REALITY_TAB_FORMS[shapeName]??REALITY_TAB_FORMS.rectangle;
    node.formParts?.forEach(part=>{
      part.removeFromParent();
      if(part.userData?.assemblyId){const targetIndex=targets.indexOf(part);if(targetIndex>=0)targets.splice(targetIndex,1);tabSelectable.delete(part);selectable.delete(part);}
      if(part.geometry){geometry.delete(part.geometry);part.geometry.dispose();}
      for(const material of (Array.isArray(part.material)?part.material:[part.material]))if(material){
        if(material.map){textures.delete(material.map);material.map.dispose();}
        materials.delete(material);node.fadeMaterials?.delete(material);node.fadeMap?.delete(material.userData?.realityLensFadeSource);material.dispose();
      }
    });
    const width=form.width,height=form.height,depth=form.depth;
    const curved=['sphere','cylinder'].includes(shapeName),art=drawFeatureArtwork(THREE,node.feature,node.accent.color,shapeName);if(art)textures.add(art);
    const sphereForm=shapeName==='sphere';
    const shell=makeMaterial(sphereForm?'#a8874c':'#0c1c2c',{metalness:sphereForm?.72:.45,roughness:sphereForm?.24:.3,transparent:true,opacity:sphereForm?.64:curved?.42:.76,emissive:sphereForm?'#715625':'#000000',emissiveIntensity:sphereForm?.38:0,depthWrite:false,side:THREE.DoubleSide});
    const artMaterial=art?makeMaterial('#b99154',{map:art,metalness:.03,roughness:.52,transparent:true,opacity:.78,depthWrite:false,side:THREE.DoubleSide}):null;
    const parts=[];
    let bodyGeometry;
    if(shapeName==='sphere')bodyGeometry=new THREE.SphereGeometry(Math.min(width,height,depth)/2,36,28);
    else if(shapeName==='cylinder')bodyGeometry=new THREE.CylinderGeometry(Math.min(width,depth)/2,Math.min(width,depth)/2,height,36,1,false);
    else if(shapeName==='cube')bodyGeometry=new THREE.BoxGeometry(width,height,depth);
    else{
      const outline=shapeName==='wave'?wavePanelShape(THREE,width,height):roundedPanelShape(THREE,width,height,form.radius);
      bodyGeometry=new THREE.ExtrudeGeometry(outline,{depth,bevelEnabled:true,bevelSegments:3,bevelSize:.035,bevelThickness:.035,curveSegments:10});
    }
    geometry.add(bodyGeometry);
    const bodyMaterial=shapeName==='cube'?[shell,shell,shell,shell,artMaterial??shell,shell]:shell;
    const body=new THREE.Mesh(bodyGeometry,bodyMaterial);body.userData.assemblyId=node.feature.id;body.name=`${node.feature.id}/spatial-tab/${shapeName}`;
    body.renderOrder=20;body.castShadow=false;body.receiveShadow=false;node.root.add(body);targets.push(body);selectable.add(body);tabSelectable.add(body);parts.push(body);
    if(!curved&&shapeName!=='cube'&&art&&artMaterial){
      const screenGeometry=new THREE.PlaneGeometry(width*.9,height*.88);geometry.add(screenGeometry);
      const screen=new THREE.Mesh(screenGeometry,artMaterial);screen.position.z=depth+.025;screen.userData.assemblyId=node.feature.id;screen.name=`${node.feature.id}/spatial-tab/image`;
      screen.renderOrder=21;node.root.add(screen);targets.push(screen);selectable.add(screen);tabSelectable.add(screen);parts.push(screen);
    }
    const edgeGeometry=new THREE.EdgesGeometry(bodyGeometry,18);geometry.add(edgeGeometry);
    const edgeMaterial=new THREE.LineBasicMaterial({color:sphereForm?'#e4c878':node.accent.color,transparent:true,opacity:sphereForm?.82:.58,depthWrite:false,depthTest:true});materials.add(edgeMaterial);
    const edges=new THREE.LineSegments(edgeGeometry,edgeMaterial);edges.renderOrder=22;node.root.add(edges);parts.push(edges);
    const indicatorGeometry=new THREE.SphereGeometry(.09,12,10);geometry.add(indicatorGeometry);
    const indicatorMaterial=makeMaterial(node.locked?'#d1ae70':'#659b91',{emissive:node.locked?'#9e7134':'#316e68',emissiveIntensity:.72,metalness:.1,roughness:.4});
    const indicator=mesh(indicatorGeometry,indicatorMaterial,[width*.36,height*.36,depth*.52+.08],[1,1,1],node.root);indicator.name=`${node.feature.id}/tab-lock-state`;
    node.formParts=[...parts,indicator];node.tabMesh=body;node.artMaterial=artMaterial;node.shellMaterial=shell;node.edgeMaterial=edgeMaterial;node.indicator=indicator;node.shape=shapeName;positionEmbeddedData(node);
    applyTabDepthMode(node);
    prepareFadeMaterials(node);
    node.artMaterial=node.fadeMap.get(artMaterial)??artMaterial;
    node.shellMaterial=node.fadeMap.get(shell)??shell;
    node.edgeMaterial=node.fadeMap.get(edgeMaterial)??edgeMaterial;
    node.indicator.material=node.fadeMap.get(indicatorMaterial)??indicatorMaterial;
  }
function applyTabDepthMode(node){
  for(const part of node.formParts??[]){
    const list=Array.isArray(part.material)?part.material:[part.material];
    for(const material of list){if(material&&'depthTest'in material){material.depthTest=true;material.depthWrite=false;material.needsUpdate=true;}}
    }
    for(const part of node.formParts??[])part.renderOrder=part===node.tabMesh?20:22;
    if(node.root)node.root.renderOrder=18;
  }
  function setLensMode(enabled){
    lensMode=Boolean(enabled);
    if(lensMode)worldBlock.visible=false;
    nodes.forEach(node=>{if(node.isTab)applyTabDepthMode(node);});
  }
  for(let index=0;index<features.length;index++){
    const feature=features[index],traits=featureTraits(feature.id),root=group(feature.id);
    const initialPosition=feature.initialPosition??[0,0,0];root.position.set(...initialPosition);
    if(feature.id!=='block-world'||feature.assemblyTier==='tab'){
      root.visible=false;
      const accentBase=colorById(feature.id),accent=makeMaterial('#000000');
      accent.color.copy(accentBase.color).offsetHSL(traits.hueShift,traits.satShift,traits.lightShift);
      accent.emissive.copy(accentBase.emissive||new THREE.Color('#000000')).offsetHSL(traits.hueShift,0,traits.lightShift);
      accent.emissiveIntensity=(accentBase.emissiveIntensity||1)*traits.glow;
      const tabScale=feature.assemblyTier==='secondary'?.94:1;
      const node={isTab:true,root,feature,traits,accent,position:new THREE.Vector3(...initialPosition),scale:tabScale,size:1,shape:'',locked:false,formParts:[],open:0,goalOpen:0,tabReveal:0,revealOrder:index,tabMesh:null,liveObjects:[],lensGroup:feature.lensGroup??resolveRealityLensGroup(feature.id),fadeMaterials:new Set(),fadeMap:new Map()};
      root.scale.setScalar(tabScale);
      const activity=group(`${feature.id}/live-content`,root);node.liveContent=activity;activity.scale.setScalar(.001);activity.visible=false;
      const sourceLayer=group(`${feature.id}/source-layer`,root);sourceLayer.visible=false;node.sourceLayer=sourceLayer;
      const sourceOrbGeometry=new THREE.BoxGeometry(.1,.1,.035);geometry.add(sourceOrbGeometry);
      node.sourceObjects=(feature.sources??[]).slice(0,4).map((source,index)=>{
        const material=makeMaterial(index===0?'#b8955e':'#6d9eaa',{emissive:index===0?'#755224':'#274f5d',emissiveIntensity:.35,metalness:.2,roughness:.42});
        const object=new THREE.Mesh(sourceOrbGeometry,material);object.name=`${feature.id}/source-${index}`;object.userData.assemblySource=source;
        sourceLayer.add(object);return object;
      });
      const nestedLayer=group(`${feature.id}/nested-layer`,root);nestedLayer.visible=false;node.nestedLayer=nestedLayer;
      const nestedGeometry=new THREE.BoxGeometry(.08,.08,.04);geometry.add(nestedGeometry);
      node.nestedObjects=(feature.sources??[]).slice(0,4).map((source,index)=>{
        const material=makeMaterial(index===0?'#bd985d':'#7b9aa0',{emissive:index===0?'#88612d':'#304b50',emissiveIntensity:.28,metalness:.25,roughness:.42});
        const object=new THREE.Mesh(nestedGeometry,material);object.name=`${feature.id}/nested-source-${index}`;object.userData.assemblySource=source;
        nestedLayer.add(object);return object;
      });
      node.statusMaterial=makeMaterial('#d4ad61',{emissive:'#8f672d',emissiveIntensity:.9,metalness:.1,roughness:.25});
      node.formParts=[];makeTabForm(node,feature.initialTabShape??tabShapes[(index-1+tabShapes.length)%tabShapes.length]??'rectangle');
      nodes.set(feature.id,node);
      continue;
    }
    const accentBase=colorById(feature.id);
    const accent=makeMaterial('#000000');accent.color.copy(accentBase.color).offsetHSL(traits.hueShift,traits.satShift,traits.lightShift);
    accent.emissive.copy(accentBase.emissive||new THREE.Color('#000000')).offsetHSL(traits.hueShift,0,traits.lightShift);
    accent.emissiveIntensity=(accentBase.emissiveIntensity||1)*traits.glow;
    const glass=makeMaterial('#153954',{transparent:true,opacity:.52,depthWrite:false,roughness:.15,metalness:.1});
    glass.color.offsetHSL(traits.hueShift,0,traits.glassLight);
      const scale=1;
      root.scale.setScalar(scale);
      if(feature.id==='block-world')root.userData.realityAnchor=true;
    const core=box([CORE,CORE,CORE],[0,0,0],dark,root);core.userData.assemblyId=feature.id;targets.push(core);selectable.add(core);
    frame(FACE,root,accent);
    const faces=[];
    for(const [axis,sign] of [[0,-1],[0,1],[1,-1],[1,1],[2,-1],[2,1]]){
      const pivot=group(`${feature.id}/face-${axis}-${sign}`,root),size=[FACE,FACE,FACE];size[axis]=.04;
      const center=[0,0,0];center[axis]=sign*REST;pivot.position.set(...center);
      const panel=box(size,[0,0,0],glass,pivot);panel.userData.assemblyId=feature.id;targets.push(panel);selectable.add(panel);
      faces.push({pivot,axis,sign,rest:sign*REST});
      for(let t=0;feature.id!=='block-world'&&t<traits.trimCount;t++){
        const edge=-.87+t*(1.74/Math.max(1,traits.trimCount-1));
        const trimSize=[.02,.02,.02],trimPosition=[0,0,0];trimSize[(axis+1)%3]=FACE-.08;trimPosition[(axis+2)%3]=edge;
        box(trimSize,trimPosition,gold,pivot);
      }
    }

    // Every face is a living surface: small local actors circulate, pulse,
    // and react to the cube opening. They are attached to the face pivot so
    // they move with that side instead of behaving like painted decoration.
    faces.forEach(({pivot,axis,sign},faceIndex)=>{
      const activity=group(`${feature.id}/face-${axis}-${sign}/activity`,pivot);
      const faceActors=[];
      for(let actorIndex=0;actorIndex<4;actorIndex++){
        const actor=mesh(actorGeometry,actorMaterial,[0,0,0],[1,1,1],activity);
        actor.userData.faceIndex=faceIndex;
        actor.userData.actorIndex=actorIndex;
        faceActors.push(actor);
      }
      const pulse=mesh(pulseGeometry,pulseMaterial,[0,0,0],[1,1,1],activity);
      pulse.rotation.set(axis===0?0:axis===1?0:Math.PI/2,axis===0?Math.PI/2:0,0);
      nodes.get(feature.id)?.faceActivity;
      if(!nodes.has(feature.id)){
        // Node metadata is installed below; retain the activity on the face
        // object until that record is created.
      }
      activity.userData.faceActors=faceActors;
      activity.userData.pulse=pulse;
    });

    // The central/root cube is not a blank box. Each of its six faces gets
    // the same local-cube visual language: a colored door, a frame, and
    // three smaller attached blocks. Each side gets a different accent.
    if(false&&feature.id==='block-world'){
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
      cell.userData.assemblyId=feature.id;cell.userData.assemblySource=source;targets.push(cell);selectable.add(cell);
      frame(.56,cellGroup,accent);
      const subs=[];
      for(const [sx,sy,sz] of [[0,.48,0],[0,-.48,0],[.48,0,0]]){
        const sub=box([.17,.17,.17],[sx,sy,sz],accent,cellGroup);sub.visible=false;subs.push(sub);
      }
      nested.push({group:cellGroup,subs,open:0,restX});
    });
    const beaconMat=makeMaterial(BEACON_COLORS[traits.beaconVariant],{emissive:BEACON_COLORS[traits.beaconVariant],emissiveIntensity:1.8});
    const beacon=box([.14,.14,.14],[0,2.85,0],beaconMat,root);
      const beaconHot=makeMaterial('#d4ac67',{emissive:'#8c6631',emissiveIntensity:.72});
    const badge=box([.68,.8,.06],[0,0,CORE/2+.11],accent,root);badge.userData.assemblyId=feature.id;targets.push(badge);selectable.add(badge);
    // A geometric open-book/circuit marker, not a screenshot or text texture.
    box([.34,.03,.06],[0,.24,CORE/2+.16],blue,root);box([.34,.03,.06],[0,-.24,CORE/2+.16],blue,root);
    box([.03,.5,.06],[-.17,0,CORE/2+.16],blue,root);box([.03,.5,.06],[.17,0,CORE/2+.16],blue,root);
    const faceActivity=faces.map(({pivot})=>pivot.children.find(child=>child.userData?.faceActors)?.userData ?? null);
    const anchorNode={root,core,faces,faceActivity,city,inner,nested,beacon,beaconHot,beaconMat,traits,open:0,goalOpen:0,tabReveal:1,position:new THREE.Vector3(...initialPosition),scale,feature,lensGroup:'worlds',fadeMaterials:new Set(),fadeMap:new Map()};
    prepareFadeMaterials(anchorNode);nodes.set(feature.id,anchorNode);
  }
  // At the universe level, each semantic domain is one small navigable
  // constellation marker. Its feature tabs stay hidden until that domain is
  // opened, so the overview is not a wall of floating panels.
  const groupParents=new Map(),groupCoreGeometry=new THREE.SphereGeometry(.36,18,14),groupRingGeometry=new THREE.TorusGeometry(.68,.018,6,42),groupInnerRingGeometry=new THREE.TorusGeometry(.44,.009,6,36);
  geometry.add(groupCoreGeometry);geometry.add(groupRingGeometry);geometry.add(groupInnerRingGeometry);
  const groupColors={worlds:'#9ab7a7',people:'#b09acb',network:'#79b8c8',value:'#c0a66e',agents:'#91a2d0',experiences:'#83b8a0'};
  for(const domain of REALITY_LENS_GROUPS){
    const members=[...nodes.values()].filter(node=>node.isTab&&node.lensGroup===domain.id);if(!members.length)continue;
    const root=group(`reality-lens/domain/${domain.id}`),color=groupColors[domain.id]??'#82b5bd';
    const coreMaterial=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.34,depthWrite:false,blending:THREE.AdditiveBlending});materials.add(coreMaterial);
    const ringMaterial=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.4,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});materials.add(ringMaterial);
    const innerMaterial=new THREE.MeshBasicMaterial({color:'#d4c49a',transparent:true,opacity:.2,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});materials.add(innerMaterial);
    const core=new THREE.Mesh(groupCoreGeometry,coreMaterial),ring=new THREE.Mesh(groupRingGeometry,ringMaterial),innerRing=new THREE.Mesh(groupInnerRingGeometry,innerMaterial);
    root.add(core,ring,innerRing);root.visible=false;root.frustumCulled=false;
    const center=new THREE.Vector3();members.forEach(node=>center.add(node.position));center.multiplyScalar(1/members.length);root.position.copy(center);
    groupParents.set(domain.id,{id:domain.id,root,core,ring,innerRing,members});
  }
  // Render authored feature relationships, never guessed proximity edges.
  // Block World is a fixed spatial anchor, not a transport hub in the graph.
  const tabNodes=[...nodes].filter(([,node])=>node.isTab);
  const tabIds=new Set(tabNodes.map(([id])=>id)),edgeSet=new Set(),edges=[];
  for(const [from,targetsForFeature] of Object.entries(relationships??{}))for(const to of targetsForFeature??[]){
    if(from===to||!tabIds.has(from)||!tabIds.has(to))continue;
    const pair=[from,to].sort(),key=pair.join('\u0000');
    if(!edgeSet.has(key)){edgeSet.add(key);edges.push(pair);}
  }
  const connectionGeometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(edges.length*6),3));geometry.add(connectionGeometry);
  const connectionMaterial=new THREE.LineBasicMaterial({color:'#36a6d3',transparent:true,opacity:.34});materials.add(connectionMaterial);
  const connections=new THREE.LineSegments(connectionGeometry,connectionMaterial);connections.frustumCulled=false;layer.add(connections);
  let selected=null,hovered=null,mode='3d',viewState=null,focusId=null,activeFocusStrength=0,activeFocusDistance=Infinity,activeFocusIsolated=false,activeGroupId='*';
  function setActiveGroup(groupId=null){
    if(groupId!==null&&groupId!=='*'&&!groupParents.has(groupId))throw Error(`Unknown Reality Lens domain: ${groupId}`);
    activeGroupId=groupId;
  }
  const projectedPosition=new THREE.Vector3(),scatterDirection=new THREE.Vector3();
  function apply(snapshot,{viewMode='3d',hoveredId=null}={}){
    viewState=snapshot;selected=snapshot.selectedId;hovered=hoveredId;mode=viewMode;
    snapshot.objects.forEach(object=>{
      const node=nodes.get(object.id);if(!node)return;
      const position=Array.isArray(object.position)?object.position:(object.position&&typeof object.position.x==='number'&&typeof object.position.y==='number'&&typeof object.position.z==='number'?[object.position.x,object.position.y,object.position.z]:null);
      if(!position) return;
      node.position.set(position[0],position[1],position[2]);node.goalOpen=object.open?1:object.id===hovered?.23:0;
      if(node.isTab){
        const nextShape=REALITY_TAB_FORMS[object.shape]?object.shape:'rectangle';
        node.size=Number.isFinite(object.size)?object.size:1;
        node.locked=object.locked===true;
        if(node.shape!==nextShape)makeTabForm(node,nextShape);
        if(node.indicator){
          node.indicator.material.color.set(node.locked?'#f0ce8a':'#d4ad61');
          node.indicator.material.emissive.set(node.locked?'#c18b42':'#8f672d');
        }
      }
    });
    connectionMaterial.color.set(snapshot.mode==='proposed'?'#b194ed':snapshot.mode==='past'?'#9a9fae':'#36a6d3');
  }
  function updateRetiredGiantLod(dt,time,{reducedMotion=false,cameraDistance=0,cameraPosition=null}={}){
    const blend=reducedMotion?1:1-Math.exp(-dt*9);
    lodBlend+=(((lensMode?false:cameraDistance>LOD_FAR)?1:0)-lodBlend)*blend;
    const showWorld=lodBlend>.5;
    worldBlock.visible=lodBlend>.02;
    wbGlass.opacity=lodBlend*.5;wbEdgeMat.opacity=lodBlend*.85;
    // The merged far-zoom cube is CLEAN: inner mini-cubes fade out across the
    // transition and are fully hidden once the merge completes, leaving only
    // the empty pulsing glass cube (wbCore) and its edge frame (wbEdgeMat).
    wbCellMat.opacity=(1-lodBlend)*.4;
    for(const wbCell of wbCells)wbCell.visible=lodBlend<=.5;
    wbGlass.emissiveIntensity=.22+.14*Math.sin(time*.8);
    wbFaceSystems.forEach(({face,panelMaterial,glowMaterial,frameMaterial,phase,axis,sign,miniActors,faceActors})=>{
      const pulse=.82+.18*Math.sin(time*.72+phase);
      panelMaterial.opacity=lodBlend*.72;
      glowMaterial.opacity=lodBlend*.32*pulse;
      frameMaterial.opacity=lodBlend*.72;
      face.visible=lodBlend>.02;
      panelMaterial.emissiveIntensity=.8+.28*pulse;
      const orbit=.9+.22*Math.sin(time*.9+phase);
      faceActors.forEach((actor,actorIndex)=>{
        const t=time*(.38+.06*actorIndex)+phase+actorIndex*2.1;
        const u=Math.sin(t)*orbit*2.2;
        const v=Math.cos(t*.77)*orbit*1.35;
        if(axis===0)actor.position.set(sign*15.35,1+v,u);
        else if(axis===1)actor.position.set(u,sign*8.35,v);
        else actor.position.set(u,1+v,sign*15.35);
        actor.scale.setScalar(.65+.25*Math.sin(t*1.4));
        actor.visible=lodBlend>.04;
      });
      miniActors.forEach((actor,actorIndex)=>{
        const t=time*.55+phase+actorIndex*2;
        actor.position.x+=Math.sin(t)*.008;
        actor.position.y+=Math.cos(t*.8)*.006;
        actor.position.z+=Math.sin(t*.65)*.008;
      });
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
      if(node.isTab){
        const perspectiveScale=lensMode&&cameraPosition?Math.max(.9,Math.min(1.22,cameraPosition.distanceTo(node.position)/78)):1;
        const targetScale=node.scale*node.size*perspectiveScale*(focusId&&id!==focusId?.72:1);
        node.root.scale.lerp(new THREE.Vector3(targetScale,targetScale,targetScale),blend);
        node.root.rotation.y=reducedMotion?0:Math.sin(time*.18+node.traits.phase)*.025;
        node.root.rotation.x=reducedMotion?0:Math.sin(time*.13+node.traits.phase)*.012;
        node.liveContent.visible=node.open>.05;
        node.liveContent.scale.setScalar(node.open*.9);
        continue;
      }
      const targetScale=node.scale*(focusId&&id!==focusId?.72:1);node.root.scale.lerp(new THREE.Vector3(targetScale,targetScale,targetScale),blend);
      node.faces.forEach(({pivot,axis,sign,rest},faceIndex)=>{
        const property=['x','y','z'][axis];pivot.position[property]=rest+sign*node.open*.72;
        const breathing=.045*Math.sin(time*1.15+node.traits.phase+faceIndex*.83);
        pivot.rotation.set(0,0,0);
        if(axis!==1)pivot.rotation[(axis===0?'z':'x')]=sign*(node.open*.65+breathing);
        else pivot.rotation.z=breathing*.65;
        const activity=node.faceActivity[faceIndex];
        if(activity){
          const actors=activity.faceActors;
          actors.forEach((actor,actorIndex)=>{
            const phase=time*(.65+.12*faceIndex)+node.traits.phase+actorIndex*1.57;
            const orbit=.46+node.open*.22;
            const u=Math.sin(phase)*orbit;
            const v=Math.cos(phase*.73+faceIndex)*orbit*.72;
            if(axis===0)actor.position.set(sign*(.055+node.open*.04),v,u);
            else if(axis===1)actor.position.set(u,sign*(.055+node.open*.04),v);
            else actor.position.set(u,v,sign*(.055+node.open*.04));
            const beat=.8+.25*Math.sin(phase*1.7);
            actor.scale.setScalar(beat*(.72+.28*node.open));
          });
          const pulse=activity.pulse;
          const pulseBeat=(Math.sin(time*1.7+faceIndex+node.traits.phase)+1)*.5;
          pulse.scale.setScalar(.65+pulseBeat*.7+node.open*.5);
          pulse.material.opacity=.12+pulseBeat*.22+node.open*.12;
          if(axis===0)pulse.rotation.set(0,Math.PI/2,0);
          else if(axis===1)pulse.rotation.set(0,0,0);
          else pulse.rotation.set(Math.PI/2,0,0);
          pulse.visible=node.open>.03 || nodeDist<15;
        }
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
  function update(dt,time,{reducedMotion=false,cameraDistance=0,cameraPosition=null}={}){
    const blend=reducedMotion?1:1-Math.exp(-dt*9);
    const targetProgress=realityLensEngine.overviewProgress(cameraDistance);
    approachBlend+=(targetProgress-approachBlend)*blend;
    worldBlock.visible=false;
    const activeRelation=(nodes.get(selected)?.isTab||nodes.get(hovered)?.isTab)===true;
    connections.visible=edges.length>0&&approachBlend>.3&&activeRelation&&cameraDistance>24&&!focusId;
    connectionMaterial.opacity=.26*approachBlend;
    const focalNode=nodes.get(focusId);
    const focusDistance=cameraPosition&&focalNode?cameraPosition.distanceTo(focalNode.position):cameraDistance;
    const focusResponse=realityLensEngine.objectResponse({id:focusId,selectedId:focusId,distance:focusDistance});
    activeFocusStrength=focusResponse.focusStrength;activeFocusDistance=focusId?focusDistance:Infinity;
    const focusIsolated=Boolean(focusId&&focusResponse.isolationReached);activeFocusIsolated=focusIsolated;
    // The funnel is a guide while travelling, not another object layered on
    // top of the feature. Clear it as the user arrives at a focused tab.
    funnelGuide.visible=approachBlend>.035&&!focusIsolated;
    funnelGuideMaterial.opacity=(.035+approachBlend*.075)*(1-activeFocusStrength);
    const buffer=connectionGeometry.attributes.position;
    for(const [id,node] of nodes){
      const groupOrder=['worlds','people','network','value','agents','experiences'].indexOf(node.lensGroup);
      const delay=node.isTab?Math.max(0,groupOrder)*.055+(node.revealOrder%3)*.012:0;
      const tabReveal=node.isTab?(node.feature.id==='block-world'?1:Math.max(0,Math.min(1,(approachBlend-delay)/Math.max(.2,1-delay)))):1;
      node.tabReveal=node.isTab?tabReveal:1;
      const level=id===selected?1:id===hovered?.55:0;
      projectedPosition.copy(node.position);
      node.root.position.lerp(projectedPosition,blend);
      const nodeDistance=cameraPosition?cameraPosition.distanceTo(node.root.position):cameraDistance;
      const physicalStage=realityLensEngine.stageAt(nodeDistance);
      node.revealStage=node.goalOpen>=.99?3:physicalStage.stage;
      node.revealProgress=node.goalOpen>=.99?1:physicalStage.progress;
      const stageOpen=[0,.28,.56,.82][node.revealStage]+node.revealProgress*.16;
      node.open+=(Math.max(node.goalOpen,stageOpen)-node.open)*blend;
      const response=realityLensEngine.objectResponse({id,selectedId:focusId,distance:focusDistance,baseScale:node.scale??1,size:node.size??1,tabReveal});
      if(node.lastContextOpacity===undefined||Math.abs(node.lastContextOpacity-response.contextOpacity)>.008){setNodeOpacity(node,response.contextOpacity);node.lastContextOpacity=response.contextOpacity;}
      const groupMatches=activeGroupId==='*'||(node.isTab&&node.lensGroup===activeGroupId);
      // Context remains available while approaching, then genuinely clears so
      // the selected object can be read and used as the Lens working surface.
      node.root.visible=(!node.isTab||tabReveal>.008)&&!response.contextHidden&&response.contextOpacity>.05&&groupMatches;
      if(!node.root.visible)continue;
      if(node.isTab){
        const targetScale=response.scale;
        node.root.scale.lerp(new THREE.Vector3(targetScale,targetScale,targetScale),blend);
        // Once a real feature panel is mounted on this object, its physical
        // shell becomes a quiet perimeter. This avoids a duplicate bright
        // wireframe fighting the readable, interactive face.
        const cover= response.isSelected ? Math.max(0,Math.min(1,(response.focusStrength-.24)/.76)) : 0;
        const tuneSurface=(material,multiplier)=>{if(!material)return;const base=material.userData?.realityLensBaseOpacity??1;material.opacity=base*(1-cover*multiplier);};
        tuneSurface(node.shellMaterial,.76);
        // The frame is useful while approaching. At the readable stage it
        // almost disappears, leaving the mounted panel as the object's face.
        if(node.edgeMaterial){const base=node.edgeMaterial.userData?.realityLensBaseOpacity??1;node.edgeMaterial.opacity=base*(1-cover)*(1-cover);}
        if(node.artMaterial){const base=node.artMaterial.userData?.realityLensBaseOpacity??1;node.artMaterial.opacity=base*(1-cover)*(1-cover);}
        tuneSurface(node.indicator?.material,.55);
        node.root.rotation.y=reducedMotion?0:Math.sin(time*.18+node.traits.phase)*.025;
        node.root.rotation.x=reducedMotion?0:Math.sin(time*.13+node.traits.phase)*.012;
        if(node.indicator){const pulse=.9+.1*Math.sin(time*.92+node.traits.phase);node.indicator.scale.setScalar(pulse);if(node.indicator.material?.emissiveIntensity!==undefined)node.indicator.material.emissiveIntensity=.28+.18*(.5+.5*Math.sin(time*1.3+node.traits.phase));}
        // At close focus the interactive panel is the living object. Its
        // ornamental orbit layers return while travelling, not over its face.
        const panelOwnsAttention=response.isSelected&&response.focusStrength>.6;
        node.liveContent.visible=node.revealStage>=1&&node.open>.05&&tabReveal>.18&&!panelOwnsAttention;
        node.liveContent.scale.setScalar(node.liveContent.visible ? .45+node.open*.55 : .001);
        // Sources are available in the approach layers; a close living panel
        // already contains its own data and should not grow floating badges.
        node.sourceLayer.visible=node.revealStage>=2&&!panelOwnsAttention;
        node.sourceLayer.scale.setScalar(node.sourceLayer.visible ? .74+node.revealProgress*.26 : .001);
        node.nestedLayer.visible=node.revealStage>=3&&!panelOwnsAttention;
        node.nestedLayer.scale.setScalar(node.nestedLayer.visible ? .72+node.revealProgress*.28 : .001);
        continue;
      }
      node.root.scale.lerp(new THREE.Vector3(response.scale, response.scale, response.scale),blend);
      node.faces.forEach(({pivot,axis,sign,rest},faceIndex)=>{
        const property=['x','y','z'][axis];pivot.position[property]=rest+sign*node.open*.9;
        const breathing=.035*Math.sin(time*1.15+node.traits.phase+faceIndex*.83);
        pivot.rotation.set(0,0,0);
        if(axis!==1)pivot.rotation[(axis===0?'z':'x')]=sign*(node.open*.72+breathing);
        else pivot.rotation.z=breathing*.65;
        const activity=node.faceActivity[faceIndex];
        if(activity){
          activity.visible=node.revealStage>=1&&node.open>.12;
          activity.faceActors.forEach((actor,actorIndex)=>{
            const phase=time*(.65+.12*faceIndex)+node.traits.phase+actorIndex*1.57;
            const orbit=.46+node.open*.22,u=Math.sin(phase)*orbit,v=Math.cos(phase*.73+faceIndex)*orbit*.72;
            if(axis===0)actor.position.set(sign*(.055+node.open*.04),v,u);
            else if(axis===1)actor.position.set(u,sign*(.055+node.open*.04),v);
            else actor.position.set(u,v,sign*(.055+node.open*.04));
            actor.scale.setScalar((.72+.28*node.open)*(.8+.2*Math.sin(phase*1.7)));
          });
          const pulse=activity.pulse,pulseBeat=(Math.sin(time*1.7+faceIndex+node.traits.phase)+1)*.5;
          pulse.scale.setScalar(.65+pulseBeat*.7+node.open*.5);pulse.material.opacity=.12+pulseBeat*.22+node.open*.12;
          pulse.visible=node.revealStage>=1&&node.open>.12;
        }
      });
      node.core.scale.setScalar(CORE*(1-node.open*.28));
      node.inner.visible=node.revealStage>=3;
      node.city.visible=node.revealStage>=2;node.city.position.y=node.open*.55;
      node.beacon.visible=node.revealStage>=1;
      for(const cell of node.nested){
        const goal=node.revealStage>=3?node.revealProgress:0;
        cell.open+=(goal-cell.open)*blend;cell.group.scale.setScalar(1+cell.open*.3);
        cell.group.position.set(cell.restX,cell.open*.4,CORE/2+.78+cell.open*.3);
        for(const sub of cell.subs)sub.visible=cell.open>.3;
      }
      node.root.rotation.y=reducedMotion?0:Math.sin(time*.18+node.traits.phase)*.025;
      node.beacon.material=level?node.beaconHot:node.beaconMat;
    }
    for(const [groupIndex,domain] of REALITY_LENS_GROUPS.entries()){
      const marker=groupParents.get(domain.id);if(!marker)continue;
      const center=new THREE.Vector3();marker.members.forEach(node=>center.add(node.root.position));center.multiplyScalar(1/marker.members.length);
      marker.root.position.lerp(center,blend);
      const expanded=activeGroupId===domain.id;
      marker.root.visible=activeGroupId!=='*'&&!expanded&&approachBlend>.08&&!focusIsolated;
      const focusAlpha=activeGroupId===null?.9:.58;
      marker.ring.material.opacity=(.2+.18*Math.sin(time*.7+groupIndex)) * approachBlend * focusAlpha;
      marker.innerRing.material.opacity=(.14+.07*Math.sin(time+groupIndex*.5)) * approachBlend * focusAlpha;
      marker.core.material.opacity=(.2+.08*Math.sin(time*.8+groupIndex)) * approachBlend * focusAlpha;
      marker.ring.rotation.set(.3+Math.sin(time*.13+groupIndex)*.06,time*.08+groupIndex,0);
      marker.innerRing.rotation.set(-.42,time*-.11-groupIndex*.4,0);
      const breathe=1+.035*Math.sin(time*.85+groupIndex);
      marker.core.scale.setScalar(breathe);
    }
    if(connections.visible){
      edges.forEach(([from,to],i)=>{
        const a=nodes.get(from),b=nodes.get(to),related=from===selected||to===selected||from===hovered||to===hovered,shown=related&&a.root.visible&&b.root.visible&&a.tabReveal>.35&&b.tabReveal>.35;
        buffer.setXYZ(i*2,shown?a.root.position.x:0,shown?a.root.position.y:-1000,shown?a.root.position.z:0);
        buffer.setXYZ(i*2+1,shown?b.root.position.x:0,shown?b.root.position.y:-1000,shown?b.root.position.z:0);
      });buffer.needsUpdate=true;
    }
    grid.material.opacity=approachBlend>.25?(mode==='4d'?.07:.022):0;
  }
  function getSnapshot(){
    const lod=approachBlend<.04?'nucleus':approachBlend<.98?'unfolding':'field';
    const groupIds=[...new Set([...nodes.values()].map(node=>node.lensGroup).filter(Boolean))];
    const formerCenter=nodes.get('block-world');
    return {geometryOnly:true,referenceImagesUsedAsTextures:false,funnelGuideVisible:funnelGuide.visible,nodeIds:[...nodes.keys()],nodeCount:nodes.size,tabCount:[...nodes.values()].filter(node=>node.isTab).length,visibleFeatureIds:[...nodes.values()].filter(node=>node.isTab&&node.root.visible).map(node=>node.feature.id),visibleTabCount:[...nodes.values()].filter(node=>node.isTab&&node.root.visible&&node.tabReveal>.35&&node.contextOpacity>.05).length,groupIds,visibleGroupCount:[...groupParents.values()].filter(marker=>marker.root.visible).length,activeGroupId,focusedId:focusId,focusStrength:Number(activeFocusStrength.toFixed(3)),focusIsolated:activeFocusIsolated,focusDistance:Number.isFinite(activeFocusDistance)?Number(activeFocusDistance.toFixed(2)):null,selectedStage:nodes.get(focusId)?.revealStage??0,approachProgress:Number(approachBlend.toFixed(3)),anchorOpen:formerCenter?.isTab?0:Number((formerCenter?.open??0).toFixed(3)),edgeCount:edges.length,relationshipSource:'authored feature navigation graph',connectionsVisible:connections.visible,connectionPairs:edges.map(pair=>[...pair]),viewMode:mode,selectedId:selected,historyMode:viewState?.mode??'present',designedArchitecture:true,equalAxisCubes:false,singleFixedAnchorCube:[...nodes.values()].some(node=>!node.isTab&&node.feature.id==='block-world'),formerCenterIsMovableTab:formerCenter?.isTab===true,lensMode,lod};
  }
  return {layer,nodes,groupParents,worldBlock,backdrop,apply,update,getSnapshot,setLensMode,setActiveGroup,getGroupPosition:id=>groupParents.get(id)?.root.position??null,focus:id=>{focusId=nodes.has(id)?id:null;},resolve:object=>object?.userData?.assemblyId??null,
    destroy(){selectable.forEach(object=>{const i=targets.indexOf(object);if(i>=0)targets.splice(i,1);});geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());layer.removeFromParent();}};
}
