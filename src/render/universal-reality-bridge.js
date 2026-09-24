import * as THREE from '../../vendor/three-r179.1/build/three.module.js';
import { createUniversalObjectRenderer } from '../universal/universal-object-renderer.js';
import {
  featureToCompanionEntities,
  featureToPrimaryEntity,
  normalizeUniversalEntity,
} from '../universal/universal-entity.js';

const BRIDGE_SOURCE='matumbo-universal-reality-bridge';
const ROUTE_FEATURE='reality-lens';
const SPECIAL_PRESERVE=new Set(['block-world']);
const MAX_VISIBLE_ENTITIES=3;
const ROOT_SCALE_BY_SHAPE=Object.freeze({
  phone:.48,
  square:.56,
  rectangle:.54,
  sphere:.62,
  cylinder:.58,
  cube:.56,
  wave:.54,
});

const KIND_HINTS=Object.freeze([
  ['slip',['slip','receipt']],
  ['contract',['contract','agreement','covenant']],
  ['contractor',['contract-party','contractor','participant','party']],
  ['person',['person','profile','avatar','identity']],
  ['pool',['pool','liquidity']],
  ['position',['position','stake']],
  ['proof',['proof','evidence','receipt','relic']],
  ['ledger',['ledger','journal']],
  ['room',['room','space']],
  ['message',['message','statement']],
  ['bot',['agent','bot','neural','assistant']],
  ['treasury',['treasury','vault']],
  ['market',['market','quote']],
  ['event',['event','match','game','sport']],
  ['token',['token','asset']],
  ['gateway',['gateway','route','projection']],
  ['media',['media','youtube','video','picture']],
]);

const FEATURE_REAL_FEEDS=Object.freeze({
  'reality-lens':['__TUMBO_REALITY_ASSEMBLY__'],
  person:['__TUMBO_PERSON_STUDIO__'],
  rooms:['__TUMBO_ROOM_SPACES__'],
  'block-world':['__TUMBO_BLOCK_WORLD__'],
  'runtime-sync':['__TUMBO_BLOCK_WORLD_RUNTIME_SYNC__'],
  migration:['__TUMBO_BLOCK_MIGRATION__'],
  'asset-token':['__TUMBO_ASSET_TOKEN_LAUNCH__','__TUMBO_TOKEN_BLOCK__'],
  'asset-market':['__TUMBO_ASSET_MARKET__'],
  'launch-distribution':['__TUMBO_DISTRIBUTION_EXPLORER__','__TUMBO_LAUNCH_CONSOLE__'],
  'social-explorer':['__TUMBO_SOCIAL_EXPLORER__'],
  'social-mirror':['__TUMBO_SOCIAL_MIRROR__'],
  youtube:['__TUMBO_YOUTUBE_SURFACE__'],
  paycore:['__TUMBO_PAYCORE__'],
  contracts:['__TUMBO_CONTRACTS_MARKETS__','__TUMBO_CONTRACT_LEDGER__'],
  'contract-atelier':['__TUMBO_CONTRACT_ATELIER__','__TUMBO_CONTRACT_AUTOMATION__','__TUMBO_CONTRACT_LEDGER__'],
  ledger:['__TUMBO_LEDGER_PROOF__','__TUMBO_CONTRACT_LEDGER__'],
  t402:['__TUMBO_T402__'],
  agent:['__TUMBO_MUSE_AGENT__','__TUMBO_LUNA__','__TUMBO_BOT_PLAZA__.console'],
  'neural-mesh':['__TUMBO_NEURAL_MESH__'],
  'muse-agent':['__TUMBO_MUSE_AGENT__'],
  'bot-plaza':['__TUMBO_BOT_PLAZA__.console','__TUMBO_BOT_PLAZA__.runtime'],
  'luna-companion':['__TUMBO_LUNA__'],
  'picture-matter':['__TUMBO_PICTURE_MATTER__'],
  'nft-atelier':['__TUMBO_NFT_ATELIER__'],
  'wardrobe-atelier':['__TUMBO_WARDROBE__'],
  'white-paper':['__TUMBO_WHITE_PAPER__'],
  'gesture-lens':['__TUMBO_GESTURE_LENS__','__TUMBO_GESTURE_INPUT__'],
  gateway:['__TUMBO_LIVE_GATEWAY__','__TUMBO_GATEWAY_TENTACLES__'],
  'world-events':['__TUMBO_WORLD_EVENTS__','__TUMBO_WORLD_EVIDENCE__'],
  'sports-events':['__TUMBO_SPORTS_EVENTS__'],
  'multi-sport-events':['__TUMBO_MULTI_SPORT_EVENTS__'],
  arena:['__TUMBO_ARENA_GAMES__'],
  chess:['__TUMBO_CHESS_ARENA__'],
  'web-ai':['__TUMBO_WEB_AI__'],
  academy:['__TUMBO_ACADEMY__'],
  projections:['__TUMBO_DEVICE_PROJECTION__','__TUMBO_PROJECTION_SESSION__'],
  'shared-session':['__TUMBO_PROJECTION_SESSION__'],
  'provider-adapters':['__TUMBO_PROTOCOL_EVIDENCE__','__TUMBO_LIVE_STATUS_BATCH__'],
  'xr-host':['__TUMBO_HAND_LENS__','__TUMBO_DEVICE_PROJECTION__'],
});
export { FEATURE_REAL_FEEDS };

