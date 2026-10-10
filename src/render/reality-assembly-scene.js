import {createRealitySurfaceGeometry} from './reality-surface-geometry.js?v=20261003-skin360';
import {REALITY_TAB_FORMS,resolveRealityTabPosition} from '../domains/reality-tab-layout.js?v=20261003-skin360';
import {REALITY_LENS_GROUPS,realityLensEngine,resolveRealityLensGroup} from '../domains/reality-lens-engine.js?v=20261003-skin360';
import {realityObjectSurfaceEngine} from '../domains/reality-object-engine.js?v=20261003-skin360';
import {lensSpaceLabel} from './reality-lens-chrome.js?v=20261003-skin360';
import {createRealityHomeSurface} from './reality-home-surfaces.js?v=20261003-skin360';
import {createHomeTransformStore} from './reality-tracking-input.js';

/** Native volumetric fronts for feature objects and their space entries.
 * Layout and materials remain projections over the existing identities. */
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
/** The entry silhouette is the space's architecture, not a browser card.
 * Keep a generous central reading area while making the actual solids distinct. */
function spaceEntryShape(THREE,id,width,height){
  const shape=new THREE.Shape(),x=width/2,y=height/2;
  const polygon=points=>{points.forEach(([px,py],index)=>index?shape.lineTo(px,py):shape.moveTo(px,py));shape.closePath();return shape;};
  if(id==='worlds')return polygon([[-x,-y],[x,-y],[x,y*.66],[x*.58,y*.66],[x*.58,y],[-x,y]]);
  if(id==='people')return roundedPanelShape(THREE,width,height,.72);
  if(id==='network')return polygon([[-x,-y],[x*.72,-y],[x,-y*.45],[x,y],[-x*.72,y],[-x,y*.45]]);
  if(id==='value')return polygon([[-x,-y*.78],[-x*.84,-y],[x*.84,-y],[x,-y*.78],[x,y*.78],[x*.84,y],[-x*.84,y],[-x,y*.78]]);
  if(id==='agents')return polygon([[-x,-y*.5],[-x*.78,-y],[x*.78,-y],[x,-y*.5],[x,y*.82],[x*.86,y],[-x*.86,y],[-x,y*.82]]);
  if(id==='experiences'){
    shape.moveTo(-x,-y*.84);shape.bezierCurveTo(-x*.28,-y*1.13,x*.28,-y*.57,x,-y*.84);
    shape.lineTo(x,y*.84);shape.bezierCurveTo(x*.28,y*1.13,-x*.28,y*.57,-x,y*.84);shape.closePath();return shape;
  }
  return roundedPanelShape(THREE,width,height,.2);
}
/** Fit a texture to the cap only. The beveled shoulders retain real lighting. */
function normalizeCapUVs(bodyGeometry){
  const positions=bodyGeometry.getAttribute('position'),uv=bodyGeometry.getAttribute('uv'),capIndices=[];
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const capGroup of bodyGeometry.groups.filter(group=>group.materialIndex===0))for(let offset=capGroup.start;offset<capGroup.start+capGroup.count;offset++){
    const index=bodyGeometry.index?bodyGeometry.index.getX(offset):offset;capIndices.push(index);
    minX=Math.min(minX,positions.getX(index));maxX=Math.max(maxX,positions.getX(index));minY=Math.min(minY,positions.getY(index));maxY=Math.max(maxY,positions.getY(index));
  }
  for(const index of capIndices)uv.setXY(index,(positions.getX(index)-minX)/(maxX-minX),(positions.getY(index)-minY)/(maxY-minY));
  uv.needsUpdate=true;
}
function shapeFromSurfaceContour(THREE,contour){
  const outline=new THREE.Shape();
  contour.forEach(([x,y],index)=>index?outline.lineTo(x,y):outline.moveTo(x,y));outline.closePath();return outline;
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
const SPACE_COPY=Object.freeze({
  worlds:{label:'Worlds',description:'Build places and explore connected realities.'},
  people:{label:'People',description:'Your identity, companions and shared spaces.'},
  network:{label:'Network',description:'Explore the web and connect useful services.'},
  value:{label:'Value',description:'Study assets, contracts and local value flows.'},
  agents:{label:'Agents',description:'Work with assistants and your local bot team.'},
  experiences:{label:'Experiences',description:'Play, learn, watch and follow live events.'},
});

// Short choosing-a-tool copy belongs to the body preview. The original feature
// record and its complete description continue to own the opened surface.
const NETWORK_PREVIEWS=Object.freeze({
  gateway:{label:'World Gateway',kicker:'PUBLIC SOURCES',description:'Public sources, with evidence.'},
  'web-ai':{label:'Web + AI',kicker:'MY GPT + WEB',description:'Your GPT chat, assistants and history.'},
  'social-explorer':{label:'Social Explorer',kicker:'LOCAL DISCOVERY',description:'Fictional places and shared ideas.'},
  'bot-plaza':{label:'Bot Plaza',kicker:'LOCAL BOT TEAM',description:'Local bots, skills and drafts.'},
});

/** A preview belongs to the body's cap. Keep only the information needed to
 * choose it; source IDs, diagnostics and full details live inside the object. */
function drawFeatureArtwork(THREE,feature,color,shapeName,{compact=false,surfaceAspect=null}={}){
  const canvas=globalThis.document?.createElement?.('canvas');if(!canvas)return null;
  const networkPreview=NETWORK_PREVIEWS[feature.id];
  const sphere=shapeName==='sphere',portrait=shapeName==='phone'||shapeName==='cylinder';canvas.width=portrait?512:768;
  canvas.height=Math.round(canvas.width/(surfaceAspect??(sphere?1:portrait?.58:1.5)));
  const ctx=canvas.getContext('2d');if(!ctx)return null;
  const width=canvas.width,height=canvas.height,margin=sphere?128:portrait?40:feature.isSpaceEntry?56:48,contentWidth=width-margin*2;
  const hex=color?.getHexString?`#${color.getHexString()}`:String(color??'#69bfd4');
  // The geometry clips this texture. A second canvas silhouette would create
  // inset borders that disagree with the physical body and interactive skin.
  const background=ctx.createLinearGradient(0,0,width,height);background.addColorStop(0,'#153d60');background.addColorStop(.5,'#081d34');background.addColorStop(1,'#102e49');
  ctx.fillStyle=background;ctx.fillRect(0,0,width,height);
  // The grazing light is engraved into the real face. It adds material depth
  // without a second plaque, floating icon, or particle layer.
  const grazing=ctx.createLinearGradient(0,0,width,0);grazing.addColorStop(0,'rgba(93,183,255,.02)');grazing.addColorStop(.48,'rgba(133,209,255,.5)');grazing.addColorStop(1,'rgba(93,183,255,.02)');
  ctx.fillStyle=grazing;ctx.fillRect(0,0,width,3);
  ctx.fillStyle='rgba(69,158,220,.05)';ctx.beginPath();ctx.moveTo(width*.56,height);ctx.lineTo(width,height*.18);ctx.lineTo(width,height);ctx.closePath();ctx.fill();
  ctx.fillStyle=hex;ctx.fillRect(margin,sphere?height*.21:portrait?68:48,feature.isSpaceEntry?74:58,5);
  ctx.fillStyle='#a4c4cf';ctx.font=`600 ${networkPreview?(compact?30:26):portrait?19:20}px system-ui,sans-serif`;ctx.letterSpacing='1.2px';
  if(!compact||networkPreview)ctx.fillText(networkPreview?.kicker??(feature.isSpaceEntry?'REALITY LENS':'LIVING WORLD'),margin,sphere?height*.27:portrait?115:91,contentWidth);
  ctx.letterSpacing='0px';
  const wrap=(value,y,fontSize,lineHeight,maxLines)=>{
    ctx.font=`600 ${fontSize}px system-ui,sans-serif`;
    const words=String(value??'').replace(/\s+/g,' ').trim().split(' '),lines=[];let line='';
    for(const word of words){const next=line?`${line} ${word}`:word;if(ctx.measureText(next).width>contentWidth&&line){lines.push(line);line=word;}else line=next;}
    if(line)lines.push(line);
    lines.slice(0,maxLines).forEach((text,index)=>{
      let visible=text;
      if(index===maxLines-1&&lines.length>maxLines){while(ctx.measureText(`${visible}…`).width>contentWidth&&visible.length)visible=visible.slice(0,-1);visible+='…';}
      ctx.fillText(visible,margin,y+index*lineHeight,contentWidth);
    });
    return Math.min(lines.length,maxLines)*lineHeight;
  };
  const title=networkPreview?.label??feature.label??(feature.id==='block-world'?'Block World':String(feature.id??'World').replaceAll('-',' '));
  ctx.fillStyle='#edf6ff';const titleY=Math.round(height*(sphere?.37:portrait?.25:networkPreview?.28:.33));
  const titleSize=compact?(portrait?76:feature.isSpaceEntry?92:84):(portrait?43:feature.isSpaceEntry?60:networkPreview?76:48);
  const titleHeight=wrap(title,titleY,titleSize,Math.round(titleSize*1.22),compact&&portrait?3:2);
  const actionY=sphere?height*.79:height-(portrait?105:70),actionSize=compact?(portrait||sphere?48:58):(networkPreview?48:portrait?27:28),dividerY=actionY-actionSize-16;
  ctx.fillStyle='#aac6d2';
  const description=String(networkPreview?.description??feature.description??'Open this world to explore.').split(/(?<=[.!?])\s/)[0];
  const descriptionLineHeight=networkPreview?58:40;
  const descriptionY=titleY+titleHeight+30,descriptionLines=Math.max(0,Math.min(sphere?1:portrait?4:2,1+Math.floor((dividerY-24-descriptionY)/descriptionLineHeight)));
  if((!compact||networkPreview)&&descriptionLines)wrap(description,descriptionY,portrait?27:networkPreview?48:30,descriptionLineHeight,descriptionLines);
  ctx.fillStyle=hex;ctx.fillRect(margin,dividerY,contentWidth,1);
  ctx.fillStyle='#cceaff';ctx.font=`600 ${actionSize}px system-ui,sans-serif`;
  ctx.fillText(feature.isSpaceEntry?(compact?`${feature.memberCount} worlds  →`:`Explore ${feature.memberCount} worlds  →`):networkPreview?'Open tool  →':'Open world  →',margin,actionY,contentWidth);
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
  let approachBlend=0,previewCompact=Number(globalThis.innerWidth)<700;
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
        const faded=material.clone();faded.userData={...faded.userData,realityLensFadeOwner:node.feature.id,realityLensBaseOpacity:material.opacity??1,realityLensBaseDepthWrite:material.depthWrite,realityLensFadeSource:material};
        faded.transparent=true;faded.depthWrite=material.depthWrite;faded.needsUpdate=true;materials.add(faded);node.fadeMaterials.add(faded);node.fadeMap.set(material,faded);return faded;
      };
      child.material=Array.isArray(child.material)?child.material.map(mapMaterial):mapMaterial(child.material);
    });
  }
  function setNodeOpacity(node,opacity){
    const alpha=Math.max(0,Math.min(1,opacity));node.contextOpacity=alpha;
    for(const material of node.fadeMaterials??[]){material.opacity=(material.userData.realityLensBaseOpacity??1)*alpha;material.depthWrite=Boolean(material.userData.realityLensBaseDepthWrite&&material.opacity>.99);}
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
  const warm=new THREE.DirectionalLight('#c4e4ff',1.45);warm.position.set(-7,14,10);layer.add(warm);
  const rim=new THREE.DirectionalLight('#51a6ff',1.3);rim.position.set(11,3,-6);layer.add(rim);

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
    const surfaceBinding=realityObjectSurfaceEngine.primarySurfaceBinding({featureId:node.feature.id,objectId:node.feature.id,shape:shapeName});
    node.surfaceBinding=surfaceBinding;node.surfaceOutline=surfaceBinding.contour;node.root.userData.objectTabOwner=node.feature.id;node.root.userData.nativeOutline=surfaceBinding.contour;
    const retiredMaterials=new Set([node.shellMaterial,node.artMaterial].filter(Boolean)),retiredMaps=new Set();
    node.formParts?.forEach(part=>{
      part.removeFromParent();
      if(part.userData?.assemblyId){const targetIndex=targets.indexOf(part);if(targetIndex>=0)targets.splice(targetIndex,1);tabSelectable.delete(part);selectable.delete(part);}
      if(part.geometry){geometry.delete(part.geometry);part.geometry.dispose();}
      for(const material of (Array.isArray(part.material)?part.material:[part.material]))if(material&&!material.userData?.realitySurfaceOwned)retiredMaterials.add(material);
    });
    for(const material of [...retiredMaterials])if(material.userData?.realityLensFadeSource)retiredMaterials.add(material.userData.realityLensFadeSource);
    for(const material of retiredMaterials){
      if(material.map)retiredMaps.add(material.map);
      materials.delete(material);node.fadeMaterials?.delete(material);node.fadeMap?.delete(material.userData?.realityLensFadeSource??material);material.dispose();
    }
    for(const map of retiredMaps){textures.delete(map);map.dispose();}
    const width=form.width,height=form.height,depth=form.depth;
    const sphereForm=shapeName==='sphere';
    const art=drawFeatureArtwork(THREE,node.feature,node.accent.color,shapeName,{compact:previewCompact,surfaceAspect:width/height});if(art)textures.add(art);
    const shell=makeMaterial('#0c1c2c',{metalness:.2,roughness:.55,transparent:false,opacity:1,depthWrite:true,side:THREE.FrontSide});
    const artMaterial=art?new THREE.MeshBasicMaterial({color:'#ffffff',map:art,transparent:false,depthWrite:true,side:THREE.FrontSide}):null;
    if(artMaterial)materials.add(artMaterial);
    const parts=[],surfaceGeometry=createRealitySurfaceGeometry(THREE,shapeName),bodyGeometry=surfaceGeometry.geometry;
    node.surfaceCharts=surfaceGeometry.charts;node.surfaceBinding=realityObjectSurfaceEngine.fullSurfaceBinding({featureId:node.feature.id,objectId:node.feature.id,shape:shapeName,charts:node.surfaceCharts});geometry.add(bodyGeometry);
    // Every exterior triangle is part of this information-bearing body.
    // The active owner's UV atlas replaces these overview materials in place.
    const bodyMaterial=surfaceGeometry.charts.map(()=>artMaterial??shell);
    const body=new THREE.Mesh(bodyGeometry,bodyMaterial);body.userData.assemblyId=node.feature.id;body.name=`${node.feature.id}/spatial-tab/${shapeName}`;
    body.renderOrder=20;body.castShadow=false;body.receiveShadow=false;node.root.add(body);targets.push(body);selectable.add(body);tabSelectable.add(body);parts.push(body);
    const edgeGeometry=new THREE.EdgesGeometry(bodyGeometry,18);geometry.add(edgeGeometry);
    const edgeMaterial=new THREE.LineBasicMaterial({color:sphereForm?'#e4c878':node.accent.color,transparent:true,opacity:sphereForm?.82:.58,depthWrite:false,depthTest:true});materials.add(edgeMaterial);
    const edges=new THREE.LineSegments(edgeGeometry,edgeMaterial);edges.renderOrder=22;node.root.add(edges);parts.push(edges);
    const indicatorGeometry=new THREE.SphereGeometry(.09,12,10);geometry.add(indicatorGeometry);
    const indicatorMaterial=makeMaterial(node.locked?'#d1ae70':'#659b91',{emissive:node.locked?'#9e7134':'#316e68',emissiveIntensity:.72,metalness:.1,roughness:.4});
    const indicator=mesh(indicatorGeometry,indicatorMaterial,[width*.36,height*.36,depth*.52+.08],[1,1,1],node.root);indicator.name=`${node.feature.id}/tab-lock-state`;
    node.formParts=[...parts,indicator];node.tabMesh=body;node.artMaterial=artMaterial;node.artTexture=art;node.shellMaterial=shell;node.edgeMaterial=edgeMaterial;node.indicator=indicator;node.shape=shapeName;positionEmbeddedData(node);
    applyTabDepthMode(node);
    prepareFadeMaterials(node);
    node.artMaterial=node.fadeMap.get(artMaterial)??artMaterial;
    node.shellMaterial=node.fadeMap.get(shell)??shell;
    node.edgeMaterial=node.fadeMap.get(edgeMaterial)??edgeMaterial;
    node.indicator.material=node.fadeMap.get(indicatorMaterial)??indicatorMaterial;
    node.artworkSuppressed=false;
  }
