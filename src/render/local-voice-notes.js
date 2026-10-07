import {createVoiceRecorder,claimVoiceActivity,watchVoiceOwnerVisibility} from './voice-session.js?v=20261005-voice';
import {createPlainVoice,encryptVoice,decryptVoice,plainVoiceBlob,parseVoiceEnvelope,normalizeVoiceAttachment,serializeVoiceAttachment} from '../domains/voice-message.js';

const STORAGE='matumbo.voice-notes.v1';
const MAX_NOTES=8;

export function readLocalVoiceNotes(storage) {
  const raw=storage.getItem(STORAGE);
  if(!raw)return [];
  if(raw.length>4200000)throw Error('The local voice archive is too large. Export or clear it in browser storage.');
  const entries=JSON.parse(raw);
  if(!Array.isArray(entries)||entries.length>MAX_NOTES)throw Error('The local voice archive is invalid.');
  return entries.map(item=>({id:String(item.id).slice(0,100),createdAt:String(item.createdAt).slice(0,40),attachment:normalizeVoiceAttachment(item.attachment)}));
}

export function saveLocalVoiceNotes(storage, notes, expectedValue=undefined) {
  if(notes.length>MAX_NOTES)throw Error('Keep at most eight local voice messages. Export and delete an older message first.');
  const safe=notes.map(item=>({id:String(item.id).slice(0,100),createdAt:String(item.createdAt).slice(0,40),attachment:normalizeVoiceAttachment(item.attachment)}));
  if(expectedValue!==undefined&&storage.getItem(STORAGE)!==expectedValue)throw Error('The voice archive changed in another tab. Reload archive before saving, importing or deleting. Your unsaved take and unlock code are retained.');
  storage.setItem(STORAGE,JSON.stringify(safe));
  return safe;
}

/** Share only the serialized envelope. The unlock code is never an input. */
export async function shareEncryptedVoiceEnvelope({attachment,windowRoot=globalThis,download=()=>{},onStatus=()=>{}}={}){
  const name='matumbo-voice-envelope.json',nav=windowRoot.navigator;
  const file=typeof windowRoot.File==='function'?new windowRoot.File([serializeVoiceAttachment(attachment)],name,{type:'application/json'}):null;
  if(file&&typeof nav?.share==='function'&&typeof nav?.canShare==='function'&&nav.canShare({files:[file]})){
    try{await nav.share({title:'maTumbo voice envelope',text:'This file contains encrypted audio only. Send the unlock code separately through a trusted channel.',files:[file]});onStatus('shared');return 'shared';}
    catch(error){if(error?.name==='AbortError'){onStatus('cancelled');return 'cancelled';}}
  }
  await download(attachment);onStatus('downloaded');return 'downloaded';
}