const FEATURE_PROJECTION_HINTS=Object.freeze({
  'contract-atelier':['contract','party','receipt','evidence','rule'],
  contracts:['contract','pool','position','market'],
  ledger:['ledger','proof','receipt','journal'],
  rooms:['room','message','person'],
  person:['person','profile','avatar','wardrobe'],
  agent:['agent','bot','proof'],
  'bot-plaza':['agent','bot','proof'],
  'neural-mesh':['neural','agent','bot'],
  'world-events':['event','evidence'],
  'sports-events':['sport','event','match'],
  'multi-sport-events':['sport','event','match'],
  'asset-market':['market','position','quote','asset'],
  'asset-token':['token','asset','allocation'],
  paycore:['ledger','journal','balance','receipt'],
  t402:['route','gateway','receipt'],
  'picture-matter':['picture','media','artifact'],
  youtube:['youtube','media','video'],
  gateway:['gateway','route','event'],
});

function clean(value,fallback=''){
  const text=value==null?'':String(value).trim();
  return text||fallback;
}

function array(value){
  return Array.isArray(value)?value:[];
}

function count(value){
  return Array.isArray(value)?value.length:0;
}

function scalar(value){
  if(value==null)return '';
  if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return value;
  return '';
}

function resolveScopePath(scope,path){
  return String(path).split('.').reduce((value,key)=>value?.[key],scope);
}

function callSnapshot(source){
  if(!source)return null;
  const candidates=[
    ()=>source?.getSnapshot?.(),
    ()=>source?.snapshot?.(),
    ()=>source?.getState?.(),
    ()=>source?.list?.(),
  ];
  for(const read of candidates){
    try{
      const value=read();
      if(value!==undefined&&value!==null)return value;
    }catch{}
  }
  if(source?.console&&source.console!==source)return callSnapshot(source.console);
  if(source?.runtime&&source.runtime!==source)return callSnapshot(source.runtime);
  return typeof source==='object'?source:null;
}

export function resolveRealFeatureFeed(featureId,scope=globalThis){
  const paths=FEATURE_REAL_FEEDS[featureId]??[];
  for(const path of paths){
    const source=resolveScopePath(scope,path);
    if(!source)continue;
    const snapshot=callSnapshot(source);
    if(snapshot!==null&&snapshot!==undefined){
      return Object.freeze({available:true,sourceName:path,snapshot});
    }
  }
  return Object.freeze({available:false,sourceName:null,snapshot:null});
}

