import {approveAvatarGenome, createAvatarEmbodiment, restoreAvatarEmbodiment} from './avatar-embodiment.js';

export const PERSON_STUDIO_STORAGE_KEY = 'matumbo.person-studio.v1';
export const STUDIO_MODEL = Object.freeze({
  id:'matumbo:reference-person:1', version:1, rig:'matumbo-humanoid:1',
  height:2.45, skin:'#794b36', hair:'#171311', face:'sculpted-reference-study',
  geometrySource:'procedural-reference-built', likenessVerified:false,
});
export const STUDIO_OUTFITS = Object.freeze([
  Object.freeze({id:'obsidian',name:'Obsidian',subtitle:'Signature · black & gold',color:'#111620',trim:'#d9ae60'}),
  Object.freeze({id:'cobalt',name:'Cobalt',subtitle:'Technical · deep blue',color:'#153b78',trim:'#90c9fa'}),
  Object.freeze({id:'ivory',name:'Ivory',subtitle:'Tailored · warm white',color:'#d6cdc0',trim:'#b28c4b'}),
  Object.freeze({id:'oxblood',name:'Oxblood',subtitle:'Evening · red & graphite',color:'#5d1b29',trim:'#dba270'}),
]);
export const STUDIO_ROOMS = Object.freeze([
  Object.freeze({id:'city',name:'City atelier',caption:'Architecture / gold / midnight',light:'#ddb878',sky:'#081d3a'}),
  Object.freeze({id:'ocean',name:'Ocean observatory',caption:'Blue horizon / silver / calm',light:'#83dbe3',sky:'#073645'}),
  Object.freeze({id:'night',name:'Night sanctuary',caption:'Violet / starlight / quiet',light:'#b6a1ed',sky:'#221537'}),
]);
export const STUDIO_COMPANIONS = Object.freeze(['drone','bird','spark']);
const copy=v=>JSON.parse(JSON.stringify(v));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const choice=(list,id)=>list.find(v=>v.id===id)??null;

