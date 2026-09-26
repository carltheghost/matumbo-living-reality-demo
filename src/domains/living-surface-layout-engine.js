import {REALITY_TAB_FORMS, realityTabRadius} from './reality-tab-layout.js';

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

const percent=value=>`${round(value)}%`;
function waveSurfaceClipPath(steps=24){
  const amplitude=.075,half=.5+amplitude,points=[];
  for(let index=0;index<=steps;index++){
    const t=index/steps,sine=Math.sin(t*Math.PI*4);
    const y=(half-(.5+amplitude*sine))/(half*2)*100;
    points.push(`${percent(t*100)} ${percent(y)}`);
  }
  for(let index=steps;index>=0;index--){
    const t=index/steps,sine=Math.sin(t*Math.PI*4);
    const y=(half-(-.5-amplitude*sine))/(half*2)*100;
    points.push(`${percent(t*100)} ${percent(y)}`);
  }
  return `polygon(${points.join(',')})`;
}

/** CSS silhouette for the same physical body used by the Three.js tab. */
export function livingSurfaceClipPath(shape='rectangle'){
  const resolved=REALITY_TAB_FORMS[shape]?shape:'rectangle';
  if(resolved==='wave')return waveSurfaceClipPath();
  if(resolved==='sphere')return 'ellipse(50% 50% at 50% 50%)';
  if(resolved==='cylinder')return 'inset(0 round 48% / 15%)';
  if(resolved==='phone')return 'inset(0 round 9%)';
  if(resolved==='square'||resolved==='cube')return 'inset(0 round 2.5%)';
  return 'inset(0 round 7%)';
}

function planarSurfaceLayout(shape,{clearance=.018,depthRatio=.42}={}){
  const form=formFor(shape),width=form.width,height=form.height;
  const depth=form.depth;
  // Extruded forms are authored from z=0 to z=depth. The skin belongs to
  // that front wall, not to an invented thicker, disconnected box.
  const z=depth+clearance;
  // The readable skin IS the front of the body, not a smaller browser card
  // pasted inside it. A wave includes the crest/trough envelope of its mesh.
  const frontWidth=width,frontHeight=shape==='wave'?height*1.15:height;
  return [
    makeFace('front',frontWidth,frontHeight,[0,0,z],[0,0,0],{kind:'front'}),
    makeFace('back',width*.82,height*.82,[0,0,-z],[0,Math.PI,0],{kind:'back',readable:false}),
    makeFace('left',depth*.82,height*.76,[-width/2-clearance,0,0],[0,-Math.PI/2,0],{kind:'edge',readable:false}),
    makeFace('right',depth*.82,height*.76,[width/2+clearance,0,0],[0,Math.PI/2,0],{kind:'edge',readable:false}),
    makeFace('top',width*.74,depth*.74,[0,height/2+clearance,0],[-Math.PI/2,0,0],{kind:'edge',readable:false}),
    makeFace('bottom',width*.74,depth*.74,[0,-height/2-clearance,0],[Math.PI/2,0,0],{kind:'edge',readable:false}),
  ];
}

function cylinderSurfaceLayout({clearance=.018,depthRatio=.42}={}){
  const form=formFor('cylinder'),radius=Math.max(form.radius,form.depth/2,form.width/2*.94),height=form.height;
  const arc=Math.PI*.64;
  // A chord is deliberately smaller than the cylinder wall. The primary
  // reading face lives on the front arc rather than filling its whole height.
  const aspect=form.width/form.height,maxHeight=height*.76;
  const frontWidth=Math.min(form.width*.9,2*radius*Math.sin(arc/2)*.98,maxHeight*aspect);
  const frontHeight=frontWidth/aspect;
  const sideWidth=Math.max(.42,frontWidth*.58),sideHeight=Math.min(height*.64,frontHeight*.82);
  const cap=Math.min(radius*1.26,frontWidth*.92);
  return [
    makeFace('front',frontWidth,frontHeight,[0,0,Math.sqrt(radius*radius-(frontWidth/2)**2)+clearance],[0,0,0],{kind:'arc',curvature:arc}),
    makeFace('back',frontWidth*.78,frontHeight*.76,[0,0,-radius-clearance],[0,Math.PI,0],{kind:'arc',curvature:arc,readable:false}),
    makeFace('left',sideWidth,sideHeight,[-radius-clearance,0,0],[0,-Math.PI/2,0],{kind:'arc',curvature:arc*.58,readable:false}),
    makeFace('right',sideWidth,sideHeight,[radius+clearance,0,0],[0,Math.PI/2,0],{kind:'arc',curvature:arc*.58,readable:false}),
    makeFace('top',cap,cap,[0,height/2+clearance,0],[-Math.PI/2,0,0],{kind:'cap',readable:false}),
    makeFace('bottom',cap,cap,[0,-height/2-clearance,0],[Math.PI/2,0,0],{kind:'cap',readable:false}),
  ];
}

