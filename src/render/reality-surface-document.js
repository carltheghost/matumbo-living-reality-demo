/**
 * A live, read-only view of one feature's existing semantic DOM.
 *
 * The mesh painter consumes these blocks. This adapter never clones a feature,
 * owns its domain state, changes its markup, or fabricates another form. Action
 * IDs point back to the original controls and keep their existing handlers.
 */
const OMIT = new Set(['SCRIPT','STYLE','TEMPLATE','NOSCRIPT','OPTION','OPTGROUP']);
const TEXT = new Set(['P','LI','DT','DD','PRE','CODE','BLOCKQUOTE','OUTPUT','CAPTION','FIGCAPTION','LEGEND','LABEL']);
const CONTAINERS = new Set(['DIV','SECTION','ARTICLE','ASIDE','HEADER','FOOTER','MAIN','NAV','FORM','FIELDSET','UL','OL','DL','TABLE','THEAD','TBODY','TFOOT','TR','TD','TH','DETAILS']);
const HEADINGS = /^H[1-6]$/;
const clean = value => String(value ?? '').replace(/\s+/g,' ').trim();
const tag = node => String(node?.tagName ?? '').toUpperCase();
const children = node => Array.from(node?.childNodes ?? node?.children ?? []);
const elements = node => children(node).filter(child => child.nodeType === 1 || child.tagName);
const attr = (node,name) => node?.getAttribute?.(name) ?? null;
const role = node => attr(node,'role') ?? '';
const POINTER_IDS=new Set(['gesture-lens-pad','gesture-input-pad']);
const isPointerSurface=node=>tag(node)==='CANVAS'||POINTER_IDS.has(String(node?.id??''))||attr(node,'data-surface-pointer')==='true';
const isFileLabel=node=>tag(node)==='LABEL'&&String(node.control?.type??'').toLowerCase()==='file';

function isControl(node) {
  return ['BUTTON','A','SUMMARY','INPUT','SELECT','TEXTAREA'].includes(tag(node))
    || ['button','tab','switch','checkbox','radio','menuitem','menuitemcheckbox','menuitemradio','slider','textbox','combobox'].includes(role(node))
    || node?.isContentEditable === true || isFileLabel(node);
}
function isMedia(node) { return ['CANVAS','IMG','VIDEO','AUDIO','IFRAME','SVG'].includes(tag(node)); }
function semanticBoundary(node) {
  return isControl(node) || isMedia(node) || isPointerSurface(node) || ['PROGRESS','METER'].includes(tag(node)) || TEXT.has(tag(node)) || CONTAINERS.has(tag(node)) || HEADINGS.test(tag(node));
}
function hasSemanticDescendant(node) {
  return elements(node).some(child=>semanticBoundary(child)||hasSemanticDescendant(child));
}

