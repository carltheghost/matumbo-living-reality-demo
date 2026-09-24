/**
 * Pure projection geometry for a Reality Lens object. Coordinates on a
 * surface are local to its root; the object's workspace position is applied
 * by the renderer exactly once. Nothing here changes the canonical object.
 */
import {REALITY_TAB_FORMS} from './reality-tab-layout.js';

const OFFSET=.018;
const TAU=Math.PI*2;
const ROUND=value=>Math.round(value*1e6)/1e6;
function stableHash(value){let hash=2166136261;for(const char of String(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return hash>>>0;}

function positive(value,name){
  if(!Number.isFinite(value)||value<=0)throw new RangeError(`${name} must be finite and positive`);
  return value;
}
function nonNegative(value,name){
  if(!Number.isFinite(value)||value<0)throw new RangeError(`${name} must be finite and nonnegative`);
  return value;
}
function formOf(shape){return REALITY_TAB_FORMS[shape]??REALITY_TAB_FORMS.rectangle;}
function shapeOf(shape){return REALITY_TAB_FORMS[shape]?shape:'rectangle';}
function positionOf(position){
  const coordinates=Array.isArray(position)?position:[position?.x,position?.y,position?.z];
  if(coordinates.length!==3||coordinates.some(value=>!Number.isFinite(value)))
    throw new TypeError('position must contain three finite coordinates');
  return [...coordinates];
}
function boundingRadius(shape,form){
  if(shape==='sphere')return Math.min(form.width,form.height,form.depth)/2;
  if(shape==='cylinder')return Math.hypot(Math.min(form.width,form.depth)/2,form.height/2);
  return Math.hypot(form.width/2,form.height/2,form.depth/2);
}
function surface(id,width,height,position,rotation,normal,arcDegrees,curvatureRadius){
  const [pitch,yaw]=rotation,up=[Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),Math.cos(yaw)*Math.sin(pitch)];
  const result={id,width:ROUND(width),height:ROUND(height),
    position:position.map(ROUND),rotation:rotation.map(ROUND),normal:normal.map(ROUND),up:up.map(ROUND)};
  if(arcDegrees!==undefined)result.arcDegrees=arcDegrees;
  if(curvatureRadius!==undefined)result.curvatureRadius=ROUND(curvatureRadius);
  return result;
}
function curvedFace(id,r,angle,width,height,arcDegrees){
  return surface(id,width,height,[(r+OFFSET)*Math.sin(angle),0,(r+OFFSET)*Math.cos(angle)],
    [0,angle,0],[Math.sin(angle),0,Math.cos(angle)],arcDegrees,r+OFFSET);
}

/**
 * Describe bounded reading patches on a fixed physical shape. size changes
 * only the outer root scale and the layout radius; copy density only requests
 * scrolling within the same readable area.
 */
export function surfaceLayout({id,shape='rectangle',size=1,contentDensity=0,position=[0,0,0],locked=false}={}){
  if(id===undefined||id===null||String(id).length===0)throw new TypeError('object id is required');
  positive(size,'size');
  nonNegative(contentDensity,'contentDensity');
  const anchor=positionOf(position),name=shapeOf(shape),form=formOf(name);
  const bodyBounds={width:form.width,height:form.height,depth:form.depth};
  const radius=ROUND(boundingRadius(name,form)*size);
  let primarySurface,secondarySurfaces;
  if(name==='cylinder'){
    const r=Math.min(form.width,form.depth)/2,primaryArc=98,secondaryArc=40;
    primarySurface=curvedFace('front',r,0,2*r*Math.sin(primaryArc*Math.PI/360)*.94,form.height*.72,primaryArc);
    secondarySurfaces=[
      curvedFace('left',r,-2*Math.PI/5,2*r*Math.sin(secondaryArc*Math.PI/360)*.92,form.height*.64,secondaryArc),
      curvedFace('right',r,2*Math.PI/5,2*r*Math.sin(secondaryArc*Math.PI/360)*.92,form.height*.64,secondaryArc),
      curvedFace('back',r,Math.PI,2*r*Math.sin(secondaryArc*Math.PI/360)*.92,form.height*.64,secondaryArc),
    ];
  }else if(name==='sphere'){
    const r=Math.min(form.width,form.height,form.depth)/2,primaryArc=80,secondaryArc=32;
    primarySurface=curvedFace('front',r,0,2*r*Math.sin(primaryArc*Math.PI/360)*.94,
      2*r*Math.sin(primaryArc*Math.PI/360)*.9,primaryArc);
    secondarySurfaces=[
      curvedFace('left',r,-Math.PI*11/36,2*r*Math.sin(secondaryArc*Math.PI/360)*.9,
        2*r*Math.sin(secondaryArc*Math.PI/360)*.85,secondaryArc),
      curvedFace('right',r,Math.PI*11/36,2*r*Math.sin(secondaryArc*Math.PI/360)*.9,
        2*r*Math.sin(secondaryArc*Math.PI/360)*.85,secondaryArc),
      surface('top',2*r*Math.sin(secondaryArc*Math.PI/360)*.9,
        2*r*Math.sin(secondaryArc*Math.PI/360)*.85,
        [0,(r+OFFSET)*Math.sin(Math.PI*11/36),(r+OFFSET)*Math.cos(Math.PI*11/36)],
        [-Math.PI*11/36,0,0],[0,Math.sin(Math.PI*11/36),Math.cos(Math.PI*11/36)],secondaryArc,r+OFFSET),
    ];
  }else{
    // Extruded flat forms occupy z=[0,depth]; the centered cube occupies
    // z=[-depth/2,+depth/2]. Never put the face inside the solid shell.
    const cube=name==='cube',clearance=cube?OFFSET:.04;
    const front=(cube?form.depth/2:form.depth)+clearance;
    const back=(cube?-form.depth/2:0)-clearance,sideZ=cube?0:form.depth/2;
    const w=form.width*(name==='wave'?.78:.86),h=form.height*(name==='wave'?.68:.78);
    primarySurface=surface('front',w,h,[0,0,front],[0,0,0],[0,0,1]);
    secondarySurfaces=[
      surface('back',w,h,[0,0,back],[0,Math.PI,0],[0,0,-1]),
      surface('left',form.depth*.72,h,[-form.width/2-clearance,0,sideZ],[0,-Math.PI/2,0],[-1,0,0]),
      surface('right',form.depth*.72,h,[form.width/2+clearance,0,sideZ],[0,Math.PI/2,0],[1,0,0]),
    ];
    if(cube)secondarySurfaces.push(
      surface('top',w,form.depth*.72,[0,form.height/2+OFFSET,0],[-Math.PI/2,0,0],[0,1,0]),
      surface('bottom',w,form.depth*.72,[0,-form.height/2-OFFSET,0],[Math.PI/2,0,0],[0,-1,0]));
  }
  return {objectId:String(id),primarySurface,secondarySurfaces,
    readableBounds:{width:primarySurface.width,height:primarySurface.height},bodyBounds,radius,
    diagnostics:{shape:name,locked:Boolean(locked),anchorPosition:anchor,
      contentDensity,requiresScroll:contentDensity>1,geometryDependsOnContent:false}};
}

/** Camera framing from the scaled body's actual projected width and height.
 * Content length never enters this calculation; it scrolls on the skin. */
export function focusDistance({shape='rectangle',size=1,baseScale=1,approachScale=1,
  viewportWidth,viewportHeight,fov=60,occupancy=.5}={}){
  const width=positive(viewportWidth,'viewportWidth'),height=positive(viewportHeight,'viewportHeight');
  const scale=positive(size,'size')*positive(baseScale,'baseScale')*positive(approachScale,'approachScale');
  if(!Number.isFinite(fov)||fov<=0||fov>=170)throw new RangeError('fov must be between 0 and 170 degrees');
  if(!Number.isFinite(occupancy)||occupancy<=0||occupancy>1)
    throw new RangeError('occupancy must be between 0 and 1');
  const name=shapeOf(shape),form=formOf(name),radius=boundingRadius(name,form)*scale;
  const tanVertical=Math.tan(fov*Math.PI/360),tanHorizontal=tanVertical*width/height;
  // The cube may present a diagonal when viewed from its side; the cylinder
  // and sphere retain their silhouettes as the observer moves around them.
  const projectedWidth=(name==='cube'?Math.hypot(form.width,form.depth):form.width)*scale;
  const projectedHeight=(name==='cube'?Math.hypot(form.height,form.depth):form.height)*scale;
  const frontDepth=(['phone','square','rectangle','wave'].includes(name)?form.depth+.04:form.depth/2)*scale;
  const minimum=frontDepth+.1+Math.max(projectedWidth/(2*tanHorizontal*occupancy),
    projectedHeight/(2*tanVertical*occupancy));
  const distance=ROUND(Math.ceil(minimum*1e6)/1e6),nearestDistance=distance-frontDepth;
  const widthOccupancy=projectedWidth/(2*nearestDistance*tanHorizontal);
  const heightOccupancy=projectedHeight/(2*nearestDistance*tanVertical);
  const sphereOccupancy=radius/(nearestDistance*Math.min(tanHorizontal,tanVertical));
  const occupancyEstimate=ROUND(Math.max(widthOccupancy,heightOccupancy));
  return {distance,occupancyEstimate,
    widthOccupancy:ROUND(widthOccupancy),heightOccupancy:ROUND(heightOccupancy),
    sphereOccupancy:ROUND(sphereOccupancy),radius:ROUND(radius),scale:ROUND(scale),
    diagnostics:{focusedObjectScreenOccupancy:occupancyEstimate}};
}

function collides(a,b,gap){
  const dx=a.position[0]-b.position[0],dy=a.position[1]-b.position[1],dz=a.position[2]-b.position[2];
  return Math.hypot(dx,dy,dz)<a.radius+b.radius+gap-1e-7;
}
function free(candidate,placed,gap){return placed.every(other=>!collides(candidate,other,gap));}
function escape(candidate,placed,gap,maxRings){
  const origin=candidate.position;
  const phase=stableHash(candidate.id)/4294967296*TAU;
  for(const obstacle of placed){
    if(!collides(candidate,obstacle,gap))continue;
    const dz=origin[2]-obstacle.position[2],minimum=candidate.radius+obstacle.radius+gap;
    const planar=Math.sqrt(Math.max(0,minimum*minimum-dz*dz))+1e-5;
    let dx=origin[0]-obstacle.position[0],dy=origin[1]-obstacle.position[1],length=Math.hypot(dx,dy);
    if(length<1e-10){dx=Math.cos(phase);dy=Math.sin(phase);length=1;}
    const suggestion={...candidate,position:[obstacle.position[0]+dx/length*planar,
      obstacle.position[1]+dy/length*planar,origin[2]]};
    if(free(suggestion,placed,gap))return suggestion.position;
  }
  const largest=placed.reduce((value,other)=>Math.max(value,other.radius),candidate.radius);
  const step=Math.max(.1,(candidate.radius+largest+gap)/4);
  for(let ring=1;ring<=maxRings;ring++){
    const distance=ring*step,samples=48;
    for(let spoke=0;spoke<samples;spoke++){
      const angle=phase+TAU*spoke/samples;
      const suggestion={...candidate,position:[origin[0]+Math.cos(angle)*distance,
        origin[1]+Math.sin(angle)*distance,origin[2]]};
      if(free(suggestion,placed,gap))return suggestion.position;
    }
  }
  return null;
}

/** Preserve already clear locations and pinned objects, then place only
 * conflicting movable objects at deterministic nonintersecting locations. */
export function solveLivingLayout(items,{gap=.3,iterations=128}={}){
  if(!Array.isArray(items))throw new TypeError('items must be an array');
  nonNegative(gap,'gap');
  if(!Number.isInteger(iterations)||iterations<1)throw new RangeError('iterations must be a positive integer');
  const ids=new Set();
  const objects=items.map((item,index)=>{
    if(!item||item.id===undefined||item.id===null||String(item.id).length===0)
      throw new TypeError(`item ${index} needs an id`);
    const id=String(item.id);
    if(ids.has(id))throw new TypeError(`duplicate object id: ${id}`);
    ids.add(id);
    const shape=shapeOf(item.shape),size=positive(item.size??1,'size');
    return {...item,id,position:positionOf(item.position??[0,0,0]),
      radius:ROUND(boundingRadius(shape,formOf(shape))*size)};
  });
  const fixed=object=>object.locked===true||object.pinned===true||object.pin===true||object.anchor===true;
  const collidedOriginally=objects.map((a,i)=>objects.some((b,j)=>i!==j&&collides(a,b,gap)));
  // Fixed objects and objects already clear in the input own their locations.
  const order=[...objects.keys()].sort((a,b)=>{
    const priority=i=>fixed(objects[i])?0:collidedOriginally[i]?2:1;
    return priority(a)-priority(b)||a-b;
  });
  const placed=[],moved=[];
  for(const index of order){
    const object=objects[index];
    if(!fixed(object)&&!free(object,placed,gap)){
      const location=escape(object,placed,gap,Math.max(iterations,16));
      if(location){object.position=location.map(ROUND);moved.push(object.id);}
    }
    placed.push(object);
  }
  const collisions=[];let minimumGap=Infinity;
  for(let i=0;i<objects.length;i++)for(let j=0;j<i;j++){
    const distance=Math.hypot(...objects[i].position.map((value,axis)=>value-objects[j].position[axis]));
    minimumGap=Math.min(minimumGap,distance-objects[i].radius-objects[j].radius);
    if(collides(objects[i],objects[j],gap))collisions.push({ids:[objects[j].id,objects[i].id],
      fixed:fixed(objects[i])&&fixed(objects[j])});
  }
  return {objects,diagnostics:{moved,collisions,unresolvedCollisions:collisions.length,
    collisionCount:collisions.length,movedObjectCount:moved.length,
    minimumGap:Number.isFinite(minimumGap)?ROUND(minimumGap):null,
    panelOverflowCount:objects.filter(object=>(object.contentDensity??0)>1).length,
    resolved:collisions.length===0,gap,iterations}};
}

/** The same wheel gesture has one owner at a time. */
export function wheelIntent({overContent=false,overObject=false,mutable=true}={}){
  if(overContent)return 'scroll';
  if(overObject&&mutable)return 'resize';
  return 'travel';
}
