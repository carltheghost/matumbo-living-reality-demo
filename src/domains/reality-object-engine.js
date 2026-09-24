import {REALITY_TAB_FORMS} from './reality-tab-layout.js';

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

/** Build the same-feature, renderer-only UI model used by every Reality Lens
 * object. It describes what the object may show; it never grants feature,
 * provider, wallet, or tool authority. */
export function createRealityObjectSurfaceEngine(){
  function wrapLayout(shape='rectangle',{depthRatio=.42,clearance=.018}={}){
    const form=REALITY_TAB_FORMS[shape]??REALITY_TAB_FORMS.rectangle;
    if(!Number.isFinite(depthRatio)||depthRatio<=0||!Number.isFinite(clearance)||clearance<0)throw Error('Reality Lens wrap dimensions must be positive and finite');
    const width=form.width,height=form.height,depth=Math.max(form.depth,Math.min(width,height)*depthRatio),z=depth/2+clearance;
    return freeze([
      {id:'front',width,height,position:[0,0,z],rotation:[0,0,0]},
      {id:'back',width,height,position:[0,0,-z],rotation:[0,Math.PI,0]},
      {id:'left',width:depth,height,position:[-width/2-clearance,0,0],rotation:[0,-Math.PI/2,0]},
      {id:'right',width:depth,height,position:[width/2+clearance,0,0],rotation:[0,Math.PI/2,0]},
      {id:'top',width,height:depth,position:[0,height/2+clearance,0],rotation:[-Math.PI/2,0,0]},
      {id:'bottom',width,height:depth,position:[0,-height/2-clearance,0],rotation:[Math.PI/2,0,0]},
    ].map(face=>({...face,width:Number(face.width.toFixed(4)),height:Number(face.height.toFixed(4)),position:face.position.map(value=>Number(value.toFixed(4)))})));
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
    const form=REALITY_TAB_FORMS[shape]??REALITY_TAB_FORMS.rectangle;
    for(const value of [size,distance,viewportHeight,fov,approachScale])if(!Number.isFinite(value)||value<=0)throw Error('Reality Lens surface projection inputs must be finite and positive');
    const pixelsPerUnit=viewportHeight/(2*distance*Math.tan(fov*Math.PI/360));
    return Object.freeze({width:form.width*size*approachScale*pixelsPerUnit,height:form.height*size*approachScale*pixelsPerUnit});
  }
  function fitPanel({shape='rectangle',size=1,distance=9,approachScale=1,viewportWidth=1280,viewportHeight=900,fov=60,safeWidth=32,safeHeight=176,inset=0}={}){
    if(!Number.isFinite(viewportWidth)||!Number.isFinite(viewportHeight)||viewportWidth<=0||viewportHeight<=0)throw Error('Reality Lens panel needs a positive viewport');
    if(!Number.isFinite(inset)||inset<0||inset>=.5)throw Error('Reality Lens panel inset must be between zero and one half');
    const bounds=projectedBounds({shape,size,distance,approachScale,viewportHeight,fov});
    const availableWidth=Math.max(1,viewportWidth-safeWidth),availableHeight=Math.max(1,viewportHeight-safeHeight);
    const viewportScale=Math.min(1,availableWidth/bounds.width,availableHeight/bounds.height);
    const fitScale=viewportScale*(1-inset*2);
    return Object.freeze({shape,width:bounds.width*fitScale,height:bounds.height*fitScale,objectWidth:bounds.width*viewportScale,objectHeight:bounds.height*viewportScale,aspectRatio:bounds.width/bounds.height,scale:fitScale,scrollable:true});
  }
  return Object.freeze({describe,projectedBounds,fitPanel,wrapLayout,shouldShowFace});
}

export const realityObjectSurfaceEngine=createRealityObjectSurfaceEngine();
