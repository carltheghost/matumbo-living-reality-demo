import {createRealitySurfaceGeometry} from './reality-surface-geometry.js?v=20261003-skin360';
import {createRealitySurfaceAtlas} from './reality-surface-atlas.js?v=20261003-skin360';
import {REALITY_TAB_FORMS} from '../domains/reality-tab-layout.js?v=20261003-skin360';

/** Each of the six existing spaces has a different physical family. */
export const REALITY_HOME_SHAPES = Object.freeze({
  worlds: 'cube', people: 'sphere', network: 'octahedron', value: 'cylinder', agents: 'torus', experiences: 'triangular-prism',
});
const ACCENTS = Object.freeze({worlds:'#6bbaff', people:'#b4baff', network:'#77d1de', value:'#9dd2f2', agents:'#6fe1ee', experiences:'#9ab4ff'});
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Home previews list the real members. Only entering the space is an action;
 * a member name never pretends to be a working individual feature button. */
export function createHomeSurfaceDocument({id, label, description = '', members = [], onOpen} = {}) {
  const features = members.map(member => member.feature ?? member).filter(feature => feature?.id);
  const blocks = [
    {id:`${id}:open`, kind:'button', text:`Open ${label}`, actionId:`open-space:${id}`},
    {id:`${id}:purpose`, kind:'text', text:clean(description)},
    {id:`${id}:count`, kind:'text', text:`${features.length} ${features.length === 1 ? 'object' : 'objects'} in this space`},
    ...features.map(feature => ({id:`${id}:member:${feature.id}`, kind:'text', text:[clean(feature.label ?? feature.title ?? feature.id), clean(feature.description)].filter(Boolean).join(' — ')})),
  ];
  return {read:()=>blocks, activate:actionId=>actionId===`open-space:${id}`?(onOpen?.(id)??false):false,
    features, label, description:clean(description), id};
}

function lines(context, text, width, maximum = Infinity) {
  const output = [], words = clean(text).split(' '); let row = '';
  for (const word of words) {
    const candidate = row ? `${row} ${word}` : word;
    if (row && context.measureText(candidate).width > width) { output.push(row); row = word; }
    else row = candidate;
  }
  if (row) output.push(row);
  if (output.length > maximum) { output.length = maximum; output[maximum - 1] = `${output[maximum - 1].replace(/[.,;:]$/, '')}…`; }
  return output;
}

/** A torus's chart axes turn around the ring. Project the home title through
 * those UVs so its letters read across the upper arc instead of shrinking into
 * eight diagonal labels. This changes ink on the same curved mesh only. */
function paintTorusHeading(ctx, canvas, chart, document, accent) {
  const source=globalThis.document.createElement('canvas');source.width=source.height=768;
  const title=source.getContext('2d'),side=768;
  title.textAlign='center';title.textBaseline='top';title.fillStyle='#f0f8ff';
  title.font='700 112px system-ui, -apple-system, "Segoe UI", sans-serif';
  title.fillText('Agents',side/2,side*.09,side*.68);
  title.fillStyle=accent;title.font='600 47px system-ui, -apple-system, "Segoe UI", sans-serif';
  title.fillText('OPEN SPACE',side/2,side*.77,side*.58);
  title.font='500 29px system-ui, -apple-system, "Segoe UI", sans-serif';
  title.fillText(`${document.features.length} objects`,side/2,side*.85,side*.46);
  const pixels=title.getImageData(0,0,side,side).data,paint=ctx.getImageData(0,0,canvas.width,canvas.height);
  const match=/ring-(\d+)-tube-(\d+)/.exec(chart.id),section=Number(match?.[1]??0),half=Number(match?.[2]??0);
  const major=chart.width*2/Math.PI,tube=chart.height/Math.PI,outer=major+tube;
  const angles=Array.from({length:canvas.width},(_,x)=>(section+(x+.5)/canvas.width)*Math.PI/2);
  for(let y=0;y<canvas.height;y++){
    const phi=(half+1-(y+.5)/canvas.height)*Math.PI,radius=(major+tube*Math.cos(phi))/outer;
    for(let x=0;x<canvas.width;x++){
      const sx=Math.max(0,Math.min(side-1,Math.floor((.5+(half?-1:1)*radius*Math.cos(angles[x])*.5)*side)));
      const sy=Math.max(0,Math.min(side-1,Math.floor((.5-radius*Math.sin(angles[x])*.5)*side)));
      const from=(sy*side+sx)*4,alpha=pixels[from+3]/255;if(!alpha)continue;
      const to=(y*canvas.width+x)*4;
      for(let channel=0;channel<3;channel++)paint.data[to+channel]=pixels[from+channel]*alpha+paint.data[to+channel]*(1-alpha);
    }
  }
  ctx.putImageData(paint,0,0);
}

