/** Dictation edits the original control. It never submits a form or interprets commands. */
const TEXT_TYPES=new Set(['text','search','email','url','tel']);
const VALUE_TYPES=new Set(['number','date','time','datetime-local','month','week']);
const NUMBER=/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const VALUE_FORMATS={
  number:'Use digits, such as 12, -0.5 or 1e3, without words, currency signs or grouping separators.',
  date:'Use an exact date: YYYY-MM-DD, for example 2026-10-05.',
  time:'Use an exact local time: HH:mm or HH:mm:ss, for example 09:30.',
  'datetime-local':'Use an exact local date and time: YYYY-MM-DDTHH:mm, for example 2026-10-05T09:30. Do not add a time zone.',
  month:'Use an exact month: YYYY-MM, for example 2026-10.',
  week:'Use an exact ISO week: YYYY-Www, for example 2026-W41.',
};
const ISO_FORMATS={
  date:/^\d{4,}-\d{2}-\d{2}$/,
  time:/^\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/,
  'datetime-local':/^\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/,
  month:/^\d{4,}-\d{2}$/,
  week:/^\d{4,}-W\d{2}$/,
};
const inputType=element=>element.tagName==='INPUT'?String(element.type||'text').toLowerCase():null;
const PRIVATE=/password|passphrase|api[-_ ]?key|secret|access[-_ ]?token|unlock[-_ ]?code|credit[-_ ]?card|one[-_ ]?time|\bcc-(?:number|csc|exp|name)\b/i;
export function isVoiceEditable(element){
  if(!element||element.disabled||element.readOnly||element.isConnected===false||element.matches?.(':disabled'))return false;
  if(element.closest?.('[data-voice-exclude],[inert]'))return false;
  if(PRIVATE.test([element.id,element.name,element.getAttribute?.('autocomplete'),element.getAttribute?.('aria-label'),element.getAttribute?.('placeholder'),...[...(element.labels??[])].map(label=>label.textContent)].filter(Boolean).join(' ')))return false;
  if(element.tagName==='TEXTAREA')return true;
  if(element.tagName==='INPUT')return TEXT_TYPES.has(inputType(element))||VALUE_TYPES.has(inputType(element));
  return element.isContentEditable===true||['true','plaintext-only'].includes(element.getAttribute?.('contenteditable'));
}
export function voiceTargetLabel(element){
  return String(element?.getAttribute?.('aria-label')||element?.labels?.[0]?.textContent||element?.getAttribute?.('placeholder')||element?.name||'Selected text field').trim().slice(0,100);
}
export function captureVoiceTarget(element){
  if(!isVoiceEditable(element))return null;
  const editable=!['INPUT','TEXTAREA'].includes(element.tagName),value=editable?element.innerHTML:String(element.value??'');
  let range=null;
  if(editable){
    const selection=element.ownerDocument?.getSelection?.();
    if(selection?.rangeCount&&element.contains(selection.getRangeAt(0).commonAncestorContainer))range=selection.getRangeAt(0).cloneRange();
    else{range=element.ownerDocument?.createRange?.();range?.selectNodeContents(element);range?.collapse(false);}
  }
  const type=inputType(element),replaceAll=VALUE_TYPES.has(type);
  return {element,editable,value,range,type,replaceAll,formatHint:replaceAll?`${VALUE_FORMATS[type]} This replaces the whole field value.`:'',label:voiceTargetLabel(element),start:replaceAll?0:Number.isInteger(element.selectionStart)?element.selectionStart:value.length,end:replaceAll?value.length:Number.isInteger(element.selectionEnd)?element.selectionEnd:value.length};
}