/** One owner for saved preferences and approved avatar; renderer never edits its identity. */
export function createPersonStudioOwner({storage=null,cryptoRoot=globalThis.crypto,clock=()=>Date.now(),modelFingerprint=null}={}) {
  let avatar=null,displayName='',outfitId='obsidian',roomId='city',companion='drone';
  let companionId=cryptoRoot.randomUUID(),dirty=false,loading=true,error=null,sequence=0;
  const subscribers=new Set();
  let assetSha256=null,approving=false;
  const notify=()=>{const s=getSnapshot();subscribers.forEach(fn=>fn(s));return s;};
  const getSnapshot=()=>freeze({source:'person-studio',model:STUDIO_MODEL,displayName,outfitId,roomId,companion,companionId,
    approved:Boolean(avatar),dirty,loading,error,avatar:avatar?.getSnapshot()??null,localOnly:true,shared:false,biometric:false,aiConnected:false});
  async function restore() {
    try {
      assetSha256=await modelFingerprint;
      if(assetSha256===null){
        const bytes=await cryptoRoot.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(STUDIO_MODEL)));
        assetSha256=[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
      }
      if(typeof assetSha256!=='string'||!/^[a-f0-9]{64}$/.test(assetSha256))throw Error('Model fingerprint is unavailable');
      const raw=storage?.getItem(PERSON_STUDIO_STORAGE_KEY);
      if(raw){
        if(raw.length>300000)throw Error('Saved profile exceeds its size limit');
        const saved=JSON.parse(raw);
        if(saved.schemaVersion!==1||!choice(STUDIO_OUTFITS,saved.outfitId)||!choice(STUDIO_ROOMS,saved.roomId)||!STUDIO_COMPANIONS.includes(saved.companion)||typeof saved.displayName!=='string'||saved.displayName.length>60)throw Error('Saved profile is invalid');
        const restored=await restoreAvatarEmbodiment(saved.avatar,{clock});
        if(restored.getSnapshot().identity.assetId!==STUDIO_MODEL.id||restored.appearance.getSnapshot().outfitAssetIds[0]!==`studio-outfit:${saved.outfitId}`)throw Error('Saved appearance does not match this model');
        if(restored.getSnapshot().identity.assetSha256!==assetSha256)throw Error('Model geometry has changed since approval; review and approve the new model');
        if(typeof saved.companionId!=='string'||saved.companionId.length>80)throw Error('Saved companion is invalid');
        avatar=restored;displayName=saved.displayName;outfitId=saved.outfitId;roomId=saved.roomId;companion=saved.companion;companionId=saved.companionId;
      }
    }catch(e){error=`Saved profile was not loaded: ${e.message}. Existing saved data has not been overwritten.`;}
    loading=false;return notify();
  }
  const ready=restore();
  async function approve(name,confirmed=false){
    if(loading)await ready;
    if(!confirmed)throw Error('Confirm approval of this avatar before saving identity');
    if(avatar)throw Error('Identity is already approved; use wardrobe controls to change appearance');
    if(approving)throw Error('Avatar approval is already in progress');
    if(!assetSha256)throw Error('Model fingerprint is unavailable; reload before approval');
    if(typeof name!=='string'||!name.trim()||name.trim().length>60)throw Error('Enter a display name of 1–60 characters');
    approving=true;
    try{
    const genome=await approveAvatarGenome({personId:`person:${cryptoRoot.randomUUID()}`,avatarId:`avatar:${cryptoRoot.randomUUID()}`,assetId:STUDIO_MODEL.id,assetSha256,rigId:STUDIO_MODEL.rig,approvedByUser:true,approvedAt:clock()},cryptoRoot);
    avatar=createAvatarEmbodiment(genome,{clock});
    avatar.appearance.transact({actor:'user',confirmed:true,outfitAssetIds:[`studio-outfit:${outfitId}`]});
    avatar.setProjection({projectionId:'profile-room',worldId:`studio:${roomId}`,position:[0,0.55,0]});
    displayName=name.trim();dirty=true;error=null;return notify();
    }finally{approving=false;}
  }
  function chooseOutfit(id){
    if(!choice(STUDIO_OUTFITS,id))throw Error('Unknown outfit');
    if(id===outfitId)return getSnapshot();
    avatar?.appearance.transact({actor:'user',confirmed:true,outfitAssetIds:[`studio-outfit:${id}`]});
    outfitId=id;dirty=true;return notify();
  }
  function chooseRoom(id){
    if(!choice(STUDIO_ROOMS,id))throw Error('Unknown room');
    roomId=id;avatar?.setProjection({projectionId:'profile-room',worldId:`studio:${id}`,position:[0,0.55,0]});dirty=true;return notify();
  }
  function chooseCompanion(id){if(!STUDIO_COMPANIONS.includes(id))throw Error('Unknown companion form');companion=id;dirty=true;return notify();}
  function save(){
    if(!avatar)throw Error('Approve the avatar first');
    if(!storage)throw Error('Local storage is unavailable; use Export profile instead');
    const serialized=exportProfile();
    try{storage.setItem(PERSON_STUDIO_STORAGE_KEY,serialized);}catch{throw Error('Save failed: local storage is unavailable or full. Export your profile instead.');}
    dirty=false;error=null;return notify();
  }
  function exportProfile(){
    if(!avatar)throw Error('Approve the avatar first');
    return JSON.stringify({schemaVersion:1,displayName,outfitId,roomId,companion,companionId,avatar:avatar.exportPersistent()},null,2);
  }
  function moveRig(yaw,arm){
    if(!avatar)throw Error('Approve the avatar to test identity-locked motion');
    if(!Number.isFinite(yaw)||!Number.isFinite(arm)||Math.abs(yaw)>1||Math.abs(arm)>1.5)throw Error('Motion is out of bounds');
    return avatar.motion.pushPose({source:'controller',sequence:sequence++,timestamp:clock(),confidence:1,joints:{head:[0,Math.sin(yaw/2),0,Math.cos(yaw/2)],leftArm:[0,0,Math.sin(-arm/2),Math.cos(arm/2)]}});
  }
  function projectInto(worldId){
    if(typeof worldId!=='string'||!/^[a-z-]{1,60}$/.test(worldId))throw Error('Invalid world route');
    avatar?.setProjection({projectionId:'active-world',worldId,position:[0,0,0]});
    return avatar?.getSnapshot().identity.avatarId??null;
  }
  return Object.freeze({ready,getSnapshot,approve,chooseOutfit,chooseRoom,chooseCompanion,save,exportProfile,moveRig,projectInto,
    getPose:()=>avatar?.motion.samplePose()??{tracking:'idle',joints:{}},
    contribution:()=>avatar?.contribution()??null,
    subscribe(fn){subscribers.add(fn);return ()=>subscribers.delete(fn);}});
}
