import test from 'node:test';
import assert from 'node:assert/strict';
import {createRealitySurfaceDocument} from '../src/render/reality-surface-document.js';

// A semantic DOM fixture, without a renderer or a second feature controller.
// Real browser acceptance remains the mounted atlas integration's responsibility.
function fixture() {
  const observers=[];
  class Node {
    constructor(name,text='') {
      this.nodeType=name==='#text'?3:1;this.tagName=this.nodeType===1?name.toUpperCase():undefined;
      this.nodeValue=this.nodeType===3?text:null;this.childNodes=[];this.parentNode=null;this.ownerDocument=doc;
      this.attributes=new Map();this.listeners=new Map();this.style={};this.hidden=false;this.disabled=false;
      this.clicks=0;this.focuses=0;this.value='';this.checked=false;this.open=false;
      if(this.nodeType===1&&text)this.append(new Node('#text',text));
    }
    get parentElement(){return this.parentNode?.nodeType===1?this.parentNode:null;}
    get children(){return this.childNodes.filter(node=>node.nodeType===1);}
    get isConnected(){for(let node=this;node;node=node.parentNode)if(node===doc.body)return true;return false;}
    get textContent(){return this.nodeType===3?this.nodeValue:this.childNodes.map(node=>node.textContent).join('');}
    set textContent(value){if(this.nodeType===3)this.nodeValue=String(value);else{for(const child of this.childNodes)child.parentNode=null;this.childNodes=[];this.append(new Node('#text',String(value)));}}
    get id(){return this.getAttribute('id')??'';}
    set id(value){this.setAttribute('id',value);}
    append(...nodes){for(let node of nodes){if(typeof node==='string')node=new Node('#text',node);node.remove();node.parentNode=this;this.childNodes.push(node);}return this;}
    remove(){if(this.parentNode)this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this),1);this.parentNode=null;}
    contains(other){for(let node=other;node;node=node.parentNode)if(node===this)return true;return false;}
    getAttribute(name){return this.attributes.get(name)??null;}
    setAttribute(name,value){this.attributes.set(name,String(value));}
    removeAttribute(name){this.attributes.delete(name);}
    addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
    removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
    emit(name){const event={type:name,target:this};for(let node=this;node;node=node.parentNode)for(const fn of node.listeners.get(name)??[])fn(event);}
    dispatchEvent(event){event.target=this;for(let node=this;node;node=node.parentNode)for(const fn of node.listeners.get(event.type)??[])fn(event);return !event.defaultPrevented;}
    getBoundingClientRect(){return this.rect??{left:-12000,top:50,width:640,height:400};}
    click(){this.clicks++;if(this.tagName==='SUMMARY'&&this.parentNode?.tagName==='DETAILS')this.parentNode.open=!this.parentNode.open;if(this.type==='checkbox')this.checked=!this.checked;this.emit('click');}
    focus(){this.focuses++;doc.activeElement=this;this.emit('focusin');}
    matches(selector){return selector===':disabled'&&this.disabled;}
  }
  const doc={defaultView:{PointerEvent:class {constructor(type,options){Object.assign(this,{type},options);}preventDefault(){this.defaultPrevented=true;}},getComputedStyle:node=>({display:node.style.display??'block',visibility:node.style.visibility??'visible'}),MutationObserver:class {
    constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}
    observe(element,options){this.element=element;this.options=options;}
    disconnect(){this.disconnected=true;}
  }},getElementById(id){let found=null;const walk=node=>{if(node.id===id)found=node;for(const child of node.children)walk(child);};walk(doc.body);return found;}};
  const el=(name,text='',attrs={})=>{const node=new Node(name,text);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);return node;};
  doc.defaultView.WheelEvent=doc.defaultView.PointerEvent;
  doc.body=el('body');const owner=el('section','',{id:'feature-console'});doc.body.append(owner);
  return {doc,owner,el,observers};
}
const turn=()=>new Promise(resolve=>queueMicrotask(resolve));

test('live semantic data preserves source order and does not duplicate nested controls',()=>{
  const {owner,el}=fixture();const title=el('h2','Actual balance'),p=el('p','Balance '),amount=el('strong','42'),button=el('button','Send');
  p.append(amount,' TUMBO ',button);owner.append(title,p);
  const adapter=createRealitySurfaceDocument({element:owner,feature:{id:'asset-token'}});
  const blocks=adapter.read();
  assert.deepEqual(blocks.map(({kind,text})=>[kind,text]),[['heading','Actual balance'],['text','Balance 42 TUMBO'],['button','Send']]);
  assert.equal(blocks[2].element,button);assert.equal(owner.children.length,2);
  const stable=blocks.map(block=>block.id);amount.textContent='43';
  assert.deepEqual(adapter.read().map(block=>block.id),stable);
  assert.equal(adapter.read()[1].text,'Balance 43 TUMBO');
  adapter.dispose();
});

