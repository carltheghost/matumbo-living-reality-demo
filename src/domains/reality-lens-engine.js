/** Reusable presentation rules for Reality Lens objects. This module is pure:
 * it positions and stages local view objects without changing feature state. */
export const REALITY_LENS_GROUPS = Object.freeze([
  Object.freeze({id:'worlds',label:'Loca',depth:8}),
  Object.freeze({id:'people',label:'Homines',depth:13.6}),
  Object.freeze({id:'network',label:'Retia',depth:19.2}),
  Object.freeze({id:'value',label:'Valor',depth:24.8}),
  Object.freeze({id:'agents',label:'Agentes',depth:30.4}),
  Object.freeze({id:'experiences',label:'Experientiae',depth:36}),
]);

const GROUP_INDEX = new Map(REALITY_LENS_GROUPS.map((group,index)=>[group.id,index]));
const FEATURE_GROUPS = Object.freeze({
  'block-world':'worlds','runtime-sync':'worlds',migration:'worlds',rooms:'worlds',
  person:'people','social-mirror':'people','wardrobe-atelier':'people','luna-companion':'people',
  gateway:'network','web-ai':'network','social-explorer':'network','bot-plaza':'network',
  paycore:'value',contracts:'value','contract-atelier':'value',ledger:'value',t402:'value',
  'asset-token':'value','asset-market':'value','launch-distribution':'value',
  agent:'agents','neural-mesh':'agents','muse-agent':'agents',
  'multi-sport-events':'experiences','sports-events':'experiences','world-events':'experiences',
  arena:'experiences',chess:'experiences',academy:'experiences',youtube:'experiences','nft-atelier':'experiences',
  'picture-matter':'experiences','gesture-lens':'experiences',projections:'experiences',
});

const DEFAULT_PROFILE = Object.freeze({
  origin:Object.freeze([0,2,0]),
  axis:Object.freeze([54,36,164]),
  // A little more air between neighbouring tabs makes the field readable
  // without turning it into a distant, disconnected constellation.
  funnel:Object.freeze({nearDepth:5,farDepth:36,nearRadius:4.35,farRadius:18.1,clusterRadius:5.85}),
  overview:Object.freeze({farDistance:160,fullDistance:64}),
  // A focus is a journey, not a permanent pile-up: surrounding objects first
  // recede, then leave the selected living surface clear at close approach.
  focus:Object.freeze({startDistance:24,endDistance:5.4,maxScale:2.6,minContextOpacity:.035,isolateAt:.78}),
  stages:Object.freeze([18,7,3.4]),
});

