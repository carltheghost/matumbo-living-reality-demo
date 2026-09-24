import {REALITY_TAB_FORMS,REALITY_TAB_GAP,realityTabRadius,resolveRealityTabPosition} from './reality-tab-layout.js';

/**
 * Geometry and layout rules for Reality Lens living objects.
 *
 * The body owns its readable surfaces.  Content length can make a surface
 * scroll, but it must never make a sphere, cylinder, or card body grow into
 * an empty wall.  All functions are pure so the same rules work in the scene,
 * the CSS3D surface renderer, tests, and future XR adapters.
 */

const FACE_IDS=Object.freeze(['front','back','left','right','top','bottom']);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const round=value=>Math.round(value*10000)/10000;
const freeze=value=>{
  if(value&&typeof value==='object'){
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

function formFor(shape){return REALITY_TAB_FORMS[shape]??REALITY_TAB_FORMS.rectangle;}
function finitePositive(value,name){
  if(!Number.isFinite(value)||value<=0)throw Error(`${name} must be finite and positive`);
  return value;
}
function normalized(vector,fallback=[1,0,0]){
  const length=Math.hypot(...vector);
  if(length<1e-7)return [...fallback];
  return vector.map(value=>value/length);
}
function stableDirection(a,b,axis=null){
  const text=[String(a),String(b)].sort().join('\u0000');
  let hash=2166136261;
  for(const char of text){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
  const angle=(hash>>>0)/4294967296*Math.PI*2;
  let vector=[Math.cos(angle),Math.sin(angle)*.42,Math.sin(angle)];
  if(axis){
    const unit=normalized(axis);
    const dot=vector[0]*unit[0]+vector[1]*unit[1]+vector[2]*unit[2];
    vector=vector.map((value,index)=>value-unit[index]*dot);
  }
  return normalized(vector);
}
function makeFace(id,width,height,position,rotation,{kind='plane',curvature=0,readable=true}={}){
  return freeze({
    id,
    width:round(width),
    height:round(height),
    position:position.map(round),
    rotation:rotation.map(round),
    kind,
    curvature:round(curvature),
    readable:Boolean(readable),
  });
}

/** Return six bounded, outward-facing content anchors for one shape. */
export function createLivingSurfaceMap(shape='rectangle',options={}){
  const {depthRatio=.42,clearance=.018,profile}=options;
  finitePositive(depthRatio,'Living surface depth ratio');
  if(!Number.isFinite(clearance)||clearance<0)throw Error('Living surface clearance must be finite and non-negative');
  // Compatibility callers receive their six face IDs, but the dimensions and
  // front placement now come from the same wrapper used by the live scene.
  const layout=surfaceLayout({id:'surface-map',shape,profile}),w=layout.wrapper.width,
    h=layout.wrapper.height,d=layout.wrapper.depth;
  const byId=new Map([layout.primarySurface,...layout.secondarySurfaces].map(face=>[face.id,face]));
  if(!byId.has('back'))byId.set('back',surface('back',layout.primarySurface.width*.72,
    layout.primarySurface.height*.72,[0,0,-layout.wrapper.frontDepth],[0,Math.PI,0],[0,0,-1]));
  const top=()=>surface('top',w*.74,d*.74,[0,h/2+clearance,0],[-Math.PI/2,0,0],[0,1,0]);
  const bottom=()=>surface('bottom',w*.74,d*.74,[0,-h/2-clearance,0],[Math.PI/2,0,0],[0,-1,0]);
  if(!byId.has('top'))byId.set('top',top());
  if(!byId.has('bottom'))byId.set('bottom',bottom());
  const kind=layout.wrapper.contour==='circle'?'hemisphere':layout.wrapper.contour==='cylinder'?'arc':'face';
  const faces=FACE_IDS.map(id=>{
    const face=byId.get(id);
    return makeFace(id,face.width,face.height,face.position,face.rotation,
      {kind:id==='front'?kind:id==='back'?'back':'edge',
        curvature:(face.arcDegrees??0)*Math.PI/180,readable:id==='front'});
  });
  return freeze({shape:layout.wrapper.shape,body:freeze({...formFor(layout.wrapper.shape),...layout.bodyBounds}),
    primary:faces[0],faces});
}

/** The readable primary surface, not the whole body, projected into pixels. */
export function projectLivingSurface({shape='rectangle',profile,size=1,distance=9,approachScale=1,viewportHeight=900,fov=60}={}){
  for(const [value,name] of [[size,'Object size'],[distance,'Camera distance'],[approachScale,'Approach scale'],[viewportHeight,'Viewport height'],[fov,'Camera field of view']])finitePositive(value,name);
  const map=createLivingSurfaceMap(shape,{profile}),surface=map.primary;
  const pixelsPerUnit=viewportHeight/(2*distance*Math.tan(fov*Math.PI/360));
  const scale=size*approachScale;
  const body=map.body;
  return freeze({
    shape:map.shape,
    width:surface.width*scale*pixelsPerUnit,
    height:surface.height*scale*pixelsPerUnit,
    bodyWidth:body.width*scale*pixelsPerUnit,
    bodyHeight:body.height*scale*pixelsPerUnit,
    pixelsPerUnit,
    primary:surface,
  });
}

/**
 * Fit a live surface into a readable part of the viewport. It intentionally
 * clamps the panel, never the world object, so long content scrolls instead of
 * growing the geometry.
 */
export function fitLivingSurface({shape='rectangle',profile,size=1,distance=9,approachScale=1,viewportWidth=1280,viewportHeight=900,fov=60,safeWidth=32,safeHeight=176,inset=0,screenWidth=.64,screenHeight=.64}={}){
  for(const [value,name] of [[viewportWidth,'Viewport width'],[viewportHeight,'Viewport height']])finitePositive(value,name);
  if(!Number.isFinite(inset)||inset<0||inset>=.5)throw Error('Living surface inset must be between zero and one half');
  if(!Number.isFinite(screenWidth)||screenWidth<=0||screenWidth>1||!Number.isFinite(screenHeight)||screenHeight<=0||screenHeight>1)throw Error('Living surface screen limits must be between zero and one');
  const projected=projectLivingSurface({shape,profile,size,distance,approachScale,viewportHeight,fov});
  const availableWidth=Math.max(1,viewportWidth-safeWidth),availableHeight=Math.max(1,viewportHeight-safeHeight);
  const maxWidth=Math.max(1,availableWidth*screenWidth),maxHeight=Math.max(1,availableHeight*screenHeight);
  const scale=Math.min(1,maxWidth/projected.width,maxHeight/projected.height)*(1-inset*2);
  const width=Math.max(1,projected.width*scale),height=Math.max(1,projected.height*scale);
  return freeze({
    shape:projected.shape,
    width,
    height,
    objectWidth:Math.min(projected.bodyWidth,availableWidth),
    objectHeight:Math.min(projected.bodyHeight,availableHeight),
    aspectRatio:projected.width/projected.height,
    scale,
    maxWidth,
    maxHeight,
    scrollable:true,
    overflowed:scale<.999,
    primary:projected.primary,
  });
}

/** Calculate a camera distance that keeps a selected body readable but bounded. */
export function focusDistanceForLivingObject({shape='rectangle',profile,size=1,approachScale=1,viewportWidth=1280,viewportHeight=900,fov=60,occupancy=.54,minDistance=7.4,maxDistance=190}={}){
  for(const [value,name] of [[size,'Object size'],[approachScale,'Approach scale'],[viewportWidth,'Viewport width'],[viewportHeight,'Viewport height'],[fov,'Camera field of view'],[occupancy,'Focus occupancy'],[minDistance,'Minimum focus distance'],[maxDistance,'Maximum focus distance']])finitePositive(value,name);
  if(occupancy>=.9||minDistance>maxDistance)throw Error('Living focus bounds are invalid');
  const frame=focusDistance({shape,profile,size,approachScale,viewportWidth,viewportHeight,fov,occupancy});
  const unclamped=frame.distance;
  const distance=clamp(unclamped,minDistance,maxDistance);
  return freeze({
    shape:profile?String(shape):shapeOf(shape),
    distance,
    unclampedDistance:unclamped,
    occupancy,
    capped:Math.abs(distance-unclamped)>.0001,
    bodyRadius:frame.radius,
  });
}

/**
 * Relax a field of tabs without random motion.  Locked/anchor objects are
 * immovable; mutable neighbours receive the correction.  With an axis, the
 * solver prefers sideways motion so the Lens continues to read as a widening
 * cone rather than a flat pile.
 */
export function relaxLivingRealityLayout(objects,{gap=1.28,maxIterations=18,bounds=60,axis=null}={}){
  if(!Array.isArray(objects))throw Error('Living layout needs an object list');
  finitePositive(gap,'Living layout gap');
  if(!Number.isInteger(maxIterations)||maxIterations<1)throw Error('Living layout iterations must be a positive integer');
  finitePositive(bounds,'Living layout bounds');
  const axisUnit=axis?normalized(axis):null;
  const nodes=objects.map(object=>{
    if(!object?.id||!Array.isArray(object.position)||object.position.length!==3||object.position.some(value=>!Number.isFinite(value)))throw Error('Each living layout object needs an id and finite position');
    const profile=object.profile;
    const radius=profile?surfaceLayout({id:object.id,shape:object.shape,size:object.size??1,profile}).radius:
      realityTabRadius(object);
    return {...object,position:[...object.position],radius,fixed:Boolean(object.anchor||object.locked)};
  });
  let movedObjectCount=0;
  for(let iteration=0;iteration<maxIterations;iteration++){
    let moved=false;
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
      const a=nodes[i],b=nodes[j],delta=a.position.map((value,index)=>value-b.position[index]);
      let distance=Math.hypot(...delta),direction;
      if(distance<1e-6){direction=stableDirection(a.id,b.id,axisUnit);distance=1e-6;}
      else direction=delta.map(value=>value/distance);
      if(axisUnit){
        const axisDot=direction[0]*axisUnit[0]+direction[1]*axisUnit[1]+direction[2]*axisUnit[2];
        const lateral=direction.map((value,index)=>value-axisUnit[index]*axisDot);
        if(Math.hypot(...lateral)>.08)direction=normalized(lateral);
        else direction=stableDirection(a.id,b.id,axisUnit);
      }
      const minimum=a.radius+b.radius+gap;
      if(distance>=minimum)continue;
      const correction=(minimum-distance+.012);
      const weights=a.fixed&&b.fixed?[0,0]:a.fixed?[0,1]:b.fixed?[1,0]:[.5,.5];
      for(const [node,weight,sign] of [[a,weights[0],1],[b,weights[1],-1]]){
        if(!weight)continue;
        node.position=node.position.map((value,index)=>clamp(value+direction[index]*correction*weight*sign,-bounds,bounds));
        moved=true;movedObjectCount++;
      }
    }
    if(!moved)break;
  }
  let collisionCount=0,minimumGap=Infinity;
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    const a=nodes[i],b=nodes[j],distance=Math.hypot(...a.position.map((value,index)=>value-b.position[index]));
    const clearance=distance-a.radius-b.radius;minimumGap=Math.min(minimumGap,clearance);
    if(clearance<gap-.002)collisionCount++;
  }
  return freeze({
    objects:nodes.map(({radius,fixed,...object})=>({...object,position:object.position.map(round)})),
    diagnostics:{collisionCount,minimumGap:Number.isFinite(minimumGap)?round(minimumGap):null,movedObjectCount},
  });
}

export function createLivingSurfaceLayoutEngine(){
  return freeze({
    faces:FACE_IDS,
    surfaceMap:createLivingSurfaceMap,
    project:projectLivingSurface,
    fit:fitLivingSurface,
    focusFrame:focusDistanceForLivingObject,
    relax:relaxLivingRealityLayout,
  });
}

export const livingSurfaceLayoutEngine=createLivingSurfaceLayoutEngine();

// Bounded Reality Lens placement and projection APIs used by the current renderer.
/**
 * Pure projection geometry for a Reality Lens object. Coordinates on a
 * surface are local to its root; the object's workspace position is applied
 * by the renderer exactly once. Nothing here changes the canonical object.
 */

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
const WRAPPER_CONTOURS=new Set(['rounded-rectangle','circle','cylinder','wave','polygon']);
function polygonOutline(vertices){
  if(!Array.isArray(vertices)||vertices.length<3||vertices.length>24||vertices.some(point=>
    !Array.isArray(point)||point.length!==2||point.some(value=>!Number.isFinite(value)||Math.abs(value)>.5)))
    throw new RangeError('polygon outline needs 3–24 normalized [x,y] vertices within ±0.5');
  const outline=vertices.map(point=>[...point]);
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  let winding=0;
  for(let index=0;index<outline.length;index++){
    const a=outline[index],b=outline[(index+1)%outline.length],c=outline[(index+2)%outline.length];
    const bend=cross(a,b,c),center=cross(a,b,[0,0]);
    if(Math.abs(bend)<1e-6||Math.abs(center)<1e-6||winding&&bend*winding<0||bend*center<0)
      throw new RangeError('polygon outline must be convex, nondegenerate, and contain its center');
    winding=Math.sign(bend);
  }
  const xs=outline.map(point=>point[0]),ys=outline.map(point=>point[1]);
  if(Math.abs(Math.min(...xs)+.5)>.001||Math.abs(Math.max(...xs)-.5)>.001||
    Math.abs(Math.min(...ys)+.5)>.001||Math.abs(Math.max(...ys)-.5)>.001)
    throw new RangeError('polygon outline must span its declared body width and height');
  return outline;
}
function polygonContentBounds(outline,width,height,faceWidth,faceHeight){
  const inside=(x,y)=>outline.every((a,index)=>{
    const b=outline[(index+1)%outline.length],edgeX=(b[0]-a[0])*width,edgeY=(b[1]-a[1])*height;
    const pointX=x-a[0]*width,pointY=y-a[1]*height;
    const centerCross=edgeX*(-a[1]*height)-edgeY*(-a[0]*width);
    return (edgeX*pointY-edgeY*pointX)*centerCross>=-1e-9;
  });
  let low=0,high=1;
  for(let iteration=0;iteration<26;iteration++){
    const scale=(low+high)/2,x=faceWidth*scale/2,y=faceHeight*scale/2;
    if([[-x,-y],[-x,y],[x,-y],[x,y]].every(([px,py])=>inside(px,py)))low=scale;
    else high=scale;
  }
  return {width:ROUND(faceWidth*low*.96),height:ROUND(faceHeight*low*.96)};
}
function builtinWrapperProfile(shape){
  const form=formOf(shape),curved=shape==='sphere'||shape==='cylinder';
  return {body:{width:form.width,height:form.height,depth:form.depth},
    contour:shape==='sphere'?'circle':shape==='cylinder'?'cylinder':shape==='wave'?'wave':'rounded-rectangle',
    coverage:.9,cornerRadius:shape==='cube'?.07:form.radius,
    radius:curved?Math.min(form.width,form.depth)/2:undefined,
    centered:curved||shape==='cube'};
}
/** Profiles specify local physical dimensions, so one more object form can be
 * introduced without changing the renderer's placement algorithm. */
function wrapperProfile(shape,override){
  if(override!==undefined&&(override===null||typeof override!=='object'||Array.isArray(override)))
    throw new TypeError('wrapper profile must be an object');
  const base=builtinWrapperProfile(shape),input=override??{};
  const body={...base.body,...input.body};
  for(const axis of ['width','height','depth'])positive(body[axis],`profile body ${axis}`);
  const contour=input.contour??base.contour;
  if(!WRAPPER_CONTOURS.has(contour))throw new RangeError('profile contour must be rounded-rectangle, circle, cylinder, wave, or polygon');
  const outline=contour==='polygon'?polygonOutline(input.outline):null;
  const coverage=input.coverage??(input.inset===undefined?base.coverage:1-2*input.inset);
  if(!Number.isFinite(coverage)||coverage<=0||coverage>=1)
    throw new RangeError('profile coverage must be between zero and one');
  const cornerRadius=input.cornerRadius??base.cornerRadius;
  nonNegative(cornerRadius,'profile cornerRadius');
  const radius=input.radius??(contour==='circle'?Math.min(body.width,body.height,body.depth)/2:
    contour==='cylinder'?Math.min(body.width,body.depth)/2:undefined);
  if(radius!==undefined)positive(radius,'profile radius');
  if(contour==='circle'&&(
    Math.abs(body.width-body.height)>body.width*.001||
    Math.abs(body.width-body.depth)>body.width*.001||
    Math.abs(radius-body.width/2)>body.width*.001))
    throw new RangeError('circular sphere profile needs equal body dimensions and radius equal to half its diameter');
  if(contour==='cylinder'&&(
    Math.abs(body.width-body.depth)>body.width*.001||
    Math.abs(radius-body.width/2)>body.width*.001))
    throw new RangeError('cylinder profile needs equal width and depth and radius equal to half its diameter');
  const centered=input.centered??(contour==='circle'||contour==='cylinder'||shape==='cube');
  const clearance=centered?OFFSET:.04;
  const defaultFront=(contour==='circle'||contour==='cylinder'?radius:
    centered?body.depth/2:body.depth)+clearance;
  const frontDepth=input.frontDepth??defaultFront;
  positive(frontDepth,'profile frontDepth');
  const physicalFront=contour==='circle'||contour==='cylinder'?radius:
    centered?body.depth/2:body.depth;
  if(frontDepth<physicalFront+.001)
    throw new RangeError('profile frontDepth must place the readable face outside its body');
  return {body,contour,outline,coverage,cornerRadius,radius,centered:Boolean(centered),frontDepth};
}
function positionOf(position){
  const coordinates=Array.isArray(position)?position:[position?.x,position?.y,position?.z];
  if(coordinates.length!==3||coordinates.some(value=>!Number.isFinite(value)))
    throw new TypeError('position must contain three finite coordinates');
  return [...coordinates];
}
function boundingRadius(shape,form,contour=shape){
  if(contour==='circle'||contour==='sphere')return Math.min(form.width,form.height,form.depth)/2;
  if(contour==='cylinder')return Math.hypot(Math.min(form.width,form.depth)/2,form.height/2);
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
 * Describe the frame and its near-full readable face from the same profile.
 * size changes only the outer root scale and layout radius; copy density only
 * requests scrolling within the same face.
 */
export function surfaceLayout({id,shape='rectangle',size=1,contentDensity=0,position=[0,0,0],locked=false,profile}={}){
  if(id===undefined||id===null||String(id).length===0)throw new TypeError('object id is required');
  positive(size,'size');
  nonNegative(contentDensity,'contentDensity');
  const anchor=positionOf(position),name=profile?String(shape):shapeOf(shape);
  const selected=wrapperProfile(name,profile),form=selected.body;
  const {contour,coverage,frontDepth,centered}=selected;
  const bodyBounds={width:form.width,height:form.height,depth:form.depth};
  const radius=ROUND(boundingRadius(name,form,contour)*size);
  // The face is the outer presentation area. A rectangular control viewport
  // inside a circular skin must fit its diagonal inside the circle; otherwise
  // its corners protrude past the object even when both are centered.
  const faceWidth=ROUND(form.width*coverage),faceHeight=ROUND(form.height*coverage);
  const polygonContent=contour==='polygon'?polygonContentBounds(selected.outline,form.width,form.height,faceWidth,faceHeight):null;
  const contentWidth=polygonContent?.width??(contour==='circle'?ROUND(Math.min(faceWidth,form.width/Math.SQRT2*.96)):faceWidth);
  const contentHeight=polygonContent?.height??(contour==='circle'?ROUND(Math.min(faceHeight,form.height/Math.SQRT2*.96)):faceHeight);
  let primarySurface,secondarySurfaces;
  if(contour==='cylinder'){
    const r=selected.radius,primaryArc=ROUND(2*Math.asin(Math.min(.9999,faceWidth/(2*r)))*180/Math.PI),secondaryArc=40;
    primarySurface=surface('front',faceWidth,faceHeight,[0,0,frontDepth],[0,0,0],[0,0,1],primaryArc,r);
    secondarySurfaces=[
      curvedFace('left',r,-2*Math.PI/5,2*r*Math.sin(secondaryArc*Math.PI/360)*.92,form.height*.64,secondaryArc),
      curvedFace('right',r,2*Math.PI/5,2*r*Math.sin(secondaryArc*Math.PI/360)*.92,form.height*.64,secondaryArc),
      curvedFace('back',r,Math.PI,2*r*Math.sin(secondaryArc*Math.PI/360)*.92,form.height*.64,secondaryArc),
    ];
  }else if(contour==='circle'){
    const r=selected.radius,primaryArc=ROUND(2*Math.asin(Math.min(.9999,faceWidth/(2*r)))*180/Math.PI),secondaryArc=32;
    primarySurface=surface('front',faceWidth,faceHeight,[0,0,frontDepth],[0,0,0],[0,0,1],primaryArc,r);
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
    const clearance=centered?OFFSET:.04;
    const back=(centered?-form.depth/2:0)-clearance,sideZ=centered?0:form.depth/2;
    primarySurface=surface('front',faceWidth,faceHeight,[0,0,frontDepth],[0,0,0],[0,0,1]);
    secondarySurfaces=[
      surface('back',faceWidth,faceHeight,[0,0,back],[0,Math.PI,0],[0,0,-1]),
      surface('left',form.depth*.72,faceHeight,[-form.width/2-clearance,0,sideZ],[0,-Math.PI/2,0],[-1,0,0]),
      surface('right',form.depth*.72,faceHeight,[form.width/2+clearance,0,sideZ],[0,Math.PI/2,0],[1,0,0]),
    ];
    if(centered)secondarySurfaces.push(
      surface('top',faceWidth,form.depth*.72,[0,form.height/2+OFFSET,0],[-Math.PI/2,0,0],[0,1,0]),
      surface('bottom',faceWidth,form.depth*.72,[0,-form.height/2-OFFSET,0],[Math.PI/2,0,0],[0,-1,0]));
  }
  const wrapper={shape:name,contour,width:ROUND(form.width),height:ROUND(form.height),depth:ROUND(form.depth),
    frontDepth:ROUND(frontDepth),cornerRadius:ROUND(Math.min(selected.cornerRadius,form.width/2,form.height/2)),
    inset:ROUND((1-coverage)/2),coverage:ROUND(coverage),radius:selected.radius===undefined?null:ROUND(selected.radius),
    outline:selected.outline,
    frameBounds:{width:ROUND(form.width),height:ROUND(form.height)},
    contentBounds:{width:contentWidth,height:contentHeight}};
  return {objectId:String(id),primarySurface,secondarySurfaces,
    readableBounds:{width:contentWidth,height:contentHeight},bodyBounds,radius,wrapper,
    diagnostics:{shape:name,locked:Boolean(locked),anchorPosition:anchor,
      contentDensity,requiresScroll:contentDensity>1,geometryDependsOnContent:false}};
}

/** Inject more object forms without adding another shape-specific renderer
 * branch. A per-object profile may still override a registry entry. */
export function createLivingSurfaceComposer({profiles={}}={}){
  if(!profiles||typeof profiles!=='object'||Array.isArray(profiles))throw new TypeError('profiles must be an object');
  const registry=new Map(Object.entries(profiles).map(([shape,profile])=>{
    if(!shape)throw new TypeError('profile shape must have an id');
    return [shape,wrapperProfile(shape,profile)];
  }));
  return Object.freeze({
    profileFor(shape){return registry.has(shape)?structuredClone(registry.get(shape)):wrapperProfile(shape);},
    surfaceLayout(options={}){return surfaceLayout({...options,profile:options.profile??registry.get(options.shape)});},
    focusDistance(options={}){return focusDistance({...options,profile:options.profile??registry.get(options.shape)});},
    solveLivingLayout(items,options={}){return solveLivingLayout(items,{...options,profiles:Object.fromEntries(registry)});},
  });
}

/** Camera framing from the scaled body's actual projected width and height.
 * Content length never enters this calculation; it scrolls on the skin. */
export function focusDistance({shape='rectangle',profile,size=1,baseScale=1,approachScale=1,
  viewportWidth,viewportHeight,fov=60,occupancy=.5}={}){
  const width=positive(viewportWidth,'viewportWidth'),height=positive(viewportHeight,'viewportHeight');
  const scale=positive(size,'size')*positive(baseScale,'baseScale')*positive(approachScale,'approachScale');
  if(!Number.isFinite(fov)||fov<=0||fov>=170)throw new RangeError('fov must be between 0 and 170 degrees');
  if(!Number.isFinite(occupancy)||occupancy<=0||occupancy>1)
    throw new RangeError('occupancy must be between 0 and 1');
  const name=profile?String(shape):shapeOf(shape),selected=wrapperProfile(name,profile),form=selected.body;
  const radius=boundingRadius(name,form,selected.contour)*scale;
  const tanVertical=Math.tan(fov*Math.PI/360),tanHorizontal=tanVertical*width/height;
  // The cube may present a diagonal when viewed from its side; the cylinder
  // and sphere retain their silhouettes as the observer moves around them.
  const box=selected.centered&&!['circle','cylinder'].includes(selected.contour);
  const projectedWidth=(box?Math.hypot(form.width,form.depth):form.width)*scale;
  const projectedHeight=(box?Math.hypot(form.height,form.depth):form.height)*scale;
  const frontDepth=selected.frontDepth*scale;
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
export function solveLivingLayout(items,{gap=.3,iterations=128,profiles={}}={}){
  if(!Array.isArray(items))throw new TypeError('items must be an array');
  nonNegative(gap,'gap');
  if(!Number.isInteger(iterations)||iterations<1)throw new RangeError('iterations must be a positive integer');
  if(!profiles||typeof profiles!=='object'||Array.isArray(profiles))throw new TypeError('profiles must be an object');
  const ids=new Set();
  const objects=items.map((item,index)=>{
    if(!item||item.id===undefined||item.id===null||String(item.id).length===0)
      throw new TypeError(`item ${index} needs an id`);
    const id=String(item.id);
    if(ids.has(id))throw new TypeError(`duplicate object id: ${id}`);
    ids.add(id);
    const profile=item.profile??profiles[item.shape];
    const shape=profile?String(item.shape??'rectangle'):shapeOf(item.shape),size=positive(item.size??1,'size');
    const selected=profile?wrapperProfile(shape,profile):null;
    return {...item,id,position:positionOf(item.position??[0,0,0]),
      radius:ROUND(selected?boundingRadius(shape,selected.body,selected.contour)*size:
        realityTabRadius({...item,shape,size}))};
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

/** The drag preview and recorded move use the same profile-aware resolver. */
export function resolveLivingTabPosition(id,proposed,objects,{shapeProfiles={}}={}){
  const profileFor=object=>shapeProfiles[object.id]?.[object.shape];
  if(!objects.some(object=>profileFor(object)))return resolveRealityTabPosition(id,proposed,objects);
  const packed=solveLivingLayout(objects.map(object=>({
    ...object,position:object.id===id?proposed:object.position,pinned:object.id!==id,
    ...(profileFor(object)?{profile:profileFor(object)}:{}),
  })),{gap:REALITY_TAB_GAP});
  const moving=packed.objects.find(object=>object.id===id);
  if(!moving)throw Error('Unknown object');
  if(packed.objects.some(object=>object.id!==id&&Math.hypot(...moving.position.map((value,axis)=>value-object.position[axis]))<
    moving.radius+object.radius+REALITY_TAB_GAP-.001))
    throw Error('No collision-free space is available here. Move a nearby tab first.');
  return moving.position.map(value=>Math.round(value*1000)/1000);
}

/** The same wheel gesture has one owner at a time. */
export function wheelIntent({overContent=false,overObject=false,mutable=true}={}){
  if(overContent)return 'scroll';
  if(overObject&&mutable)return 'resize';
  return 'travel';
}