test('deep inline nesting cannot hide an actionable descendant',()=>{
  const {owner,el}=fixture();const outer=el('span'),inner=el('span'),button=el('button','Run original');inner.append(button);outer.append(inner);owner.append(outer);
  const adapter=createRealitySurfaceDocument({element:owner});
  assert.equal(adapter.read().find(block=>block.actionId)?.element,button);
  adapter.dispose();
});

test('button names retain visible text inside block layout wrappers and image alternatives',()=>{
  const {owner,el}=fixture();const button=el('button'),layout=el('div'),hidden=el('span','Private');hidden.hidden=true;
  layout.append(el('strong','Real action'),el('small','Current result'),el('img','',{alt:'Verified'}),hidden);button.append(layout);owner.append(button);
  const adapter=createRealitySurfaceDocument({element:owner});assert.equal(adapter.read()[0].text,'Real action Current result Verified');adapter.dispose();
});

test('closed details omit private body and direct text while retaining its live summary',()=>{
  const {owner,el}=fixture();const details=el('details'),summary=el('summary','Full records'),button=el('button','Nested action');
  details.append(summary,' private direct text ',el('p','Private record'),button);owner.append(details);
  const adapter=createRealitySurfaceDocument({element:owner});const first=adapter.read();
  assert.deepEqual(first.map(block=>block.text),['Full records']);
  assert.equal(adapter.activate(first[0].actionId),true);assert.equal(summary.clicks,1);
  const open=adapter.read();assert.ok(open.some(block=>block.text==='private direct text'));assert.ok(open.some(block=>block.text==='Private record'));
  assert.equal(open[0].expanded,true);const nested=open.find(block=>block.element===button);
  details.open=false;assert.equal(adapter.activate(nested.actionId),false);adapter.dispose();
});

test('hidden, inert, aria-hidden, CSS-hidden and hidden-input content is not painted or activated',()=>{
  const {owner,el}=fixture();const nodes=Array.from({length:7},(_,i)=>el('button',`Secret ${i}`));
  nodes[0].hidden=true;nodes[1].inert=true;nodes[2].setAttribute('aria-hidden','true');nodes[3].style.display='none';nodes[4].style.visibility='hidden';nodes[5].style.visibility='collapse';
  const hiddenInput=el('input');hiddenInput.type='hidden';hiddenInput.value='not public';owner.append(...nodes,hiddenInput);
  const adapter=createRealitySurfaceDocument({element:owner});const blocks=adapter.read();assert.deepEqual(blocks.map(block=>block.text),['Secret 6']);
  const action=blocks[0].actionId;nodes[6].hidden=true;assert.equal(adapter.activate(action),false);assert.equal(nodes[6].clicks,0);adapter.dispose();
});

test('original commands execute synchronously once with reentrancy and stale-owner guards',()=>{
  const {owner,el}=fixture();const button=el('button','Transfer');owner.append(button);const adapter=createRealitySurfaceDocument({element:owner});
  const action=adapter.read()[0].actionId;let transfers=0;button.addEventListener('click',()=>{transfers++;assert.equal(adapter.activate(action),false);});
  assert.equal(adapter.activate(action),true);assert.equal(transfers,1);assert.equal(button.clicks,1);
  button.remove();assert.equal(adapter.activate(action),false);
  const replacement=el('button','Transfer');owner.append(replacement);assert.equal(adapter.activate(action),false);assert.equal(replacement.clicks,0);
  assert.notEqual(adapter.read()[0].actionId,action);adapter.dispose();
});

test('disabled controls and disabled fieldsets remain inert; first legend keeps browser semantics',()=>{
  const {owner,el}=fixture();const fieldset=el('fieldset'),legend=el('legend'),legendAction=el('button','Explain'),blocked=el('button','Submit');fieldset.disabled=true;legend.append(legendAction);fieldset.append(legend,blocked);
  const ariaParent=el('div','',{'aria-disabled':'true'}),ariaButton=el('button','Unavailable');ariaParent.append(ariaButton);owner.append(fieldset,ariaParent);
  const adapter=createRealitySurfaceDocument({element:owner});const blocks=adapter.read();
  assert.equal(adapter.activate(blocks.find(block=>block.element===legendAction).actionId),true);
  for(const node of [blocked,ariaButton]){const block=blocks.find(block=>block.element===node);assert.equal(block.disabled,true);assert.equal(adapter.activate(block.actionId),false);assert.equal(node.clicks,0);}
  adapter.dispose();
});