const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const mix=(a,b,t)=>a+(b-a)*t;
function normalize(vector){
  const length=Math.hypot(...vector);
  if(!Number.isFinite(length)||length<1e-8)throw Error('Reality Lens axis must be a finite non-zero vector');
  return vector.map(value=>value/length);
}
function stableHash(value){let hash=2166136261;for(const char of String(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return hash>>>0;}

export function resolveRealityLensGroup(featureId){
  if(FEATURE_GROUPS[featureId])return FEATURE_GROUPS[featureId];
  const id=String(featureId??'').toLowerCase();
  if(/person|social|wardrobe|companion/.test(id))return 'people';
  if(/agent|neural|muse|bot/.test(id))return 'agents';
  if(/asset|pay|contract|ledger|token|market|t402/.test(id))return 'value';
  if(/room|world|block|migration|city|runtime/.test(id))return 'worlds';
  if(/message|gateway|web|network|bridge/.test(id))return 'network';
  return 'experiences';
}

export function createRealityLensEngine(overrides={}){
  const profile={...DEFAULT_PROFILE,...overrides,
    origin:[...(overrides.origin??DEFAULT_PROFILE.origin)],
    axis:[...(overrides.axis??DEFAULT_PROFILE.axis)],
    funnel:{...DEFAULT_PROFILE.funnel,...overrides.funnel},
    overview:{...DEFAULT_PROFILE.overview,...overrides.overview},
    focus:{...DEFAULT_PROFILE.focus,...overrides.focus},
    stages:[...(overrides.stages??DEFAULT_PROFILE.stages)],
  };
  if(profile.origin.length!==3||profile.origin.some(value=>!Number.isFinite(value)))throw Error('Reality Lens origin must have three finite coordinates');
  if(profile.stages.length!==3||profile.stages.some(value=>!Number.isFinite(value))||!(profile.stages[0]>profile.stages[1]&&profile.stages[1]>profile.stages[2]&&profile.stages[2]>=0))throw Error('Reality Lens reveal stages must be three descending distance thresholds');
  const axis=normalize(profile.axis);
  const reference=Math.abs(axis[1])>.92?[1,0,0]:[0,1,0];
  const basisA=normalize([axis[1]*reference[2]-axis[2]*reference[1],axis[2]*reference[0]-axis[0]*reference[2],axis[0]*reference[1]-axis[1]*reference[0]]);
  const basisB=normalize([axis[1]*basisA[2]-axis[2]*basisA[1],axis[2]*basisA[0]-axis[0]*basisA[2],axis[0]*basisA[1]-axis[1]*basisA[0]]);
  const groupDepth=new Map(REALITY_LENS_GROUPS.map(group=>[group.id,group.depth]));

  function surfacePoint({depth,angle=0,radiusFraction=1}={}){
    const f=profile.funnel,axialDepth=clamp((depth-f.nearDepth)/Math.max(1e-6,f.farDepth-f.nearDepth))*(f.farDepth-f.nearDepth);
    const radius=mix(f.nearRadius,f.farRadius,axialDepth/Math.max(1e-6,f.farDepth-f.nearDepth))*clamp(radiusFraction);
    const center=profile.origin.map((value,axisIndex)=>value+axis[axisIndex]*(f.nearDepth+axialDepth));
    const position=center.map((value,axisIndex)=>value+radius*(basisA[axisIndex]*Math.cos(angle)+basisB[axisIndex]*Math.sin(angle)));
    return {position,radius,depth:f.nearDepth+axialDepth};
  }

  function placeInFunnel({id,index=0,count=1,groupId=resolveRealityLensGroup(id),depth=null,seed=0}={}){
    const f=profile.funnel,groupNumber=GROUP_INDEX.get(groupId)??REALITY_LENS_GROUPS.length-1;
    const axialDepth=clamp((depth??groupDepth.get(groupId)??f.farDepth)-f.nearDepth,0,f.farDepth-f.nearDepth);
    const t=axialDepth/Math.max(1e-6,f.farDepth-f.nearDepth);
    const radius=mix(f.nearRadius,f.farRadius,t);
    const countSafe=Math.max(1,Math.floor(count));
    const localIndex=((Math.floor(index)%countSafe)+countSafe)%countSafe;
    const hash=stableHash(`${groupId}:${id}:${seed}`)/4294967296;
    const golden=2.399963229728653;
    const clusterAngle=groupNumber*Math.PI*2/REALITY_LENS_GROUPS.length-Math.PI/2;
    const angle=clusterAngle+(localIndex-(countSafe-1)/2)*golden+hash*.12;
    const ring=Math.sqrt((localIndex+.5)/countSafe)*Math.min(f.clusterRadius,radius*.42);
    const radialA=Math.cos(angle)*ring+Math.cos(clusterAngle)*radius*.55;
    const radialB=Math.sin(angle)*ring+Math.sin(clusterAngle)*radius*.55;
    const center=profile.origin.map((value,axisIndex)=>value+axis[axisIndex]*(f.nearDepth+axialDepth));
    const position=center.map((value,axisIndex)=>value+basisA[axisIndex]*radialA+basisB[axisIndex]*radialB);
    return {position,groupId,depth:f.nearDepth+axialDepth,radius};
  }

  function overviewProgress(cameraDistance){
    const {farDistance,fullDistance}=profile.overview;
    if(!Number.isFinite(cameraDistance)||farDistance<=fullDistance)throw Error('Invalid Reality Lens overview distances');
    const linear=clamp((farDistance-cameraDistance)/(farDistance-fullDistance));
    return linear*linear*(3-2*linear);
  }

  function stageAt(distance){
    if(!Number.isFinite(distance))return {stage:0,progress:0};
    const [first,second,third]=profile.stages;
    if(distance>first)return {stage:0,progress:clamp((first*1.8-distance)/(first*.8))};
    if(distance>second)return {stage:1,progress:clamp((first-distance)/(first-second))};
    if(distance>third)return {stage:2,progress:clamp((second-distance)/(second-third))};
    return {stage:3,progress:1};
  }

  function objectResponse({id,selectedId=null,distance=Infinity,baseScale=1,size=1,tabReveal=1}={}){
    const isSelected=id===selectedId;
    const {startDistance,endDistance,maxScale,minContextOpacity,isolateAt}=profile.focus;
    const focusStrength=selectedId===null?0:clamp((startDistance-distance)/(startDistance-endDistance));
    const contextOpacity=isSelected?1:minContextOpacity+(1-minContextOpacity)*(1-focusStrength)**2;
    const approachScale=isSelected?mix(1,maxScale,focusStrength):1;
    const isolationReached=selectedId!==null&&focusStrength>=isolateAt;
    const contextHidden=!isSelected&&isolationReached;
    return {isSelected,focusStrength,contextOpacity,isolationReached,contextHidden,scale:baseScale*size*approachScale*clamp(tabReveal),...stageAt(distance)};
  }

  return Object.freeze({profile:Object.freeze(profile),placeInFunnel,surfacePoint,overviewProgress,stageAt,objectResponse,groupFor:resolveRealityLensGroup});
}

export const realityLensEngine=createRealityLensEngine();