function snapshotMetrics(snapshot){
  const metrics={};
  const accept=(key,value)=>{
    if(Object.keys(metrics).length>=3||metrics[key]!==undefined)return;
    if(typeof value==='number'&&Number.isFinite(value))metrics[key]=value;
    else if(typeof value==='string'||typeof value==='boolean')metrics[key]=value;
    else if(Array.isArray(value))metrics[key]=value.length;
  };
  if(Array.isArray(snapshot)){accept('records',snapshot);return metrics;}
  if(!snapshot||typeof snapshot!=='object')return metrics;
  for(const [key,value] of Object.entries(snapshot)){
    if(['source','boundary','summary','selectedRecord','selected','current'].includes(key))continue;
    accept(key,value);
    if(Object.keys(metrics).length>=3)break;
  }
  if(Object.keys(metrics).length<3&&snapshot.summary&&typeof snapshot.summary==='object'){
    for(const [key,value] of Object.entries(snapshot.summary)){
      accept(key,value);
      if(Object.keys(metrics).length>=3)break;
    }
  }
  return metrics;
}

function snapshotSummary(snapshot,fallback){
  if(typeof snapshot==='string')return clean(snapshot,fallback);
  if(!snapshot||typeof snapshot!=='object')return fallback;
  const direct=[
    snapshot.summary,
    snapshot.description,
    snapshot.message,
    snapshot.boundary,
    snapshot.status,
    snapshot.state,
    snapshot.action,
  ].find(value=>typeof value==='string'&&value.trim());
  if(direct)return clean(direct,fallback);
  const selected=snapshot.selectedRecord??snapshot.selected??snapshot.current;
  if(selected&&typeof selected==='object'){
    return clean(selected.summary??selected.description??selected.label??selected.title??selected.id,fallback);
  }
  if(snapshot.summary&&typeof snapshot.summary==='object'){
    return clean(snapshot.summary.summary??snapshot.summary.description??snapshot.summary.boundary??snapshot.summary.status,fallback);
  }
  return fallback;
}

function collectSnapshotRecords(snapshot,limit=6){
  const out=[],seen=new Set();
  const add=value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))return;
    const identity=clean(value.id??value.key??value.label??value.title??JSON.stringify(Object.keys(value).slice(0,6)));
    if(seen.has(identity))return;
    seen.add(identity);out.push(value);
  };
  const visit=value=>{
    if(out.length>=limit||!value||typeof value!=='object')return;
    if(Array.isArray(value)){
      for(const item of value){add(item);if(out.length>=limit)break;}
      return;
    }
    const preferred=['selectedRecord','selected','current','records','items','contracts','pools','positions','messages','rooms','events','ledger','proof','allocations','profiles','modes','entries','statements','results','evidence','receipts'];
    for(const key of preferred){
      const child=value[key];
      if(Array.isArray(child))visit(child);
      else add(child);
      if(out.length>=limit)break;
    }
    if(out.length<limit&&value.summary&&typeof value.summary==='object')visit(value.summary);
  };
  visit(snapshot);
  return out.slice(0,limit);
}

function liveRecordEntity(record,featureId,index,sourceName,fallbackKind='generic'){
  const inferred=inferProjectionEntityKind(record);
  const kind=inferred==='generic'?fallbackKind:inferred;
  const title=clean(record?.title??record?.label??record?.name??record?.id,`${kind} ${index+1}`);
  return normalizeUniversalEntity({
    id:`${featureId}:live:${clean(record?.id??record?.key,index)}`,
    kind,
    title,
    summary:snapshotSummary(record,`Live ${kind} state from ${sourceName}.`),
    status:clean(record?.status??record?.state,'live'),
    metrics:snapshotMetrics(record),
    relations:array(record?.relations).map(value=>typeof value==='string'?value:value?.id).filter(Boolean),
    provenance:[BRIDGE_SOURCE,'real-data',sourceName],
    source:{feed:sourceName,recordId:clean(record?.id??record?.key,index)},
  });
}