test('fields expose live values, named labels, options, bounds and native focus without cloning',()=>{
  const {doc,owner,el}=fixture();const label=el('label','Amount'),input=el('input','',{min:'1',max:'10',step:'1'});input.type='number';input.value='2';input.labels=[label];
  const select=el('select','',{'aria-label':'Asset'});select.value='TUMBO';select.options=[{value:'TUMBO',textContent:'TUMBO-SIM',selected:true},{value:'USD',label:'Dollar',disabled:true,selected:false}];
  const area=el('textarea','',{'aria-label':'Instructions'});area.value='Original draft';owner.append(label,input,select,area);
  const adapter=createRealitySurfaceDocument({element:owner});let blocks=adapter.read();const field=blocks.find(block=>block.element===input);
  assert.equal(field.text,'Amount');assert.equal(field.value,'2');assert.equal(field.min,'1');assert.equal(field.max,'10');
  assert.equal(adapter.activate(field.actionId),true);assert.equal(doc.activeElement,input);assert.equal(input.clicks,0);assert.equal(input.focuses,1);
  input.value='7';area.value='Edited with IME';blocks=adapter.read();assert.equal(blocks.find(block=>block.element===input).value,'7');assert.equal(blocks.find(block=>block.element===area).value,'Edited with IME');
  assert.deepEqual(blocks.find(block=>block.element===select).options,[{value:'TUMBO',text:'TUMBO-SIM',disabled:false,selected:true},{value:'USD',text:'Dollar',disabled:true,selected:false}]);adapter.dispose();
});

test('checkbox activation uses its original native click once and passwords are never extracted',()=>{
  const {owner,el}=fixture();const check=el('input','',{'aria-label':'Consent'});check.type='checkbox';const password=el('input','',{'aria-label':'Key'});password.type='password';password.value='private-value';owner.append(check,password);
  const adapter=createRealitySurfaceDocument({element:owner});let blocks=adapter.read();assert.equal(blocks[1].value,'');assert.equal(blocks[1].sensitive,true);
  assert.equal(adapter.activate(blocks[0].actionId),true);assert.equal(check.checked,true);assert.equal(check.clicks,1);assert.equal(adapter.read()[0].checked,true);assert.equal(JSON.stringify(adapter.snapshot()).includes('private-value'),false);adapter.dispose();
});

test('table rows retain actual cells and their original embedded actions',()=>{
  const {owner,el}=fixture();const table=el('table'),row=el('tr'),first=el('td','Alice'),second=el('td','12'),third=el('td'),button=el('button','Pay');third.append(button);row.append(first,second,third);table.append(row);owner.append(table);
  const adapter=createRealitySurfaceDocument({element:owner});const blocks=adapter.read();assert.deepEqual(blocks.map(block=>[block.kind,block.text]),[['row','Alice · 12'],['button','Pay']]);assert.deepEqual(blocks[0].cells,['Alice','12','']);adapter.dispose();
});

test('native progress and meter values remain real observable data even without child text',()=>{
  const {owner,el}=fixture();const progress=el('progress','',{'aria-label':'Loaded'}),meter=el('meter','',{'aria-label':'Capacity'});progress.value=.4;progress.max=1;meter.value=25;meter.min=0;meter.max=100;owner.append(progress,meter);
  const adapter=createRealitySurfaceDocument({element:owner});const blocks=adapter.read();assert.deepEqual(blocks.map(block=>[block.text,block.value,block.max]),[['Loaded','0.4','1'],['Capacity','25','100']]);adapter.dispose();
});

test('media blocks retain original canvas/image/iframe and explicitly decline embedded pixels',()=>{
  const {owner,el}=fixture();const canvas=el('canvas','',{'aria-label':'Live board'}),image=el('img','',{alt:'Actual image'}),iframe=el('iframe','',{title:'YouTube player'});owner.append(canvas,image,iframe);
  const adapter=createRealitySurfaceDocument({element:owner});const blocks=adapter.read();assert.deepEqual(blocks.map(block=>block.kind),['canvas','image','media']);assert.equal(blocks[0].element,canvas);assert.equal(blocks[1].element,image);assert.equal(blocks[2].element,iframe);assert.equal(blocks[2].pixelAccess,'unavailable');assert.match(blocks[2].text,/pixels are unavailable/);assert.equal(owner.children.filter(node=>node.tagName==='IFRAME').length,1);adapter.dispose();
});

