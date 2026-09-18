/** PERSON Ω: immutable approved identity, explicit appearance history, advisory pose. */
export const AVATAR_SCHEMA_VERSION = 1;
export const APPEARANCE_AUTHORITY = Object.freeze(['LOCKED','CONTEXTUAL','OPEN']);
export const RIG_JOINTS = Object.freeze(['root','spine','neck','head','leftArm','rightArm','leftHand','rightHand','leftLeg','rightLeg',
  ...['left','right'].flatMap(side=>['Thumb','Index','Middle','Ring','Little'].flatMap(finger=>[0,1,2].map(j=>side+finger+j)))]);
const clone=value=>JSON.parse(JSON.stringify(value));
const frozen=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;};
function string(value,name,max=160){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`Invalid ${name}`);return value.trim();}
function strictKeys(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error('Unexpected fields');}
function quaternion(value){if(!Array.isArray(value)||value.length!==4||!value.every(Number.isFinite))throw Error('Invalid joint quaternion');const n=Math.hypot(...value);if(n<0.0001)throw Error('Invalid joint quaternion');return value.map(v=>v/n);}
function time(value){if(!Number.isFinite(value)||value<0)throw Error('Invalid timestamp');return value;}

export async function approveAvatarGenome({personId,avatarId,assetId,assetSha256,rigId,approvedByUser,approvedAt=Date.now()},cryptoRoot=globalThis.crypto) {
  if(approvedByUser!==true)throw Error('Explicit avatar approval required');
  if(!/^[a-f0-9]{64}$/i.test(assetSha256??''))throw Error('Approved asset requires SHA-256');
  const identity={schemaVersion:AVATAR_SCHEMA_VERSION,personId:string(personId,'person ID'),avatarId:string(avatarId,'avatar ID'),assetId:string(assetId,'asset ID'),assetSha256:assetSha256.toLowerCase(),rigId:string(rigId,'rig ID'),approvedAt:time(approvedAt)};
  const bytes=await cryptoRoot.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(identity)));
  const identityHash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  // Hash identifies this approved record, not a biometric or proof of a person's legal identity.
  return frozen({...identity,identityHash});
}

function appearanceState(value){
  strictKeys(value,['version','authority','outfitAssetIds','approvedPresets']);
  if(!Number.isSafeInteger(value.version)||value.version<0||!APPEARANCE_AUTHORITY.includes(value.authority))throw Error('Invalid appearance state');
  const assets=v=>{if(!Array.isArray(v)||v.length>24)throw Error('Invalid wardrobe');return v.map(id=>string(id,'wearable asset'));};
  if(!Array.isArray(value.approvedPresets)||value.approvedPresets.length>32)throw Error('Invalid presets');
  return frozen({version:value.version,authority:value.authority,outfitAssetIds:assets(value.outfitAssetIds),approvedPresets:value.approvedPresets.map(p=>({id:string(p.id,'preset'),worldId:string(p.worldId,'world'),outfitAssetIds:assets(p.outfitAssetIds)}))});
}

