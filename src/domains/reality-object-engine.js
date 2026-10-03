import {livingSurfaceLayoutEngine} from './living-surface-layout-engine.js?v=20261003-calm7';

const STAGE_NAMES=Object.freeze(['Signum','Identitas','Fontes','Interior']);
const LATIN_LABELS=Object.freeze({
  'reality-lens':'Oculus Realitatis','person':'Persona Ω','rooms':'Cubicula & Nuntii',
  'block-world':'Materia / Fabrica','runtime-sync':'Concordia Laterum','migration':'Transitus',
  'asset-token':'Signum Bonorum','asset-market':'Forum Bonorum','launch-distribution':'Distributio',
  'social-explorer':'Exploratio Socialis','social-mirror':'Speculum Sociale','youtube':'YouTube',
  'paycore':'Pecunia · PAYCORE','contracts':'Pacta','contract-atelier':'Officina Pactorum',
  'ledger':'Liber & EchoProof','t402':'Iter Valor','agent':'Agens','neural-mesh':'Rete Neurale',
  'muse-agent':'Musa','bot-plaza':'Forum Agentium','luna-companion':'Luna · Comes',
  'picture-matter':'Imago & Res','nft-atelier':'Officina NFT','wardrobe-atelier':'Vestis',
  'white-paper':'Charta Alba','gesture-lens':'Gestus','gateway':'Porta Realitatis',
  'world-events':'Eventa','sports-events':'Ludi','multi-sport-events':'Ludi Varii',
  'arena':'Arena','chess':'Scacci','web-ai':'Retia & AI','academy':'Academia','projections':'Telum · PC · XR',
});
const cleanVisibleCopy=value=>String(value??'').replace(/\bworlds\b/gi,'loca').replace(/\bworld\b/gi,'locus');
export function realityLensLabel(feature){
  const id=typeof feature==='string'?feature:feature?.id;
  return LATIN_LABELS[id]??cleanVisibleCopy(typeof feature==='string'?feature:feature?.label??id??'Instrumentum');
}
export function realityLensCopy(value){return cleanVisibleCopy(value);}
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

/** Keep an accessible hit region on the rendered contour. Never relocate it
 * to a convenient screen pocket, where it could select an invisible object. */
export function projectSurfaceHitRegion({points,viewportWidth,viewportHeight}={}){
  if(!Array.isArray(points)||points.length<3||points.some(point=>!Array.isArray(point)||point.length!==3||point.some(value=>!Number.isFinite(value))))throw Error('A native hit region needs projected contour points');
  if(!Number.isFinite(viewportWidth)||viewportWidth<=0||!Number.isFinite(viewportHeight)||viewportHeight<=0)throw Error('A native hit region needs a finite viewport');
  if(points.some(point=>point[2]<=-1||point[2]>=1))return Object.freeze({visible:false});
  const pixels=points.map(([x,y])=>[(x*.5+.5)*viewportWidth,(-y*.5+.5)*viewportHeight]);
  const left=Math.min(...pixels.map(point=>point[0])),right=Math.max(...pixels.map(point=>point[0])),top=Math.min(...pixels.map(point=>point[1])),bottom=Math.max(...pixels.map(point=>point[1]));
  const width=right-left,height=bottom-top;
  if(width<1||height<1||right<0||left>viewportWidth||bottom<0||top>viewportHeight)return Object.freeze({visible:false});
  return freeze({visible:true,left,top,width,height,clipPath:`polygon(${pixels.map(([x,y])=>`${(x-left)/width*100}% ${(y-top)/height*100}%`).join(',')})`});
}

/** Build the same-feature, renderer-only UI model used by every Reality Lens
 * object. It describes what the object may show; it never grants feature,
 * provider, wallet, or tool authority. */