test('mesh pointer coordinates map to the original offscreen canvas and its existing gesture handlers',()=>{
  const {owner,el}=fixture();const canvas=el('canvas','',{'aria-label':'Chess board'});owner.append(canvas);
  const adapter=createRealitySurfaceDocument({element:owner});const block=adapter.read()[0],seen=[];
  for(const type of ['pointerdown','pointermove','pointerup'])canvas.addEventListener(type,event=>{seen.push(event);event.preventDefault();});
  assert.equal(block.pointerSurface,true);assert.equal(adapter.activate(block.actionId),false,'coordinate-free click must not impersonate a board move');
  for(const type of ['pointerdown','pointermove','pointerup'])assert.equal(adapter.dispatchPointer(block.actionId,{type,x:.25,y:.75,pointerId:9,pointerType:'touch'}),true);
  assert.deepEqual(seen.map(event=>[event.type,event.clientX,event.clientY,event.pointerId,event.pointerType,event.buttons]),[
    ['pointerdown',-11840,350,9,'touch',1],['pointermove',-11840,350,9,'touch',1],['pointerup',-11840,350,9,'touch',0],
  ]);assert.ok(seen.every(event=>event.target===canvas));assert.equal(canvas.clicks,0);adapter.dispose();
});

test('pointer bridge rejects invalid, stale and disabled targets without dispatch',()=>{
  const {owner,el}=fixture();const canvas=el('canvas'),button=el('button','Ordinary action');owner.append(canvas,button);const adapter=createRealitySurfaceDocument({element:owner});const blocks=adapter.read(),id=blocks[0].actionId;
  let calls=0;canvas.addEventListener('pointerdown',()=>calls++);
  const base={type:'pointerdown',x:.5,y:.5};
  for(const override of [{x:NaN},{y:2},{type:'mousedown'},{pointerId:-2},{pointerType:'invented'}])assert.equal(adapter.dispatchPointer(id,{...base,...override}),false);
  assert.equal(adapter.dispatchPointer(blocks[1].actionId,base),false);canvas.hidden=true;assert.equal(adapter.dispatchPointer(id,base),false);canvas.hidden=false;canvas.disabled=true;assert.equal(adapter.dispatchPointer(id,base),false);canvas.disabled=false;canvas.remove();assert.equal(adapter.dispatchPointer(id,base),false);assert.equal(calls,0);adapter.dispose();
});

test('tap completion dispatches exactly one coordinate-bearing click to click-only canvas controls',()=>{
  const {owner,el}=fixture();const canvas=el('canvas');owner.append(canvas);const adapter=createRealitySurfaceDocument({element:owner}),id=adapter.read()[0].actionId,seen=[];
  canvas.addEventListener('click',event=>seen.push(event));
  for(const type of ['pointerdown','pointerup'])assert.equal(adapter.dispatchPointer(id,{type,x:.25,y:.75}),true);
  assert.equal(seen.length,0,'pointer events alone do not synthesize browser click');
  assert.equal(adapter.dispatchPointer(id,{type:'click',x:.25,y:.75}),true);assert.equal(seen.length,1);
  assert.deepEqual([seen[0].clientX,seen[0].clientY,seen[0].buttons],[-11840,350,0]);assert.equal(canvas.clicks,0,'do not also invoke coordinate-free native click');adapter.dispose();
});

test('wheel forwarding preserves original canvas coordinates, deltas, units and one native handler call',()=>{
  const {owner,el}=fixture();const canvas=el('canvas');owner.append(canvas);const adapter=createRealitySurfaceDocument({element:owner});const id=adapter.read()[0].actionId,seen=[];
  canvas.addEventListener('wheel',event=>{seen.push(event);event.preventDefault();assert.equal(adapter.dispatchWheel(id,{x:.5,y:.5,deltaY:1}),false,'reentrant wheel must not zoom twice');});
  assert.equal(adapter.dispatchWheel(id,{x:.75,y:.25,deltaX:3,deltaY:-24,deltaZ:1,deltaMode:1,shiftKey:true}),true);
  assert.equal(seen.length,1);const event=seen[0];assert.equal(event.target,canvas);
  assert.deepEqual([event.clientX,event.clientY,event.deltaX,event.deltaY,event.deltaZ,event.deltaMode,event.shiftKey],[-11520,150,3,-24,1,1,true]);
  assert.equal(event.defaultPrevented,true);assert.equal(canvas.clicks,0);adapter.dispose();
});

