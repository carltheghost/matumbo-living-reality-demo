/** Pure, deterministic layout rules for Reality Lens living surfaces. No DOM, CSS, Three.js, or feature-state access. */

/** Maximum object bounding-box volume relative to its content box. */
export const MAX_EMPTY_VOLUME_RATIO=1.6;
/** Maximum fraction of viewport height occupied by one object by default. */
export const MAX_VIEWPORT_FRACTION=0.4;
/** Small outward clearance between a mounted surface and its face. */
export const SURFACE_OFFSET=0.018;
/** Minimum separation used by the deterministic object packer. */
export const MIN_OBJECT_SEPARATION=0.9;
/** Default content-box thickness when metrics supply only width and height. */
export const CONTENT_BOX_DEPTH=0.12;
/** Maximum readable local surface dimension. */
export const MAX_SURFACE_DIMENSION=4.8;

const SHAPES=Object.freeze({phone:{width:.86,height:1.5,depth:.14},square:{width:1.28,height:1.28,depth:.14},rectangle:{width:1.92,height:1.12,depth:.14},sphere:{width:1.45,height:1.45,depth:1.45},cylinder:{width:1.36,height:1.64,depth:1.36},cube:{width:1.42,height:1.42,depth:1.42},wave:{width:1.92,height:1.12,depth:.18}});
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const finite=(v,f)=>Number.isFinite(v)?v:f;
const round=v=>Math.round(v*10000)/10000;
const positive=(v,name)=>{if(!Number.isFinite(v)||v<=0)throw Error(name+' must be positive and finite');return v;};

function linesOf(v){if(v==null)return[];if(Array.isArray(v))return v.map(x=>String(x??'').trim()).filter(Boolean);return String(v).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);}
function actionsOf(v){if(v==null)return[];if(Array.isArray(v))return v.map(x=>String(x??'').trim()).filter(Boolean);return[String(v).trim()].filter(Boolean);}

/** Estimate a stable, font-independent content box from semantic copy. */
export function measureContent(descriptor={}){
 const title=String(descriptor.title??'').trim(),lines=linesOf(descriptor.lines),actions=actionsOf(descriptor.actions);
 const longest=Math.max(title.length,...lines.map(x=>x.length),...actions.map(x=>x.length),1);
 const lineCount=Math.max(1,lines.length),actionRows=actions.length?Math.ceil(actions.length/2):0;
 const width=clamp(.28*Math.min(longest,72)+.34,1.05,5);
 const height=clamp(.42+.34*lineCount+.24*actionRows+(title?.38:0),.92,4.2);
 return Object.freeze({width:round(width),height:round(height)});
}

function chooseShape(w,h,opts){if(opts.shape&&SHAPES[opts.shape])return opts.shape;const a=w/h;if(a<.72)return'phone';if(a<=1.16)return'square';if(a>1.72)return'wave';return'rectangle';}

/** Fit a living object around content. Bounding-box volume never exceeds 1.6x the content box volume. */
export function fitObjectToContent(metrics,opts={}){
 if(!metrics||typeof metrics!=='object')throw Error('content metrics are required');
 const cw=positive(metrics.width,'content width'),ch=positive(metrics.height,'content height'),cd=positive(finite(metrics.depth,CONTENT_BOX_DEPTH),'content depth');
 const pad=clamp(finite(opts.padding,.08),0,.24),w=Math.min(MAX_SURFACE_DIMENSION,cw*(1+pad*2)),h=Math.min(MAX_SURFACE_DIMENSION,ch*(1+pad*2));
 const shape=chooseShape(w,h,opts),maxDepth=MAX_EMPTY_VOLUME_RATIO*cw*ch*cd/(w*h),preferred=finite(opts.depth,SHAPES[shape].depth);
 return Object.freeze({shape,width:round(w),height:round(h),depth:round(Math.min(Math.max(preferred,Number.EPSILON),maxDepth))});
}

function faceSpec(face){switch(String(face).toLowerCase()){case'back':return{normal:[0,0,-1],rotation:[0,Math.PI,0],axis:'z'};case'left':return{normal:[-1,0,0],rotation:[0,-Math.PI/2,0],axis:'x'};case'right':return{normal:[1,0,0],rotation:[0,Math.PI/2,0],axis:'x'};case'top':return{normal:[0,1,0],rotation:[-Math.PI/2,0,0],axis:'y'};case'bottom':return{normal:[0,-1,0],rotation:[Math.PI/2,0,0],axis:'y'};case'front':return{normal:[0,0,1],rotation:[0,0,0],axis:'z'};default:throw Error('face must be front, back, left, right, top, or bottom');}}

