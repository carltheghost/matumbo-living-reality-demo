import test from 'node:test';
import assert from 'node:assert/strict';
import {isVoiceEditable,captureVoiceTarget,insertVoiceTranscript} from '../src/render/voice-text-target.js';

function field(extra={}){
  const events=[],listeners=new Map();
  class InputEvent extends Event {constructor(name,options){super(name,options);this.data=options?.data;this.inputType=options?.inputType;}}
  class CustomEvent extends Event {constructor(name,options){super(name,options);this.detail=options?.detail;}}
  const item={tagName:'INPUT',type:'search',isConnected:true,value:'find old words',selectionStart:5,selectionEnd:8,maxLength:-1,
    ownerDocument:{defaultView:{Event,InputEvent,CustomEvent}},attributes:{'aria-label':'Search things'},
    getAttribute(name){return this.attributes[name]??null;},closest(){return null;},
    setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);},
    dispatchEvent(event){events.push(event);listeners.get(event.type)?.(event);return !event.defaultPrevented;},...extra};
  return {item,events,on:(name,fn)=>listeners.set(name,fn)};
}
test('dictation replaces only the captured selection in the original field and never submits',()=>{
  const {item,events}=field();const result=insertVoiceTranscript(captureVoiceTarget(item),'new');
  assert.equal(item.value,'find new words');assert.equal(result.label,'Search things');
  assert.deepEqual(events.map(event=>event.type),['beforeinput','input','change','matumbo:voice-input']);
  assert.equal(events.at(-1).detail.final,true);assert.equal(events[1].inputType,'insertFromDictation');
});
test('typing after capture is preserved instead of overwritten by a late transcript',()=>{
  const {item}=field();const captured=captureVoiceTarget(item);item.value='my newer writing';
  assert.throws(()=>insertVoiceTranscript(captured,'spoken'),/field changed/);assert.equal(item.value,'my newer writing');
});
test('the original control can decline dictation with beforeinput',()=>{
  const {item,on,events}=field();on('beforeinput',event=>event.preventDefault());
  assert.throws(()=>insertVoiceTranscript(captureVoiceTarget(item),'spoken'),/declined/);
  assert.equal(item.value,'find old words');assert.equal(events.length,1);
});
test('reentrant edits and permission changes during beforeinput are preserved',()=>{
  for(const change of [item=>item.value='new owner value',item=>item.readOnly=true]){
    const {item,on,events}=field();on('beforeinput',()=>change(item));
    assert.throws(()=>insertVoiceTranscript(captureVoiceTarget(item),'spoken'),/preserved/);
    assert.equal(events.length,1);
  }
});

test('a limit lowered during beforeinput is rechecked before writing the transcript',()=>{
  const {item,on,events}=field({maxLength:20});
  on('beforeinput',()=>{item.maxLength=3;});
  assert.throws(()=>insertVoiceTranscript(captureVoiceTarget(item),'123456'),/allows 3 characters/);
  assert.equal(item.value,'find old words');assert.equal(events.length,1);
});
test('secret, disabled, detached and unsupported fields are excluded',()=>{
  for(const extra of [{type:'password'},{type:'range'},{type:'color'},{type:'file'},{type:'checkbox'},{disabled:true},{readOnly:true},{isConnected:false},{matches:()=>true},
    {name:'api_key'},{id:'unlock-code'},{attributes:{autocomplete:'one-time-code'}},{attributes:{autocomplete:'cc-number'}},
    {attributes:{'aria-label':'Access token'}},{labels:[{textContent:'API key'}]},{attributes:{placeholder:'Your secret'}},{closest:()=>({})}]){
    const {item}=field(extra);assert.equal(isVoiceEditable(item),false,JSON.stringify(extra));assert.equal(captureVoiceTarget(item),null);
  }
});
test('field limits and empty or oversized transcripts reject without mutation',()=>{
  for(const [extra,text] of [[{maxLength:14},'many spoken words'],[{},' '],[{},'x'.repeat(8001)]]){
    const {item,events}=field(extra);assert.throws(()=>insertVoiceTranscript(captureVoiceTarget(item),text));assert.equal(item.value,'find old words');assert.equal(events.length,0);
  }
});
test('email and textarea controls preserve the same selection contract',()=>{
  for(const extra of [{type:'email',selectionStart:null,selectionEnd:null},{tagName:'TEXTAREA',type:'textarea'}]){
    const {item}=field(extra);insertVoiceTranscript(captureVoiceTarget(item),'new');
    assert.equal(item.value,extra.type==='email'?'find old wordsnew':'find new words');
  }
});