export function createRealityObjectSurfaceEngine(){
  /** One body, one information front, one interactive skin. Both renderers
   * consume the same local anchors; neither may invent a second panel frame. */
  function primarySurfaceBinding({featureId,objectId,shape='rectangle'}={}){
    if(typeof featureId!=='string'||!featureId||featureId!==objectId)throw Error('An object tab must bind its own feature identity');
    const geometry=livingSurfaceLayoutEngine.surfaceMap(shape,{clearance:0});
    if(geometry.shape!==shape)throw Error('An object tab must use a registered body shape');
    const interaction=livingSurfaceLayoutEngine.surfaceMap(shape,{clearance:.002});
    return freeze({entityId:featureId,bodyId:objectId,shape,coordinateSpace:'owning-body-local',
      informationFace:geometry.primary,interactionFace:interaction.primary,
      contour:livingSurfaceLayoutEngine.contour(shape),clipPath:livingSurfaceLayoutEngine.contourClipPath(shape),interactiveFaceCount:1,
      interactionClearance:.002,separatePanelFrame:false,bodyMutation:false});
  }
  function wrapLayout(shape='rectangle',{depthRatio=.42,clearance=.018}={}){
    return livingSurfaceLayoutEngine.surfaceMap(shape,{depthRatio,clearance}).faces;
  }
  // All shapes share the same readable-focus rule. While travelling, the
  // surrounding faces make the object feel volumetric; once that object is
  // isolated, only its interactive front remains. This prevents a sphere,
  // wave, phone, or cube from turning into a stack of overlapping panels.
  function shouldShowFace({faceId,facesCamera,focusIsolated=false,focusedId=null,featureId=null,stage=0,objectVisible=true}={}){
    if(!['front','back','left','right','top','bottom'].includes(faceId))throw Error('A Reality Lens surface needs a known face');
    if(!Number.isInteger(stage)||stage<0||stage>3)throw Error('A Reality Lens surface stage must be between zero and three');
    if(!objectVisible)return false;
    const intimateFocus=Boolean(focusIsolated&&focusedId&&featureId&&focusedId===featureId);
    // The primary surface is the living reading face of the selected object.
    // It remains mounted through rotation, while only the wrapping context
    // surfaces depend on the viewing angle and approach distance.
    if(faceId==='front')return true;
    if(!facesCamera||intimateFocus)return false;
    return stage>=1;
  }
  function describe({feature,object,stage=0,summary='',readOnly=false}={}){
    if(!feature?.id||!object?.id||feature.id!==object.id)throw Error('A Reality Lens surface must preserve the owning feature identity');
    if(!Number.isInteger(stage)||stage<0||stage>3)throw Error('Reality Lens surface stage must be between zero and three');
    const position=Array.isArray(object.position)?object.position:[object.position?.x,object.position?.y,object.position?.z];
    if(position.length!==3||position.some(value=>!Number.isFinite(value)))throw Error('A Reality Lens surface needs a valid spatial position');
    const anchor=object.anchor===true,id=feature.id;
    const state=anchor?'Fixum · centrum':object.locked?'Immutabile':object.open?'Apertum · data':'Mutabile';
    const refs=(feature.sources??[]).map(String);
    return freeze({
      id,label:realityLensLabel(feature),description:realityLensCopy(feature.description),
      position:position.map(value=>Number(value.toFixed(1))),positionLabel:position.map(value=>Number(value.toFixed(1))).join(' / '),
      state,shape:String(object.shape??'rectangle'),size:Number(object.size??1),stage,stageLabel:STAGE_NAMES[stage],
      sourceRefs:refs.map(realityLensCopy),sourceCount:refs.length,boundary:realityLensCopy(feature.boundary??'Aspectus localis.'),
      summary:realityLensCopy(summary||'Idem instrumentum. Aperi ad inspicienda data localia.'),
      identitySame:true,interactive:!readOnly,readOnly:Boolean(readOnly),
      controls:Object.freeze({canEnter:true,canReshape:!anchor&&!object.locked&&!readOnly,canResize:!anchor&&!object.locked&&!readOnly,canMove:!anchor&&!object.locked&&!readOnly,canLock:!anchor&&!readOnly}),
      layers:Object.freeze({identity:stage>=1,sources:stage>=2,details:stage>=3}),
      authority:Object.freeze({autonomousExecution:false,providerAuthority:false,walletAuthority:false,externalTransfer:false}),
    });
  }
  function projectedBounds({shape='rectangle',size=1,distance=9,approachScale=1,viewportHeight=900,fov=60}={}){
    const projected=livingSurfaceLayoutEngine.project({shape,size,distance,approachScale,viewportHeight,fov});
    return Object.freeze({width:projected.width,height:projected.height,bodyWidth:projected.bodyWidth,bodyHeight:projected.bodyHeight,primary:projected.primary});
  }
  function fitPanel({shape='rectangle',size=1,distance=9,approachScale=1,viewportWidth=1280,viewportHeight=900,fov=60,safeWidth=32,safeHeight=176,inset=0}={}){
    return livingSurfaceLayoutEngine.fit({shape,size,distance,approachScale,viewportWidth,viewportHeight,fov,safeWidth,safeHeight,inset});
  }
  function focusFrame({shape='rectangle',size=1,approachScale=1,viewportWidth=1280,viewportHeight=900,fov=60,occupancy=.54,minDistance=7.4,maxDistance=190}={}){
    return livingSurfaceLayoutEngine.focusFrame({shape,size,approachScale,viewportWidth,viewportHeight,fov,occupancy,minDistance,maxDistance});
  }
  return Object.freeze({describe,primarySurfaceBinding,hitRegion:projectSurfaceHitRegion,projectedBounds,fitPanel,focusFrame,wrapLayout,shouldShowFace,compose:livingSurfaceLayoutEngine.compose,readingFrame:livingSurfaceLayoutEngine.readingFrame,readingProjection:livingSurfaceLayoutEngine.readingProjection,clipPath:livingSurfaceLayoutEngine.contourClipPath});
}

export const realityObjectSurfaceEngine=createRealityObjectSurfaceEngine();
