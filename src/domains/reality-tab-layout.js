/** Shared presentation bounds for movable Reality Lens tabs. These are local
 * view objects only; form and collision rules never alter domain state. */
export const REALITY_TAB_FORMS=Object.freeze({
  phone:Object.freeze({label:'Phone',width:.86,height:1.5,depth:.14,radius:.16}),
  square:Object.freeze({label:'Square',width:1.28,height:1.28,depth:.14,radius:.18}),
  rectangle:Object.freeze({label:'Rectangle',width:1.92,height:1.12,depth:.14,radius:.14}),
  sphere:Object.freeze({label:'Sphere',width:1.45,height:1.45,depth:1.45,radius:.72}),
  cylinder:Object.freeze({label:'Cylinder',width:1.36,height:1.64,depth:1.36,radius:.68}),
  cube:Object.freeze({label:'Cube',width:1.42,height:1.42,depth:1.42,radius:.71}),
  wave:Object.freeze({label:'Wave',width:1.92,height:1.12,depth:.18,radius:.98}),
});
// The nominal wave height is the midline-to-midline panel height. Its
// two crest/trough edges add 7.5% on each side to the front envelope.
// Share the actual sampled contour between the 3D cap and CSS skin;
// the extrusion bevel is a separate visual rim.
export const WAVE_TAB_PROFILE=Object.freeze({amplitude:.075,cycles:2,segments:28});
export function waveTabEnvelopeHeight(height){
  return height*(1+2*WAVE_TAB_PROFILE.amplitude);
}
export function waveTabContour(width,height){
  if(!Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0)throw Error('Wave dimensions must be finite and positive');
  const {amplitude,cycles,segments}=WAVE_TAB_PROFILE,points=[];
  for(let i=0;i<=segments;i++){
    const t=i/segments;
    points.push(Object.freeze([-width/2+width*t,height/2+Math.sin(t*Math.PI*2*cycles)*height*amplitude]));
  }
  for(let i=segments;i>=0;i--){
    const t=i/segments;
    points.push(Object.freeze([-width/2+width*t,-height/2-Math.sin(t*Math.PI*2*cycles)*height*amplitude]));
  }
  return Object.freeze(points);
}
export const REALITY_TAB_FORM_IDS=Object.freeze(Object.keys(REALITY_TAB_FORMS));
export const REALITY_TAB_SIZE_MIN=.35;
export const REALITY_TAB_SIZE_MAX=24;
// Quiet breathing room: enough for distinct living objects to read apart,
// without splitting the Reality Lens into a disconnected galaxy.
export const REALITY_TAB_GAP=1.28;
const ROUND=value=>Math.round(value*1000)/1000;

export function normalizeRealityTabShape(value){
  if(!REALITY_TAB_FORMS[value])throw Error(`Choose one of the supported tab forms: ${REALITY_TAB_FORM_IDS.join(', ')}`);
  return value;
}

export function normalizeRealityTabSize(value){
  if(!Number.isFinite(value)||value<REALITY_TAB_SIZE_MIN||value>REALITY_TAB_SIZE_MAX)throw Error(`Tab size must be between ${REALITY_TAB_SIZE_MIN} and ${REALITY_TAB_SIZE_MAX}`);
  return ROUND(value);
}

export function realityTabRadius(object){
  if(object.anchor)return 2.92;
  const form=REALITY_TAB_FORMS[object.shape]??REALITY_TAB_FORMS.rectangle;
  const halfDiagonal=Math.hypot(form.width/2,form.height/2,form.depth/2);
  return halfDiagonal*(Number.isFinite(object.size)?object.size:1);
}

/** Keep a user move or resize from intersecting another spatial tab. If the
 * requested destination is occupied, move only the edited tab to the nearest
 * available side; fixed/locked neighbors keep their positions. */
export function resolveRealityTabPosition(id,proposed,objects){
  if(!Array.isArray(proposed)||proposed.length!==3||proposed.some(value=>!Number.isFinite(value)))throw Error('Position must contain three finite coordinates within the workspace');
  const candidate=proposed.map(value=>Math.max(-60,Math.min(60,value)));
  const moving=objects.find(object=>object.id===id);
  if(!moving)throw Error('Unknown object');
  const movingRadius=realityTabRadius(moving);
  for(let iteration=0;iteration<64;iteration++){
    let adjusted=false;
    for(const other of objects){
      if(other.id===id)continue;
      const otherPosition=other.position;
      const delta=candidate.map((value,axis)=>value-otherPosition[axis]);
      let distance=Math.hypot(...delta);
      const minimum=movingRadius+realityTabRadius(other)+REALITY_TAB_GAP;
      if(distance>=minimum)continue;
      if(distance<1e-6){
        const seed=[...id].reduce((sum,char)=>sum+char.charCodeAt(0),0)+iteration;
        const angle=seed*2.399963229728653;
        delta[0]=Math.cos(angle);delta[1]=Math.sin(angle)*.35;delta[2]=Math.sin(angle);
        distance=Math.hypot(...delta);
      }
      const push=(minimum-distance)+.015;
      for(let axis=0;axis<3;axis++)candidate[axis]=Math.max(-60,Math.min(60,candidate[axis]+delta[axis]/distance*push));
      adjusted=true;
    }
    if(!adjusted)return candidate.map(ROUND);
  }
  const stillOverlapping=objects.some(other=>other.id!==id&&Math.hypot(...candidate.map((value,axis)=>value-other.position[axis]))<movingRadius+realityTabRadius(other)+REALITY_TAB_GAP-.001);
  if(stillOverlapping)throw Error('No collision-free space is available here. Move a nearby tab first.');
  return candidate.map(ROUND);
}
