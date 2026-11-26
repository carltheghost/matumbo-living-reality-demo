import {Renderer,embed} from '/render.js';
import {Camera} from '/camera.js';
import {GripHost} from '/services/vivo/web/authority/grip-host.mjs';
import {RemoteTransport, verifyMemoryBackupSet, MEMORY_BACKUP_SET_MAX_BYTES} from './remote-transport.mjs';
import {ApplicationInputs} from './interactions.mjs';
import {eventTime,screenTarget,viewBasis,projectAccepted,timestampedCameraClass} from './adapters.mjs';
import {installCameraConstraintFallback,normalizeCameraFacing} from './camera-compat.mjs';
import {installWorkshopOverlay} from '/application/vivo-ui-overlay.mjs';

const $=id=>document.getElementById(id),element=(tag,p={})=>Object.assign(document.createElement(tag),p);
installCameraConstraintFallback();
const vivoOverlayStyle=document.createElement('link');vivoOverlayStyle.rel='stylesheet';vivoOverlayStyle.href='/application/vivo-ui-overlay.css';document.head.append(vivoOverlayStyle);
const vivoOverlay=installWorkshopOverlay();
const renderer=new Renderer($('world'),$('overlay')),grids=new Map(),previews=new Map();
let transport=null,host=null,inputs=null,state=null,selected=null,hand=null,online=false,role=null;
const say=t=>{$('status').textContent=t;},safe=fn=>async(...a)=>{try{return await fn(...a);}catch(e){say(e.code||e.message||String(e));}};
const tokenFromUrl=()=>{const p=new URLSearchParams(location.hash.slice(1)),token=p.get('token')||'';if(token)history.replaceState(null,'',location.pathname+location.search);return token;};
const tokenInput=element('input',{id:'remoteToken',type:'password',autocomplete:'off',placeholder:'Owner or invitation token',value:tokenFromUrl()});
const tokenLabel=element('label',{textContent:'Private access token'});tokenLabel.append(tokenInput);
$('displayName').closest('label').replaceWith(tokenLabel);
$('spaceKind').closest('.row').hidden=true;$('metricInputLabel').hidden=true;$('keyLabel').hidden=true;$('joinRoom').hidden=true;
$('createRoom').textContent='Enter shared Vivo';$('inviteNote').textContent='The token stays in this browser session and WebSocket join message. Camera frames never leave this device.';
$('welcome').querySelector('a').hidden=true;
document.querySelector('[data-panel="neural"]').hidden=false;document.querySelector('[data-panel="neural"]').textContent='Neural Memory';
document.querySelector('[data-panel="people"]').textContent='♧ People';document.querySelector('[data-panel="record"]').textContent='↧ State';
$('moveTarget').options[0].textContent='Shared learned material object';
const moveSheet=document.querySelector('[data-sheet="move"]');
const objectLabel=element('label',{textContent:'Active object'}),objectSelect=element('select',{id:'remoteObject'});objectLabel.append(objectSelect);moveSheet.prepend(objectLabel);
objectSelect.onchange=()=>{selected=objectSelect.value;renderer.selected=selected;updateUI();};
moveSheet.querySelector('p').textContent='Drag the same object from two devices. Matching cooperative grips become separate accepted constraints; one canonical learned material state responds to both.';
moveSheet.querySelector('p.muted').textContent='Root is native 4D; the nested relic is native 11D. Time is separate. Dashed markers are targets, not the object itself.';
const enterButton=element('button',{id:'enterSpace',textContent:'Enter selected inner world'});
const exitButton=element('button',{id:'exitSpace',textContent:'Return through saved Eye frame'});moveSheet.append(enterButton,exitButton);
const eyeSheet=document.querySelector('[data-sheet="eye"]');eyeSheet.querySelector('p').textContent='Your Eye is persistent and independent. Another participant can remain in root while you enter the 11D inner world.';
const peopleSheet=document.querySelector('[data-sheet="people"]');$('inviteRole').closest('label').hidden=true;$('inviteRole').hidden=true;
$('makeInvite').textContent='Create 1-hour editor invitation';$('revokeInvites').textContent='Refresh invitation list';
peopleSheet.querySelector('p.muted').textContent='Invitation links are bearer capabilities. The server stores only token hashes. Shared object state is server-readable; camera video is never part of this protocol.';
peopleSheet.querySelector('a').hidden=true;
const recordSheet=document.querySelector('[data-sheet="record"]');for(const child of [...recordSheet.children])child.hidden=true;
const materialButton=element('button',{id:'remoteMaterial',textContent:'Run learned material'});
const exportButton=element('button',{id:'remoteExport',textContent:'Export accepted world JSON'});
const forkButton=element('button',{id:'remoteForkOffline',textContent:'Fork offline branch'});
const reconcileButton=element('button',{id:'remoteReconcile',textContent:'Reconcile uncertain grips'});
recordSheet.append(materialButton,exportButton,forkButton,reconcileButton,element('p',{className:'muted',textContent:'Exports accepted world/Eye/history only. Offline forks are explicit checkpoint handoffs; no invitation tokens, camera frames, microphone or private runtime token.'}));
// Use the existing remote neural surface. No automatic upload, provider call,
// credential storage or new login is introduced.
const memorySheet=document.querySelector('[data-sheet="neural"]');
memorySheet.replaceChildren(element('h3',{textContent:'Neural Memory · private evidence vault'}),
  element('p',{className:'muted',textContent:'Owner archives Council reports. Collaborators recall only individually shared reports. Evidence is not provider-authenticated or billing.'}));
const memoryOwner=element('section',{hidden:true}),memoryFile=element('input',{type:'file',accept:'.json,application/json'});
memoryFile.setAttribute('aria-label','Council report to archive');
const archiveMemory=element('button',{textContent:'Archive selected report',type:'button'});
const memoryQuery=element('input',{type:'search',placeholder:'Provider, task, verdict or digest',maxLength:128});
memoryQuery.setAttribute('aria-label','Search shared Neural Memory');
const memoryRecall=element('button',{type:'button',textContent:'Recall evidence'});
const memoryMore=element('button',{type:'button',textContent:'Older reports',hidden:true});
const memoryStatus=element('p',{textContent:'Connect to recall evidence.'});memoryStatus.setAttribute('role','status');
const memoryResults=element('div');memoryResults.setAttribute('aria-label','Remote Neural Memory results');
const shareMemoryId=element('select'),shareInvite=element('select');
shareMemoryId.setAttribute('aria-label','Evidence to share');shareInvite.setAttribute('aria-label','Collaborator invitation');
const loadShares=element('button',{type:'button',textContent:'Load invitations and grants'});
const grantMemory=element('button',{type:'button',textContent:'Grant recall access'});
const revokeMemory=element('button',{type:'button',textContent:'Revoke recall access'});
let loadedShareMemoryId=null;
function updateShareActions(){
  loadShares.disabled=role!=='owner'||!shareMemoryId.value;
  const ready=role==='owner'&&Boolean(shareMemoryId.value)&&
    loadedShareMemoryId===shareMemoryId.value&&Boolean(shareInvite.value);
  grantMemory.disabled=!ready;revokeMemory.disabled=!ready;
}
function resetInviteSelection(){
  loadedShareMemoryId=null;
  shareInvite.replaceChildren(element('option',{value:'',textContent:'Select a collaborator'}));
  shareInvite.value='';updateShareActions();
}
function resetSharing(){
  shareMemoryId.replaceChildren(element('option',{value:'',textContent:'Select evidence to share'}));
  shareMemoryId.value='';resetInviteSelection();
}
shareMemoryId.addEventListener('change',()=>{
  memoryEpoch++;resetInviteSelection();
  memoryStatus.textContent='Evidence changed. Load invitations and grants for this report.';
});
shareInvite.addEventListener('change',updateShareActions);
const vaultRecovery=element('details');
vaultRecovery.append(element('summary',{textContent:'Restore a local Neural Memory capsule'}),
  element('p',{className:'muted',textContent:'Review sends the selected file to this private vault. Restore adds new reports privately and keeps existing grants. No provider calls.'}));