function realFeedEntities(feature,featureId,feed,selected){
  if(!feed?.available)return [];
  const normalizedFeature={
    ...feature,id:featureId,
    title:feature?.title??feature?.label??featureId,
    label:feature?.label??feature?.title??featureId,
    summary:feature?.summary??feature?.description??'Living Reality object',
    description:feature?.description??feature?.summary??'',
    accent:feature?.accent??null,
  };
  const primary=featureToPrimaryEntity(normalizedFeature,`live:${featureId}`);
  const base=normalizeUniversalEntity({
    ...primary,
    id:`${featureId}:live`,
    title:normalizedFeature.title,
    summary:snapshotSummary(feed.snapshot,normalizedFeature.summary),
    status:clean(feed.snapshot?.status??feed.snapshot?.state??feed.snapshot?.action,'live'),
    metrics:snapshotMetrics(feed.snapshot),
    provenance:[BRIDGE_SOURCE,'real-data',feed.sourceName],
    source:{feed:feed.sourceName,live:true},
  });
  if(!selected)return Object.freeze([base]);
  const records=collectSnapshotRecords(feed.snapshot,4)
    .slice(0,MAX_VISIBLE_ENTITIES-1)
    .map((record,index)=>liveRecordEntity(record,featureId,index,feed.sourceName,base.kind));
  return Object.freeze([base,...records]);
}