function numericValue(value){
  const text=String(value??'');
  return NUMBER.test(text)&&Number.isFinite(Number(text))?Number(text):null;
}
function attribute(element,name){return element.getAttribute?.(name)??(name==='value'?element.defaultValue:element[name])??'';}
function decimal(value){
  const [mantissa,exponent='0']=String(value).toLowerCase().split('e');
  const places=mantissa.includes('.')?mantissa.length-mantissa.indexOf('.')-1:0;
  return {units:BigInt(mantissa.replace('.','')),scale:places-Number(exponent)};
}
function onStep(value,base,step){
  // Decimal grids avoid rejecting 0.3 on a 0.1 step because of binary rounding.
  // Number() has already bounded the values, so these powers stay below 10^633.
  const parts=[value,base,step].map(decimal),scale=Math.max(...parts.map(part=>part.scale));
  const [amount,origin,increment]=parts.map(part=>part.units*10n**BigInt(scale-part.scale));
  return (amount-origin)%increment===0n;
}
function validateValue(element,text,type){
  if(type==='number'){
    const value=numericValue(text);
    if(value===null)throw Error(VALUE_FORMATS.number);
    const min=numericValue(attribute(element,'min')),max=numericValue(attribute(element,'max'));
    if(min!==null&&value<min)throw Error(`Use a number at least ${min}. Your original value is preserved.`);
    if(max!==null&&value>max)throw Error(`Use a number no greater than ${max}. Your original value is preserved.`);
    const rawStep=String(attribute(element,'step')).toLowerCase();
    if(rawStep!=='any'){
      const configured=numericValue(rawStep),step=configured!==null&&configured>0?configured:1;
      const base=min??numericValue(attribute(element,'value'))??0;
      if(!onStep(value,base,step))throw Error(`Use increments of ${step} starting at ${base}. Your original value is preserved.`);
    }
  }else if(!ISO_FORMATS[type]?.test(text))throw Error(VALUE_FORMATS[type]);
  if(element.validity?.customError)throw Error(element.validationMessage||'This field has a validation error. Resolve it before inserting.');
  // A detached copy applies the browser's own range, step, calendar and value
  // sanitization rules without changing the original or firing invalid events.
  const probe=element.cloneNode?.(false);
  if(probe){
    probe.value=text;
    if(!probe.value||probe.validity?.valid===false)throw Error(`${probe.validationMessage||'This value does not meet the field’s rules.'} ${VALUE_FORMATS[type]}`);
    return probe.value;
  }
  if(type!=='number')throw Error(`This browser cannot validate date/time dictation here. Use the field’s original picker. ${VALUE_FORMATS[type]}`);
  return text;
}
export function insertVoiceTranscript(target,text){
  const element=target?.element,transcript=String(text??'').trim();
  if(!isVoiceEditable(element))throw Error('Choose an editable text field again.');
  if(!transcript||transcript.length>8000)throw Error('Keep the transcript between 1 and 8,000 characters.');
  const current=target.editable?element.innerHTML:String(element.value??'');
  if(current!==target.value)throw Error('This field changed while you were speaking. Select it again before inserting; your existing writing is preserved.');
  if(inputType(element)!==target.type)throw Error('This field type changed. Select it again before inserting.');
  const replaceAll=VALUE_TYPES.has(target.type);
  let replacement=replaceAll?validateValue(element,transcript,target.type):transcript;
  const max=Number(element.maxLength);
  if(!target.editable&&!replaceAll&&max>=0&&Number.isFinite(max)&&current.length-(target.end-target.start)+transcript.length>max)throw Error(`This field allows ${max} characters. Shorten the transcript before inserting.`);
  const doc=element.ownerDocument,view=doc?.defaultView??globalThis;
  const event=(name,options={})=>{const Type=name==='matumbo:voice-input'?view.CustomEvent:view.InputEvent??view.Event;return new Type(name,{bubbles:true,...options});};
  if(element.dispatchEvent(event('beforeinput',{cancelable:true,inputType:'insertFromDictation',data:transcript}))===false)throw Error('This field declined the edit. Your transcript is still available.');
  if(!isVoiceEditable(element)||inputType(element)!==target.type||(target.editable?element.innerHTML:String(element.value??''))!==current)throw Error('This field changed while preparing the edit. Select it again; its writing is preserved.');
  // beforeinput handlers may update constraints or custom validity too.
  if(replaceAll)replacement=validateValue(element,transcript,target.type);
  const setValue=value=>{
    // Bypass an instance-level framework value tracker so the following native
    // input event reaches controlled React fields as an actual value change.
    const Type=element.tagName==='TEXTAREA'?view.HTMLTextAreaElement:view.HTMLInputElement;
    const setter=Type&&Object.getOwnPropertyDescriptor(Type.prototype,'value')?.set;
    if(setter)setter.call(element,value);else element.value=value;
  };
  if(replaceAll)setValue(replacement);
  else if(target.editable){
    const range=target.range;
    if(!range||!element.contains(range.commonAncestorContainer))throw Error('The text selection changed. Select this field again.');
    range.deleteContents();const textNode=doc.createTextNode(transcript);range.insertNode(textNode);range.setStartAfter(textNode);range.collapse(true);
    const selection=doc.getSelection?.();selection?.removeAllRanges();selection?.addRange(range);
  }else if(typeof element.setRangeText==='function'&&(element.tagName==='TEXTAREA'||['text','search','tel','url'].includes(String(element.type||'text')))){
    element.setRangeText(transcript,target.start,target.end,'end');
  }else setValue(current.slice(0,target.start)+transcript+current.slice(target.end));
  element.dispatchEvent(event('input',{inputType:'insertFromDictation',data:transcript}));
  element.dispatchEvent(new view.Event('change',{bubbles:true}));
  element.dispatchEvent(event('matumbo:voice-input',{detail:{final:true,source:'dictation'}}));
  return {inserted:replacement.length,label:target.label,replacedWholeValue:replaceAll};
}