/** Browser-local audio notebook. Keys and decrypted audio never enter storage. */
export function mountLocalVoiceNotes({documentRoot:doc=document,windowRoot:view=window,getContext=()=>view.location.href,recorderFactory=createVoiceRecorder}={}) {
  const panel=doc.createElement('aside');panel.id='reality-voice-notes';panel.hidden=true;
  panel.className='reality-lens-feature-panel';panel.dataset.lensSurfaceAttached='true';
  panel.setAttribute('aria-label','Voice messages');panel.setAttribute('data-voice-exclude','');
  panel.innerHTML=`<header><h2>Voice messages</h2><button type="button" data-close aria-label="Close voice messages">×</button></header>
    <p>Encrypted by default; messages stay in this browser until you export. Share the unlock code separately; nothing is delivered to recipients.</p>
    <p>Up to 60 sec / 384 KB. Browser dictation may send audio online. Dates, format and length stay readable.</p>
    <label>Audio protection<select data-mode><option value="plain">Readable audio</option><option value="encrypted" selected>Encrypt audio with a separate unlock code</option></select></label>
    <div><button type="button" data-record>Record voice</button><button type="button" data-stop>Stop recording</button><button type="button" data-discard>Discard take</button></div>
    <p role="status" aria-live="polite" data-status>Microphone starts only when you choose Record voice.</p>
    <audio data-audio controls preload="none" hidden></audio>
    <div><button type="button" data-preview>Preview take</button><button type="button" data-prepare>Encrypt & show unlock code</button><button type="button" data-save>Save voice message</button></div>
    <section data-keybox hidden><label>Keep this code separately<input data-key readonly autocomplete="off" aria-label="Generated audio unlock code"></label><p>Losing the code makes the encrypted audio unrecoverable. It is excluded from saved messages and exports.</p><label><input type="checkbox" data-kept> I saved the unlock code separately</label></section>
    <details data-archive><summary>Saved messages</summary><label>Import an encrypted voice message<input type="file" data-import accept="application/json,.json"></label><button type="button" data-reload>Reload messages</button><p data-count></p><div data-list></div></details>`;
  const style=doc.createElement('link');style.rel='stylesheet';style.href=new URL('./local-voice-notes.css?v=20261007-voice-message-compact-archive',import.meta.url).href;doc.head.append(style);doc.body.append(panel);
  const q=s=>panel.querySelector(s),audio=q('[data-audio]'),status=q('[data-status]');q('[data-mode]').value='encrypted';
  let disposed=false,context=getContext(),revision=0,playRevision=0,take=null,prepared=null,notes=[],archiveSnapshot=null,url='',release=null,busy=false,recordingState={};
  const events=[];
  // A local row identifier is not a key, proof, identity or authorization token.
  const newId=()=>view.crypto?.randomUUID?.()??`voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const listen=(el,name,fn)=>{el.addEventListener(name,fn);events.push(()=>el.removeEventListener(name,fn));};
  const report=error=>{if(!disposed)status.textContent=error?.message||String(error);};
  const current=ticket=>!disposed&&ticket===revision&&!panel.hidden&&context===getContext();
  const recorder=recorderFactory({windowRoot:view,onState:s=>{
    recordingState=s;if(disposed)return;
    if(s.error)report(s.errorMessage||s.error);
    else if(s.active)status.textContent=s.status==='requesting'?'Waiting for microphone permission…':'Recording locally. Choose Stop to review.';
    else if(s.status==='stopped'&&s.bytes&&['time-limit','byte-limit'].includes(s.reason))void finishTake();
    render();
  }});
  recordingState=recorder.getSnapshot();
  function stopAudio(){playRevision++;audio.pause();audio.removeAttribute('src');audio.load();audio.hidden=true;release?.();release=null;if(url)view.URL.revokeObjectURL(url);url='';}
  function clearSecret(){prepared=null;q('[data-key]').value='';q('[data-kept]').checked=false;q('[data-keybox]').hidden=true;panel.querySelectorAll('[data-unlock]').forEach(field=>{field.value='';});}
  function cancel(){revision++;recorder.cancel();stopAudio();take=null;clearSecret();busy=false;render();}
  function close(){if(disposed)return;cancel();panel.hidden=true;}
  function render(){
    if(disposed)return;
    const active=Boolean(recordingState.active);
    q('[data-record]').disabled=active||busy||!recordingState.supported;
    q('[data-stop]').disabled=!active;q('[data-mode]').disabled=active||busy;
    q('[data-preview]').disabled=!take||active||busy;
    q('[data-prepare]').disabled=!take||active||busy||q('[data-mode]').value!=='encrypted';
    q('[data-save]').disabled=active||busy||(!take&&!prepared)||(q('[data-mode]').value==='encrypted'&&(!prepared||!q('[data-kept]').checked));
    q('[data-import]').disabled=active||busy;
    q('[data-reload]').disabled=active||busy;
  }
  async function finishTake(){
    const ticket=revision,clip=await recorder.stop();
    if(!current(ticket))return;
    if(clip){take=clip;clearSecret();status.textContent='Take ready. Preview it, then explicitly save or encrypt it.';}
    render();
  }
  async function play(blob){
    stopAudio();const ticket=revision,playTicket=playRevision;
    if(!current(ticket))return false;
    release=claimVoiceActivity(audio,stopAudio,view);url=view.URL.createObjectURL(blob);const ownUrl=url;audio.src=url;audio.hidden=false;
    try{await audio.play();if(playRevision!==playTicket||!current(ticket)||url!==ownUrl){if(url===ownUrl)stopAudio();return false;}return true;}
    catch(error){const stale=playRevision!==playTicket||!current(ticket)||url!==ownUrl;if(url===ownUrl)stopAudio();if(stale)return false;throw error;}
  }
  function persist(next){notes=saveLocalVoiceNotes(view.localStorage,next,archiveSnapshot);archiveSnapshot=JSON.stringify(notes);drawNotes();}
  function reload(){const raw=view.localStorage.getItem(STORAGE);const next=readLocalVoiceNotes({getItem:()=>raw});notes=next;archiveSnapshot=raw;drawNotes();}
  function download(attachment){
    const link=doc.createElement('a'),href=view.URL.createObjectURL(new view.Blob([serializeVoiceAttachment(attachment)],{type:'application/json'}));
    link.href=href;link.download='matumbo-voice-envelope.json';link.click();view.setTimeout(()=>view.URL.revokeObjectURL(href),1000);
  }
  async function exportEnvelope(attachment){
    try{const result=await shareEncryptedVoiceEnvelope({attachment,windowRoot:view,download,onStatus:outcome=>{if(disposed)return;status.textContent=outcome==='shared'?'Encrypted envelope shared. The unlock code was not included.':outcome==='cancelled'?'Sharing canceled. Your note is still saved here.':'Encrypted envelope downloaded. Transfer it and send the unlock code separately.';}});return result;}
    catch(error){report(error);}
  }
  function drawNotes(){
    q('[data-count]').textContent=`${notes.length} of ${MAX_NOTES} browser-local messages`;
    const list=q('[data-list]');list.replaceChildren();
    for(const item of notes){
      const row=doc.createElement('section'),label=doc.createElement('p');
      label.textContent=`${item.attachment.mode==='encrypted'?'Encrypted audio':'Readable audio'} · ${new Date(item.createdAt).toLocaleString()} · ${(item.attachment.durationMs/1000).toFixed(1)} seconds`;
      row.append(label);
      const code=doc.createElement('input');code.type='password';code.autocomplete='off';code.maxLength=43;code.setAttribute('data-unlock','');code.setAttribute('aria-label','43-character audio unlock code');
      if(item.attachment.mode==='encrypted')row.append(code);
      const button=(text,fn)=>{const el=doc.createElement('button');el.type='button';el.textContent=text;el.addEventListener('click',fn);row.append(el);};
      button(item.attachment.mode==='encrypted'?'Unlock & play':'Play message',async()=>{
        const ticket=++revision;stopAudio();busy=true;render();
        try{const blob=item.attachment.mode==='encrypted'?await decryptVoice(item.attachment,code.value,{cryptoRoot:view.crypto}):plainVoiceBlob(item.attachment);
          code.value='';if(!current(ticket))return;const playing=await play(blob);if(playing&&current(ticket))status.textContent='Playing audio locally. Lock / stop releases its playback copy.';
        }catch(error){report(error);}finally{if(ticket===revision){busy=false;render();}}
      });
      button('Lock / stop',()=>{revision++;code.value='';stopAudio();busy=false;render();});
      button('Export / share envelope',()=>void exportEnvelope(item.attachment));
      button('Delete voice message',()=>{try{persist(notes.filter(note=>note.id!==item.id));revision++;stopAudio();busy=false;render();status.textContent='Voice message deleted. Any unsaved take is retained.';}catch(error){report(error);}});
      list.append(row);
    }
  }
  listen(q('[data-close]'),'click',close);
  listen(q('[data-reload]'),'click',()=>{try{reload();status.textContent='Archive reloaded. Any unsaved take and unlock code are retained.';render();}catch(error){report(error);}});
  listen(q('[data-record]'),'click',()=>{cancel();context=getContext();void recorder.start();});
  listen(q('[data-stop]'),'click',()=>void finishTake());
  listen(q('[data-discard]'),'click',()=>{cancel();status.textContent='Take discarded.';});
  listen(q('[data-mode]'),'change',()=>{clearSecret();render();});
  listen(q('[data-kept]'),'change',render);
  listen(q('[data-preview]'),'click',()=>{if(take)void play(take.blob).catch(report);});
  listen(q('[data-prepare]'),'click',async()=>{
    if(!take||busy)return;const ticket=++revision;busy=true;stopAudio();render();
    try{const result=await encryptVoice(take,{cryptoRoot:view.crypto});if(!current(ticket))return;
      prepared=result.attachment;take=null;q('[data-key]').value=result.unlockCode;q('[data-keybox]').hidden=false;status.textContent='Audio encrypted. Save the code separately, acknowledge it, then save the local note.';
    }catch(error){report(error);}finally{if(ticket===revision){busy=false;render();}}
  });
  listen(q('[data-save]'),'click',async()=>{
    if(busy)return;const ticket=++revision;busy=true;render();
    try{const attachment=q('[data-mode]').value==='encrypted'?prepared:take?await createPlainVoice(take):null;
      if(!current(ticket))return;
      if(!attachment||(attachment.mode==='encrypted'&&!q('[data-kept]').checked))throw Error('Prepare the audio and save its separate code first.');
      persist([...notes,{id:newId(),createdAt:new Date().toISOString(),attachment}]);cancel();status.textContent='Voice message saved in this browser only. Export explicitly to transfer the envelope.';
    }catch(error){report(error);}finally{if(ticket===revision){busy=false;render();}}
  });
  listen(q('[data-import]'),'change',async event=>{
    const file=event.target.files?.[0],ticket=++revision;event.target.value='';if(!file)return;
    try{if(file.size>514000)throw Error('Choose an envelope smaller than 514 KB.');const attachment=parseVoiceEnvelope(await file.text());
      if(!current(ticket))return;persist([...notes,{id:newId(),createdAt:new Date().toISOString(),attachment}]);status.textContent='Voice message imported locally. Playback requires a separate explicit action.';
    }catch(error){report(error);}
  });
  listen(audio,'ended',()=>{release?.();release=null;});
  listen(audio,'play',()=>{if(disposed||panel.hidden||context!==getContext()){stopAudio();return;}release?.();release=claimVoiceActivity(audio,stopAudio,view);});
  listen(doc,'visibilitychange',()=>{if(doc.hidden)close();});listen(view,'pagehide',close);
  listen(panel,'keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
  const unwatch=watchVoiceOwnerVisibility({element:panel,windowRoot:view,onHidden:cancel});
  const timer=view.setInterval(()=>{if(!panel.hidden&&context!==getContext()){close();context=getContext();}},250);
  return {open(){if(disposed)return;panel.className='reality-lens-feature-panel';panel.dataset.lensSurfaceAttached='true';context=getContext();panel.hidden=false;
    try{reload();status.textContent=recordingState.supported?'Choose Record voice to begin.':'Recording is unavailable. You can import, unlock and play supported audio envelopes.';}catch(error){report(error);}render();q('[data-close]').focus();},close,
    destroy(){if(disposed)return;close();disposed=true;recorder.destroy();unwatch();view.clearInterval(timer);events.forEach(remove=>remove());panel.remove();style.remove();}};
}