function recordText(record){
  return [
    record?.id,
    record?.kind,
    record?.type,
    record?.source,
    record?.label,
    record?.title,
    record?.featureId,
    record?.group,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function inferProjectionEntityKind(record={}){
  const text=recordText(record);
  for(const [kind,hints] of KIND_HINTS){
    if(hints.some(hint=>text.includes(hint)))return kind;
  }
  return 'generic';
}

function projectionEntities(projection){
  if(Array.isArray(projection?.entities))return projection.entities;
  if(projection?.entities&&typeof projection.entities==='object'){
    return Object.entries(projection.entities).map(([id,value])=>({id,...value}));
  }
  return [];
}

export function projectionEntitiesForFeature(featureId,projection){
  const hints=FEATURE_PROJECTION_HINTS[featureId]??[featureId];
  const normalized=hints.map(value=>String(value).toLowerCase());
  return projectionEntities(projection).filter(record=>{
    const text=recordText(record);
    return normalized.some(hint=>text.includes(hint));
  });
}

function projectionRecordEntity(record,featureId,index=0){
  const kind=inferProjectionEntityKind(record);
  const title=clean(record?.title??record?.label??record?.name??record?.id,`${kind} ${index+1}`);
  const summary=clean(
    record?.summary??record?.description??record?.boundary??record?.status,
    `Projected ${kind} record from the shared Living Reality.`,
  );
  const metrics={};
  for(const [key,value] of Object.entries(record??{})){
    if(Object.keys(metrics).length>=3)break;
    if(['id','title','label','name','summary','description','kind','type','source','featureId'].includes(key))continue;
    const simple=scalar(value);
    if(simple!=='')metrics[key]=simple;
  }
  return normalizeUniversalEntity({
    id:`${featureId}:projection:${clean(record?.id,index)}`,
    kind,
    title,
    summary,
    status:clean(record?.status,'observed'),
    metrics,
    relations:array(record?.relations).map(value=>typeof value==='string'?value:value?.id).filter(Boolean),
    provenance:[BRIDGE_SOURCE,clean(record?.source,'simfabric-projection')],
    source:record,
  });
}

function readLedgerContracts(scope=globalThis){
  const ledger=scope?.__TUMBO_CONTRACT_LEDGER__;
  try{
    const listed=ledger?.list?.();
    if(Array.isArray(listed))return listed;
  }catch{}
  try{
    const snapshot=ledger?.snapshot?.()??ledger?.getSnapshot?.();
    if(Array.isArray(snapshot?.contracts))return snapshot.contracts;
  }catch{}
  return [];
}

function selectedContractId(scope=globalThis){
  try{
    return scope?.__TUMBO_CONTRACT_ATELIER__?.getSnapshot?.()?.selectedId
      ?? scope?.__TUMBO_CONTRACT_FLOW__?.getSnapshot?.()?.selectedId
      ?? null;
  }catch{return null;}
}

export function contractEntitiesFromRecords(contracts=[],selectedId=null){
  const list=array(contracts);
  const contract=(selectedId&&list.find(item=>String(item?.id)===String(selectedId)))??list.at(-1);
  if(!contract)return [];
  const rules=array(contract?.terms?.rules);
  const parties=array(contract?.parties).map(party=>typeof party==='string'?party:party?.id??party?.name).filter(Boolean);
  const approvals=array(contract?.approvals);
  const evidence=array(contract?.evidence);
  const receipts=array(contract?.receipts);
  const latestReceipt=receipts.at(-1)??null;
  const title=clean(contract?.title??contract?.label??contract?.id,'Living Contract');

  const contractEntity=normalizeUniversalEntity({
    id:`contract:${contract.id}`,
    kind:'contract',
    title,
    summary:`${rules.length} conditions · ${approvals.length}/${Math.max(1,parties.length)} approvals · ${receipts.length} receipts`,
    status:clean(contract?.status,'draft'),
    metrics:{
      conditions:rules.length,
      approvals:`${approvals.length}/${parties.length}`,
      evidence:evidence.length,
    },
    relations:[
      ...parties.map(party=>`party:${party}`),
      ...receipts.slice(-3).map(receipt=>`receipt:${receipt?.id??'local'}`),
    ],
    actions:['inspect','expand','trace'],
    provenance:[BRIDGE_SOURCE,'contract-ledger',String(contract.id)],
    content:rules.slice(0,4).map((rule,index)=>({
      id:`rule-${rule?.id??index}`,
      label:rule?.label??`Condition ${index+1}`,
      value:clean(rule?.state??rule?.when?.op??'condition'),
      priority:.78-index*.05,
      kind:'condition',
      action:'inspect',
    })),
    source:{feed:'contract-ledger',contractId:String(contract.id)},
  });

  const slipEntity=normalizeUniversalEntity({
    id:`contract:${contract.id}:slip`,
    kind:'slip',
    title:'Covenant Slip',
    summary:latestReceipt
      ? 'Latest receipt, evidence ancestry and effects carried by this contract.'
      : 'Contract state slip awaiting its first local receipt.',
    status:latestReceipt?'attached':'pending',
    metrics:{
      receipts:receipts.length,
      evidence:latestReceipt?.evidenceIds?.length??evidence.length,
      effects:latestReceipt?.effects?.length??0,
    },
    relations:[contractEntity.id,...parties.slice(0,2).map(party=>`party:${party}`)],
    actions:['inspect','trace'],
    provenance:[BRIDGE_SOURCE,'contract-ledger','covenant-slip'],
    content:latestReceipt?.id?[{
      id:'receipt-id',
      label:'RECEIPT',
      value:String(latestReceipt.id),
      priority:.84,
      kind:'proof',
      action:'inspect',
    }]:[],
    source:{feed:'contract-ledger',contractId:String(contract.id),receiptId:latestReceipt?.id??null},
  });

  const contractorEntity=normalizeUniversalEntity({
    id:`contract:${contract.id}:contractor`,
    kind:'contractor',
    title:parties.length?parties.join(' · '):'Contract Participants',
    summary:'Parties, approval state and obligations connected to the same living contract.',
    status:approvals.length>=parties.length&&parties.length?'approved':'active',
    metrics:{
      parties:parties.length,
      approved:approvals.length,
      obligations:rules.length,
    },
    relations:[contractEntity.id,slipEntity.id],
    actions:['inspect','trace'],
    provenance:[BRIDGE_SOURCE,'contract-ledger','participants'],
    source:{feed:'contract-ledger',contractId:String(contract.id),partyCount:parties.length},
  });

  return Object.freeze([contractEntity,slipEntity,contractorEntity]);
}

function realContractEntities(scope){
  return contractEntitiesFromRecords(readLedgerContracts(scope),selectedContractId(scope));
}

export function entitiesForFeature({
  feature,
  featureId=feature?.id,
  projection=null,
  selected=false,
  scope=globalThis,
}={}){
  if(!featureId)return [];
  if(featureId==='contract-atelier'||featureId==='contracts'){
    const real=realContractEntities(scope);
    if(real.length)return real;
  }

  const feed=resolveRealFeatureFeed(featureId,scope);
  const live=realFeedEntities(feature,featureId,feed,selected);
  if(live.length)return live;

  const projected=projectionEntitiesForFeature(featureId,projection)
    .slice(0,selected?MAX_VISIBLE_ENTITIES:1)
    .map((record,index)=>projectionRecordEntity(record,featureId,index));
  if(projected.length)return Object.freeze(projected);

  const normalizedFeature={
    ...feature,
    id:featureId,
    title:feature?.title??feature?.label??featureId,
    label:feature?.label??feature?.title??featureId,
    summary:feature?.summary??feature?.description??'Living Reality object',
    description:feature?.description??feature?.summary??'',
    accent:feature?.accent??null,
  };
  return selected
    ? featureToCompanionEntities(normalizedFeature,`assembly:${featureId}`).slice(0,MAX_VISIBLE_ENTITIES)
    : Object.freeze([featureToPrimaryEntity(normalizedFeature,`assembly:${featureId}`)]);
}

function preserveFeature(featureId){
  return SPECIAL_PRESERVE.has(featureId);
}

function softenLegacySurface(root,featureId,restore){
  if(!root||preserveFeature(featureId))return;
  root.traverse(child=>{
    if(!child?.material)return;
    const named=String(child.name??'');
    const isLegacy=named.startsWith(`${featureId}/spatial-tab/`);
    if(!isLegacy)return;
    const materials=Array.isArray(child.material)?child.material:[child.material];
    for(const material of materials){
      if(!material||restore.has(material))continue;
      restore.set(material,{
        transparent:material.transparent,
        opacity:material.opacity,
        depthWrite:material.depthWrite,
      });
      material.transparent=true;
      material.opacity=Math.min(.12,Number.isFinite(material.opacity)?material.opacity:1);
      material.depthWrite=false;
      material.needsUpdate=true;
    }
  });
}

function restoreLegacyMaterials(restore){
  for(const [material,state] of restore){
    if(!material)continue;
    material.transparent=state.transparent;
    material.opacity=state.opacity;
    material.depthWrite=state.depthWrite;
    material.needsUpdate=true;
  }
  restore.clear();
}

function layoutRendered(record){
  const items=record.rendered;
  const primaryScale=ROOT_SCALE_BY_SHAPE[record.featureObject?.shape]??.54;
  const placements=[
    {position:[0,.03,.18],scale:primaryScale},
    {position:[-.58,-.50,.30],scale:primaryScale*.42},
    {position:[.58,-.50,.30],scale:primaryScale*.42},
  ];
  items.forEach((rendered,index)=>{
    const placement=placements[index]??placements[0];
    rendered.mesh.position.fromArray(placement.position);
    rendered.mesh.scale.setScalar(placement.scale);
    rendered.mesh.rotation.set(index?-.08:.02,(index-1)*.18,index?-.04:0);
    rendered.mesh.renderOrder=24+index;
  });
}

function sameIds(rendered,entities){
  return rendered.length===entities.length&&rendered.every((item,index)=>item.entity.id===entities[index]?.id);
}

function renderEntitySignature(entity){
  return JSON.stringify({
    id:entity?.id,
    kind:entity?.kind,
    title:entity?.title,
    summary:entity?.summary,
    status:entity?.status,
    geometryFamily:entity?.geometryFamily,
    priority:entity?.priority,
    metrics:entity?.metrics,
    relations:entity?.relations,
    actions:entity?.actions,
    content:entity?.content,
    interactionState:entity?.interactionState,
  });
}

function syncRecord(record,entities){
  if(!sameIds(record.rendered,entities)){
    for(const rendered of record.rendered){
      rendered.mesh.removeFromParent();
      record.renderer.remove(rendered.entity.id);
    }
    record.rendered=[];
    record.signatures.clear();
    for(const entity of entities){
      const rendered=record.renderer.create(entity);
      record.group.add(rendered.mesh);
      record.rendered.push(rendered);
      record.signatures.set(entity.id,renderEntitySignature(entity));
    }
  }else{
    entities.forEach(entity=>{
      const signature=renderEntitySignature(entity);
      if(record.signatures.get(entity.id)===signature)return;
      record.renderer.upsert(entity);
      record.signatures.set(entity.id,signature);
    });
  }
  layoutRendered(record);
}

function createRecord(featureObject,featureId,renderer){
  const group=new THREE.Group();
  group.name=`${featureId}/universal-organism`;
  group.userData={source:BRIDGE_SOURCE,featureId,universal:true};
  featureObject.root.add(group);
  return {
    featureId,
    featureObject,
    group,
    renderer,
    rendered:[],
    signatures:new Map(),
    restore:new Map(),
    feed:Object.freeze({available:false,sourceName:null,snapshot:null}),
  };
}

export function createUniversalRealityBridge({
  scope=globalThis,
  documentRoot=globalThis.document,
  renderer=createUniversalObjectRenderer({
    atlasSize:256,
    topologyOptions:{seamAngle:Math.PI/7,curvatureThreshold:.02},
    enableDisplacement:true,
  }),
  pollMs=900,
}={}){
  const records=new Map();
  let timer=0;
  let destroyed=false;
  let projection=scope?.SIMFABRIC?.getProjection?.()??scope?.__SIMFABRIC_PROJECTION__??null;
  let lastSelected=null;

  function assembly(){
    return scope?.__TUMBO_REALITY_ASSEMBLY__??null;
  }

  function removeRecord(featureId){
    const record=records.get(featureId);
    if(!record)return;
    restoreLegacyMaterials(record.restore);
    for(const rendered of record.rendered){
      rendered.mesh.removeFromParent();
      renderer.remove(rendered.entity.id);
    }
    record.signatures.clear();
    record.group.removeFromParent();
    records.delete(featureId);
  }

  function sync(){
    if(destroyed)return false;
    const owner=assembly();
    if(!owner?.getSnapshot||!owner?.getFeatureObject)return false;
    const snapshot=owner.getSnapshot();
    const selectedId=snapshot?.selectedId??snapshot?.objects?.find?.(item=>item?.selected)?.id??null;
    lastSelected=selectedId??lastSelected;
    const objects=array(snapshot?.objects);
    const liveIds=new Set();

    for(const object of objects){
      const featureId=clean(object?.id);
      if(!featureId||featureId==='reality-lens')continue;
      const featureObject=owner.getFeatureObject(featureId);
      if(!featureObject?.root||!featureObject?.feature)continue;
      liveIds.add(featureId);

      let record=records.get(featureId);
      if(!record){
        record=createRecord(featureObject,featureId,renderer);
        records.set(featureId,record);
      }else{
        record.featureObject=featureObject;
        if(record.group.parent!==featureObject.root)featureObject.root.add(record.group);
      }

      softenLegacySurface(featureObject.root,featureId,record.restore);
      if(preserveFeature(featureId)){
        record.group.visible=false;
        continue;
      }
      record.group.visible=true;
      record.feed=resolveRealFeatureFeed(featureId,scope);
      const entities=entitiesForFeature({
        feature:featureObject.feature,
        featureId,
        projection,
        selected:featureId===selectedId||featureId==='contract-atelier',
        scope,
      });
      syncRecord(record,entities);
    }

    for(const id of [...records.keys()])if(!liveIds.has(id))removeRecord(id);
    return true;
  }

  function setFeatureEntities(featureId,entities){
    const owner=assembly();
    const featureObject=owner?.getFeatureObject?.(featureId);
    if(!featureObject?.root||!Array.isArray(entities)||!entities.length)return false;
    let record=records.get(featureId);
    if(!record){
      record=createRecord(featureObject,featureId,renderer);
      records.set(featureId,record);
    }
    softenLegacySurface(featureObject.root,featureId,record.restore);
    record.group.visible=!preserveFeature(featureId);
    syncRecord(record,entities.map(normalizeUniversalEntity));
    return true;
  }

  function onProjection(event){
    projection=event?.detail?.projection??event?.detail??scope?.SIMFABRIC?.getProjection?.()??projection;
    sync();
  }

  scope?.addEventListener?.('simfabric:projection',onProjection);
  timer=scope?.setInterval?.(sync,pollMs)??0;
  sync();

  const api=Object.freeze({
    source:BRIDGE_SOURCE,
    sync,
    setFeatureEntities,
    getSnapshot(){
      return Object.freeze({
        source:BRIDGE_SOURCE,
        route:new URLSearchParams(scope?.location?.search??'').get('feature'),
        selectedId:lastSelected,
        featureCount:records.size,
        universalObjectCount:[...records.values()].reduce((sum,record)=>sum+record.rendered.length,0),
        preserved:Object.freeze([...records.keys()].filter(preserveFeature)),
        realFeedRegisteredCount:[...records.keys()].filter(id=>Boolean(FEATURE_REAL_FEEDS[id]?.length)).length,
        realFeedAvailableCount:[...records.values()].filter(record=>record.feed?.available).length,
        dataFeeds:Object.freeze(Object.fromEntries([...records].map(([id,record])=>[
          id,
          Object.freeze({
            registered:Boolean(FEATURE_REAL_FEEDS[id]?.length),
            available:Boolean(record.feed?.available),
            sourceName:record.feed?.sourceName??null,
          }),
        ]))),
        features:Object.freeze(Object.fromEntries([...records].map(([id,record])=>[
          id,
          Object.freeze({
            entityIds:Object.freeze(record.rendered.map(item=>item.entity.id)),
            kinds:Object.freeze(record.rendered.map(item=>item.entity.kind)),
            geometryFamilies:Object.freeze(record.rendered.map(item=>item.geometryFamily)),
          }),
        ]))),
      });
    },
    destroy(){
      if(destroyed)return;
      destroyed=true;
      if(timer)scope?.clearInterval?.(timer);
      scope?.removeEventListener?.('simfabric:projection',onProjection);
      for(const id of [...records.keys()])removeRecord(id);
      renderer.dispose();
      if(scope?.__TUMBO_UNIVERSAL_OBJECTS__===api)delete scope.__TUMBO_UNIVERSAL_OBJECTS__;
    },
  });
  scope.__TUMBO_UNIVERSAL_OBJECTS__=api;
  return api;
}

function autoBoot(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  const params=new URLSearchParams(window.location.search);
  if(params.get('feature')!==ROUTE_FEATURE)return;
  let attempts=0;
  const tryMount=()=>{
    if(window.__TUMBO_UNIVERSAL_OBJECTS__)return;
    if(window.__TUMBO_REALITY_ASSEMBLY__){
      createUniversalRealityBridge({scope:window,documentRoot:document});
      return;
    }
    if(++attempts<160)window.setTimeout(tryMount,125);
  };
  tryMount();
}

autoBoot();