export function createAvatarEmbodiment(genome,{clock=()=>Date.now(),persistentState=null}={}) {
  if(genome?.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(genome?.identityHash??''))throw Error('Approved genome required');
  const identity=frozen(clone(genome));
  let appearance=frozen({version:0,authority:'LOCKED',outfitAssetIds:[],approvedPresets:[]});
  let history=[],sequence=-1,lastTimestamp=-1,receivedAt=0;
  const sourceSequences=new Map();
  let reliable={};let confidence=0;
  const projections=new Map();
  function appearanceTransaction(command){
    strictKeys(command,['actor','outfitAssetIds','authority','approvedPresets','presetId','worldId','confirmed']);
    const actor=command.actor;
    if(actor!=='user'&&actor!=='world')throw Error('Only explicit user or approved world appearance requests are accepted');
    if(actor==='world') {
      if(appearance.authority==='LOCKED')throw Error('Appearance is locked');
      if(appearance.authority==='CONTEXTUAL')throw Error('User confirmation required through the user appearance action');
      const preset=appearance.approvedPresets.find(p=>p.id===command.presetId&&p.worldId===command.worldId);
      if(!preset)throw Error('World preset has not been approved');
      if(command.outfitAssetIds||command.authority||command.approvedPresets)throw Error('World cannot rewrite appearance permissions');
      command={...command,outfitAssetIds:preset.outfitAssetIds};
    } else if(command.confirmed!==true)throw Error('Explicit user confirmation required');
    if(actor==='user'&&command.presetId){
      const preset=appearance.approvedPresets.find(p=>p.id===command.presetId&&p.worldId===command.worldId);
      if(!preset)throw Error('Preset has not been approved');
      command={...command,outfitAssetIds:preset.outfitAssetIds};
    }
    const next=clone(appearance);
    if(command.authority!==undefined){if(!APPEARANCE_AUTHORITY.includes(command.authority))throw Error('Invalid appearance authority');next.authority=command.authority;}
    function assets(value){if(!Array.isArray(value)||value.length>24)throw Error('Invalid wardrobe');return value.map(id=>string(id,'wearable asset'));}
    if(command.outfitAssetIds!==undefined)next.outfitAssetIds=assets(command.outfitAssetIds);
    if(command.approvedPresets!==undefined){if(!Array.isArray(command.approvedPresets)||command.approvedPresets.length>32)throw Error('Invalid presets');next.approvedPresets=command.approvedPresets.map(p=>({id:string(p.id,'preset'),worldId:string(p.worldId,'world'),outfitAssetIds:assets(p.outfitAssetIds)}));}
    next.version++;history=[...history,{appearance,changedAt:clock(),actor}].slice(-100);appearance=frozen(next);return appearance;
  }
  function pushPose(packet){
    // This closure can write motion only. Extra fields (including identity/wardrobe) are rejected.
    strictKeys(packet,['source','sequence','timestamp','confidence','joints']);
    if(!['camera','vr','ar','controller','hand','mocap'].includes(packet.source))throw Error('Unsupported motion source');
    const previous=sourceSequences.get(packet.source);
    if(!Number.isSafeInteger(packet.sequence)||packet.sequence<0||packet.sequence<=(previous?.sequence??-1))throw Error('Out-of-order motion');
    time(packet.timestamp);if(packet.timestamp<(previous?.timestamp??-1))throw Error('Out-of-order timestamp');
    if(!Number.isFinite(packet.confidence)||packet.confidence<0||packet.confidence>1)throw Error('Invalid tracking confidence');
    strictKeys(packet.joints,RIG_JOINTS);
    const normalized=Object.fromEntries(Object.entries(packet.joints).map(([joint,value])=>[joint,quaternion(value)]));
    sourceSequences.set(packet.source,{sequence:packet.sequence,timestamp:packet.timestamp});
    sequence++;lastTimestamp=packet.timestamp;receivedAt=clock();confidence=packet.confidence;
    if(confidence>=0.5)for(const [joint,q] of Object.entries(normalized))reliable[joint]={q,receivedAt};
    return samplePose();
  }
  function samplePose(){
    const age=Math.max(0,clock()-receivedAt);
    const tracking=sequence<0?'idle':age>2000||confidence===0?'rest':age>250||confidence<0.5?'hold':'tracked';
    const joints={};
    for(const [name,record] of Object.entries(reliable)) {
      const q=record.q;
      const jointAge=Math.max(0,clock()-record.receivedAt);
      const blend=Math.min(1,Math.max(0,(jointAge-250)/1750));
      // Normalized shortest-path quaternion interpolation toward neutral.
      const sign=q[3]<0?-1:1;
      joints[name]=quaternion(q.map((v,i)=>v*sign*(1-blend)+(i===3?blend:0)));
    }
    return frozen({sequence,sourceTimestamp:lastTimestamp,confidence,tracking,joints});
  }
  function setProjection({projectionId,worldId,position=[0,0,0],rotation=[0,0,0,1]}) {
    if(!Array.isArray(position)||position.length!==3||!position.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6))throw Error('Invalid projection position');
    const record=frozen({projectionId:string(projectionId,'projection ID'),worldId:string(worldId,'world ID'),personId:identity.personId,avatarId:identity.avatarId,position:[...position],rotation:quaternion(rotation)});
    if(projections.size>=32&&!projections.has(record.projectionId))throw Error('Projection limit reached');
    projections.set(record.projectionId,record);return record;
  }
  const snapshot=()=>frozen({identity,appearance,history:clone(history),projections:[...projections.values()],motion:samplePose()});
  if(persistentState){
    appearance=appearanceState(persistentState.appearance);
    if(!Array.isArray(persistentState.history)||persistentState.history.length>100)throw Error('Invalid appearance history');
    history=persistentState.history.map(h=>({appearance:appearanceState(h.appearance),changedAt:time(h.changedAt),actor:['user','world'].includes(h.actor)?h.actor:(()=>{throw Error('Invalid history actor');})()}));
    if(!Array.isArray(persistentState.projections)||persistentState.projections.length>32)throw Error('Invalid projections');
    persistentState.projections.forEach(p=>setProjection(p));
  }
  return Object.freeze({
    motion:Object.freeze({pushPose,samplePose}),
    appearance:Object.freeze({transact:appearanceTransaction,getSnapshot:()=>appearance}),
    setProjection,getSnapshot:snapshot,
    exportPersistent:()=>JSON.stringify({schemaVersion:1,identity,appearance,history,projections:[...projections.values()]}),
    contribution:()=>frozen({schemaVersion:1,source:'person-embodiment',simulation:false,updatedAt:new Date(clock()).toISOString(),entities:[{id:identity.personId,type:'person',avatarId:identity.avatarId,identityHash:identity.identityHash,appearanceVersion:appearance.version}],evidence:[{kind:'user-approved-asset-reference',assetId:identity.assetId,sha256:identity.assetSha256}],capabilities:[{id:'person.pose',enabled:true,authority:'local-motion'},{id:'person.authentication',enabled:false,authority:'none'}]})
  });
}

export async function restoreAvatarEmbodiment(serialized,options={}) {
  if(typeof serialized!=='string'||serialized.length>250000)throw Error('Invalid avatar snapshot size');
  const saved=JSON.parse(serialized);strictKeys(saved,['schemaVersion','identity','appearance','history','projections']);
  if(saved.schemaVersion!==1)throw Error('Unsupported avatar snapshot');
  const identity=saved.identity;
  strictKeys(identity,['schemaVersion','personId','avatarId','assetId','assetSha256','rigId','approvedAt','identityHash']);
  const approved=await approveAvatarGenome({...identity,approvedByUser:true});
  if(approved.identityHash!==identity.identityHash)throw Error('Avatar identity integrity mismatch');
  return createAvatarEmbodiment(approved,{...options,persistentState:saved});
}