export function createRealitySurfaceDocument({element,feature=null,onDirty=()=>{}}={}) {
  if (!element || !(element.nodeType === 1 || element.tagName)) throw new TypeError('A surface document needs its original feature element.');
  const documentRoot = element.ownerDocument ?? globalThis.document;
  const view = documentRoot?.defaultView ?? globalThis;
  const nodeIds = new WeakMap(), actions = new Map(), dispatching = new Set();
  const identity = String(feature?.id ?? feature ?? element.id ?? 'feature');
  let nextId=0,revision=0,disposed=false,queued=false,lastBlocks=[];
  const reasons = new Set();

  const idFor = node => {
    if (!nodeIds.has(node)) nodeIds.set(node,`${identity}:surface:${++nextId}`);
    return nodeIds.get(node);
  };
  const belongs = node => {
    if (!node || node.isConnected === false || element.isConnected === false) return false;
    if (typeof element.contains === 'function') return element.contains(node);
    for (let current=node;current;current=current.parentElement ?? current.parentNode) if (current===element) return true;
    return false;
  };
  const styleFor = node => {
    try { return typeof view?.getComputedStyle === 'function' ? view.getComputedStyle(node) : null; }
    catch { return null; }
  };
  // Only the owner and its descendants participate. Its outer hosting element
  // may be offscreen for accessibility/input and is not another visible panel.
  const visible = node => {
    if (!belongs(node)) return false;
    for (let current=node;current;current=current.parentElement ?? current.parentNode) {
      if (current.nodeType === 1 || current.tagName) {
        const style=styleFor(current);
        if (current.hidden || current.inert || attr(current,'hidden')!==null || attr(current,'aria-hidden')==='true'
          || style?.display==='none' || style?.visibility==='hidden' || style?.visibility==='collapse') return false;
        if (tag(current)==='INPUT' && String(current.type ?? attr(current,'type')).toLowerCase()==='hidden') return false;
        const parent=current.parentElement ?? current.parentNode;
        if (parent && tag(parent)==='DETAILS' && !parent.open && attr(parent,'open')===null) {
          const summary=elements(parent).find(child=>tag(child)==='SUMMARY');
          if (current!==summary) return false;
        }
      }
      if (current===element) break;
    }
    return true;
  };
  const disabled = node => {
    if (node.disabled === true || (isFileLabel(node)&&node.control.disabled===true)) return true;
    try { if (node.matches?.(':disabled')) return true; } catch {}
    for (let current=node;current;current=current.parentElement ?? current.parentNode) {
      if (attr(current,'aria-disabled')==='true') return true;
      if (tag(current)==='FIELDSET' && current.disabled) {
        const legend=elements(current).find(child=>tag(child)==='LEGEND');
        if (!legend?.contains?.(node)) return true;
      }
      if (current===element) break;
    }
    return false;
  };
  const inlineText = (node,{includeControls=false}={}) => {
    const parts=[];
    const collect=(current,isRoot=false)=>{
      if (current.nodeType===3) { parts.push(current.nodeValue ?? current.textContent ?? ''); return; }
      if (!(current.nodeType===1 || current.tagName) || !visible(current) || OMIT.has(tag(current))) return;
      if (!isRoot && (isMedia(current) || (!includeControls && isControl(current)) || CONTAINERS.has(tag(current)) || TEXT.has(tag(current)) || HEADINGS.test(tag(current)))) return;
      if (tag(current)==='BR') { parts.push(' '); return; }
      const nodes=children(current);
      // textContent fallback supports small host adapters without text nodes.
      if (!nodes.length) parts.push(current.textContent ?? '');
      else for (const child of nodes) collect(child);
    };
    collect(node,true);return clean(parts.join(''));
  };
  const accessibleName = node => {
    const explicit=clean(attr(node,'aria-label'));if(explicit)return explicit;
    const labelIds=clean(attr(node,'aria-labelledby')).split(' ').filter(Boolean);
    const labelled=labelIds.map(id=>documentRoot?.getElementById?.(id)).filter(Boolean).map(label=>clean(label.textContent)).join(' ');
    if(labelled)return labelled;
    const labels=Array.from(node.labels ?? []).map(label=>inlineText(label)).filter(Boolean).join(' ');
    if(labels)return labels;
    // Buttons may contain block layout wrappers. Their accessible name still
    // includes that visible descendant text even though data layout does not.
    const nameParts=[];
    const collectName=current=>{
      if(current.nodeType===3){nameParts.push(current.nodeValue ?? current.textContent ?? '');return;}
      if(!(current.nodeType===1||current.tagName)||!visible(current)||OMIT.has(tag(current)))return;
      if(tag(current)==='IMG'){nameParts.push(attr(current,'alt')??'');return;}
      if(isMedia(current))return;
      const nodes=children(current);
      if(!nodes.length)nameParts.push(current.textContent??'');
      else for(const child of nodes)collectName(child);
    };
    collectName(node);
    const own=clean(nameParts.join(' '));
    return own || clean(attr(node,'title')) || clean(attr(node,'placeholder')) || clean(attr(node,'name'));
  };
  const dirty = reason => {
    if(disposed)return;
    reasons.add(reason);
    if(queued)return;
    queued=true;
    queueMicrotask(()=>{
      queued=false;if(disposed)return;
      revision++;const changed=[...reasons];reasons.clear();
      onDirty?.({revision,reasons:changed,featureId:identity});
    });
  };
  const observedEvent = event => dirty(event?.type ?? 'event');
  for(const type of ['input','change','focusin','focusout','toggle','click'])element.addEventListener?.(type,observedEvent,true);
  const Observer=view?.MutationObserver ?? globalThis.MutationObserver;
  const observer=typeof Observer==='function' ? new Observer(()=>dirty('mutation')) : null;
  observer?.observe(element,{subtree:true,childList:true,characterData:true,attributes:true});

  function read() {
    if(disposed)return [];
    const blocks=[];actions.clear();
    const emit=(node,kind,text='',extra={})=>{
      const block={id:idFor(node),kind,text:clean(text),value:'',disabled:disabled(node),element:node,...extra};
      blocks.push(block);return block;
    };
    const emitControl=node=>{
      const nodeTag=tag(node),inputType=String(node.type ?? attr(node,'type') ?? '').toLowerCase();
      const editable=node.isContentEditable===true || role(node)==='textbox';
      const kind=nodeTag==='INPUT'?'input':nodeTag==='SELECT'?'select':nodeTag==='TEXTAREA'||editable?'textarea':nodeTag==='SUMMARY'?'summary':nodeTag==='A'?'link':'button';
      const actionId=`${idFor(node)}:action`;
      let text=accessibleName(node);
      if(!text && nodeTag==='INPUT' && ['button','submit','reset'].includes(inputType))text=clean(node.value);
      if(!text)text=kind==='summary'?'Details':kind==='button'?'Action':kind==='link'?'Open link':'Input';
      const extra={actionId,role:role(node),inputType,focused:documentRoot?.activeElement===node,readOnly:node.readOnly===true || attr(node,'aria-readonly')==='true'};
      if(['input','select','textarea'].includes(kind)) {
        // Password contents never leave the native field, including snapshots.
        extra.value=inputType==='password'?'':String(editable?node.textContent ?? '':node.value ?? '');
        extra.sensitive=inputType==='password';
        if(['checkbox','radio'].includes(inputType))extra.checked=Boolean(node.checked);
        for(const name of ['min','max','step','placeholder'])if(attr(node,name)!==null)extra[name]=attr(node,name);
        if(nodeTag==='SELECT') {
          extra.multiple=Boolean(node.multiple);
          extra.options=Array.from(node.options ?? []).map(option=>({value:String(option.value ?? ''),text:clean(option.label ?? option.textContent),disabled:Boolean(option.disabled || option.parentElement?.disabled),selected:Boolean(option.selected)}));
        }
      }
      if(attr(node,'aria-checked')!==null)extra.checked=attr(node,'aria-checked')==='true';
      if(attr(node,'aria-selected')!==null)extra.selected=attr(node,'aria-selected')==='true';
      if(attr(node,'aria-valuenow')!==null)extra.value=attr(node,'aria-valuenow');
      if(attr(node,'aria-valuetext')!==null)extra.valueText=attr(node,'aria-valuetext');
      if(nodeTag==='SUMMARY')extra.expanded=Boolean((node.parentElement ?? node.parentNode)?.open);
      else if(attr(node,'aria-expanded')!==null)extra.expanded=attr(node,'aria-expanded')==='true';
      const block=emit(node,kind,text,extra);actions.set(actionId,node);return block;
    };
    // When a semantic parent emits its own text, descend only to the next
    // semantic boundary; inline emphasis must not duplicate the parent text.
    const nested=node=>{
      for(const child of elements(node)) {
        if(!visible(child)||OMIT.has(tag(child)))continue;
        if(semanticBoundary(child))visit(child);else nested(child);
      }
    };
    const visit=node=>{
      if(!(node.nodeType===1 || node.tagName)||!visible(node)||OMIT.has(tag(node)))return;
      const nodeTag=tag(node);
      if(isControl(node)) { emitControl(node);return; }
      if(isPointerSurface(node)&&nodeTag!=='CANVAS') {
        const actionId=`${idFor(node)}:pointer`;
        emit(node,'pointer',accessibleName(node)||'Pointer interaction area',{actionId,pointerSurface:true,inputType:'pointer',value:inlineText(node)});
        actions.set(actionId,node);nested(node);return;
      }
      if(['PROGRESS','METER'].includes(nodeTag)) {
        emit(node,'text',accessibleName(node)|| (nodeTag==='PROGRESS'?'Progress':'Measure'),{
          value:String(node.value??attr(node,'value')??''),min:String(node.min??attr(node,'min')??0),max:String(node.max??attr(node,'max')??1),role:nodeTag.toLowerCase(),
        });return;
      }
      if(nodeTag==='DETAILS' && !node.open && attr(node,'open')===null) {
        const summary=elements(node).find(child=>tag(child)==='SUMMARY');
        if(summary)visit(summary);return;
      }
      if(isMedia(node)) {
        const kind=nodeTag==='CANVAS'?'canvas':nodeTag==='IMG'||nodeTag==='SVG'?'image':'media';
        const caption=clean(attr(node,'aria-label') || attr(node,'alt') || attr(node,'title'));
        const text=nodeTag==='IFRAME'?`${caption||'Embedded player'} · browser player; embedded pixels are unavailable to the surface texture`:caption || (kind==='canvas'?'Live feature canvas':kind==='image'?'Feature image':'Media');
        const pointer=nodeTag==='CANVAS',actionId=pointer?`${idFor(node)}:pointer`:null;
        emit(node,kind,text,{mediaType:nodeTag.toLowerCase(),pixelAccess:nodeTag==='IFRAME'?'unavailable':'source-dependent',...(pointer?{actionId,pointerSurface:true,inputType:'pointer'}:{})});
        if(pointer)actions.set(actionId,node);return;
      }
      if(nodeTag==='TR') {
        const cells=elements(node).filter(child=>['TD','TH'].includes(tag(child))&&visible(child));
        const text=cells.map(cell=>inlineText(cell)).filter(Boolean).join(' · ');
        if(text)emit(node,'row',text,{cells:cells.map(cell=>inlineText(cell))});
        for(const cell of cells)nested(cell);return;
      }
      if(HEADINGS.test(nodeTag)||TEXT.has(nodeTag)) {
        const text=inlineText(node);
        if(text)emit(node,HEADINGS.test(nodeTag)?'heading':'text',text,HEADINGS.test(nodeTag)?{level:Number(nodeTag.slice(1))}:{});
        nested(node);return;
      }
      // Generic layout containers often hold important data in bare spans.
      // Preserve their source order by collecting adjacent inline text runs.
      let run=[],anchor=null;
      const flush=()=>{
        const text=clean(run.join(''));
        if(text){const owner=anchor ?? node;emit(owner,'text',text,{id:`${idFor(owner)}:text`});}
        run=[];anchor=null;
      };
      for(const child of children(node)) {
        if(child.nodeType===3) { run.push(child.nodeValue ?? child.textContent ?? '');anchor??=child;continue; }
        if(!(child.nodeType===1 || child.tagName)||!visible(child)||OMIT.has(tag(child)))continue;
        if(semanticBoundary(child)) { flush();visit(child); }
        else if(hasSemanticDescendant(child)) { flush();visit(child); }
        else { run.push(inlineText(child));anchor??=child; }
      }
      flush();
      if(!children(node).length && clean(node.textContent))emit(node,'text',node.textContent);
    };
    visit(element);lastBlocks=blocks;return blocks;
  }

  function getElement(actionId) {
    if(disposed)return null;
    const node=actions.get(String(actionId));
    return node && visible(node) ? node : null;
  }
  function focus(actionId) {
    const node=getElement(actionId);
    if(!node || disabled(node) || typeof node.focus!=='function')return false;
    node.focus({preventScroll:true});dirty('focus');return true;
  }
  function activate(actionId) {
    const key=String(actionId),node=getElement(key);
    if(!node || disabled(node) || dispatching.has(key) || isPointerSurface(node))return false;
    const nodeTag=tag(node),inputType=String(node.type ?? attr(node,'type') ?? '').toLowerCase();
    const edit=['SELECT','TEXTAREA'].includes(nodeTag)||node.isContentEditable===true||role(node)==='textbox'
      || (nodeTag==='INPUT' && !['button','submit','reset','image','checkbox','radio','file','color'].includes(inputType));
    if(edit)return focus(key);
    if(typeof node.click!=='function')return false;
    dispatching.add(key);
    try { node.click();dirty('activate');return true; }
    finally { dispatching.delete(key); }
  }
  /** Forward one observed mesh pointer event to the original interaction area.
   * x/y use top-left normalized image coordinates, not flipped texture UVs.
   * The caller retains the physical canvas capture after dispatch, because an
   * original handler may request capture on its own offscreen element. */
  function dispatchPointer(actionId,{type,x,y,pointerId=1,pointerType='mouse',button=0,buttons,pressure}={}) {
    const key=String(actionId),node=getElement(key);
    if(!node||!isPointerSurface(node)||disabled(node)||dispatching.has(key)
      || !['pointerdown','pointermove','pointerup','pointercancel','click'].includes(type)
      || !Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1
      || !Number.isInteger(pointerId)||pointerId<0||!['mouse','touch','pen'].includes(pointerType)
      || !Number.isInteger(button)||button< -1||button>5) return false;
    const rect=node.getBoundingClientRect?.();
    if(!rect||![rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0)return false;
    const Pointer=view?.PointerEvent??globalThis.PointerEvent;
    if(typeof Pointer!=='function'||typeof node.dispatchEvent!=='function')return false;
    const pressed=['pointerup','pointercancel','click'].includes(type)?0:1;
    const event=new Pointer(type,{bubbles:true,cancelable:true,composed:true,
      clientX:rect.left+x*rect.width,clientY:rect.top+y*rect.height,
      pointerId,pointerType,button,buttons:Number.isInteger(buttons)&&buttons>=0&&buttons<=31?buttons:pressed,
      pressure:Number.isFinite(pressure)?Math.max(0,Math.min(1,pressure)):(pressed?.5:0),isPrimary:true,
    });
    dispatching.add(key);
    try{node.dispatchEvent(event);dirty('pointer');return true;}
    finally{dispatching.delete(key);}
  }
  /** Keep original canvas zoom/scroll handlers in their native coordinate space. */
  function dispatchWheel(actionId,{x,y,deltaX=0,deltaY=0,deltaZ=0,deltaMode=0,ctrlKey=false,shiftKey=false,altKey=false,metaKey=false}={}) {
    const key=String(actionId),node=getElement(key);
    if(!node||!isPointerSurface(node)||disabled(node)||dispatching.has(key)
      || ![x,y,deltaX,deltaY,deltaZ].every(Number.isFinite)||x<0||x>1||y<0||y>1
      || ![0,1,2].includes(deltaMode))return false;
    const rect=node.getBoundingClientRect?.(),Wheel=view?.WheelEvent??globalThis.WheelEvent;
    if(!rect||![rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0
      || typeof Wheel!=='function'||typeof node.dispatchEvent!=='function')return false;
    const event=new Wheel('wheel',{bubbles:true,cancelable:true,composed:true,
      clientX:rect.left+x*rect.width,clientY:rect.top+y*rect.height,
      deltaX,deltaY,deltaZ,deltaMode,ctrlKey:Boolean(ctrlKey),shiftKey:Boolean(shiftKey),altKey:Boolean(altKey),metaKey:Boolean(metaKey),
    });
    dispatching.add(key);
    try{node.dispatchEvent(event);dirty('wheel');return true;}
    finally{dispatching.delete(key);}
  }
  function dispose() {
    if(disposed)return;disposed=true;observer?.disconnect();actions.clear();lastBlocks=[];reasons.clear();
    for(const type of ['input','change','focusin','focusout','toggle','click'])element.removeEventListener?.(type,observedEvent,true);
  }
  function snapshot() {
    return {featureId:identity,revision,disposed,blockCount:lastBlocks.length,actionCount:actions.size,
      originalElementId:element.id ?? null,canonicalOwners:1,clonedFeatureCount:0,
      kinds:[...new Set(lastBlocks.map(block=>block.kind))]};
  }
  return Object.freeze({read,activate,focus,getElement,dispatchPointer,dispatchWheel,dispose,snapshot});
}