/** Project one large title through the diamond's actual facet UVs. It reads
 * across adjacent faces instead of repeating tiny labels on eight triangles. */
function paintDiamondHeading(ctx,canvas,chart,document,accent){
  const source=globalThis.document.createElement('canvas');source.width=source.height=768;
  const title=source.getContext('2d'),side=768;
  title.textAlign='center';title.textBaseline='top';title.fillStyle='#f0f8ff';
  title.font='700 94px system-ui, -apple-system, "Segoe UI", sans-serif';
  title.fillText('Network',side/2,side*.33,side*.63);
  title.font='700 83px system-ui, -apple-system, "Segoe UI", sans-serif';
  title.fillText('& tools',side/2,side*.47,side*.64);
  title.fillStyle=accent;title.font='600 34px system-ui, -apple-system, "Segoe UI", sans-serif';
  title.fillText(`${document.features.length} OBJECTS`,side/2,side*.63,side*.5);
  title.fillText('OPEN SPACE',side/2,side*.70,side*.48);
  const pixels=title.getImageData(0,0,side,side).data,paint=ctx.getImageData(0,0,canvas.width,canvas.height);
  const form=REALITY_TAB_FORMS.octahedron,section=Number(chart.id.split('-')[1]),upper=chart.id.startsWith('upper');
  const rim=[-form.width/2,form.width/2,form.width/2,-form.width/2],a=rim[section],b=rim[(section+1)%4],facing=section<2?1:-1;
  for(let y=0;y<canvas.height;y++){
    const v=1-(y+.5)/canvas.height,sy=Math.floor((.5-(upper?1:-1)*v*.5)*side);
    for(let x=0;x<canvas.width;x++){
      const u=(x+.5)/canvas.width,wa=1-u-v*.5,wb=u-v*.5;if(wa<0||wb<0)continue;
      const sx=Math.max(0,Math.min(side-1,Math.floor((.5+facing*(wa*a+wb*b)/form.width)*side)));
      const from=(sy*side+sx)*4,alpha=pixels[from+3]/255;if(!alpha)continue;
      const to=(y*canvas.width+x)*4;
      for(let channel=0;channel<3;channel++)paint.data[to+channel]=pixels[from+channel]*alpha+paint.data[to+channel]*(1-alpha);
    }
  }
  ctx.putImageData(paint,0,0);
}

/** Large home typography is authored directly into the same material canvases.
 * The feature atlas supplies their allocation and disposal contract, while the
 * home document has one whole-body navigation action and never has pagination. */