test('wheel bridge rejects hidden, stale, non-canvas and malformed input',()=>{
  const {owner,el}=fixture();const canvas=el('canvas'),button=el('button','Action');owner.append(canvas,button);const adapter=createRealitySurfaceDocument({element:owner});const blocks=adapter.read(),id=blocks[0].actionId,base={x:.5,y:.5,deltaY:80};let calls=0;canvas.addEventListener('wheel',()=>calls++);
  for(const override of [{x:Infinity},{y:-.1},{deltaY:NaN},{deltaX:'2'},{deltaMode:3}])assert.equal(adapter.dispatchWheel(id,{...base,...override}),false);
  assert.equal(adapter.dispatchWheel(blocks[1].actionId,base),false);canvas.hidden=true;assert.equal(adapter.dispatchWheel(id,base),false);canvas.hidden=false;canvas.disabled=true;assert.equal(adapter.dispatchWheel(id,base),false);canvas.disabled=false;canvas.rect={left:0,top:0,width:0,height:1};assert.equal(adapter.dispatchWheel(id,base),false);canvas.remove();assert.equal(adapter.dispatchWheel(id,base),false);assert.equal(calls,0);adapter.dispose();
});

test('only registered gesture pads and explicit pointer opt-ins get gesture regions',()=>{
  const {owner,el}=fixture();const pad=el('div','Gesture data',{id:'gesture-lens-pad','aria-label':'Rehearse hand movement'}),other=el('div','Ordinary content'),explicit=el('div','Custom interaction',{'data-surface-pointer':'true'});owner.append(pad,other,explicit);
  const adapter=createRealitySurfaceDocument({element:owner});const blocks=adapter.read();assert.equal(blocks.find(block=>block.element===pad).kind,'pointer');assert.equal(blocks.find(block=>block.element===explicit).pointerSurface,true);assert.equal(blocks.find(block=>block.text==='Ordinary content').actionId,undefined);adapter.dispose();
});

test('visible file label retains native activation of its deliberately hidden picker',()=>{
  const {owner,el}=fixture();const label=el('label','Use my photo'),file=el('input');file.type='file';file.hidden=true;label.control=file;label.append(file);owner.append(label);
  let picker=0;label.addEventListener('click',()=>picker++);const adapter=createRealitySurfaceDocument({element:owner});const blocks=adapter.read();assert.equal(blocks.length,1);assert.equal(blocks[0].text,'Use my photo');assert.equal(adapter.activate(blocks[0].actionId),true);assert.equal(label.clicks,1);assert.equal(picker,1);file.disabled=true;assert.equal(adapter.activate(blocks[0].actionId),false);adapter.dispose();
});

test('ARIA tabs, contenteditable and labelled-by names retain original semantic state',()=>{
  const {owner,el}=fixture();const name=el('span','Actual data',{id:'data-title'}),tab=el('div','', {role:'tab','aria-selected':'true','aria-labelledby':'data-title'}),editor=el('div','Draft',{'aria-label':'Native editor'});editor.isContentEditable=true;owner.append(name,tab,editor);
  const adapter=createRealitySurfaceDocument({element:owner});const blocks=adapter.read(),tabBlock=blocks.find(block=>block.element===tab),field=blocks.find(block=>block.element===editor);
  assert.equal(tabBlock.text,'Actual data');assert.equal(tabBlock.selected,true);assert.equal(field.kind,'textarea');assert.equal(field.value,'Draft');assert.equal(adapter.activate(field.actionId),true);adapter.dispose();
});

test('changes coalesce, reads do not mutate the DOM or self-notify, and disposal cancels work',async()=>{
  const {owner,el,observers}=fixture();const input=el('input','',{'aria-label':'Value'});owner.append(input);const notifications=[];
  const adapter=createRealitySurfaceDocument({element:owner,onDirty:change=>notifications.push(change)});adapter.read();adapter.read();await turn();assert.equal(notifications.length,0);
  input.value='3';input.emit('input');input.emit('change');observers[0].callback([]);await turn();assert.equal(notifications.length,1);assert.deepEqual(new Set(notifications[0].reasons),new Set(['input','change','mutation']));assert.equal(adapter.snapshot().revision,1);
  input.emit('input');adapter.dispose();await turn();assert.equal(notifications.length,1);assert.equal(observers[0].disconnected,true);assert.deepEqual(adapter.read(),[]);assert.equal(adapter.snapshot().disposed,true);assert.equal(adapter.activate('missing'),false);
});

test('an offscreen outer host is not a second owner or a reason to discard feature content',()=>{
  const {doc,owner,el}=fixture();const host=el('div');host.style.left='-10000px';doc.body.append(host);host.append(owner);owner.append(el('button','Existing feature'));
  const adapter=createRealitySurfaceDocument({element:owner});assert.equal(adapter.read().length,1);assert.equal(adapter.snapshot().canonicalOwners,1);assert.equal(adapter.snapshot().clonedFeatureCount,0);adapter.dispose();
});
