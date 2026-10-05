import {createSpeechInput} from './voice-session.js?v=20261005-voice';
import {captureVoiceTarget,isVoiceEditable,insertVoiceTranscript,voiceTargetLabel} from './voice-text-target.js';

const LANGUAGES=[['en-US','English (US)'],['en-GB','English (UK)'],['es-ES','Español'],['fr-FR','Français'],['pt-BR','Português'],['de-DE','Deutsch'],['it-IT','Italiano'],['sw-KE','Kiswahili'],['ar-SA','العربية'],['hi-IN','हिन्दी'],['zh-CN','中文'],['ja-JP','日本語']];
/** App-wide progressive enhancement of existing editable controls. */
export function mountVoiceDictation({documentRoot=globalThis.document,windowRoot=globalThis.window,onOpen=()=>{},onNavigate=()=>{},onSearch=null,getContext=()=>windowRoot.location?.href??'',speechFactory=createSpeechInput}={}){
  const doc=documentRoot,view=windowRoot;
  if(!doc?.body)return {destroy(){},open(){},close(){},getSnapshot:()=>({available:false})};
  let disposed=false,opened=false,target=null,context=null,lastField=null,lastFieldContext=null,speechState={status:'idle',supported:false},inserted=false,takePrefix='';
  const events=[],create=(tag,text)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  const style=create('link');style.rel='stylesheet';style.href=new URL('./voice-dictation.css',import.meta.url).href;doc.head.append(style);
  const trigger=create('button','◉ Voice');trigger.id='voice-dictation-trigger';trigger.type='button';trigger.setAttribute('aria-controls','voice-dictation-panel');trigger.setAttribute('aria-expanded','false');trigger.title='Dictate into a text field · Alt + Shift + V';
  const panel=create('aside');panel.id='voice-dictation-panel';panel.hidden=true;panel.dataset.controllerOwned='voice';panel.setAttribute('aria-label','Voice writing');panel.setAttribute('data-voice-exclude','');
  panel.innerHTML=`<header><div><small>Words, your way</small><h2>Speak to write</h2></div><button type="button" data-vd-close aria-label="Close voice writing">×</button></header>
    <p class="vd-intro">Choose a text field, speak, then review your words.</p>
    <label>Write into<select data-vd-target aria-label="Dictation destination"></select></label>
    <p data-vd-format class="vd-note" hidden></p>
    <label>Language<select data-vd-language aria-label="Spoken language"></select></label>
    <p class="vd-disclosure">Your browser’s speech service may process microphone audio online. Language support depends on your browser. Recording voice messages is a separate local action.</p>
    <div class="vd-actions"><button type="button" data-vd-start>Start dictation</button><button type="button" data-vd-stop>Stop listening</button></div>
    <p data-vd-status role="status" aria-live="polite">Choose a text field to begin.</p><p data-vd-interim aria-hidden="true"></p>
    <label>Review transcript<textarea data-vd-draft rows="4" maxlength="8000" aria-label="Review dictated words" placeholder="Your words appear here. You can edit before inserting."></textarea></label>
    <div class="vd-actions"><button type="button" data-vd-insert>Insert into field</button><button type="button" data-vd-search>Search app</button><button type="button" data-vd-copy>Copy words</button><button type="button" data-vd-clear>Clear transcript</button></div>
    <p class="vd-note">Insertion keeps the original field’s controls. Search and Send remain your choice. Passwords and secret fields are excluded. For a website embedded inside the app, copy your words and paste them there.</p>
    <footer><button type="button" data-vd-rooms>Voice messages</button><button type="button" data-vd-gpt>Voice conversation</button></footer>`;
  doc.body.append(trigger,panel);
  const q=s=>panel.querySelector(s),draft=q('[data-vd-draft]'),status=q('[data-vd-status]'),destination=q('[data-vd-target]'),language=q('[data-vd-language]');
  q('[data-vd-search]').hidden=typeof onSearch!=='function';
  for(const [value,label] of LANGUAGES){const option=create('option',label);option.value=value;language.append(option);}
  const preferred=String(view.navigator?.language??'en-US');if(LANGUAGES.some(([value])=>value===preferred))language.value=preferred;
  const speech=speechFactory({windowRoot:view,language:language.value||'en-US',onUpdate:s=>{if(disposed)return;draft.value=[takePrefix,s.transcript??''].filter(Boolean).join(' ').slice(0,8000);q('[data-vd-interim]').textContent=s.interim??'';inserted=false;render();},onState:s=>{speechState=s;if(!disposed)render();}});
  speechState=speech.getSnapshot();
  function active(){return speechState.active??['starting','listening','stopping'].includes(speechState.status);}
  function render(){
    if(disposed)return;trigger.dataset.listening=String(active());trigger.textContent=active()?'◉ Listening…':'◉ Voice';
    q('[data-vd-start]').disabled=active()||!speechState.supported;
    q('[data-vd-stop]').disabled=!active();language.disabled=active();destination.disabled=active();
    q('[data-vd-insert]').disabled=active()||!target||!draft.value.trim()||inserted;
    q('[data-vd-copy]').disabled=active()||!draft.value.trim();
    q('[data-vd-search]').disabled=active()||!draft.value.trim();
    draft.readOnly=active();
    q('[data-vd-format]').textContent=target?.formatHint??'';q('[data-vd-format]').hidden=!target?.formatHint;
    if(speechState.error)status.textContent=speechState.errorMessage||`Dictation stopped: ${speechState.error}. You can still type.`;
    else if(!speechState.supported)status.textContent='Speech recognition is unavailable in this browser. Type here or use your device keyboard’s microphone. Local voice messages may still be available.';
    else if(active())status.textContent='Listening. Stop when you are ready to review.';
  }
  function currentField(el){return isVoiceEditable(el)&&!el.closest?.('#voice-dictation-panel,[hidden],[aria-hidden="true"]')&&Boolean(el.getClientRects?.().length)&&view.getComputedStyle?.(el)?.visibility!=='hidden';}
  function candidateFields(){return [...doc.querySelectorAll('input,textarea,[contenteditable="true"],[contenteditable="plaintext-only"]')].filter(currentField);}
  let fields=[];
  function choices(){
    fields=candidateFields();destination.replaceChildren();
    const empty=create('option','Transcript only — choose a field first');empty.value='';destination.append(empty);
    fields.forEach((field,index)=>{const option=create('option',voiceTargetLabel(field));option.value=String(index);destination.append(option);});
    const index=fields.indexOf(target?.element);destination.value=index<0?'':String(index);if(index<0)target=null;
  }
  function choose(field){target=currentField(field)?captureVoiceTarget(field):null;context=getContext();inserted=false;status.textContent=target?`Ready to write into ${target.label}.`:'Select a search box or text field, then open Voice. You can also dictate a transcript here.';render();}
  function open(field=lastFieldContext===getContext()?lastField:null){if(disposed)return;if(opened){close();return;}onOpen();choose(field);opened=true;panel.hidden=false;trigger.setAttribute('aria-expanded','true');choices();q('[data-vd-start]').focus();render();}
  function close({restoreFocus=true}={}){if(disposed)return;speech.abort();opened=false;panel.hidden=true;trigger.setAttribute('aria-expanded','false');if(restoreFocus)(isVoiceEditable(target?.element)?target.element:trigger).focus?.({preventScroll:true});}
  function listen(el,type,fn,options){el.addEventListener(type,fn,options);events.push(()=>el.removeEventListener(type,fn,options));}
  listen(trigger,'pointerdown',()=>{if(isVoiceEditable(doc.activeElement)){lastField=doc.activeElement;lastFieldContext=getContext();}});
  listen(trigger,'click',()=>open());listen(q('[data-vd-close]'),'click',()=>close());
  listen(destination,'change',()=>choose(fields[Number(destination.value)]&&destination.value!==''?fields[Number(destination.value)]:null));
  listen(q('[data-vd-start]'),'click',()=>{inserted=false;takePrefix=draft.value.trim();speech.start({language:language.value});});
  listen(q('[data-vd-stop]'),'click',()=>speech.stop());
  listen(q('[data-vd-clear]'),'click',()=>{speech.abort();draft.value='';q('[data-vd-interim]').textContent='';inserted=false;status.textContent='Transcript cleared.';render();});
  listen(q('[data-vd-copy]'),'click',async()=>{
    try{if(!view.navigator?.clipboard?.writeText)throw Error('clipboard unavailable');await view.navigator.clipboard.writeText(draft.value);if(!disposed)status.textContent='Words copied. Paste them into the destination you choose.';}
    catch{if(!disposed){status.textContent='Automatic copy is unavailable. Select the transcript and copy it with your device controls.';draft.focus();draft.select();}}
  });
  listen(draft,'input',()=>{inserted=false;render();});
  listen(q('[data-vd-search]'),'click',()=>{
    if(active()||!draft.value.trim()||typeof onSearch!=='function')return;
    try{onSearch(draft.value.trim());close({restoreFocus:false});}
    catch(error){status.textContent=String(error.message||'Search is unavailable. Your words are retained.');}
  });
  listen(q('[data-vd-insert]'),'click',()=>{
    try{if(context!==getContext()||!currentField(target?.element))throw Error('The destination changed or closed. Choose the destination again.');const result=insertVoiceTranscript(target,draft.value);inserted=true;status.textContent=`Inserted into ${result.label}. Use its original Search or Send when ready.`;render();close();}
    catch(error){status.textContent=String(error.message);}
  });
  listen(q('[data-vd-rooms]'),'click',()=>{close({restoreFocus:false});onNavigate('rooms');});
  listen(q('[data-vd-gpt]'),'click',()=>{close({restoreFocus:false});onNavigate('web-ai');});
  listen(doc,'focusin',event=>{if(isVoiceEditable(event.target)&&!event.target.closest?.('#voice-dictation-panel')){lastField=event.target;lastFieldContext=getContext();}},true);
  listen(doc,'keydown',event=>{if(event.altKey&&event.shiftKey&&event.code==='KeyV'){event.preventDefault();event.stopImmediatePropagation();open();}else if(opened&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}},true);
  listen(doc,'visibilitychange',()=>{if(doc.hidden)speech.abort();});listen(view,'pagehide',()=>close({restoreFocus:false}));
  const timer=view.setInterval(()=>{if(opened&&context!==getContext()){speech.abort();target=null;context=getContext();choices();status.textContent='The active space changed. Choose a destination for your transcript.';render();}},250);
  render();
  return {open,close,getSnapshot:()=>({available:true,opened,targetLabel:target?.label??null,speech:speech.getSnapshot(),draftLength:draft.value.length,inserted}),destroy(){if(disposed)return;close({restoreFocus:false});disposed=true;speech.destroy();view.clearInterval(timer);events.forEach(remove=>remove());trigger.remove();panel.remove();style.remove();}};
}
