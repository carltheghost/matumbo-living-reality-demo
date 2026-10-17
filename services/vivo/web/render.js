/* Small independent renderer for the shared mode. Full-D state lives on the server.
 * WebGL draws surfaces and objects; Canvas 2D fallback preserves interaction.
 * It does not claim full volumetric higher-dimensional perception or AR anchoring.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;

/**
 * Keep the forward renderer and phone input inverse on the same projection
 * parameters. The phone route reserves a lower dock on narrow viewports, so
 * its screen center is intentionally different from the shared desktop
 * renderer's center.
 */
export function rendererProjectionParameters(renderer={},fallback={}){
 const width=finite(renderer.w,finite(fallback.width)),height=finite(renderer.h,finite(fallback.height));
 const projectionProfile=renderer.projectionProfile==='phone'?'phone':'base';
 return {
  width,height,centerX:width/2,
  centerY:projectionProfile==='phone'&&width<720?height*.37:height*.52,
  yaw:finite(renderer.yaw,.55),pitch:finite(renderer.pitch,.68),distance:Math.max(.15,finite(renderer.distance,10.5)),
  origin:Array.isArray(renderer.origin)?[finite(renderer.origin[0]),finite(renderer.origin[1]),finite(renderer.origin[2])]:[0,0,0],
  projectionProfile,
 };
}
export function embed(q,g,chart='a'){
 const [u,v,h]=q,R=g.R,r=g.r;
 if(g.kind==='sphere'){const s=u*u+v*v,d=R*R+s;return [2*R*u/d*(R+h),(s-R*R)/d*(R+h)*(chart==='b'?-1:1),2*R*v/d*(R+h)];}
 if(g.kind==='torus')return [(R+(r+h)*Math.cos(v))*Math.cos(u),(r+h)*Math.sin(v),(R+(r+h)*Math.cos(v))*Math.sin(u)];
 if(g.kind==='mobius')return [(R+v*Math.cos(u/2))*Math.cos(u),v*Math.sin(u/2)+h,(R+v*Math.cos(u/2))*Math.sin(u)];
 return [u,h,v];
}
export class Renderer{
 constructor(canvas,overlay){this.canvas=canvas;this.overlay=overlay;this.ctx=overlay.getContext('2d');this.yaw=.55;this.pitch=.68;this.distance=10.5;this.origin=[0,0,0];this.projectionProfile='base';this.screen=[];this.gridPoints=[];this.state=null;this.grid=null;this.slice=[];this.overview=false;this.selected=null;this.held=null;this.fps=0;this.last=0;this.pointer=null;this.hand=[];this.route=[];this.backend='Canvas 2D';
  try{this.gl=canvas.getContext('webgl',{alpha:true,antialias:false,preserveDrawingBuffer:true});if(this.gl){this.initGL();this.backend='WebGL';}}catch(e){this.gl=null;}
  if(!this.gl)this.fallback=canvas.getContext('2d');
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.lost=true;});canvas.addEventListener('webglcontextrestored',()=>{this.initGL();this.lost=false;});
 }
 initGL(){const g=this.gl,compile=(type,src)=>{const s=g.createShader(type);g.shaderSource(s,src);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s));return s;};const p=g.createProgram();g.attachShader(p,compile(g.VERTEX_SHADER,'attribute vec3 p;attribute vec4 c;varying vec4 col;void main(){gl_Position=vec4(p,1.);col=c;}'));g.attachShader(p,compile(g.FRAGMENT_SHADER,'precision mediump float;varying vec4 col;void main(){gl_FragColor=col;}'));g.linkProgram(p);if(!g.getProgramParameter(p,g.LINK_STATUS))throw Error(g.getProgramInfoLog(p));g.useProgram(p);this.program=p;this.buffer=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,this.buffer);for(const [n,size,off]of[['p',3,0],['c',4,12]]){const a=g.getAttribLocation(p,n);g.enableVertexAttribArray(a);g.vertexAttribPointer(a,size,g.FLOAT,false,28,off);}g.enable(g.BLEND);g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA);g.enable(g.DEPTH_TEST);g.depthFunc(g.LEQUAL);}
 resize(){const w=innerWidth,h=innerHeight;this.w=w;this.h=h;if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;this.overlay.width=w;this.overlay.height=h;}if(this.gl)this.gl.viewport(0,0,w,h);}
 project(p){const projection=rendererProjectionParameters(this),{width,height,centerX,centerY,yaw,pitch,distance,origin}=projection;const x=p[0]-origin[0],y=p[1]-origin[1],z=p[2]-origin[2],ca=Math.cos(yaw),sa=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);const xx=ca*x-sa*z,zz=sa*x+ca*z,yy=cp*y-sp*zz,depth=distance-(sp*y+cp*zz);const k=Math.min(width,height)*1.18/Math.max(.15,depth);return {x:centerX+xx*k,y:centerY-yy*k,z:clamp((depth-1)/35,-.95,.95),k,depth,visible:depth>.3};}
 inSlice(e){let d=0;for(let i=3;i<e.q.length;i++)d+=(e.q[i]-(this.slice[i]||0))**2;return d<=e.radius**2;}
 sliceRadius(e){let d=0;for(let i=3;i<e.q.length;i++)d+=(e.q[i]-(this.slice[i]||0))**2;return Math.sqrt(Math.max(.001,e.radius**2-d));}
 at(x,y){let best=null,d=42;for(const p of this.screen){const dd=Math.hypot(x-p.x,y-p.y);if(dd<d&&p.interactive){best=p.id;d=dd;}}return best;}
 cellAt(x,y){let best=-1,d=28;this.gridPoints.forEach((p,i)=>{const n=Math.hypot(x-p.x,y-p.y);if(n<d&&p.visible){d=n;best=i;}});return best;}
 triangle(a,b,c,color,buffer){if(![a,b,c].every(p=>p.visible))return;for(const p of[a,b,c])buffer.push(2*p.x/this.w-1,1-2*p.y/this.h,p.z,...color);}
 draw(now){this.resize();const dt=this.last?now-this.last:33;this.last=now;this.fps=.9*this.fps+.1*1000/Math.max(1,dt);const ctx=this.ctx;ctx.clearRect(0,0,this.w,this.h);const tris=[];this.screen=[];
  if(this.state&&this.grid){const s=this.state,g=s.geometry,points=this.grid.positions.map(p=>this.project(p));this.gridPoints=points;const[n,m]=this.grid.shape,act=s.guide.activity,blocked=new Set(s.guide.blocked);
   for(const [a,b,c] of this.grid.faces){const h=(act[a]+act[b]+act[c])/3;let col=blocked.has(a)||blocked.has(b)||blocked.has(c)?[.20,.10,.10,.94]:[.065+h*.07,.16+h*.18,.19+h*.16,.92];this.triangle(points[a],points[b],points[c],col,tris);}
   for(const e of Object.values(s.entities)){const visible=this.inSlice(e);if(!visible&&!this.overview)continue;const pos=embed(e.q,g,e.chart),p=this.project(pos);if(!p.visible)continue;this.screen.push({...p,id:e.id,interactive:visible});const radius=(visible?this.sliceRadius(e):e.radius)*p.k,sel=e.id===this.selected,held=e.id===this.held;const col=held?[.94,.76,.40,1]:visible?[.49,.80,.69,1]:[.5,.6,.6,.24];
    for(let k=0;k<24;k++){const a=k*Math.PI/12,b=(k+1)*Math.PI/12;this.triangle({...p,z:p.z-.003},{x:p.x+Math.cos(a)*radius,y:p.y+Math.sin(a)*radius,z:p.z,visible:true},{x:p.x+Math.cos(b)*radius,y:p.y+Math.sin(b)*radius,z:p.z,visible:true},col,tris);}
    ctx.strokeStyle=held?'#edd395':sel?'#ade5d4':visible?'#6c9990':'#607079';ctx.lineWidth=held?3:1;ctx.setLineDash(visible?[]:[3,5]);ctx.beginPath();ctx.arc(p.x,p.y,Math.max(15,radius)+6,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.font='12px system-ui';ctx.textAlign='center';ctx.fillStyle=held?'#f2daaa':'#d0e5dc';ctx.strokeStyle='#081c25';ctx.lineWidth=4;const label=(held?'HELD · ':!visible?'OUTSIDE SLICE · ':'')+e.name;ctx.strokeText(label,p.x,p.y+Math.max(15,radius)+23);ctx.fillText(label,p.x,p.y+Math.max(15,radius)+23);
   }
   // Grid and propagated guide drawn from shared, received state.
   ctx.lineWidth=.6;for(const[a,b]of this.grid.edges){const p=points[a],q=points[b];if(!p.visible||!q.visible)continue;const h=(act[a]+act[b])/2;ctx.strokeStyle=`rgba(${85+Math.round(h*40)},${115+Math.round(h*45)},${129+Math.round(h*30)},${.17+h*.17})`;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();}
   for(const i of s.guide.blocked){const p=points[i];if(p?.visible){ctx.fillStyle='#dc9486';ctx.fillRect(p.x-4,p.y-4,8,8);}}
   const goal=points[s.guide.goal];if(goal?.visible){ctx.strokeStyle='#eed097';ctx.lineWidth=2;ctx.beginPath();ctx.arc(goal.x,goal.y,10,0,Math.PI*2);ctx.stroke();}
   if(this.route.length){ctx.strokeStyle='#f1ce91';ctx.lineWidth=3;ctx.beginPath();this.route.forEach((i,k)=>{const p=points[i];if(p?.visible)k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});ctx.stroke();}
   for(const person of s.participants||[]){if(!person.observer||person.id===this.actor)continue;const q=person.observer.q;let outside=false;for(let i=3;i<q.length;i++)if(Math.abs(q[i]-(this.slice[i]||0))>.4)outside=true;if(outside&&!this.overview)continue;const p=this.project(embed(q,g,person.observer.chart));ctx.strokeStyle='#dab4dc';ctx.strokeRect(p.x-7,p.y-7,14,14);ctx.fillStyle='#dfc8e1';ctx.font='11px system-ui';ctx.fillText(person.name+(outside?' · other slice':''),p.x,p.y-14);}
  }
  if(this.gl&&!this.lost){const g=this.gl;g.clearColor(.02,.07,.09,document.body.classList.contains('camera-live')?0:1);g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);g.useProgram(this.program);g.bindBuffer(g.ARRAY_BUFFER,this.buffer);g.bufferData(g.ARRAY_BUFFER,new Float32Array(tris),g.DYNAMIC_DRAW);g.drawArrays(g.TRIANGLES,0,tris.length/7);}else if(this.fallback){const c=this.fallback;c.clearRect(0,0,this.w,this.h);if(!document.body.classList.contains('camera-live')){c.fillStyle='#07171d';c.fillRect(0,0,this.w,this.h);}for(let i=0;i<tris.length;i+=21){c.fillStyle=`rgba(${tris[i+3]*255},${tris[i+4]*255},${tris[i+5]*255},${tris[i+6]})`;c.beginPath();for(let k=0;k<3;k++){const j=i+k*7,x=(tris[j]+1)*this.w/2,y=(1-tris[j+1])*this.h/2;k?c.lineTo(x,y):c.moveTo(x,y);}c.fill();}}
  if(this.pointer){ctx.strokeStyle='#f1d39b';ctx.lineWidth=2;ctx.beginPath();ctx.arc(this.pointer[0],this.pointer[1],14,0,Math.PI*2);ctx.stroke();}
  if(this.hand.length){ctx.strokeStyle='#91d0be';ctx.lineWidth=2;for(const[a,b]of[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]]){ctx.beginPath();ctx.moveTo(...this.hand[a]);ctx.lineTo(...this.hand[b]);ctx.stroke();}}
 }
}