function applyTabDepthMode(node){
  for(const part of node.formParts??[]){
    const list=Array.isArray(part.material)?part.material:[part.material];
    for(const material of list){if(material&&'depthTest'in material){material.depthTest=true;material.depthWrite=part===node.tabMesh;material.needsUpdate=true;}}
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
  const groupParents=new Map(),groupTargets=[],groupCoreGeometry=new THREE.SphereGeometry(.36,18,14),groupRingGeometry=new THREE.TorusGeometry(.68,.018,6,42),groupInnerRingGeometry=new THREE.TorusGeometry(.44,.009,6,36);
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
    const copy={...SPACE_COPY[domain.id],label:lensSpaceLabel(domain.id)};
    const previewFeature={id:domain.id,label:copy.label,description:copy.description,isSpaceEntry:true,memberCount:members.length};
    const homeSurface=createRealityHomeSurface({THREE,id:domain.id,label:copy.label,description:copy.description,members});
    const entryGeometry=homeSurface.geometry;geometry.add(entryGeometry);
    for(const material of homeSurface.materials){materials.add(material);if(material.map)textures.add(material.map);}
    const entryFace=homeSurface.materials[homeSurface.charts.findIndex(chart=>chart.id==='front')]??homeSurface.materials[0];
    const entry=new THREE.Mesh(entryGeometry,homeSurface.materials);entry.name=`reality-lens/space-entry/${domain.id}`;entry.userData.realityLensGroup=domain.id;entry.userData.spaceSilhouette=homeSurface.shape;entry.userData.homeSurfaceShape=homeSurface.shape;entry.userData.surfaceCharts=homeSurface.charts;entry.visible=false;entry.renderOrder=20;
    const entryEdgeGeometry=new THREE.EdgesGeometry(entryGeometry,35);geometry.add(entryEdgeGeometry);
    const entryEdgeMaterial=new THREE.LineBasicMaterial({color:homeSurface.accent,transparent:true,opacity:.3,depthWrite:false});materials.add(entryEdgeMaterial);
    const entryEdges=new THREE.LineSegments(entryEdgeGeometry,entryEdgeMaterial);entryEdges.visible=false;entryEdges.renderOrder=22;
    root.add(entry,entryEdges);groupTargets.push(entry);
    const center=new THREE.Vector3();members.forEach(node=>center.add(node.position));center.multiplyScalar(1/members.length);root.position.copy(center);
    groupParents.set(domain.id,{id:domain.id,label:copy.label,previewFeature,homeSurface,root,core,ring,innerRing,entry,entryFace,entryEdges,members,spacePosition:new THREE.Vector3()});
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
  let calmMode=false,spaceViewport={width:1280,height:800},creatorAppearance=null;
  const compactPositions=new Map(),spaceBounds=new Map(),spacePages=new Map();
  const compactBasePositions=new Map([...nodes].filter(([,node])=>Array.isArray(node.feature.initialPosition)).map(([id,node])=>[id,node.position.clone()]));
  let homeStorage=null;try{homeStorage=globalThis.localStorage??null;}catch{}
  const homeTransforms=createHomeTransformStore({ids:[...groupParents.keys()],storage:homeStorage});
  const homeBases=new Map();
  const previewScale=2.2;
  function getSpacePage(groupId=activeGroupId){
    const members=groupParents.get(groupId)?.members??[],pageSize=spaceViewport.width<700?4:6,total=members.length,pageCount=Math.max(1,Math.ceil(total/pageSize));
    const page=Math.max(0,Math.min(pageCount-1,spacePages.get(groupId)??0));
    return {page,pageCount,pageSize,total,ids:members.slice(page*pageSize,(page+1)*pageSize).map(node=>node.feature.id)};
  }
  function boundsFor(items){
    if(!items.length)return {center:[0,1,0],radius:1,width:2,height:2,depth:1,count:0,ids:[]};
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const item of items)for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],item.position[axis]-item.size[axis]/2);max[axis]=Math.max(max[axis],item.position[axis]+item.size[axis]/2);}
    const size=max.map((value,axis)=>value-min[axis]),center=min.map((value,axis)=>(value+max[axis])/2);
    return {center,radius:Math.hypot(...size)/2,width:size[0],height:size[1],depth:size[2],count:items.length,ids:items.map(item=>item.id)};
  }
  function arrangeRows(items,maxColumns,gap){
    const columns=Math.min(maxColumns,Math.max(1,items.length)),rows=Math.ceil(items.length/columns),columnWidths=Array(columns).fill(0),rowHeights=Array(rows).fill(0);
    items.forEach((item,index)=>{columnWidths[index%columns]=Math.max(columnWidths[index%columns],item.size[0]);rowHeights[Math.floor(index/columns)]=Math.max(rowHeights[Math.floor(index/columns)],item.size[1]);});
    const width=columnWidths.reduce((sum,value)=>sum+value,0)+gap*(columns-1),height=rowHeights.reduce((sum,value)=>sum+value,0)+gap*(rows-1);
    return items.map((item,index)=>{
      const column=index%columns,row=Math.floor(index/columns),x=-width/2+columnWidths.slice(0,column).reduce((sum,value)=>sum+value,0)+gap*column+columnWidths[column]/2;
      const y=1+height/2-rowHeights.slice(0,row).reduce((sum,value)=>sum+value,0)-gap*row-rowHeights[row]/2;
      return {...item,position:[x,y,0]};
    });
  }
  function refreshSpaceLayout(){
    const columns=creatorAppearance?.layout==='focus'?1:creatorAppearance?.layout==='flow'?1:spaceViewport.width<700?2:creatorAppearance?.layout==='grid'?4:3;
    const creatorGap=creatorAppearance?.density==='compact'?.8:creatorAppearance?.density==='spacious'?2.8:1.7;
    // Compute each entry's envelope from its actual beveled solid. Include
    // the full range of the tiny orientation drift so framing never guesses.
    const entries=arrangeRows([...groupParents.values()].map(marker=>{
      const half=[0,0,0],angle=spaceViewport.width<700?.09:.2;
      for(const yaw of [angle-.007,angle+.007]){
        const rotation=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(.045,yaw,0));
        const bodyBounds=marker.entry.geometry.boundingBox.clone().applyMatrix4(rotation);
        for(const [axis,key] of ['x','y','z'].entries())half[axis]=Math.max(half[axis],Math.abs(bodyBounds.min[key]),Math.abs(bodyBounds.max[key]));
      }
      return {id:marker.id,size:half.map(value=>value*2)};
    }),columns,creatorAppearance?(creatorGap*.7):(spaceViewport.width<700?.5:1.6));
    entries.forEach(item=>{homeBases.set(item.id,[...item.position]);const transform=homeTransforms.get(item.id);item.position=item.position.map((value,axis)=>Math.max(-60,Math.min(60,value+transform.offset[axis])));item.size=item.size.map(value=>value*transform.size);groupParents.get(item.id).spacePosition.set(...item.position);});spaceBounds.set(null,boundsFor(entries));
    const framedHome=entries.map(item=>{const box=homeBox(item.id,getHomeTransform(item.id));return {id:item.id,position:box.getCenter(new THREE.Vector3()).toArray(),size:box.getSize(new THREE.Vector3()).toArray()};});
    spaceBounds.set(null,boundsFor(framedHome));
    compactPositions.clear();
    for(const marker of groupParents.values()){
      const page=getSpacePage(marker.id);spacePages.set(marker.id,page.page);
      const members=marker.members.slice(page.page*page.pageSize,(page.page+1)*page.pageSize);
      // Four tools form a balanced square by default. Explicit creator layout
      // choices still control their arrangement, and saved positions stay intact.
      const memberColumns=marker.id==='network'&&members.length===4&&!['focus','flow','grid'].includes(creatorAppearance?.layout)?2:columns;
      const memberGap=marker.id==='network'&&!creatorAppearance?1.0:creatorGap;
      const items=arrangeRows(members.map(node=>{
        const form=REALITY_TAB_FORMS[node.shape]??REALITY_TAB_FORMS.rectangle,scale=(node.size??1)*(node.scale??1)*previewScale;
        const size=new THREE.Vector3(form.width*scale,form.height*scale,form.depth*scale);
        if(node.rotation?.some(angle=>angle!==0)){
          const half=size.clone().multiplyScalar(.5),box=new THREE.Box3(half.clone().negate(),half);
          box.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...node.rotation))).getSize(size);
        }
        return {id:node.feature.id,size:size.toArray()};
      }),memberColumns,memberGap);
      items.forEach(item=>{const node=nodes.get(item.id),base=compactBasePositions.get(item.id)??node.position;item.position=item.position.map((value,axis)=>value+(node.position.getComponent(axis)-base.getComponent(axis)));compactPositions.set(item.id,new THREE.Vector3(...item.position));});spaceBounds.set(marker.id,boundsFor(items));
    }
  }
  function getObjectPosition(id){
    const node=nodes.get(id);if(!node)return null;
    return calmMode&&activeGroupId!=='*'&&compactPositions.has(id)?compactPositions.get(id):node.position;
  }
  function resolveObjectMove(id,position,objects){
    if(!calmMode||activeGroupId==='*')return resolveRealityTabPosition(id,position,objects);
    const object=objects.find(item=>item.id===id),node=nodes.get(id),current=getObjectPosition(id),page=getSpacePage(node.lensGroup);
    const visible=objects.filter(item=>page.ids.includes(item.id));
    const displayed=visible.map(item=>({ ...item,position:getObjectPosition(item.id).toArray(),size:item.size*(nodes.get(item.id).scale??1)*previewScale }));
    const proposed=current.toArray().map((value,axis)=>value+position[axis]-node.position.getComponent(axis));
    const resolved=resolveRealityTabPosition(id,proposed,displayed);
    return resolved.map((value,axis)=>node.position.getComponent(axis)+value-current.getComponent(axis));
  }
  function getHomeTransform(id){
    const marker=groupParents.get(id);if(!marker)throw Error('Unknown Home space');
    const transform=homeTransforms.get(id),base=homeBases.get(id)??[0,0,0];
    return {id,position:base.map((value,axis)=>Math.max(-60,Math.min(60,value+transform.offset[axis]))),size:transform.size,rotation:transform.rotation,locked:false,anchor:false};
  }
  function homeBox(id,transform){
    const marker=groupParents.get(id),index=[...groupParents.keys()].indexOf(id),yaw=(index%2?-1:1)*(spaceViewport.width<700?.09:.2);
    const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(.045+transform.rotation[0],yaw+transform.rotation[1],transform.rotation[2]));
    return marker.entry.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...transform.position),rotation,new THREE.Vector3().setScalar(transform.size))).expandByScalar(.18);
  }
  function setHomeTransform(id,value,{preview=false}={}){
    if(viewState?.mode==='past')throw Error('Recorded history is read-only; return to the present before arranging Home');
    const current=getHomeTransform(id),next={...current,...value,id};
    if(!Array.isArray(next.position)||next.position.length!==3||next.position.some(number=>!Number.isFinite(number)||Math.abs(number)>60))throw Error('Home position must be finite and within the local workspace');
    if(!Number.isFinite(next.size)||next.size<.5||next.size>2.5||!Array.isArray(next.rotation)||next.rotation.length!==3||next.rotation.some(number=>!Number.isFinite(number)||Math.abs(number)>Math.PI))throw Error('Home scale or rotation exceeds its presentation bounds');
    next.position=[...next.position];next.rotation=[...next.rotation];
    for(let iteration=0;iteration<64;iteration++){
      let changed=false;
      for(const otherId of groupParents.keys())if(otherId!==id){
        const a=homeBox(id,next),other=getHomeTransform(otherId),b=homeBox(otherId,other);
        if(!a.intersectsBox(b))continue;
        const pushes=['x','y','z'].map((axis,index)=>({index,positive:b.max[axis]-a.min[axis]+.02,negative:a.max[axis]-b.min[axis]+.02}));
        const nearest=pushes.flatMap(push=>[{index:push.index,step:push.positive},{index:push.index,step:-push.negative}]).sort((left,right)=>Math.abs(left.step)-Math.abs(right.step))[0];
        next.position[nearest.index]=Math.max(-60,Math.min(60,next.position[nearest.index]+nearest.step));changed=true;
      }
      if(!changed)break;
      if(iteration===63)throw Error('No collision-free Home slot is available; move another object first');
    }
    const base=homeBases.get(id)??[0,0,0],row={id,offset:next.position.map((number,axis)=>number-base[axis]),size:next.size,rotation:next.rotation};
    homeTransforms[preview?'preview':'commit'](id,row);refreshSpaceLayout();return getHomeTransform(id);
  }
  function cancelHomeTransform(id){homeTransforms.cancel(id);refreshSpaceLayout();}
  function resetHomeTransforms(){if(viewState?.mode==='past')throw Error('Recorded history is read-only; return to the present before resetting Home');homeTransforms.reset();refreshSpaceLayout();return getSnapshot();}
  function setActiveGroup(groupId=null){
    if(groupId!==null&&groupId!=='*'&&!groupParents.has(groupId))throw Error(`Unknown Reality Lens domain: ${groupId}`);
    activeGroupId=groupId;
  }
  /** Calm navigation is additive. '*' restores the saved full assembly;
   * null shows entry bodies, and a domain ID opens only its own objects. */
  function setSpaceView(groupId=null){
    setActiveGroup(groupId);calmMode=groupId!=='*';refreshSpaceLayout();
    if(focusId&&groupId!==nodes.get(focusId)?.lensGroup)focusId=null;
  }
  function setSpaceViewport({width,height}={}){
    if(!Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0)throw Error('Reality Lens space viewport must have positive finite dimensions');
    spaceViewport={width,height};
    const compact=width<700;
    if(compact!==previewCompact){
      previewCompact=compact;
      for(const node of nodes.values())if(node.isTab)makeTabForm(node,node.shape);
      for(const marker of groupParents.values()){
        if(marker.homeSurface)continue; // Native home atlases are resolution independent; retain all body charts.
        const material=marker.entryFace,oldTexture=material.map;
        const texture=drawFeatureArtwork(THREE,marker.previewFeature,groupColors[marker.id],`space-${marker.id}`,{compact:previewCompact,surfaceAspect:5.6/3.9});
        if(texture)textures.add(texture);material.map=texture;material.needsUpdate=true;
        if(oldTexture){textures.delete(oldTexture);oldTexture.dispose();}
      }
    }
    if(focusId&&activeGroupId===nodes.get(focusId)?.lensGroup){const index=groupParents.get(activeGroupId).members.findIndex(node=>node.feature.id===focusId);spacePages.set(activeGroupId,Math.floor(index/(width<700?4:6)));}
    refreshSpaceLayout();
  }
  function setSpacePage(page){
    if(!Number.isFinite(page))throw Error('Reality Lens space page must be a finite number');
    if(!groupParents.has(activeGroupId))return getSpacePage();
    const info=getSpacePage();spacePages.set(activeGroupId,Math.max(0,Math.min(info.pageCount-1,Math.trunc(page))));
    focusId=null;refreshSpaceLayout();return getSpacePage();
  }
  function focus(id){
    focusId=nodes.has(id)?id:null;
    if(calmMode&&focusId&&activeGroupId===nodes.get(focusId)?.lensGroup){
      const info=getSpacePage(),index=groupParents.get(activeGroupId).members.findIndex(node=>node.feature.id===focusId),page=Math.floor(index/info.pageSize);
      if(page!==info.page){spacePages.set(activeGroupId,page);refreshSpaceLayout();}
    }
  }
  refreshSpaceLayout();
  function tintCreatorMaterial(material,color){
    if(!material?.color?.set)return;
    material.userData??={};
    if(color===null&&!material.userData.creatorOriginalColor)return;
    if(!material.userData.creatorOriginalColor)material.userData.creatorOriginalColor=`#${material.color.getHexString()}`;
    material.color.set(color??material.userData.creatorOriginalColor);
  }
  function applyCreatorAppearance(){
    for(const node of nodes.values()){
      const objectColor=creatorAppearance?.objects?.find(item=>item.id===node.feature?.id)?.color;
      tintCreatorMaterial(node.edgeMaterial,objectColor??creatorAppearance?.palette?.accent??null);
    }
    for(const marker of groupParents.values())tintCreatorMaterial(marker.entryEdges?.material,creatorAppearance?.palette?.accent??null);
  }
  function setCreatorAppearance(descriptor=null){creatorAppearance=descriptor;refreshSpaceLayout();applyCreatorAppearance();return getSnapshot();}
  const projectedPosition=new THREE.Vector3(),scatterDirection=new THREE.Vector3();
  function apply(snapshot,{viewMode='3d',hoveredId=null}={}){
    viewState=snapshot;selected=snapshot.selectedId;hovered=hoveredId;mode=viewMode;
    snapshot.objects.forEach(object=>{
      const node=nodes.get(object.id);if(!node)return;
      const position=Array.isArray(object.position)?object.position:(object.position&&typeof object.position.x==='number'&&typeof object.position.y==='number'&&typeof object.position.z==='number'?[object.position.x,object.position.y,object.position.z]:null);
      if(!position) return;
      if(!compactBasePositions.has(object.id))compactBasePositions.set(object.id,new THREE.Vector3(...position));
      node.position.set(position[0],position[1],position[2]);node.goalOpen=object.open?1:object.id===hovered?.23:0;
      const rotation=Array.isArray(object.rotation)?object.rotation:[0,0,0];
      // Apply canonical changes and cancelled previews once. Mounted surface
      // gestures can keep their existing orientation between owner changes.
      if(!node.rotation||rotation.some((angle,axis)=>angle!==node.rotation[axis])){
        node.rotation=[...rotation];node.root.rotation.set(...rotation);
      }
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
    if(calmMode)refreshSpaceLayout();
    applyCreatorAppearance();
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
        if(!node.surface360)node.root.rotation.set((node.rotation?.[0]??0)+(reducedMotion?0:Math.sin(time*.13+node.traits.phase)*.012),(node.rotation?.[1]??0)+(reducedMotion?0:Math.sin(time*.18+node.traits.phase)*.025),node.rotation?.[2]??0);
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
      node.city.position.y=node.open*.55;node.root.rotation.set(node.rotation?.[0]??0,(node.rotation?.[1]??0)+(reducedMotion?0:Math.sin(time*.18+node.traits.phase)*.025),node.rotation?.[2]??0);
      node.beacon.material=level?node.beaconHot:node.beaconMat;
    }
    if(!showWorld){edges.forEach(([from,to],i)=>{const a=nodes.get(from).root.position,b=nodes.get(to).root.position;buffer.setXYZ(i*2,a.x,a.y,a.z);buffer.setXYZ(i*2+1,b.x,b.y,b.z);});buffer.needsUpdate=true;}
    grid.material.opacity=mode==='4d'?.09:.035;
  }
  function update(dt,time,{reducedMotion=false,cameraDistance=0,cameraPosition=null}={}){
    const blend=reducedMotion?1:1-Math.exp(-dt*9);
    const focalNode=nodes.get(focusId),focusScale=Math.max(1,focalNode?.size??1);
    const targetProgress=calmMode?1:realityLensEngine.overviewProgress(cameraDistance/focusScale);
    approachBlend+=(targetProgress-approachBlend)*blend;
    worldBlock.visible=false;
    const activeRelation=(nodes.get(selected)?.isTab||nodes.get(hovered)?.isTab)===true;
    connections.visible=!calmMode&&edges.length>0&&approachBlend>.3&&activeRelation&&cameraDistance>24&&!focusId;
    connectionMaterial.opacity=.26*approachBlend;
    const focusDistance=cameraPosition&&focalNode?cameraPosition.distanceTo(getObjectPosition(focusId)):cameraDistance;
    const focusResponse=realityLensEngine.objectResponse({id:focusId,selectedId:focusId,distance:focusDistance,focusScale});
    activeFocusStrength=focusResponse.focusStrength;activeFocusDistance=focusId?focusDistance:Infinity;
    const focusIsolated=Boolean(focusId&&focusResponse.isolationReached);activeFocusIsolated=focusIsolated;
    // The funnel is a guide while travelling, not another object layered on
    // top of the feature. Clear it as the user arrives at a focused tab.
    funnelGuide.visible=!calmMode&&approachBlend>.035&&!focusIsolated;
    funnelGuideMaterial.opacity=(.035+approachBlend*.075)*(1-activeFocusStrength);
    const buffer=connectionGeometry.attributes.position;
    const pageFeatureIds=calmMode?new Set(getSpacePage().ids):null;
    for(const [id,node] of nodes){
      const groupOrder=['worlds','people','network','value','agents','experiences'].indexOf(node.lensGroup);
      const delay=node.isTab?Math.max(0,groupOrder)*.055+(node.revealOrder%3)*.012:0;
      const tabReveal=node.isTab?(node.feature.id==='block-world'?1:Math.max(0,Math.min(1,(approachBlend-delay)/Math.max(.2,1-delay)))):1;
      node.tabReveal=node.isTab?tabReveal:1;
      const level=id===selected?1:id===hovered?.55:0;
      projectedPosition.copy(getObjectPosition(id));
      node.root.position.lerp(projectedPosition,blend);
      const nodeDistance=cameraPosition?cameraPosition.distanceTo(node.root.position):cameraDistance;
      const physicalStage=realityLensEngine.stageAt(nodeDistance/Math.max(1,node.size??1));
      node.revealStage=node.goalOpen>=.99?3:physicalStage.stage;
      node.revealProgress=node.goalOpen>=.99?1:physicalStage.progress;
      const stageOpen=[0,.28,.56,.82][node.revealStage]+node.revealProgress*.16;
      node.open+=(Math.max(node.goalOpen,stageOpen)-node.open)*blend;
      const response=realityLensEngine.objectResponse({id,selectedId:focusId,distance:focusDistance,focusScale,baseScale:(node.scale??1)*(calmMode&&!focusId?previewScale:1),size:node.size??1,tabReveal});
      if(node.lastContextOpacity===undefined||Math.abs(node.lastContextOpacity-response.contextOpacity)>.008){setNodeOpacity(node,response.contextOpacity);node.lastContextOpacity=response.contextOpacity;}
      const groupMatches=activeGroupId==='*'||((calmMode||node.isTab)&&node.lensGroup===activeGroupId&&(!calmMode||pageFeatureIds.has(id)));
      // Context remains available while approaching, then genuinely clears so
      // the selected object can be read and used as the Lens working surface.
      node.root.visible=(!node.isTab||tabReveal>.008)&&!response.contextHidden&&response.contextOpacity>.05&&groupMatches;
      if(!node.root.visible)continue;
      if(node.isTab){
        // A mounted reader uses the same stable scale as its camera framing.
        // Distance-driven growth otherwise shrank a wide phone surface to
        // ~150px tall even after its reading frame had been calculated.
        const reading=node.surfaceReading&&response.isSelected;
        const targetScale=reading?node.scale*node.size*realityLensEngine.profile.focus.maxScale:response.scale;
        const stretch=reading?(node.surfaceStretch??[1,1,1]):[1,1,1];
        node.root.scale.lerp(new THREE.Vector3(targetScale*stretch[0],targetScale*stretch[1],targetScale*stretch[2]),blend);
        // Native object-tab contract: when controls are mounted, the Three.js
        // body remains the visible tab. The DOM contributes interaction/text
        // only; it must never replace the object with a second card.
        const cover=response.isSelected?Math.max(0,Math.min(1,(response.focusStrength-.24)/.76)):0;
        const tuneSurface=(material,multiplier)=>{if(!material)return;const base=material.userData?.realityLensBaseOpacity??1;material.opacity=base*(1-cover*multiplier)*response.contextOpacity;};
        tuneSurface(node.shellMaterial,reading?0:.18);
        if(node.edgeMaterial){const base=node.edgeMaterial.userData?.realityLensBaseOpacity??1;node.edgeMaterial.opacity=base*(reading?1:(1-cover*.18))*response.contextOpacity;}
        if(node.artMaterial&&!node.surface360){
          // Static preview typography disappears while the live controls are
          // present, but the cap material itself stays opaque as the object's
          // real front face.
          if(node.artworkSuppressed!==reading){
            node.artworkSuppressed=reading;
            node.artMaterial.map=reading?null:node.artTexture;
            node.artMaterial.color.set(reading?'#0d2b48':'#ffffff');
            node.artMaterial.needsUpdate=true;
          }
          const base=node.artMaterial.userData?.realityLensBaseOpacity??1;
          node.artMaterial.opacity=base*(reading?1:(1-cover*.22))*response.contextOpacity;
          // Opaque information fronts occlude the rear shoulders and their
          // edge loops. Leaving them depthless let shell geometry paint over
          // the first letters when an object was viewed off-centre.
          node.artMaterial.depthWrite=node.artMaterial.opacity>.99;
        }
        tuneSurface(node.indicator?.material,.35);
        if(!node.surface360){
          node.root.rotation.set((node.rotation?.[0]??0)+(reducedMotion||calmMode?0:Math.sin(time*.13+node.traits.phase)*.012),(node.rotation?.[1]??0)+(reducedMotion||calmMode?0:Math.sin(time*.18+node.traits.phase)*.025),node.rotation?.[2]??0);
        }
        if(node.indicator){node.indicator.visible=!node.surfaceReading&&!calmMode;const pulse=reducedMotion?1:.9+.1*Math.sin(time*.92+node.traits.phase);node.indicator.scale.setScalar(pulse);if(node.indicator.material?.emissiveIntensity!==undefined)node.indicator.material.emissiveIntensity=node.surfaceReading||reducedMotion?.28:.28+.18*(.5+.5*Math.sin(time*1.3+node.traits.phase));}
        // At close focus the object itself owns attention. The attached
        // controls are only its interactive skin, not a replacement panel.
        const panelOwnsAttention=response.isSelected&&response.focusStrength>.6;
        node.liveContent.visible=!calmMode&&node.revealStage>=1&&node.open>.05&&tabReveal>.18&&!panelOwnsAttention;
        node.liveContent.scale.setScalar(node.liveContent.visible ? .45+node.open*.55 : .001);
        // Sources are available in the approach layers; a close living panel
        // already contains its own data and should not grow floating badges.
        node.sourceLayer.visible=!calmMode&&node.revealStage>=2&&!panelOwnsAttention;
        node.sourceLayer.scale.setScalar(node.sourceLayer.visible ? .74+node.revealProgress*.26 : .001);
        node.nestedLayer.visible=!calmMode&&node.revealStage>=3&&!panelOwnsAttention;
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
      node.root.rotation.set(node.rotation?.[0]??0,(node.rotation?.[1]??0)+(reducedMotion?0:Math.sin(time*.18+node.traits.phase)*.025),node.rotation?.[2]??0);
      node.beacon.material=level?node.beaconHot:node.beaconMat;
    }
    for(const [groupIndex,domain] of REALITY_LENS_GROUPS.entries()){
      const marker=groupParents.get(domain.id);if(!marker)continue;
      const center=new THREE.Vector3();
      if(calmMode)center.copy(marker.spacePosition);
      else{marker.members.forEach(node=>center.add(node.root.position));center.multiplyScalar(1/marker.members.length);}
      marker.root.position.lerp(center,blend);
      const motion=calmMode&&!reducedMotion?Math.sin(time*.24+groupIndex)*.007:0;
      const homeTransform=homeTransforms.get(domain.id);marker.root.scale.setScalar(calmMode?homeTransform.size:1);
      marker.root.rotation.set((calmMode?.045:0)+(calmMode?homeTransform.rotation[0]:0),(calmMode?(groupIndex%2?-1:1)*(spaceViewport.width<700?.09:.2)+motion:0)+(calmMode?homeTransform.rotation[1]:0),calmMode?homeTransform.rotation[2]:0);
      const expanded=activeGroupId===domain.id;
      marker.root.visible=calmMode?activeGroupId===null:activeGroupId!=='*'&&!expanded&&approachBlend>.08&&!focusIsolated;
      marker.entry.visible=calmMode;marker.entryEdges.visible=calmMode;
      marker.core.visible=!calmMode;marker.ring.visible=!calmMode;marker.innerRing.visible=!calmMode;
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
    // Zero opacity still writes line depth in Three.js. Hide the guide itself
    // so it cannot cut dark seams through the native information fronts.
    grid.visible=!calmMode&&approachBlend>.25&&!focusIsolated;
    grid.material.opacity=grid.visible?(mode==='4d'?.07:.022):0;
    starMaterial.opacity=calmMode?.18:.38;
  }
  function getSnapshot(){
    const lod=approachBlend<.04?'nucleus':approachBlend<.98?'unfolding':'field';
    const groupIds=[...new Set([...nodes.values()].map(node=>node.lensGroup).filter(Boolean))];
    const formerCenter=nodes.get('block-world');
    return {homeLayout:homeTransforms.snapshot(),geometryOnly:true,referenceImagesUsedAsTextures:false,funnelGuideVisible:funnelGuide.visible,gridVisible:grid.visible,nodeIds:[...nodes.keys()],nodeCount:nodes.size,tabCount:[...nodes.values()].filter(node=>node.isTab).length,visibleFeatureIds:[...nodes.values()].filter(node=>node.isTab&&node.root.visible).map(node=>node.feature.id),visibleTabCount:[...nodes.values()].filter(node=>node.isTab&&node.root.visible&&node.tabReveal>.35&&node.contextOpacity>.05).length,groupIds,visibleGroupCount:[...groupParents.values()].filter(marker=>marker.root.visible).length,visibleGroupIds:[...groupParents.values()].filter(marker=>marker.root.visible).map(marker=>marker.id),activeGroupId,calmMode,spaceView:calmMode?(activeGroupId??'home'):'assembly',spacePage:getSpacePage(),spaceBounds:spaceBounds.get(activeGroupId)??null,focusedId:focusId,focusStrength:Number(activeFocusStrength.toFixed(3)),focusIsolated:activeFocusIsolated,focusDistance:Number.isFinite(activeFocusDistance)?Number(activeFocusDistance.toFixed(2)):null,selectedStage:nodes.get(focusId)?.revealStage??0,approachProgress:Number(approachBlend.toFixed(3)),anchorOpen:formerCenter?.isTab?0:Number((formerCenter?.open??0).toFixed(3)),edgeCount:edges.length,relationshipSource:'authored feature navigation graph',connectionsVisible:connections.visible,connectionPairs:edges.map(pair=>[...pair]),viewMode:mode,selectedId:selected,historyMode:viewState?.mode??'present',designedArchitecture:true,equalAxisCubes:false,singleFixedAnchorCube:[...nodes.values()].some(node=>!node.isTab&&node.feature.id==='block-world'),formerCenterIsMovableTab:formerCenter?.isTab===true,lensMode,lod};
  }
  return {layer,nodes,groupParents,groupTargets,worldBlock,backdrop,apply,update,getSnapshot,setCreatorAppearance,setLensMode,setActiveGroup,setSpaceView,setSpaceViewport,setSpacePage,getSpacePage,getObjectPosition,resolveObjectMove,getHomeTransform,setHomeTransform,cancelHomeTransform,resetHomeTransforms,getSpaceBounds:id=>spaceBounds.get(id??null)??null,getGroupPosition:id=>{const marker=groupParents.get(id);return marker?(calmMode?marker.spacePosition:marker.root.position):null;},focus,resolve:object=>object?.userData?.assemblyId??null,resolveGroup:object=>object?.userData?.realityLensGroup??null,
    destroy(){selectable.forEach(object=>{const i=targets.indexOf(object);if(i>=0)targets.splice(i,1);});groupTargets.length=0;geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());layer.removeFromParent();}};
}
