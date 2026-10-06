import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {element,UiEvent} from './dom-adapter.mjs';
import {mountLocalVoiceNotes,readLocalVoiceNotes} from '../src/render/local-voice-notes.js';

test('Reality Lens routes its Speak to write voice shortcut into the encrypted message notebook', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /mountLocalVoiceNotes\(/);
  assert.match(source, /textContent='Voice messages'/);
  assert.match(source, /id==='rooms'\|\|id==='voice-messages'\)\{featureNavigator\.close\(\);localVoiceNotes\.open\(\);return;\}/);
});

function setup(t,{storage}={}){
  const doc=element('document');doc.ownerDocument=doc;
  doc.head=element('head',doc);doc.body=element('body',doc);doc.append(doc.head,doc.body);
  doc.createElement=tag=>{const el=element(tag,doc);if(tag==='audio'){el.pause=()=>{el.pauses=(el.pauses??0)+1;};el.load=()=>{};el.play=async()=>{el.plays=(el.plays??0)+1;await el.fire('play');};}return el;};
  const win=element('window',doc);win.document=doc;doc.defaultView=win;win.Event=win.CustomEvent=UiEvent;
  win.location={href:'http://localhost/#arena'};win.crypto=webcrypto;win.Blob=Blob;
  const values=new Map(),intervals=new Map(),revoked=[];let owner='account:a',serial=0;
  win.localStorage=storage??{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  win.URL={createObjectURL:()=>`blob:local-${++serial}`,revokeObjectURL:url=>revoked.push(url)};
  win.setTimeout=setTimeout;win.clearTimeout=clearTimeout;
  win.setInterval=fn=>{const id=++serial;intervals.set(id,fn);return id;};win.clearInterval=id=>intervals.delete(id);
  let state={status:'idle',active:false,supported:true},callbacks;
  const capture={starts:0,cancels:0,destroyed:0,clip:{blob:new Blob(['voice bytes'],{type:'audio/webm'}),mimeType:'audio/webm',durationMs:1200}};
  const recorderFactory=options=>{callbacks=options;return {getSnapshot:()=>state,
    start(){capture.starts++;state={...state,active:true,status:'recording'};callbacks.onState(state);return Promise.resolve(true);},
    stop(){state={...state,active:false,status:'stopped'};callbacks.onState(state);return Promise.resolve(capture.clip);},
    cancel(){capture.cancels++;state={...state,active:false,status:'stopped'};callbacks.onState(state);},destroy(){capture.destroyed++;}};};
  const api=mountLocalVoiceNotes({documentRoot:doc,windowRoot:win,getContext:()=>owner,recorderFactory});
  const audio=doc.querySelector('[data-audio]');audio.pause=()=>{audio.pauses=(audio.pauses??0)+1;};audio.load=()=>{};audio.play=async()=>{audio.plays=(audio.plays??0)+1;await audio.fire('play');};
  t.after(()=>api.destroy());
  const q=name=>{const found=doc.querySelector(`[data-${name}]`);assert.ok(found,`Missing ${name}`);return found;};
  return {doc,win,api,q,capture,values,revoked,intervals,setOwner:value=>{owner=value;},tick(){for(const fn of intervals.values())fn();}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function take(c){await c.q('record').click();await c.q('stop').click();await flush();}

test('mounted local notes require explicit record, preview and save without opening microphone on mount',async t=>{
  const c=setup(t);assert.equal(c.capture.starts,0);c.api.open();assert.equal(c.capture.starts,0);
  assert.equal(c.q('save').disabled,true);await take(c);assert.equal(c.capture.starts,1);
  assert.equal(c.values.size,0);assert.equal(c.q('audio').plays,undefined);
  await c.q('preview').click();await flush();assert.equal(c.q('audio').plays,1);
  await c.q('save').click();assert.equal(readLocalVoiceNotes(c.win.localStorage).length,1);
  assert.equal(c.q('save').disabled,true);assert.ok(c.revoked.length);assert.match(c.q('status').textContent,/browser only/);
});

test('mounted encryption requires separate code acknowledgment and drops codes on close and persisted records',async t=>{
  const c=setup(t);c.api.open();c.q('mode').value='encrypted';await c.q('mode').fire('change');await take(c);
  assert.equal(c.q('save').disabled,true);await c.q('prepare').click();const code=c.q('key').value;
  assert.equal(code.length,43);assert.equal(c.values.size,0);assert.equal(c.q('save').disabled,true);
  c.q('kept').checked=true;await c.q('kept').fire('change');assert.equal(c.q('save').disabled,false);
  await c.q('save').click();const saved=[...c.values.values()][0];assert.equal(saved.includes(code),false);assert.equal(saved.includes('voice bytes'),false);
  assert.equal(readLocalVoiceNotes(c.win.localStorage)[0].attachment.mode,'encrypted');assert.equal(c.q('key').value,'');
  c.q('unlock').value=code;c.api.close();assert.equal(c.q('unlock').value,'');
});

test('owner changes during asynchronous import cannot save into the new context and cleanup removes capture and playback',async t=>{
  const c=setup(t);c.api.open();let resolveText;
  const waiting=new Promise(resolve=>{resolveText=resolve;});
  c.q('import').files=[{size:10,text:()=>waiting}];const pending=c.q('import').fire('change');
  c.setOwner('account:b');c.tick();resolveText('{}');await pending;
  assert.equal(c.values.size,0);
  assert.equal(c.doc.querySelector('#reality-voice-notes').hidden,true);
  c.api.open();await take(c);await c.q('preview').click();await flush();c.api.destroy();
  assert.equal(c.capture.destroyed,1);assert.equal(c.intervals.size,0);assert.ok(c.revoked.length);
  assert.equal(c.doc.querySelector('#reality-voice-notes'),null);
});

test('storage quota failure preserves the reviewed recording for retry',async t=>{
  const c=setup(t);c.api.open();await take(c);const original=c.win.localStorage.setItem;
  c.win.localStorage.setItem=()=>{throw Error('quota unavailable');};await c.q('save').click();
  assert.match(c.q('status').textContent,/quota unavailable/);assert.equal(c.q('save').disabled,false);assert.equal(c.q('preview').disabled,false);
  c.win.localStorage.setItem=original;await c.q('save').click();assert.equal(readLocalVoiceNotes(c.win.localStorage).length,1);
});

test('two mounted hosts detect archive conflicts and reload without discarding an encrypted take or key',async t=>{
  const first=setup(t),second=setup(t,{storage:first.win.localStorage});first.api.open();second.api.open();
  second.q('mode').value='encrypted';await second.q('mode').fire('change');await take(second);await second.q('prepare').click();
  const code=second.q('key').value;second.q('kept').checked=true;await second.q('kept').fire('change');
  await take(first);await first.q('save').click();await second.q('save').click();
  assert.match(second.q('status').textContent,/changed in another tab/);assert.equal(readLocalVoiceNotes(first.win.localStorage).length,1);
  assert.equal(second.q('key').value,code);assert.equal(second.q('save').disabled,false);
  await second.q('reload').click();assert.equal(second.q('key').value,code);assert.equal(second.q('kept').checked,true);
  await second.q('save').click();assert.equal(readLocalVoiceNotes(first.win.localStorage).length,2);
  const deleteButton=first.q('list').querySelectorAll('button').find(button=>button.textContent==='Delete local note');
  await deleteButton.click();assert.match(first.q('status').textContent,/changed in another tab/);assert.equal(readLocalVoiceNotes(first.win.localStorage).length,2);
  await first.q('reload').click();await take(first);
  await first.q('list').querySelectorAll('button').find(button=>button.textContent==='Delete local note').click();
  assert.equal(first.q('save').disabled,false);await first.q('save').click();assert.equal(readLocalVoiceNotes(first.win.localStorage).length,2);
});

test('a pending playback cannot revive a closed owner or announce playback after an account changes',async t=>{
  const c=setup(t);c.api.open();await take(c);await c.q('save').click();
  let settle;c.q('audio').play=()=>new Promise(resolve=>{settle=resolve;});
  const playButton=c.q('list').querySelectorAll('button').find(button=>button.textContent==='Play note');
  const pending=playButton.click();await flush();const before=c.q('status').textContent;
  c.api.close();settle();await pending;
  assert.equal(c.q('audio').hidden,true);assert.equal(c.q('audio').src,'');assert.equal(c.q('status').textContent,before);
  c.api.open();const changed=c.q('list').querySelectorAll('button').find(button=>button.textContent==='Play note').click();await flush();
  c.setOwner('account:other');settle();await changed;
  assert.equal(c.q('audio').hidden,true);assert.doesNotMatch(c.q('status').textContent,/Playing audio locally/);
});
