import { TopologySurfaceObject } from './topology-surface-object.js';

const MAX_REGIONS=12;
const SHAPE_MAP=Object.freeze({
  sphere:'sphere',
  cylinder:'cylinder',
  cube:'cube',
  rectangle:'irregular',
  square:'irregular',
  phone:'irregular',
  wave:'open',
});

const clean=(value,fallback='')=>{
  const text=value==null?'':String(value).replace(/\s+/g,' ').trim();
  return text||fallback;
};
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));

function isHidden(element){
  if(!element)return true;
  if(element.hidden===true||element.getAttribute?.('aria-hidden')==='true')return true;
  return Boolean(element.closest?.('[hidden],[aria-hidden="true"]'));
}

function controlLabel(control,index){
  const aria=clean(control.getAttribute?.('aria-label'));
  if(aria)return aria;
  const id=control.id;
  if(id&&control.ownerDocument?.querySelector){
    try{
      const explicit=control.ownerDocument.querySelector(`label[for="${CSS?.escape?CSS.escape(id):id.replace(/"/g,'')}"]`);
      const label=clean(explicit?.textContent);
      if(label)return label;
    }catch{}
  }
  const wrapping=clean(control.closest?.('label')?.textContent);
  if(wrapping)return wrapping.slice(0,80);
  const text=clean(control.textContent);
  if(text)return text.slice(0,80);
  return clean(control.placeholder,clean(control.name,`Control ${index+1}`)).slice(0,80);
}

function controlValue(control){
  const tag=String(control.tagName??'').toUpperCase();
  const type=String(control.type??'').toLowerCase();
  if(type==='checkbox'||type==='radio')return control.checked?'ON':'OFF';
  if(tag==='SELECT'){
    const option=control.options?.[control.selectedIndex];
    return clean(option?.textContent,control.value);
  }
  if(tag==='BUTTON'||tag==='A'||tag==='SUMMARY')return 'activate';
  const value=clean(control.value);
  return value||clean(control.placeholder,'empty');
}

function controlKind(control){
  const tag=String(control.tagName??'').toUpperCase();
  const type=String(control.type??'').toLowerCase();
  if(tag==='BUTTON'||tag==='A'||tag==='SUMMARY')return 'button';
  if(tag==='SELECT')return 'select';
  if(type==='checkbox'||type==='radio')return 'toggle';
  if(type==='range')return 'range';
  return 'input';
}

function firstText(panel,selectors){
  for(const selector of selectors){
    const candidate=panel?.querySelector?.(selector);
    const value=clean(candidate?.textContent);
    if(value)return value;
  }
  return '';
}

function panelControls(panel){
  if(!panel?.querySelectorAll)return [];
  const all=[...panel.querySelectorAll('button,a[href],input,textarea,select,summary')];
  return all.filter(element=>{
    if(isHidden(element)||element.disabled)return false;
    if(String(element.type??'').toLowerCase()==='hidden')return false;
    if(element.matches?.('[data-native-surface-ignore]'))return false;
    return true;
  });
}

export function extractNativeInformation({feature,panel,summary='',activeElement=null}={}){
  const entries=[];
  const actions=new Map();
  const featureId=clean(feature?.id,'object');
  const title=clean(
    firstText(panel,[':scope > header h1',':scope > header h2',':scope > h1',':scope > h2','h1','h2']),
    clean(feature?.label,featureId),
  );
  entries.push({
    id:'identity',
    label:clean(feature?.kicker,'OBJECT'),
    value:title,
    priority:1,
    kind:'identity',
    state:'active',
    action:'focus',
    interactive:true,
  });

  const status=firstText(panel,['[role="status"]','[class*="status"]','[data-status]']);
  if(status)entries.push({
    id:'status',
    label:'STATE',
    value:status.slice(0,180),
    priority:.93,
    kind:'state',
    state:'live',
    action:'inspect',
    interactive:true,
  });

  const detail=clean(summary,clean(feature?.description));
  if(detail)entries.push({
    id:'detail',
    label:'DETAIL',
    value:detail.slice(0,340),
    priority:.86,
    kind:'detail',
    state:'live',
    action:'expand',
    interactive:true,
  });

  const controls=panelControls(panel);
  const available=Math.max(0,MAX_REGIONS-entries.length);
  controls.slice(0,available).forEach((control,index)=>{
    const kind=controlKind(control),id=`control-${index+1}`;
    const editing=activeElement===control;
    const label=controlLabel(control,index);
    entries.push({
      id,
      label,
      value:controlValue(control).slice(0,140),
      priority:clamp(.80-index*.035,.48,.84),
      kind,
      state:editing?'editing':'ready',
      action:kind==='input'?'edit':kind==='range'?'adjust':kind==='select'?'choose':'activate',
      interactive:true,
    });
    actions.set(id,{control,kind,label});
  });

  if(!controls.length&&feature?.boundary){
    entries.push({
      id:'boundary',
      label:'BOUNDARY',
      value:clean(feature.boundary).slice(0,280),
      priority:.55,
      kind:'provenance',
      state:'info',
      action:'inspect',
      interactive:true,
    });
  }

  return Object.freeze({
    featureId,
    entries:Object.freeze(entries.slice(0,MAX_REGIONS).map(entry=>Object.freeze({...entry}))),
    actions,
  });
}