function sphereSurfaceLayout({clearance=.018,depthRatio=.42}={}){
  const form=formFor('sphere'),radius=Math.max(form.radius,Math.min(form.width,form.height,form.depth)/2);
  // Keep text on the front hemisphere. The other tangent segments exist for
  // atmosphere and short metadata, not as duplicate browser windows.
  const primary=radius*1.62,side=radius*.88,cap=radius*1.08;
  return [
    makeFace('front',primary,primary,[0,0,Math.sqrt(radius*radius-(primary/2)**2)+clearance],[0,0,0],{kind:'hemisphere',curvature:Math.PI*.58}),
    makeFace('back',primary*.68,primary*.68,[0,0,-radius-clearance],[0,Math.PI,0],{kind:'hemisphere',curvature:Math.PI*.42,readable:false}),
    makeFace('left',side,side,[-radius*.86-clearance,0,radius*.16],[0,-Math.PI/2.55,0],{kind:'hemisphere',curvature:Math.PI*.34,readable:false}),
    makeFace('right',side,side,[radius*.86+clearance,0,radius*.16],[0,Math.PI/2.55,0],{kind:'hemisphere',curvature:Math.PI*.34,readable:false}),
    makeFace('top',cap,cap,[0,radius*.86+clearance,0],[-Math.PI/2.55,0,0],{kind:'hemisphere',curvature:Math.PI*.3,readable:false}),
    makeFace('bottom',cap,cap,[0,-radius*.86-clearance,0],[Math.PI/2.55,0,0],{kind:'hemisphere',curvature:Math.PI*.3,readable:false}),
  ];
}

function cubeSurfaceLayout({clearance=.018,depthRatio=.42}={}){
  const form=formFor('cube'),edge=Math.min(form.width,form.height,form.depth),half=edge/2+clearance;
  const primary=edge*.88,side=edge*.7;
  return [
    makeFace('front',primary,primary,[0,0,half],[0,0,0],{kind:'face'}),
    makeFace('back',side,side,[0,0,-half],[0,Math.PI,0],{kind:'face',readable:false}),
    makeFace('left',side,side,[-half,0,0],[0,-Math.PI/2,0],{kind:'face',readable:false}),
    makeFace('right',side,side,[half,0,0],[0,Math.PI/2,0],{kind:'face',readable:false}),
    makeFace('top',side,side,[0,half,0],[-Math.PI/2,0,0],{kind:'face',readable:false}),
    makeFace('bottom',side,side,[0,-half,0],[Math.PI/2,0,0],{kind:'face',readable:false}),
  ];
}

/** Return six bounded, outward-facing content anchors for one shape. */
export function createLivingSurfaceMap(shape='rectangle',options={}){
  const {depthRatio=.42,clearance=.018}=options;
  finitePositive(depthRatio,'Living surface depth ratio');
  if(!Number.isFinite(clearance)||clearance<0)throw Error('Living surface clearance must be finite and non-negative');
  const resolved=REALITY_TAB_FORMS[shape]?shape:'rectangle';
  const faces=resolved==='cylinder'
    ?cylinderSurfaceLayout({depthRatio,clearance})
    :resolved==='sphere'
      ?sphereSurfaceLayout({depthRatio,clearance})
      :resolved==='cube'
        ?cubeSurfaceLayout({depthRatio,clearance})
        :planarSurfaceLayout(resolved,{depthRatio,clearance});
  return freeze({shape:resolved,body:freeze({...formFor(resolved)}),primary:faces[0],faces});
}

/**
 * Optical layout, not texture resolution. One CSS pixel should project to
 * approximately one screen pixel when reading. A fixed 320px/unit raster
 * made 16px text microscopic on phone/cylinder bodies. Quantization plus a
 * caller-side hysteresis prevents continuous layout while approaching.
 */