const vaultCapsuleFile=element('input',{type:'file',accept:'.json,application/json'});
vaultCapsuleFile.setAttribute('aria-label','Local Neural Memory capsule');
const vaultReview=element('button',{type:'button',textContent:'Review capsule on server',disabled:true});
const vaultRestore=element('button',{type:'button',textContent:'Restore reviewed capsule to vault',disabled:true});
const vaultCapsuleStatus=element('p',{textContent:'Choose a capsule. Nothing is uploaded on file selection.'});
vaultCapsuleStatus.setAttribute('aria-live','polite');vaultCapsuleStatus.setAttribute('aria-label','Vault capsule status');
const vaultCheck=element('button',{type:'button',textContent:'Check last restore receipt',disabled:true});
const vaultRecent=element('button',{type:'button',textContent:'Recent restore receipts'});
const vaultReceipts=element('div');vaultReceipts.setAttribute('aria-label','Vault restore receipts');
vaultRecovery.append(vaultCapsuleFile,vaultReview,vaultRestore,vaultCheck,vaultRecent,vaultCapsuleStatus,vaultReceipts);
let vaultEpoch=0,vaultBusy=false,vaultStaged=null,vaultLastReview=null;
function updateVaultControls(){
  vaultCapsuleFile.disabled=vaultBusy;
  vaultReview.disabled=vaultBusy||!vaultCapsuleFile.files?.length;
  vaultRestore.disabled=vaultBusy||!vaultStaged;
  vaultCheck.disabled=vaultBusy||!vaultLastReview;
  vaultRecent.disabled=vaultBusy;
}
function resetVaultCapsule(){
  vaultEpoch++;vaultBusy=false;vaultStaged=null;vaultLastReview=null;vaultReceipts.replaceChildren();vaultCapsuleFile.value='';vaultRecovery.open=false;
  vaultCapsuleStatus.textContent='Choose a capsule. Nothing is uploaded on file selection.';updateVaultControls();
}
vaultCapsuleFile.onchange=()=>{
  vaultEpoch++;vaultStaged=null;vaultCapsuleStatus.textContent='File selected. Review explicitly to send it to the private vault.';updateVaultControls();
};
vaultReview.onclick=async()=>{
  if(vaultBusy||!vaultCapsuleFile.files?.length||role!=='owner'||!transport||transport.closed)return;
  const client=transport,epoch=++vaultEpoch,file=vaultCapsuleFile.files[0];
  const current=()=>transport===client&&!client.closed&&epoch===vaultEpoch&&role==='owner';
  vaultBusy=true;vaultStaged=null;updateVaultControls();
  try{
    if(file.size>1052672)throw Error('Capsule exceeds the local recovery file limit.');
    const capsule=JSON.parse(await file.text());if(!current())return;
    const review=await client.reviewMemoryCapsule(capsule);if(!current())return;
    vaultStaged={capsule,review};
    vaultCapsuleStatus.textContent='Preview: '+review.added+' new · '+review.duplicates+' duplicates · '+review.current+' existing. '+review.fixture+' fixture / '+review.liveClaims+' host-reported live claims. New reports stay private.';
  }catch(error){if(current())vaultCapsuleStatus.textContent=error.code||error.message;}
  finally{if(current()){vaultBusy=false;updateVaultControls();}}
};
vaultRestore.onclick=async()=>{
  if(vaultBusy||!vaultStaged||role!=='owner'||!transport||transport.closed)return;
  const client=transport,epoch=++vaultEpoch,staged=vaultStaged;
  const current=()=>transport===client&&!client.closed&&epoch===vaultEpoch&&role==='owner';
  vaultBusy=true;vaultStaged=null;vaultLastReview=staged.review.added?staged.review:null;updateVaultControls();
  try{
    const result=await client.restoreMemoryCapsule(staged.capsule,staged.review);if(!current())return;
    vaultCapsuleFile.value='';
    vaultCapsuleStatus.textContent='Restored '+result.added+' new reports · '+result.duplicates+' duplicates skipped · '+result.total+' in private vault.';
    await recallMemory();
  }catch(error){if(current())vaultCapsuleStatus.textContent=(error.code||error.message)+' · Restore outcome unconfirmed. Check the receipt and recall the vault before another restore.';}
  finally{if(current()){vaultBusy=false;updateVaultControls();}}
};
function showVaultReceipt(receipt){
  const item=element('details');
  item.append(element('summary',{textContent:'Committed '+receipt.added+' new reports · '+receipt.duplicates+' duplicates skipped'}),
    element('p',{textContent:'Capsule SHA-256: '+receipt.capsuleDigest}),
    element('p',{textContent:'Receipt SHA-256: '+receipt.receiptSha256}),
    element('p',{textContent:'Total at commit: '+receipt.totalAtCommit+' · added reports were private at commit. Current grants may differ.'}));
  for(const id of receipt.addedMemoryIds)item.append(element('p',{textContent:id}));
  vaultReceipts.append(item);
}
vaultCheck.onclick=async()=>{
  if(vaultBusy||!vaultLastReview||role!=='owner'||!transport||transport.closed)return;
  const client=transport,epoch=++vaultEpoch,review=vaultLastReview;
  const current=()=>transport===client&&!client.closed&&epoch===vaultEpoch&&role==='owner';
  vaultBusy=true;updateVaultControls();vaultReceipts.replaceChildren();
  try{
    const result=await client.reconcileMemoryRestore(review);if(!current())return;
    if(result.status==='committed'){
      showVaultReceipt(result.receipt);
      vaultCapsuleStatus.textContent='Commit confirmed: '+result.receipt.added+' new reports were restored.';
      await recallMemory();
    }else vaultCapsuleStatus.textContent='No changed-restore receipt observed. This is not proof of rollback. Recall the vault before reviewing again.';
  }catch(error){if(current())vaultCapsuleStatus.textContent=error.code||error.message;}
  finally{if(current()){vaultBusy=false;updateVaultControls();}}
};
vaultRecent.onclick=async()=>{
  if(vaultBusy||role!=='owner'||!transport||transport.closed)return;
  const client=transport,epoch=++vaultEpoch;
  const current=()=>transport===client&&!client.closed&&epoch===vaultEpoch&&role==='owner';
  vaultBusy=true;updateVaultControls();vaultReceipts.replaceChildren();
  try{
    const receipts=await client.recentMemoryRestores();if(!current())return;
    receipts.forEach(showVaultReceipt);
    vaultCapsuleStatus.textContent=receipts.length+' recent changed-restore receipts · historical, not current permissions.';
  }catch(error){if(current())vaultCapsuleStatus.textContent=error.code||error.message;}
  finally{if(current()){vaultBusy=false;updateVaultControls();}}
};
const vaultBackup=element('details');
vaultBackup.append(element('summary',{textContent:'Back up private evidence vault'}),
  element('p',{className:'muted',textContent:'Download all evidence in bounded parts. Files exclude invitations, grants and restore receipts. Copies are not revocable or encrypted by Vivo. Save every part to recover the full evidence vault.'}));