function sameRegionIds(surface,entries){
  if(!surface||surface.regions.length!==entries.length)return false;
  const ids=new Set(surface.regions.map(region=>region.id));
  return entries.every(entry=>ids.has(entry.id));
}

function dispatch(control,type){
  try{
    control.dispatchEvent(new Event(type,{bubbles:true}));
  }catch{}
}

export class NativeInformationSurface{
  constructor({featureId,feature,mesh,shape='irregular',panel=null,summary='',atlasSize=768,onNavigate=null}={}){
    if(!mesh?.isMesh)throw Error('Native information needs the owning Three.js mesh');
    this.featureId=String(featureId??feature?.id??mesh.name);
    this.feature=feature??{id:this.featureId,label:this.featureId};
    this.mesh=mesh;
    this.shape=SHAPE_MAP[shape]??'irregular';
    this.panel=panel;
    this.summary=summary;
    this.atlasSize=atlasSize;
    this.onNavigate=typeof onNavigate==='function'?onNavigate:null;
    this.originalGeometry=mesh.geometry;
    this.originalMaterial=mesh.material;
    this.surface=null;
    this.actions=new Map();
    this._lastSignature='';
    this._disposed=false;
    this.sync({panel,summary,force:true});
  }

  _build(entries){
    if(this.surface){
      this.surface.dispose();
      this.mesh.geometry=this.originalGeometry;
      this.mesh.material=this.originalMaterial;
    }
    this.surface=new TopologySurfaceObject({
      id:`reality-native:${this.featureId}`,
      mesh:this.mesh,
      shape:this.shape,
      content:entries,
      atlasSize:this.atlasSize,
      enableDisplacement:true,
      topologyOptions:{seamAngle:Math.PI/7,curvatureThreshold:.02},
    });
    this.mesh.userData.nativeInformationSurface=this;
    this.mesh.userData.nativeInformationOwner=this.featureId;
  }

  sync({panel=this.panel,summary=this.summary,force=false}={}){
    if(this._disposed)return false;
    this.panel=panel??this.panel;
    this.summary=summary??this.summary;
    const extracted=extractNativeInformation({
      feature:this.feature,
      panel:this.panel,
      summary:this.summary,
      activeElement:this.panel?.ownerDocument?.activeElement??globalThis.document?.activeElement??null,
    });
    const signature=JSON.stringify(extracted.entries.map(entry=>[entry.id,entry.label,entry.value,entry.state,entry.action]));
    this.actions=extracted.actions;
    if(!force&&signature===this._lastSignature)return false;
    this._lastSignature=signature;
    if(!sameRegionIds(this.surface,extracted.entries)){
      this._build(extracted.entries);
      return true;
    }
    for(const entry of extracted.entries){
      this.surface.updateContent(entry.id,{
        label:entry.label,
        value:entry.value,
        action:entry.action,
        priority:entry.priority,
        kind:entry.kind,
        state:entry.state,
      });
    }
    return true;
  }

  owns(object){
    return object===this.mesh||object?.userData?.nativeInformationOwner===this.featureId;
  }

  activate(intersection){
    if(this._disposed||!intersection||intersection.object!==this.mesh)return false;
    const hit=this.surface?.hitTest?.(intersection);
    if(!hit)return false;
    this.surface.focus(hit.region.id);
    const action=this.actions.get(hit.region.id);
    if(!action){
      if(hit.region.id==='identity'||hit.region.id==='detail'){
        this.onNavigate?.(this.featureId,'native-surface');
        return true;
      }
      return true;
    }
    const {control,kind}=action;
    if(kind==='select'){
      const length=control.options?.length??0;
      if(length){
        control.selectedIndex=(Math.max(-1,control.selectedIndex)+1)%length;
        dispatch(control,'input');dispatch(control,'change');
      }
    }else if(kind==='range'){
      const current=Number(control.value),step=Number(control.step)||1,min=Number.isFinite(Number(control.min))?Number(control.min):-Infinity,max=Number.isFinite(Number(control.max))?Number(control.max):Infinity;
      if(Number.isFinite(current)){
        control.value=String(Math.min(max,Math.max(min,current+step)));
        dispatch(control,'input');dispatch(control,'change');
      }else control.focus?.({preventScroll:true});
    }else if(kind==='input'){
      try{control.focus?.({preventScroll:true});control.select?.();}catch{}
    }else{
      control.click?.();
    }
    queueMicrotask?.(()=>this.sync({force:true}));
    return true;
  }

  update({camera=null,viewportHeight=900,time=0,budget=1,focused=true}={}){
    if(this._disposed)return;
    this.surface?.updateLod?.({camera,viewportHeight,focused,budget});
    this.surface?.update?.(time);
  }

  dispose(){
    if(this._disposed)return;
    this._disposed=true;
    try{this.surface?.dispose?.();}catch{}
    if(this.mesh){
      this.mesh.geometry=this.originalGeometry;
      this.mesh.material=this.originalMaterial;
      delete this.mesh.userData.nativeInformationSurface;
      delete this.mesh.userData.nativeInformationOwner;
    }
    this.actions.clear();
  }
}

export function createNativeInformationSurface(options){
  return new NativeInformationSurface(options);
}