export function composeLivingSurface({shape='rectangle',worldScale=1,verticalScale=worldScale,distance=9,viewportWidth=1280,viewportHeight=900,fov=60,faceCosine=1}={}){
  for(const [value,name] of [[worldScale,'World scale'],[distance,'Surface distance'],[viewportWidth,'Viewport width'],[viewportHeight,'Viewport height'],[fov,'Camera field of view']])finitePositive(value,name);
  if(fov>=179||!Number.isFinite(faceCosine)||faceCosine<-1||faceCosine>1)throw Error('Invalid readable projection');
  finitePositive(verticalScale,'Vertical world scale');
  const map=createLivingSurfaceMap(shape),face=map.primary;
  const pixelsPerUnit=viewportHeight*worldScale/(2*distance*Math.tan(fov*Math.PI/360));
  const density=Math.max(8,Math.round(pixelsPerUnit/8)*8);
  const densityY=Math.max(8,Math.round(pixelsPerUnit*verticalScale/worldScale/8)*8);
  const width=Math.max(1,Math.round(face.width*density)),height=Math.max(1,Math.round(face.height*densityY));
  const actualWidth=face.width*pixelsPerUnit*Math.max(0,faceCosine),actualHeight=face.height*pixelsPerUnit*verticalScale/worldScale;
  const inset=shape==='sphere'?Math.round(width*.15):shape==='cylinder'?Math.round(width*.07):16;
  return freeze({shape:map.shape,width,height,pixelsPerUnit:density,pixelsPerUnitY:densityY,cssScale:1/density,cssScaleY:1/densityY,
    actualWidth,actualHeight,columns:width-inset*2>=620?2:1,inset,
    textPx:16,touchPx:44,readable:actualWidth>=160&&actualHeight>=160&&faceCosine>=.72,
    needsTurn:faceCosine<.92,mode:width<220?'compact':width<620?'reading':'expanded',
    // No letter shrinking and no silhouette stretching to fit long content.
    overflow:'scroll',bodyMutation:false,source:'owning-object-projection'});
}

/** A device projection may reflow the whole body, never the canonical entity.
 * Wide forms unfold vertically on a portrait phone; tall forms broaden in
 * landscape. Corners, cut facets, wave edges and volume travel together. */
export function livingReadingProjection({shape='rectangle',viewportWidth=1280,viewportHeight=900}={}){
  finitePositive(viewportWidth,'Viewport width');finitePositive(viewportHeight,'Viewport height');
  const face=createLivingSurfaceMap(shape).primary;
  const landscape=viewportHeight<=600&&viewportWidth>viewportHeight;
  const portrait=!landscape&&viewportWidth<=700;
  const aspect=face.width/face.height;
  const targetAspect=landscape?Math.max(aspect,1.7):portrait?Math.min(aspect,.78):aspect;
  const stretch=targetAspect>aspect?[targetAspect/aspect,1,1]:[1,aspect/targetAspect,1];
  return freeze({shape:createLivingSurfaceMap(shape).shape,stretch,
    mode:landscape?'landscape':portrait?'portrait':'desktop',
    safeTop:landscape?60:portrait?182:112,safeBottom:landscape?72:portrait?186:142,safeSide:landscape?28:portrait?20:48,
    targetAspect,canonicalShapeUnchanged:true,authority:'projection-only'});
}

/** Fit an entire body and its reading skin inside usable chrome-free space. */
export function readingFrameForLivingObject({shape='rectangle',size=1,approachScale=1,stretch=[1,1,1],viewportWidth=1280,viewportHeight=900,fov=60,safeTop=110,safeBottom=150,safeSide=20,maxDistance=190}={}){
  for(const [value,name] of [[size,'Object size'],[approachScale,'Approach scale'],[viewportWidth,'Viewport width'],[viewportHeight,'Viewport height'],[fov,'Camera field of view']])finitePositive(value,name);
  if([safeTop,safeBottom,safeSide].some(value=>!Number.isFinite(value)||value<0)||fov>=179)throw Error('Invalid reading frame');
  if(!Array.isArray(stretch)||stretch.length!==3||stretch.some(value=>!Number.isFinite(value)||value<=0))throw Error('Invalid reading stretch');
  const {body,primary}=createLivingSurfaceMap(shape),scale=size*approachScale;
  const availableWidth=Math.max(80,viewportWidth-safeSide*2),availableHeight=Math.max(100,viewportHeight-safeTop-safeBottom);
  const tangent=Math.tan(fov*Math.PI/360),unit=viewportHeight/(2*tangent);
  // Account for the skin being forward of the center. Looking at just the
  // center-distance allowed sphere surfaces to leap over the header.
  const skinDistance=Math.max(primary.width*stretch[0]*unit/availableWidth,primary.height*stretch[1]*unit/availableHeight)*scale;
  const bodyDistance=Math.max(body.width*stretch[0]*unit/availableWidth,body.height*stretch[1]*unit/availableHeight)*scale;
  const wanted=Math.max(skinDistance+primary.position[2]*stretch[2]*scale,bodyDistance)*1.025;
  const distance=clamp(wanted,.7,maxDistance);
  return freeze({distance,unclampedDistance:wanted,capped:distance!==wanted,
    targetYOffset:(safeBottom-safeTop)/2/viewportHeight*2*distance*tangent,
    availableWidth,availableHeight,occupancy:availableHeight/viewportHeight,
    bodyRadius:realityTabRadius({shape,size})*approachScale});
}