test('numeric and email insertion bypass an instance value tracker so native input can update controlled state',()=>{
  for(const type of ['number','email']){
    const {item,events}=field({type,value:type==='number'?'12':'old@example.org',selectionStart:null,selectionEnd:null});
    let value=item.value,nativeWrites=0,trackedWrites=0;
    class NativeInput {}
    Object.defineProperty(NativeInput.prototype,'value',{get(){return value;},set(next){nativeWrites++;value=String(next);}});
    Object.defineProperty(item,'value',{get(){return value;},set(next){trackedWrites++;value=String(next);},configurable:true});
    item.ownerDocument.defaultView.HTMLInputElement=NativeInput;
    insertVoiceTranscript(captureVoiceTarget(item),type==='number'?'25':'suffix');
    assert.equal(nativeWrites,1);assert.equal(trackedWrites,0);
    assert.equal(item.value,type==='number'?'25':'old@example.orgsuffix');
    assert.equal(events.filter(event=>event.type==='input').length,1);
  }
});

function numberField(extra={}){
  return field({type:'number',value:'12',selectionStart:null,selectionEnd:null,attributes:{'aria-label':'Amount'},...extra});
}

test('number dictation replaces the whole value and keeps native form submission separate',()=>{
  const {item,events}=numberField({value:'250',maxLength:1});
  const target=captureVoiceTarget(item);
  assert.equal(isVoiceEditable(item),true);
  assert.equal(target.replaceAll,true);
  assert.equal(target.start,0);assert.equal(target.end,3);
  assert.match(target.formatHint,/Use digits/);
  const result=insertVoiceTranscript(target,'125');
  assert.equal(item.value,'125');assert.equal(result.replacedWholeValue,true);
  assert.deepEqual(events.map(event=>event.type),['beforeinput','input','change','matumbo:voice-input']);
});

test('numeric grammar accepts finite scientific notation and decimals while ambiguous words leave the field unchanged',()=>{
  for(const text of ['0','-12','12.5','.5','-0.125','1e3','2.5E-2']){
    const {item}=numberField({step:'any'});insertVoiceTranscript(captureVoiceTarget(item),text);assert.equal(item.value,text);
  }
  for(const text of ['one hundred','12 dollars','1,000','1 000','1,5','Infinity','NaN','1e9999','0x10','12foo','1.','+12','1/2']){
    const {item,events}=numberField({step:'any'});
    assert.throws(()=>insertVoiceTranscript(captureVoiceTarget(item),text),/Use digits/,text);
    assert.equal(item.value,'12');assert.equal(events.length,0);
  }
});

test('number min/max and exact step grids preserve bounds without binary floating point rejection',()=>{
  for(const [settings,value] of [
    [{min:'0',max:'10',step:'0.1'},'0.3'],
    [{min:'0.2',step:'0.5'},'1.2'],
    [{attributes:{value:'0.2'},step:'0.5'},'1.2'],
    [{min:'-10',max:'-1',step:'any'},'-1.5'],
    [{step:'1e-7'},'3e-7'],
    [{step:'1e300'},'3e300'],
    [{min:'nonsense',max:'',step:'any'},'0.125'],
  ]){
    const {item}=numberField(settings);insertVoiceTranscript(captureVoiceTarget(item),value);assert.equal(item.value,value);
  }
  for(const [settings,value,message] of [
    [{min:'1'},'0',/at least 1/],
    [{max:'10'},'11',/no greater than 10/],
    [{step:'0.1'},'0.35',/increments of 0.1/],
    [{min:'0.2',step:'0.5'},'1',/starting at 0.2/],
    [{},'1.5',/increments of 1/],
    [{step:'0'},'1.5',/increments of 1/],
    [{step:'-2'},'1.5',/increments of 1/],
  ]){
    const {item,events}=numberField(settings);assert.throws(()=>insertVoiceTranscript(captureVoiceTarget(item),value),message);
    assert.equal(item.value,'12');assert.equal(events.length,0);
  }
});