const backupStart=element('button',{type:'button',textContent:'Download first backup part'});
const backupNext=element('button',{type:'button',textContent:'Download next backup part',disabled:true});
const backupStatus=element('p',{textContent:'No backup started.'});
backupStatus.setAttribute('aria-label','Vault backup status');backupStatus.setAttribute('aria-live','polite');
const backupComplete=element('button',{type:'button',textContent:'Download complete backup file'});
const backupVerifyFile=element('input',{type:'file',accept:'.json,application/json'});
backupVerifyFile.setAttribute('aria-label','Complete backup file to verify');
const backupPartSelect=element('select',{disabled:true});backupPartSelect.setAttribute('aria-label','Verified recovery part');
const backupExtract=element('button',{type:'button',textContent:'Extract verified capsule',disabled:true});
const backupVerifyStatus=element('p',{textContent:'No complete backup selected.'});
backupVerifyStatus.setAttribute('aria-label','Backup verification status');backupVerifyStatus.setAttribute('aria-live','polite');
const backupReviewAll=element('button',{type:'button',textContent:'Review complete backup on server',disabled:true});
const backupRestoreAll=element('button',{type:'button',textContent:'Restore all reviewed reports',disabled:true});
const backupCheckAll=element('button',{type:'button',textContent:'Check complete restore receipt',disabled:true});
const backupRecentAll=element('button',{type:'button',textContent:'Recent complete restore receipts'});
const backupRestoreStatus=element('p',{textContent:'Select and verify a complete backup first.'});
backupRestoreStatus.setAttribute('aria-label','Complete restore status');backupRestoreStatus.setAttribute('aria-live','polite');
const backupRestoreReceipts=element('div');backupRestoreReceipts.setAttribute('aria-label','Complete restore receipts');
vaultBackup.append(backupStart,backupNext,backupComplete,backupStatus,
  element('p',{className:'muted',textContent:'Verify the complete backup locally, then either extract a capsule or explicitly review all parts on this private server. Restoration merges evidence in one transaction. No credentials, grants or prior receipts are imported.'}),
  backupVerifyFile,backupPartSelect,backupExtract,backupVerifyStatus,
  backupReviewAll,backupRestoreAll,backupCheckAll,backupRecentAll,backupRestoreStatus,backupRestoreReceipts);