/** The readable primary surface, not the whole body, projected into pixels. */
export function projectLivingSurface({shape='rectangle',size=1,distance=9,approachScale=1,viewportHeight=900,fov=60}={}){
  for(const [value,name] of [[size,'Object size'],[distance,'Camera distance'],[approachScale,'Approach scale'],[viewportHeight,'Viewport height'],[fov,'Camera field of view']])finitePositive(value,name);
  const surface=createLivingSurfaceMap(shape).primary;
  const pixelsPerUnit=viewportHeight/(2*distance*Math.tan(fov*Math.PI/360));
  const scale=size*approachScale;
  const body=formFor(shape);
  return freeze({
    shape:createLivingSurfaceMap(shape).shape,
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
export function fitLivingSurface({shape='rectangle',size=1,distance=9,approachScale=1,viewportWidth=1280,viewportHeight=900,fov=60,safeWidth=32,safeHeight=176,inset=0,screenWidth=.64,screenHeight=.64}={}){
  for(const [value,name] of [[viewportWidth,'Viewport width'],[viewportHeight,'Viewport height']])finitePositive(value,name);
  if(!Number.isFinite(inset)||inset<0||inset>=.5)throw Error('Living surface inset must be between zero and one half');
  if(!Number.isFinite(screenWidth)||screenWidth<=0||screenWidth>1||!Number.isFinite(screenHeight)||screenHeight<=0||screenHeight>1)throw Error('Living surface screen limits must be between zero and one');
  const projected=projectLivingSurface({shape,size,distance,approachScale,viewportHeight,fov});
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
export function focusDistanceForLivingObject({shape='rectangle',size=1,approachScale=1,viewportWidth=1280,viewportHeight=900,fov=60,occupancy=.54,minDistance=7.4,maxDistance=190}={}){
  for(const [value,name] of [[size,'Object size'],[approachScale,'Approach scale'],[viewportWidth,'Viewport width'],[viewportHeight,'Viewport height'],[fov,'Camera field of view'],[occupancy,'Focus occupancy'],[minDistance,'Minimum focus distance'],[maxDistance,'Maximum focus distance']])finitePositive(value,name);
  if(occupancy>=.9||minDistance>maxDistance)throw Error('Living focus bounds are invalid');
  const form=formFor(shape),scale=size*approachScale,viewportAspect=viewportWidth/viewportHeight;
  // Preserve both vertical and horizontal breathing room. A wide wave uses
  // its width as the limiting dimension; a tall phone/cylinder uses height.
  const apparentHeight=Math.max(form.height,form.width/Math.max(.35,viewportAspect))*scale;
  const unclamped=apparentHeight/(2*occupancy*Math.tan(fov*Math.PI/360));
  const distance=clamp(unclamped,minDistance,maxDistance);
  return freeze({
    shape:REALITY_TAB_FORMS[shape]?shape:'rectangle',
    distance,
    unclampedDistance:unclamped,
    occupancy,
    capped:Math.abs(distance-unclamped)>.0001,
    bodyRadius:realityTabRadius({shape,size})*approachScale,
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
    return {...object,position:[...object.position],radius:realityTabRadius(object),fixed:Boolean(object.anchor||object.locked)};
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
    readingFrame:readingFrameForLivingObject,
    compose:composeLivingSurface,
    readingProjection:livingReadingProjection,
    clipPath:livingSurfaceClipPath,
    relax:relaxLivingRealityLayout,
  });
}

export const livingSurfaceLayoutEngine=createLivingSurfaceLayoutEngine();