function paintHome(materials, charts, document, accent) {
  const front = charts.findIndex(chart => chart.id === 'front');
  const ordered = charts.map((_, index) => index).sort((a,b)=>Number(b===front)-Number(a===front));
  charts.forEach((chart,index) => {
    const texture=materials[index].map, canvas=texture.image, ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
    const safe=chart.contentBounds, compact=safe.width < .75;
    const x=safe.x*w, y=(compact?safe.y:.10)*h, width=safe.width*w, height=(compact?safe.height:.8)*h;
    const gradient=ctx.createLinearGradient(0,0,w,h);
    gradient.addColorStop(0,'#143b5c');gradient.addColorStop(.48,'#0b2038');gradient.addColorStop(1,'#061126');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
    ctx.fillStyle=accent;ctx.fillRect(0,0,w,Math.max(3,h*.012));
    ctx.textAlign='left';ctx.textBaseline='top';
    if(chart.shape==='torus'){
      paintTorusHeading(ctx,canvas,chart,document,accent);texture.needsUpdate=true;return;
    }
    if(chart.shape==='octahedron'){
      paintDiamondHeading(ctx,canvas,chart,document,accent);texture.needsUpdate=true;return;
    }
    const shortHeading=chart.shape==='triangular-prism'?['Play &','media']:chart.shape==='cylinder'?['Value &','contracts']:null;
    if(shortHeading){
      // Compact curved sections prioritize a name that can be read on a phone.
      // Full names, descriptions and member identity remain in the document.
      let size=Math.min(height*.28,width*.24);
      ctx.font=`700 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      const longest=Math.max(...shortHeading.map(line=>ctx.measureText(line).width));if(longest>width)size*=width/longest;
      ctx.font=`700 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;ctx.fillStyle='#f0f8ff';
      shortHeading.forEach((line,row)=>ctx.fillText(line,x,y+height*.06+row*size*1.12,width));
      const footer=Math.max(size*.34,13);ctx.font=`600 ${footer}px system-ui, -apple-system, "Segoe UI", sans-serif`;ctx.fillStyle=accent;
      ctx.fillText(`${document.features.length} OBJECTS`,x,y+height*.69,width);
      ctx.fillRect(x,y+height*.82,width,Math.max(1,h*.003));ctx.fillText('OPEN SPACE →',x,y+height*.87,width);
      texture.needsUpdate=true;return;
    }
    const scale=Math.min(width/620,height/610),font=(size,weight=400)=>{ctx.font=`${weight} ${size*scale}px system-ui, -apple-system, "Segoe UI", sans-serif`;};
    font(27,600);ctx.fillStyle=accent;ctx.fillText(`${document.features.length} OBJECTS  /  ${chart.shape.toUpperCase()}`,x,y,width);
    font(91,650);ctx.fillStyle='#f0f8ff';
    const heading=lines(ctx,document.label,width,3);
    heading.forEach((line,row)=>ctx.fillText(line,x,y+52*scale+row*105*scale,width));
    let cursor=y+(66+heading.length*105)*scale;
    const order=ordered.indexOf(index),start=order*Math.ceil(document.features.length/charts.length);
    const selected=document.features.slice(start,start+Math.ceil(document.features.length/charts.length));
    const detail=order===0?document.description:selected.length?selected.map(feature=>clean(feature.label??feature.title??feature.id)).join(' · '):'Enter this space to choose an object.';
    font(33,450);ctx.fillStyle='#bcd1e3';
    const availableLines=Math.max(1,Math.min(4,Math.floor((y+height-cursor-110*scale)/(45*scale))));
    lines(ctx,detail,width,availableLines).forEach((line,row)=>ctx.fillText(line,x,cursor+row*45*scale,width));
    cursor=y+height-79*scale;
    ctx.fillStyle=accent;ctx.fillRect(x,cursor,width,3*scale);
    font(39,600);ctx.fillText('OPEN SPACE  →',x,cursor+24*scale,width);
    texture.needsUpdate=true;
  });
}

export function createRealityHomeSurface({THREE,id,label,description,members=[],onOpen,height=3.9}={}) {
  const shape=REALITY_HOME_SHAPES[id]??'cube';
  const body=createRealitySurfaceGeometry(THREE,shape);
  const bounds=body.geometry.boundingBox,scale=height/(bounds.max.y-bounds.min.y);
  body.geometry.scale(scale,scale,scale);body.geometry.computeBoundingBox();body.geometry.computeBoundingSphere();
  const document=createHomeSurfaceDocument({id,label,description,members,onOpen}),accent=ACCENTS[id]??'#77caff';
  let atlas=null,materials;
  if(globalThis.document?.createElement){
    atlas=createRealitySurfaceAtlas({THREE,charts:body.charts,document,feature:{id,label,description,shape},size:512});
    materials=atlas.materials;paintHome(materials,body.charts,document,accent);
  }else{
    // Geometry remains usable in server-side layout/tests; the browser's real
    // canvas path above is what supplies visible information-bearing materials.
    materials=body.charts.map(()=>new THREE.MeshBasicMaterial({color:'#123454'}));
  }
  materials.forEach(material=>{material.userData.realityHomeSurface=true;material.userData.realityLensGroup=id;});
  return {...body,materials,atlas,document,accent,shape,refresh:()=>false};
}