/** Mount a panel on the object's skin with a slight outward offset; never at the object's interior origin. */
export function surfaceTransform(object,panel,face='front'){
 if(!object||typeof object!=='object')throw Error('object is required');if(!panel||typeof panel!=='object')throw Error('panel is required');
 const spec=faceSpec(face),w=positive(finite(panel.width,object.width),'panel width'),h=positive(finite(panel.height,object.height),'panel height'),ow=positive(object.width,'object width'),oh=positive(object.height,'object height'),od=positive(object.depth,'object depth');
 const maxW=spec.axis==='x'?od:ow,maxH=spec.axis==='y'?od:oh,fw=Math.min(w,maxW*.94),fh=Math.min(h,maxH*.94),p=[0,0,0];
 if(spec.axis==='z')p[2]=spec.normal[2]*(od/2+SURFACE_OFFSET);if(spec.axis==='x')p[0]=spec.normal[0]*(ow/2+SURFACE_OFFSET);if(spec.axis==='y')p[1]=spec.normal[1]*(oh/2+SURFACE_OFFSET);
 const base=Array.isArray(object.position)?object.position:[object.position?.x,object.position?.y,object.position?.z],origin=base?.length===3&&base.every(Number.isFinite)?base:[0,0,0];
 return Object.freeze({position:Object.freeze(p.map((v,i)=>round(v+origin[i]))),rotation:Object.freeze(spec.rotation.map(round)),width:round(fw),height:round(fh)});
}

function radius(item){const w=positive(finite(item.width,1),'item width'),h=positive(finite(item.height,1),'item height'),d=positive(finite(item.depth,Math.min(w,h)),'item depth');return Math.hypot(w/2,h/2,d/2);}
function viewportOf(v={}){return{width:positive(finite(v.width,finite(v.w,1280)),'viewport width'),height:positive(finite(v.height,finite(v.h,720)),'viewport height')};}

/** Deterministically pack objects with a collision-safe grid and 40% viewport-height footprint cap. */
export function layoutObjects(items=[],viewport={}){
 if(!Array.isArray(items))throw Error('items must be an array');const view=viewportOf(viewport),ordered=items.map((item,index)=>({item,index,id:String(item?.id??index)}));if(!ordered.length)return[];
 const maxH=view.height*MAX_VIEWPORT_FRACTION,radii=ordered.map(({item})=>radius(item)*Math.min(1,maxH/Math.max(1e-6,finite(item.height,1)))),maxR=Math.max(...radii),gap=Math.max(MIN_OBJECT_SEPARATION,maxR*.16),cell=Math.max(MIN_OBJECT_SEPARATION,2*maxR+gap);
 const columns=Math.max(1,Math.ceil(Math.sqrt(ordered.length*view.width/view.height))),rows=Math.ceil(ordered.length/columns),gridW=Math.max(cell,columns*cell),gridH=Math.max(cell,rows*cell),out=[];
 for(let i=0;i<ordered.length;i++){const col=i%columns,row=Math.floor(i/columns),item=ordered[i].item,z=finite(item?.position?.[2],finite(item?.z,0));out.push({id:ordered[i].id,position:[round((col+.5)*cell-gridW/2),round(gridH/2-(row+.5)*cell),round(z)],radius:radii[i]});}
 for(let i=0;i<out.length;i++)for(let j=0;j<i;j++){const a=out[i],b=out[j],dx=a.position[0]-b.position[0],dy=a.position[1]-b.position[1],dist=Math.hypot(dx,dy),min=a.radius+b.radius+MIN_OBJECT_SEPARATION;if(dist<min){const angle=((i+1)*2.399963229728653+j*.618033988749895)%(Math.PI*2),push=min-dist;a.position[0]=round(a.position[0]+Math.cos(angle)*push);a.position[1]=round(a.position[1]+Math.sin(angle)*push);}}
 return out.map(({id,position})=>({id,position}));
}

/** Clamp scale and camera-relative distance so an object cannot dominate the viewport. Mutates and returns the supplied object. */
export function clampToView(object,camera={}){
 if(!object||typeof object!=='object')throw Error('object is required');const vh=positive(finite(camera.viewportHeight,finite(camera.height,720)),'camera viewport height'),maxH=vh*MAX_VIEWPORT_FRACTION,oh=positive(finite(object.height,1),'object height');
 object.scale=Math.min(finite(object.scale,1),maxH/oh);
 if(Number.isFinite(camera.distance)&&Number.isFinite(camera.minDistance)&&Number.isFinite(camera.maxDistance)){const min=Math.max(.01,camera.minDistance),max=Math.max(min,camera.maxDistance);camera.distance=clamp(camera.distance,min,max);}
 if(Number.isFinite(object.distance))object.distance=Math.max(object.distance,positive(finite(camera.minDistance,.01),'camera minimum distance'));
 return object;
}