test('browser numeric validity is checked on a detached copy without mutating or validating the original',()=>{
  for(const reason of ['Native range validation failed.','Native step validation failed.']){
    const {item,events}=numberField({cloneNode(deep){assert.equal(deep,false);return {value:'',validity:{valid:false},validationMessage:reason};}});
    assert.throws(()=>insertVoiceTranscript(captureVoiceTarget(item),'15'),error=>error.message.includes(reason));
    assert.equal(item.value,'12');assert.equal(events.length,0);
  }
  const {item}=numberField({validity:{customError:true},validationMessage:'Use the approved amount.'});
  assert.throws(()=>insertVoiceTranscript(captureVoiceTarget(item),'15'),/approved amount/);assert.equal(item.value,'12');
});

test('numeric insertion preserves newer typing and rechecks constraints and validity after beforeinput',()=>{
  const changed=numberField();const target=captureVoiceTarget(changed.item);changed.item.value='99';
  assert.throws(()=>insertVoiceTranscript(target,'20'),/field changed/);assert.equal(changed.item.value,'99');
  for(const mutate of [item=>{item.max='5';},item=>{item.step='7';},item=>{item.type='text';},item=>{item.validity={customError:true};item.validationMessage='Now blocked.';}]){
    const {item,on,events}=numberField();on('beforeinput',()=>mutate(item));
    assert.throws(()=>insertVoiceTranscript(captureVoiceTarget(item),'15'));
    assert.equal(item.value,'12');assert.deepEqual(events.map(event=>event.type),['beforeinput']);
  }
  const denied=numberField();denied.on('beforeinput',event=>event.preventDefault());
  assert.throws(()=>insertVoiceTranscript(captureVoiceTarget(denied.item),'15'),/declined/);
  assert.equal(denied.item.value,'12');
});

test('date and time dictation accepts only exact ISO-shaped values validated by the native detached control',()=>{
  for(const [type,value] of [['date','2026-10-05'],['time','09:30'],['datetime-local','2026-10-05T09:30'],['month','2026-10'],['week','2026-W41']]){
    let probes=0;
    const {item,events}=field({type,value:'previous value',selectionStart:null,selectionEnd:null,cloneNode(){probes+=1;return {value:'',validity:{valid:true}};}});
    assert.equal(isVoiceEditable(item),true);
    assert.equal(captureVoiceTarget(item).replaceAll,true);
    insertVoiceTranscript(captureVoiceTarget(item),value);
    assert.equal(item.value,value);assert.equal(probes,2);
    assert.equal(events.some(event=>event.type==='submit'),false);
  }
  for(const [type,value] of [['date','tomorrow'],['date','10/05/2026'],['time','nine thirty'],['datetime-local','2026-10-05T09:30Z'],['month','October 2026'],['week','next week']]){
    const {item,events}=field({type,value:'previous value'});
    assert.throws(()=>insertVoiceTranscript(captureVoiceTarget(item),value),/Use an exact/);
    assert.equal(item.value,'previous value');assert.equal(events.length,0);
  }
});

test('invalid calendar values, native time steps and reentrant date constraints never erase the existing value',()=>{
  const invalid=field({type:'date',value:'2026-10-05',cloneNode(){return {get value(){return '';},set value(_value){},validity:{valid:true}};}});
  assert.throws(()=>insertVoiceTranscript(captureVoiceTarget(invalid.item),'2026-02-30'),/exact date/);
  assert.equal(invalid.item.value,'2026-10-05');assert.equal(invalid.events.length,0);
  const time=field({type:'time',value:'09:30',cloneNode(){return {value:'',validity:{valid:false},validationMessage:'Minutes must be on a 15 minute step.'};}});
  assert.throws(()=>insertVoiceTranscript(captureVoiceTarget(time.item),'09:31'),/15 minute step/);
  assert.equal(time.item.value,'09:30');assert.equal(time.events.length,0);
  const changed=field({type:'date',value:'2026-10-05',cloneNode(){return {value:'',validity:{valid:this.max!=='2026-01-01'},validationMessage:'Above the new date limit.'};}});
  changed.on('beforeinput',()=>{changed.item.max='2026-01-01';});
  assert.throws(()=>insertVoiceTranscript(captureVoiceTarget(changed.item),'2026-11-01'),/new date limit/);
  assert.equal(changed.item.value,'2026-10-05');
  assert.deepEqual(changed.events.map(event=>event.type),['beforeinput']);
});
