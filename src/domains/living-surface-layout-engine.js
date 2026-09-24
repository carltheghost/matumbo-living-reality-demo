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

function planarSurfaceLayout(shape,{clearance=.018,depthRatio=.42}={}){
  const form=formFor(shape),width=form.width,height=form.height;
  const depth=Math.max(form.depth,Math.min(width,height)*depthRatio);
  const z=depth/2+clearance;
  // Keep the primary silhouette true to the chosen tab form. A phone stays
  // portrait and a wave stays wide even when its content becomes scrollable.
  const frontWidth=width*.9,frontHeight=height*.9;
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
  const frontWidth=Math.min(form.width*.84,2*radius*Math.sin(arc/2)*.98,maxHeight*aspect);
  const frontHeight=frontWidth/aspect;
  const sideWidth=Math.max(.42,frontWidth*.58),sideHeight=Math.min(height*.64,frontHeight*.82);
  const cap=Math.min(radius*1.26,frontWidth*.92);
  return [
    makeFace('front',frontWidth,frontHeight,[0,0,radius+clearance],[0,0,0],{kind:'arc',curvature:arc}),
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
    makeFace('front',primary,primary,[0,0,radius+clearance],[0,0,0],{kind:'hemisphere',curvature:Math.PI*.58}),
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
    relax:relaxLivingRealityLayout,
  });
}

export const livingSurfaceLayoutEngine=createLivingSurfaceLayoutEngine();