let backupEpoch=0,backupBusy=false,backupCursor=null,verifiedBackup=null,verifiedBundle=null,backupStaged=null,backupLastReview=null;
function updateBackupControls(){
  backupStart.disabled=backupBusy;backupNext.disabled=backupBusy||!backupCursor;backupComplete.disabled=backupBusy;
  backupVerifyFile.disabled=backupBusy;backupPartSelect.disabled=backupBusy||!verifiedBackup;
  backupExtract.disabled=backupBusy||!verifiedBackup||backupPartSelect.value==='';
  backupReviewAll.disabled=backupBusy||!verifiedBundle;
  backupRestoreAll.disabled=backupBusy||!backupStaged;
  backupCheckAll.disabled=backupBusy||!backupLastReview;
  backupRecentAll.disabled=backupBusy;
}
function clearVerifiedBackup(){
  verifiedBackup=null;verifiedBundle=null;backupStaged=null;
  backupRestoreStatus.textContent='Select and verify a complete backup first.';
  backupPartSelect.replaceChildren(element('option',{value:'',textContent:'Select a verified part'}));
  backupPartSelect.value='';backupVerifyFile.value='';
}
function requestBackupFile(text,filename){
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
  const link=element('a',{href:url,download:filename,hidden:true});
  try{document.body.append(link);link.click();}
  finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
function resetVaultBackup(){
  backupEpoch++;backupBusy=false;backupCursor=null;backupLastReview=null;backupRestoreReceipts.replaceChildren();vaultBackup.open=false;clearVerifiedBackup();
  backupVerifyStatus.textContent='No complete backup selected.';
  backupStatus.textContent='No backup started.';updateBackupControls();
}
async function downloadVaultPart(first){
  if(backupBusy||(!first&&!backupCursor)||role!=='owner'||!transport||transport.closed)return;
  const client=transport,epoch=++backupEpoch,prior=first?null:backupCursor;
  const current=()=>transport===client&&!client.closed&&epoch===backupEpoch&&role==='owner';
  if(first)backupCursor=null;
  backupBusy=true;updateBackupControls();
  try{
    const part=await client.prepareMemoryBackupPart(prior?{after:prior.after,revision:prior.revision}:undefined);
    if(!current())return;
    if(prior&&(part.offset!==prior.offset||part.total!==prior.total))throw Error('MEMORY_BACKUP_PART_INVALID');
    if(part.total===0){backupStatus.textContent='Vault is empty. No backup file needed.';return;}
    const url=URL.createObjectURL(new Blob([part.text],{type:'application/json'}));
    const link=element('a',{href:url,download:part.filename,hidden:true});
    try{document.body.append(link);link.click();}
    finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    backupCursor=part.complete?null:{after:part.nextAfter,revision:part.revision,offset:part.offset+part.count,total:part.total};
    backupStatus.textContent='Download requested: '+(part.offset+1)+'–'+(part.offset+part.count)+' of '+part.total+
      ' reports. '+(part.complete?'Final part; confirm every file was saved.':'Download the next part to complete this backup.');
  }catch(error){
    if(current()){
      if(error.code==='BACKUP_REVISION_STALE'||error.code==='BACKUP_CURSOR_INVALID')backupCursor=null;
      backupStatus.textContent=(error.code||error.message)+' · '+(backupCursor?'Check saved files before continuing.':'Start a new backup; do not combine different revisions.');
    }
  }finally{if(current()){backupBusy=false;updateBackupControls();}}
}
backupStart.onclick=()=>void downloadVaultPart(true);
backupNext.onclick=()=>void downloadVaultPart(false);
backupComplete.onclick=async()=>{
  if(backupBusy||role!=='owner'||!transport||transport.closed)return;
  const client=transport,epoch=++backupEpoch;
  const current=()=>transport===client&&!client.closed&&epoch===backupEpoch&&role==='owner';
  backupBusy=true;updateBackupControls();
  backupStatus.textContent='Collecting one revision of the vault…';
  try{
    const complete=await client.prepareCompleteMemoryBackup();if(!current())return;
    requestBackupFile(complete.text,complete.filename);
    backupStatus.textContent='Complete backup download requested: '+complete.total+' reports · '+complete.parts+' capsule parts. Verify the saved file locally.';
  }catch(error){if(current())backupStatus.textContent=(error.code||error.message)+' · No complete backup exported. Start again.';}
  finally{if(current()){backupBusy=false;updateBackupControls();}}
};
backupVerifyFile.onchange=async()=>{
  if(backupBusy||role!=='owner'||!transport||transport.closed)return;
  const file=backupVerifyFile.files?.[0];if(!file)return;
  const client=transport,epoch=++backupEpoch;
  const current=()=>transport===client&&!client.closed&&epoch===backupEpoch&&role==='owner';
  backupBusy=true;clearVerifiedBackup();updateBackupControls();
  backupVerifyStatus.textContent='Verifying locally; nothing is uploaded.';
  try{
    if(file.size>MEMORY_BACKUP_SET_MAX_BYTES)throw Error('Complete backup exceeds the file limit.');
    const parsed=JSON.parse(await file.text());if(!current())return;
    const verified=await verifyMemoryBackupSet(parsed);if(!current())return;
    verifiedBackup=verified;verifiedBundle=parsed;
    backupRestoreStatus.textContent='Verified locally. Review explicitly to upload the complete backup to this private vault.';
    verified.parts.forEach((part,index)=>backupPartSelect.append(element('option',{value:String(index),
      textContent:part.count===0?'Empty capsule':'Reports '+(part.offset+1)+'–'+(part.offset+part.count)})));
    backupVerifyStatus.textContent='Verified complete backup: '+verified.total+' reports · '+verified.parts.length+' capsule parts. No missing or duplicate runs.';
  }catch(error){if(current())backupVerifyStatus.textContent=(error.code||error.message)+' · No capsule available to extract.';}
  finally{if(current()){backupBusy=false;updateBackupControls();}}
};
backupPartSelect.onchange=updateBackupControls;
backupExtract.onclick=()=>{
  if(backupBusy||role!=='owner'||!transport||transport.closed||!verifiedBackup||backupPartSelect.value==='')return;
  const part=verifiedBackup.parts[Number(backupPartSelect.value)];if(!part)return;
  requestBackupFile(JSON.stringify(part.capsule,null,2)+'\n',
    'neural-memory-'+part.journalSha256.slice(0,12)+'.json');
  backupVerifyStatus.textContent='Verified capsule download requested. Restore this part through the reviewed capsule flow.';
};
backupReviewAll.onclick=async()=>{
  if(backupBusy||!verifiedBundle||role!=='owner'||!transport||transport.closed)return;
  const client=transport,epoch=++backupEpoch,bundle=verifiedBundle;
  const current=()=>transport===client&&!client.closed&&epoch===backupEpoch&&role==='owner';
  backupBusy=true;backupStaged=null;updateBackupControls();
  backupRestoreStatus.textContent='Reviewing all parts on the private server…';
  try{
    const review=await client.reviewCompleteMemoryBackup(bundle);if(!current())return;
    backupStaged={bundle,review};
    backupRestoreStatus.textContent='Preview: '+review.added+' new · '+review.duplicates+' duplicates · '+review.parts+' parts. '+review.fixture+' fixture / '+review.liveClaims+' host-reported live claims. New reports stay private.';
  }catch(error){if(current())backupRestoreStatus.textContent=error.code||error.message;}
  finally{if(current()){backupBusy=false;updateBackupControls();}}
};
backupRestoreAll.onclick=async()=>{
  if(backupBusy||!backupStaged||role!=='owner'||!transport||transport.closed)return;
  const client=transport,epoch=++backupEpoch,staged=backupStaged;
  const current=()=>transport===client&&!client.closed&&epoch===backupEpoch&&role==='owner';
  backupBusy=true;backupStaged=null;backupLastReview=staged.review.added?staged.review:null;updateBackupControls();
  try{
    const result=await client.restoreCompleteMemoryBackup(staged.bundle,staged.review);if(!current())return;
    backupRestoreStatus.textContent='Restored '+result.added+' new reports · '+result.duplicates+' duplicates skipped · '+result.total+' in private vault.';
    await recallMemory();
  }catch(error){if(current())backupRestoreStatus.textContent=(error.code||error.message)+' · Outcome unconfirmed. Check the receipt and recall before reviewing again.';}
  finally{if(current()){backupBusy=false;updateBackupControls();}}
};
function showCompleteRestoreReceipt(receipt){
  const item=element('details');
  item.append(element('summary',{textContent:'Committed '+receipt.added+' new reports · '+receipt.duplicates+' duplicates skipped'}),
    element('p',{textContent:'Manifest SHA-256: '+receipt.manifestDigest}),
    element('p',{textContent:'Receipt SHA-256: '+receipt.receiptSha256}),
    element('p',{textContent:'Total at commit: '+receipt.totalAtCommit+' · new reports were private at commit. Current grants may differ.'}));
  for(const id of receipt.addedMemoryIds)item.append(element('p',{textContent:id}));
  backupRestoreReceipts.append(item);
}
backupCheckAll.onclick=async()=>{
  if(backupBusy||!backupLastReview||role!=='owner'||!transport||transport.closed)return;
  const client=transport,epoch=++backupEpoch,review=backupLastReview;
  const current=()=>transport===client&&!client.closed&&epoch===backupEpoch&&role==='owner';
  backupBusy=true;backupRestoreReceipts.replaceChildren();updateBackupControls();
  try{
    const result=await client.reconcileCompleteMemoryRestore(review);if(!current())return;
    if(result.status==='committed'){
      showCompleteRestoreReceipt(result.receipt);
      backupRestoreStatus.textContent='Complete commit confirmed: '+result.receipt.added+' new reports were restored.';
      await recallMemory();
    }else backupRestoreStatus.textContent='No changed-restore receipt observed. This is not proof of rollback. Recall before reviewing again.';
  }catch(error){if(current())backupRestoreStatus.textContent=error.code||error.message;}
  finally{if(current()){backupBusy=false;updateBackupControls();}}
};
backupRecentAll.onclick=async()=>{
  if(backupBusy||role!=='owner'||!transport||transport.closed)return;
  const client=transport,epoch=++backupEpoch;
  const current=()=>transport===client&&!client.closed&&epoch===backupEpoch&&role==='owner';
  backupBusy=true;backupRestoreReceipts.replaceChildren();updateBackupControls();
  try{
    const receipts=await client.recentCompleteMemoryRestores();if(!current())return;
    receipts.forEach(showCompleteRestoreReceipt);
    backupRestoreStatus.textContent=receipts.length+' recent complete restore receipts · historical, not current permissions.';
  }catch(error){if(current())backupRestoreStatus.textContent=error.code||error.message;}
  finally{if(current()){backupBusy=false;updateBackupControls();}}
};
memoryOwner.append(memoryFile,archiveMemory,shareMemoryId,shareInvite,loadShares,grantMemory,revokeMemory,vaultRecovery,vaultBackup);
const agentContext=element('details');
agentContext.append(element('summary',{textContent:'Prepare agent evidence context'}),
  element('p',{className:'muted',textContent:'Choose a task and provenance. Recall returns authorized evidence only, including disagreement. No model call or automatic action.'}));
const taskScope=element('select'),modeScope=element('select'),providerScope=element('select');
taskScope.setAttribute('aria-label','Agent evidence task');modeScope.setAttribute('aria-label','Agent evidence provenance');
providerScope.setAttribute('aria-label','Required provider in evidence');
for(const [value,textContent] of [['route-constraint-v1','Constrained planning'],['arithmetic-31-v1','Arithmetic']])
  taskScope.append(element('option',{value,textContent}));
for(const [value,textContent] of [['fixture','Synthetic fixtures'],['live','Host-reported live (unverified)']])
  modeScope.append(element('option',{value,textContent}));
for(const value of ['','openai','anthropic','google','deepseek','kimi','nvidia','xai'])
  providerScope.append(element('option',{value,textContent:value||'Any provider'}));
const prepareEvidence=element('button',{type:'button',textContent:'Prepare agent evidence'});
const reasonEvidence=element('button',{type:'button',textContent:'Reason from authorized evidence'});
const reasoningResult=element('section');reasoningResult.setAttribute('aria-label','Advisory reasoning result');
agentContext.append(taskScope,modeScope,providerScope,prepareEvidence,reasonEvidence,reasoningResult);
const plannerArea=element('details');
plannerArea.append(element('summary',{textContent:'Plan a custom agent mission'}),
  element('p',{className:'muted',textContent:'Edit the bounded mission: 1–12 jobs with integer costs and values, a budget, required job IDs and mutually exclusive ID pairs. Maximize value, then minimize cost, then sort IDs. Empty choice is allowed unless jobs are required. No automatic execution.'}));
const defaultMission={budget:7,jobs:[{id:'A',cost:3,value:5},{id:'B',cost:4,value:7},{id:'C',cost:5,value:9},{id:'D',cost:2,value:4}],required:[],conflicts:[]};
const missionInput=element('textarea',{rows:10,maxLength:8192,value:JSON.stringify(defaultMission,null,2)});
missionInput.setAttribute('aria-label','Agent mission definition');
const missionPlan=element('button',{type:'button',textContent:'Solve and verify mission'});
const plannerResult=element('section');plannerResult.setAttribute('aria-label','Verified custom mission result');
plannerArea.append(missionInput,missionPlan,plannerResult);
agentContext.append(plannerArea);
function clearReasoning(){reasoningResult.replaceChildren();plannerResult.replaceChildren();}
missionInput.addEventListener('input',()=>{
  memoryEpoch++;clearReasoning();memoryStatus.textContent='Mission changed. Solve this exact definition again.';
});
for(const control of [taskScope,modeScope,providerScope])control.addEventListener('change',()=>{
  memoryEpoch++;clearReasoning();memoryResults.replaceChildren();resetSharing();
  memoryCursor=null;memoryMore.hidden=true;
  reasonEvidence.disabled=taskScope.value!=='route-constraint-v1';
  memoryStatus.textContent='Scope changed. Recall or reason using this selection.';
});
memorySheet.append(memoryOwner,memoryQuery,memoryRecall,memoryMore,agentContext,memoryStatus,memoryResults);
let memoryEpoch=0,memoryCursor=null;
resetSharing();
function clearMemoryView(){
  memoryEpoch++;memoryCursor=null;clearReasoning();memoryResults.replaceChildren();resetSharing();
  memoryFile.value='';resetVaultCapsule();resetVaultBackup();memoryQuery.value='';memoryOwner.hidden=true;memoryMore.hidden=true;
  taskScope.value='route-constraint-v1';modeScope.value='fixture';providerScope.value='';agentContext.open=false;reasonEvidence.disabled=false;
  missionInput.value=JSON.stringify(defaultMission,null,2);plannerArea.open=false;
  memoryStatus.textContent='Connect to recall evidence.';
}
const memoryAction=fn=>async()=>{
  const client=transport,epoch=++memoryEpoch;clearReasoning();
  if(!client||client.closed){clearMemoryView();return;}
  const current=()=>transport===client&&!client.closed&&memoryEpoch===epoch;
  memoryStatus.textContent='Reading private memory…';
  try{await fn(client,current);}catch(e){if(current()){
    if(['AUTH_REQUIRED','FORBIDDEN','NOT_FOUND'].includes(e.code)){
      memoryResults.replaceChildren();resetSharing();memoryCursor=null;memoryMore.hidden=true;
    }
    memoryStatus.textContent=e.code||e.message||'Memory request failed.';
  }}
};
function addMemoryRecord(record){
  const card=element('details');
  card.append(element('summary',{textContent:(record.mode==='fixture'?'Fixture · not live':'Host-reported · unverified')+' · '+record.runId}),
    element('p',{textContent:'Evidence: '+record.evidenceDigest}),
    element('p',{textContent:'Advisory only; charges unknown.'}));
  if(record.localOptimum)card.append(element('p',{textContent:'Local optimum: '+record.localOptimum.candidate+' · value '+record.localOptimum.value}));
  for(const row of record.rows)card.append(element('p',{textContent:row.provider+' · '+row.verdict+(row.candidate?' · '+row.candidate:'')}));
  const download=element('button',{type:'button',textContent:'Download original report'});
  card.append(download,element('p',{className:'muted',textContent:'A downloaded copy is outside server permissions and cannot be revoked.'}));
  download.onclick=memoryAction(async(client,current)=>{
    const prepared=await client.prepareCouncilEvidenceDownload(record.memoryId);
    if(!current())return;
    const url=URL.createObjectURL(new Blob([prepared.text],{type:'application/json'}));
    const link=element('a',{href:url,download:prepared.filename,hidden:true});
    try{document.body.append(link);link.click();}
    finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    memoryStatus.textContent='Download requested. The original report digest is unchanged.';
  });
  memoryResults.append(card);
  if(role==='owner'&&![...shareMemoryId.options].some(o=>o.value===record.memoryId))
    shareMemoryId.append(element('option',{value:record.memoryId,textContent:record.runId+' · '+record.mode}));
}
function recallMemory(older=false){
  return memoryAction(async(client,current)=>{
    const page=await client.memoryRequest('search',{query:memoryQuery.value,limit:16,before:older?memoryCursor:null});
    if(!current())return;
    if(!older){memoryResults.replaceChildren();resetSharing();}
    page.records.forEach(addMemoryRecord);memoryCursor=page.nextBefore;memoryMore.hidden=memoryCursor===null;
    memoryStatus.textContent=memoryResults.children.length+' accessible reports · private server evidence';
  })();
}
memoryRecall.onclick=()=>void recallMemory();
memoryMore.onclick=()=>void recallMemory(true);
prepareEvidence.onclick=memoryAction(async(client,current)=>{
  memoryResults.replaceChildren();resetSharing();
  memoryCursor=null;memoryMore.hidden=true;
  const packet=await client.prepareAgentContext({task:taskScope.value,mode:modeScope.value,
    providers:providerScope.value?[providerScope.value]:[],limit:4});
  if(!current())return;
  packet.records.forEach(addMemoryRecord);
  memoryStatus.textContent=packet.status==='no-matching-evidence'?'No matching authorized evidence.':
    'Prepared '+packet.records.length+' evidence reports · advisory only'+(packet.truncated?' · more matches exist':'');
});
reasonEvidence.onclick=memoryAction(async(client,current)=>{
  memoryResults.replaceChildren();resetSharing();
  memoryCursor=null;memoryMore.hidden=true;
  const result=await client.reasonAgentMission({task:taskScope.value,mode:modeScope.value,
    providers:providerScope.value?[providerScope.value]:[],limit:4});
  if(!current())return;
  const p=result.proposal,proof=result.proof,e=result.evidence,c=e.observationCounts;
  reasoningResult.append(element('h3',{textContent:'Local mathematical solution'}),
    element('p',{textContent:'Verified plan: '+p.candidate+' · cost '+p.cost+' / '+proof.budget+' · value '+p.value}),
    element('p',{textContent:proof.subsetsChecked+' subsets checked · '+proof.feasibleSubsets+' feasible · runner-up '+proof.runnerUp.candidate+' value '+proof.runnerUp.value}),
    element('p',{textContent:({
      'no-matching-evidence':'No matching authorized evidence. Local proof only.',
      'matching-optimum-observed':'Matching optimum observed in authorized reports.',
      'dissent-or-invalid-only':'Historical disagreement or invalid proposals only. Local proof is independent.',
      'no-usable-proposal':'Reports recalled, but no usable provider proposal.'
    })[e.status]}),
    element('p',{textContent:c.optimal+' optimal · '+c['feasible-suboptimal']+' suboptimal · '+c['over-budget']+' over budget · '+c['invalid-proposal']+' invalid · '+c.unknown+' unknown observations'}),
    element('p',{textContent:'Decision SHA-256: '+result.decisionSha256}),
    element('p',{className:'muted',textContent:'Advisory only. No provider calls initiated; historical charges unknown. Repeated observations are not independent votes.'}));
  for(const record of e.citations){
    const detail=element('details');detail.append(element('summary',{textContent:record.provenance+' · '+record.runId}),
      element('p',{textContent:'Evidence: '+record.evidenceDigest}));
    for(const row of record.observations)detail.append(element('p',{textContent:row.provider+' · '+row.verdict+(row.candidate?' · '+row.candidate:'')}));
    reasoningResult.append(detail);
  }
  memoryStatus.textContent='Local reasoning complete · '+e.recordsUsed+' authorized reports'+(e.truncated?' · more matches exist':'');
});
missionPlan.onclick=memoryAction(async(client,current)=>{
  const text=missionInput.value;if(text.length>8192)throw Error('Mission definition is too large.');
  let mission;try{mission=JSON.parse(text);}catch{throw Error('Mission must be valid JSON.');}
  memoryResults.replaceChildren();resetSharing();memoryCursor=null;memoryMore.hidden=true;
  const result=await client.planAgentMission({mission,selection:{mode:modeScope.value,
    providers:providerScope.value?[providerScope.value]:[],limit:4}});
  if(!current())return;
  const p=result.proposal,proof=result.proof,receipt=result.evidence.receipt;
  plannerResult.append(element('h3',{textContent:'Independently verified mission'}),
    element('p',{textContent:p?'Verified plan: '+(p.candidate||'Empty choice')+' · cost '+p.cost+' / '+result.mission.budget+' · value '+p.value:
      'No feasible plan satisfies the required jobs, conflicts and budget.'}),
    element('p',{textContent:proof.subsetsChecked+' subsets checked · '+proof.feasibleSubsets+' feasible · '+proof.equallyValuableOptima+' equally valuable optima'}),
    element('p',{textContent:proof.runnerUp?'Runner-up: '+(proof.runnerUp.candidate||'Empty choice')+' · value '+proof.runnerUp.value+' · gap '+proof.optimalityGap:'No feasible alternative.'}),
    element('p',{textContent:'Mission SHA-256: '+result.missionSha256}),
    element('p',{textContent:'Enumeration SHA-256: '+proof.enumerationSha256}),
    element('p',{textContent:'Decision SHA-256: '+result.decisionSha256}),
    element('p',{className:'muted',textContent:'Advisory only. No provider call, billing or world action.'}));
  if(receipt){
    const e=receipt.evidence;
    plannerResult.append(element('p',{textContent:'Exact historical task · '+e.recordsUsed+' authorized evidence reports. Local proof is independent.'}));
    for(const record of e.citations){
      const detail=element('details');detail.append(element('summary',{textContent:record.provenance+' · '+record.runId}),
        element('p',{textContent:'Evidence: '+record.evidenceDigest}));
      for(const row of record.observations)detail.append(element('p',{textContent:row.provider+' · '+row.verdict+(row.candidate?' · '+row.candidate:'')}));
      plannerResult.append(detail);
    }
  }else plannerResult.append(element('p',{textContent:'Custom task has no matching evidence contract. Historical Council proposals were not recalled.'}));
  memoryStatus.textContent='Mission verified · '+(receipt?receipt.evidence.recordsUsed:0)+' authorized reports';
});
archiveMemory.onclick=memoryAction(async(client,current)=>{
  const file=memoryFile.files?.[0];if(!file||file.size>65536)throw Error('Choose a Council JSON report no larger than 64 KB.');
  const envelope=JSON.parse(await file.text());if(!current())return;
  const result=await client.memoryRequest('archive',{envelope});if(!current())return;
  memoryFile.value='';memoryStatus.textContent=result.status==='duplicate'?'Already archived.':'Report archived on private server. Select Recall evidence to inspect.';
});
loadShares.onclick=memoryAction(async(client,current)=>{
  const memoryId=shareMemoryId.value;
  if(!memoryId)throw Error('Recall and select a report first.');
  resetInviteSelection();
  const [invites,grants]=await Promise.all([client.listInvites(),client.memoryRequest('grants',{memoryId})]);
  if(!current()||shareMemoryId.value!==memoryId)return;
  if(grants.memoryId!==memoryId)throw Error('Grant response belongs to another report.');
  const byId=new Map(grants.grants.map(g=>[g.invitationId,g]));
  shareInvite.replaceChildren(element('option',{value:'',textContent:'Select a collaborator'}),
    ...invites.filter(i=>!i.revoked&&i.expiresAt>Date.now()/1000).map(i=>
      element('option',{value:i.id,textContent:i.actorId+(byId.has(i.id)?' · shared':' · private')})));
  shareInvite.value='';loadedShareMemoryId=memoryId;updateShareActions();
  memoryStatus.textContent='Select a collaborator. Grant and revoke affect only the selected report.';
});
function changeShare(granted){
  return memoryAction(async(client,current)=>{
    const memoryId=shareMemoryId.value,invitationId=shareInvite.value;
    if(!memoryId||!invitationId||loadedShareMemoryId!==memoryId)throw Error('Select evidence and an active invitation for that report.');
    const actor=shareInvite.selectedOptions[0]?.textContent?.split(' · ')[0]||'selected collaborator';
    // A grant/revoke consumes this explicit target selection. Reconcile
    // with the server before allowing another sharing change.
    resetInviteSelection();
    const result=await client.memoryRequest('grant',{memoryId,invitationId,granted});
    if(!current())return;
    if(result.memoryId!==memoryId||result.invitationId!==invitationId||result.granted!==granted)
      throw Error('Unexpected sharing receipt. Reload invitations and grants.');
    memoryStatus.textContent=result.granted?'Recall access granted. Target: '+actor:
      'Future recall access revoked. Previously downloaded copies cannot be revoked. Target: '+actor;
  })();
}
grantMemory.onclick=()=>void changeShare(true);revokeMemory.onclick=()=>void changeShare(false);
const badge=element('div',{id:'localCapabilities',textContent:'REMOTE · disconnected'});document.body.append(badge);

async function gridFor(d){if(!grids.has(d)){const r=await fetch('/api/remote/grid?dimension='+d);if(!r.ok)throw Error(await r.text());grids.set(d,await r.json());}return grids.get(d);}
function currentEntity(){return state?.snapshot.spaces[state.eye.spaceId].entities[selected];}
function configureAxes(){if(!state)return;for(const id of ['moveAxis','sliceAxis']){$(id).replaceChildren();for(let a=id==='sliceAxis'?3:0;a<state.eye.dimension;a++)$(id).append(element('option',{value:String(a),textContent:'x'+(a+1)}));}const a=+$('sliceAxis').value;$('sliceValue').value=String(state.eye.slice?.['x'+(a+1)]||0);}
function receive(next){if(!next)return;const old=state?.eye?.spaceId;state=next;online=true;
  const entities=next.snapshot.spaces[next.eye.spaceId].entities;if(!selected||!entities[selected])selected=Object.keys(entities)[0];
  renderer.actor=transport?.actorId;renderer.selected=selected;
  void gridFor(next.eye.dimension).then(grid=>{renderer.grid=grid;renderer.state=projectAccepted(next,grid);renderer.slice=[...next.eye.q];for(const[k,v]of Object.entries(next.eye.slice||{}))renderer.slice[+k.slice(1)-1]=v;renderer.origin=embed(next.eye.q,renderer.state.geometry,next.eye.chart);});
  if(old!==next.eye.spaceId)configureAxes();updateUI();
}
function updateUI(){if(!state)return;const e=currentEntity(),activeRole=role??transport?.role??'joining';$('connection').textContent=(online?'REMOTE '+activeRole.toUpperCase():'DISCONNECTED')+' · '+transport.actorId;
  $('worldName').textContent=state.eye.spaceId==='root'?'Shared 4D adaptive workshop':'Inside persistent 11D relic world';
  $('dimensionBadge').textContent=state.eye.dimension+' spatial axes + separate time';$('geometryBadge').textContent='Eye r'+state.eye.revision+' · seq '+state.snapshot.acceptedSequence;
  $('selection').hidden=!e;if(e){$('selectedName').textContent=e.name;$('selectedCoords').textContent=e.q.map((v,i)=>'x'+(i+1)+' '+v.toFixed(3)).join(' · ');}
  const ids=Object.keys(state.snapshot.spaces[state.eye.spaceId].entities);
  if(objectSelect.options.length!==ids.length||ids.some((id,i)=>objectSelect.options[i]?.value!==id))objectSelect.replaceChildren(...ids.map(id=>element('option',{value:id,textContent:state.snapshot.spaces[state.eye.spaceId].entities[id].name||id})));
  objectSelect.value=selected;
  enterButton.disabled=!e?.innerSpaceId;exitButton.disabled=!state.eye.stack?.length;
  $('peopleList').replaceChildren();for(const p of state.participants||[])$('peopleList').append(element('p',{textContent:(p.actorId||p.seat)+' · '+(p.online?'online':'offline')+(p.actorId===transport.actorId?' (you)':'')}));
  const running=state.capabilities.material?.running;materialButton.hidden=role!=='owner';materialButton.textContent=(running?'Pause':'Run')+' learned adaptive material';
  badge.textContent='REMOTE · canonical '+(state.capabilities.materialLearning?'LEARNED 4D/11D MATERIAL':'MATERIAL OFF')+' · independent Eyes';
  $('metrics').textContent='Camera '+(camera.stream?'on':'off')+' · no microphone · no frame uploads · sim t '+state.snapshot.simulationTime.toFixed(3);
}
async function connect(){if(transport&&!transport.closed)await disconnect();const token=tokenInput.value.trim();if(!token)throw Error('Enter owner or invitation token');
  const socket=(location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws';
  const client=new RemoteTransport({url:socket,token,onState:receive,onError:error=>say('Remote: '+(error.code||error.message||'protocol error')),onClose:()=>{if(transport===client)clearMemoryView();}});transport=client;const admitted=await client.admit();role=admitted.role;clearMemoryView();memoryOwner.hidden=role!=='owner';memoryStatus.textContent='Connected. Select Recall evidence.';receive(admitted.state);
  host=await GripHost.open(client,{onPreview:(key,v)=>v?previews.set(key,v):previews.delete(key),onStatus:(_k,e)=>e.code&&say('Grip: '+e.code)});
  inputs=new ApplicationInputs({host,nextEpoch:()=>client.nextEpoch(),project:(entity,anchor,point)=>screenTarget(renderer,entity,anchor,point),onRemove:key=>previews.delete(key)});
  await gridFor(state.eye.dimension);configureAxes();$('welcome').hidden=true;$('toolbar').hidden=false;say('Connected to one canonical Vivo world. Touch, hands and Eye actions use accepted authority state.');
}
async function disconnect(){online=false;clearMemoryView();camera.stop();try{await inputs?.cancelAll('remote-disconnect');}catch{}try{await inputs?.close();}catch{}try{await transport?.close();}catch{}host=null;inputs=null;transport=null;state=null;$('welcome').hidden=false;$('toolbar').hidden=true;badge.textContent='REMOTE · disconnected';}
function cooperativeGroup(id){return 'shared.'+state.eye.spaceId+'.'+id;}
async function beginGesture(key,source,id,point,observedAt){if(!inputs||!online)throw Error('Not connected');const e=state.snapshot.spaces[state.eye.spaceId].entities[id];selected=id;renderer.selected=id;updateUI();return inputs.begin(key,{entity:e,source,point,observedAt,cooperativeGroup:cooperativeGroup(id)});}
const moveGesture=(key,p,t)=>inputs?.move(key,p,t),endGesture=(key,p,t)=>inputs?.end(key,{point:p,observedAt:t});
async function releaseAll(){await inputs?.releaseAll();}
async function editEye(change){const eye=structuredClone(state.eye);change(eye);await transport.moveEye(eye,eye.revision);}
async function navigate(enter){
 await releaseAll();
 for(let attempt=0;attempt<3;attempt++){
   const eye=state.eye,e=currentEntity();if(enter&&!e?.innerSpaceId)throw Error('Select an entrance object');
   const command={schema:'vivo.command/1',id:'nav.'+crypto.randomUUID(),worldId:state.snapshot.worldId,spaceId:eye.spaceId,kind:enter?'space.enter':'space.exit',expectedRevision:enter?e.revision:eye.revision,payload:enter?{eyeId:'main',portalEntityId:e.id}:{eyeId:'main',returnFrameId:eye.stack.at(-1)?.id}};
   const receipt=await transport.submit(command);
   if(receipt.status==='accepted'){say(enter?'Entered persistent nested world. Your collaborator Eye was not moved.':'Returned through your saved Eye frame.');return;}
   if(!(enter&&receipt.code==='STALE_REVISION'&&attempt<2))throw Error(receipt.code);
   // A moving material portal can advance between render and submit. Refresh
   // identity/state and retry; do not reuse the stale command ID or guess state.
   await transport.refresh();
 }
 throw Error('STALE_REVISION');
}
$('createRoom').onclick=safe(connect);$('connection').onclick=safe(disconnect);enterButton.onclick=safe(()=>navigate(true));exitButton.onclick=safe(()=>navigate(false));
$('closePanel').onclick=()=>$('panel').close();document.querySelectorAll('.toolbar button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.sheet').forEach(s=>{const active=s.dataset.sheet===b.dataset.panel;s.hidden=!active;s.classList.toggle('active',active);});$('panelTitle').textContent=b.textContent;$('panel').showModal();});
$('homeView').onclick=safe(()=>editEye(eye=>{eye.q=Array(eye.dimension).fill(0);eye.basis=viewBasis(eye.dimension,.55,.68);for(const k of Object.keys(eye.slice||{}))eye.slice[k]=0;}));
$('followSelected').onclick=safe(()=>editEye(eye=>{const e=currentEntity();eye.q=[...e.q];for(let a=3;a<eye.dimension;a++)eye.slice['x'+(a+1)]=e.q[a];}));
$('sliceValue').oninput=safe(()=>editEye(eye=>{const a=+$('sliceAxis').value;eye.slice['x'+(a+1)]=+$('sliceValue').value;eye.q[a]=+$('sliceValue').value;}));
async function axisMove(sign){
  const axis=+$('moveAxis').value;
  if($('moveTarget').value==='observer')return editEye(eye=>{eye.q[axis]+=sign*.25;if(axis>=3)eye.slice['x'+(axis+1)]=eye.q[axis];});
  const entity=currentEntity();if(!entity)throw Error('Select an object');
  if(!state.capabilities.material?.running)throw Error(role==='owner'?'Run learned material first':'Ask the owner to run learned material');
  const key='axis:'+crypto.randomUUID(),epoch=await transport.nextEpoch(),target={spaceId:entity.spaceId,chart:entity.chart,dimension:entity.dimension,q:[...entity.q]};
  target.q[axis]+=sign*.25;
  await host.begin(key,{entity,source:'keyboard',inputEpoch:epoch,cooperativeGroup:cooperativeGroup(entity.id)});
  const observedAt=performance.now(),epsilon=1e-6;
  try{
    if(!host.offer(key,target,observedAt))throw Error('Axis target rejected');
    const acceptedDeadline=performance.now()+1800;
    while(performance.now()<acceptedDeadline){
      const own=state?.constraints?.find(c=>c.actorId===transport.actorId&&c.spaceId===entity.spaceId&&c.entityId===entity.id);
      if(own?.target?.q?.length===target.q.length&&Math.abs(own.target.q[axis]-target.q[axis])<=epsilon)break;
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    const own=state?.constraints?.find(c=>c.actorId===transport.actorId&&c.spaceId===entity.spaceId&&c.entityId===entity.id);
    if(!(own?.target?.q?.length===target.q.length&&Math.abs(own.target.q[axis]-target.q[axis])<=epsilon))throw Error('Axis target was not accepted before release');
    const moveDeadline=performance.now()+2600,start=entity.q[axis];
    while(performance.now()<moveDeadline){
      const accepted=state?.snapshot.spaces[entity.spaceId]?.entities[entity.id];
      if(accepted&&Math.abs(accepted.q[axis]-start)>epsilon)break;
      await new Promise(resolve=>setTimeout(resolve,40));
    }
    const accepted=state?.snapshot.spaces[entity.spaceId]?.entities[entity.id];
    if(!(accepted&&Math.abs(accepted.q[axis]-start)>epsilon))throw Error('No material step moved the held axis target');
    await host.end(key,'axis-nudge');
  }catch(error){await host.cancel(key,'axis-nudge-failed').catch(()=>{});throw error;}
}
for(const [id,sign] of [['axisMinus',-1],['axisPlus',1]])$(id).onclick=safe(()=>axisMove(sign));
$('remoteMaterial').onclick=safe(async()=>{await transport.materialRun(!state.capabilities.material.running);});
$('remoteExport').onclick=safe(async()=>{await releaseAll();const data=await transport.export();const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}));const a=element('a',{href:u,download:'vivo-remote-accepted.json'});a.click();setTimeout(()=>URL.revokeObjectURL(u),5000);});
$('remoteForkOffline').onclick=safe(async()=>{await releaseAll();const receipt=await transport.forkOffline();if(receipt.status!=='accepted')throw Error(receipt.code);const branch=receipt.result,u=URL.createObjectURL(new Blob([JSON.stringify(branch,null,2)+'\n'],{type:'application/json'}));const a=element('a',{href:u,download:'vivo-remote-offline-'+branch.worldId.replace(/[^A-Za-z0-9_.-]/g,'_')+'.json'});a.click();setTimeout(()=>URL.revokeObjectURL(u),5000);say('Explicit offline branch created from accepted checkpoint '+branch.checkpointHash.slice(0,12)+'; shared history was not replayed.');});
$('remoteReconcile').onclick=safe(()=>inputs.reconcileAll());
$('makeInvite').onclick=safe(async()=>{if(role!=='owner')throw Error('Only owner creates invitations');const inv=await transport.createInvite(3600);const u=new URL(location.href);u.hash='token='+encodeURIComponent(inv.token);$('inviteLink').value=u.toString();say('One-hour editor invitation created. Token is shown once and stored only as a hash on the server.');});
$('copyInvite').onclick=safe(()=>navigator.clipboard.writeText($('inviteLink').value));$('revokeInvites').onclick=safe(async()=>{if(role!=='owner')throw Error('Owner only');const list=await transport.listInvites();for(const inv of list)if(!inv.revoked&&inv.actorId!==transport.actorId)await transport.revokeInvite(inv.id);say('Guest invitations revoked.');});
$('reconnect').onclick=safe(connect);$('leaveRoom').onclick=safe(disconnect);

const pointers=new Map();
$('overlay').addEventListener('pointerdown',safe(async event=>{if(!state||$('panel').open)return;const id=renderer.at(event.clientX,event.clientY);if(!id)return;const key='pointer:'+event.pointerId;event.currentTarget.setPointerCapture(event.pointerId);pointers.set(event.pointerId,key);await beginGesture(key,'touch',id,[event.clientX,event.clientY],eventTime(event));}));
$('overlay').addEventListener('pointermove',event=>{const key=pointers.get(event.pointerId);if(key)moveGesture(key,[event.clientX,event.clientY],eventTime(event));});
for(const type of ['pointerup','pointercancel'])$('overlay').addEventListener(type,event=>{const key=pointers.get(event.pointerId);if(!key)return;pointers.delete(event.pointerId);if(type==='pointerup')void endGesture(key,[event.clientX,event.clientY],eventTime(event)).catch(e=>say(e.code||e.message));else void inputs.cancel(key,'pointercancel').catch(e=>say(e.code||e.message));});

const TimedCamera=timestampedCameraClass(Camera);
const camera=normalizeCameraFacing(new TimedCamera($('cameraVideo'),text=>{$('cameraState').textContent=text;},event=>{
 if(event.type==='lost'){renderer.pointer=null;hand=null;void inputs?.cancel('hand','hand-source-lost').catch(()=>{});return;}
 if(event.type==='aim'){renderer.pointer=event.point;return;}if(!state||$('panel').open)return;
 if(event.type==='grab'){const id=renderer.at(...event.point);if(id){hand={epoch:event.epoch};void beginGesture('hand','hand',id,event.point,event.observedAt).catch(e=>say(e.code||e.message));}}
 if(event.type==='move'&&hand?.epoch===event.epoch)moveGesture('hand',event.point,event.observedAt);
 if(event.type==='release'){hand=null;void endGesture('hand',event.point,event.observedAt).catch(e=>say(e.code||e.message));}
},points=>renderer.hand=$('skeleton').checked?points:[]));
for(const[id,facing]of[['frontCamera','user'],['backCamera','environment']])$(id).onclick=safe(async()=>{$('panel').close();await camera.start(facing);updateUI();});
$('previewCamera').onclick=safe(async()=>{$('panel').close();await camera.start('environment',false);updateUI();});$('stopCamera').onclick=()=>{camera.stop();updateUI();};$('visibility').onchange=()=>{camera.profile=$('visibility').value;camera.sampleLuma();};$('torch').onclick=safe(()=>camera.light());$('exposure').onclick=safe(()=>camera.exposure());

function drawTarget(target,label,color){if(!state||target.spaceId!==state.eye.spaceId)return;const p=renderer.project(embed(target.q,{kind:'flat',dimension:target.dimension},target.chart));if(!p.visible)return;const ctx=renderer.ctx;ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.setLineDash([5,5]);ctx.beginPath();ctx.arc(p.x,p.y,20,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillText(label,p.x,p.y-27);ctx.restore();}
function draw(t){renderer.draw(t);for(const c of state?.constraints||[])drawTarget(c.target,'ACCEPTED '+(c.actorId===transport?.actorId?'YOU':'OTHER'),'#c8a7ed');for(const p of previews.values())drawTarget(p.frame,'PROVISIONAL','#edd395');requestAnimationFrame(draw);}requestAnimationFrame(draw);
fetch('/healthz').then(r=>r.json()).then(x=>{$('serviceReady').textContent=x.ok?'REMOTE AUTHORITY READY · camera stays local':'Remote authority not ready';$('createRoom').disabled=!x.ok;}).catch(e=>{$('serviceReady').textContent=e.message;});
