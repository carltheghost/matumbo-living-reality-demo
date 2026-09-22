/* Reality .25 bridge for the canonical maTumbo browser demo.
 * The existing maTumbo world remains the host application.
 * This surface materializes the independent 18-direction Reality .25 field
 * without replacing the glass-cube layout, HUD, avatars, blocks or feature UI.
 */
import * as THREE from '../../vendor/three-r179.1/build/three.module.js';
import { OrbitControls } from '../../vendor/three-r179.1/examples/jsm/controls/OrbitControls.js';
import { RealityField } from 'https://raw.githubusercontent.com/carltheghost/matumbo-living-reality-25/main/reality-field.js?v=20260922-r25b';

const FIELD_SEEDS = [
  ['R01','R07'],['R07','R15'],['R15','R18'],
  ['R02','R10'],['R10','R16'],['R05','R11'],
];

const uiStyle = `
#matumbo-reality25-launcher{
  position:fixed;right:18px;bottom:86px;z-index:12000;
  border:1px solid rgba(145,220,255,.35);border-radius:999px;
  padding:10px 15px;background:rgba(5,12,23,.78);backdrop-filter:blur(16px);
  color:#dff6ff;font:700 12px/1 system-ui, sans-serif;letter-spacing:.08em;
  box-shadow:0 10px 40px rgba(0,0,0,.35);cursor:pointer;
}
#matumbo-reality25-launcher:hover{border-color:rgba(145,220,255,.72);transform:translateY(-1px)}
#matumbo-reality25{
  position:fixed;inset:0;z-index:11000;display:none;grid-template-columns:240px 1fr 280px;
  background:radial-gradient(circle at 50% 46%,rgba(19,46,77,.30),rgba(2,4,8,.88) 70%);
  backdrop-filter:blur(18px);color:#eaf7ff;font-family:system-ui,sans-serif;
}
#matumbo-reality25.open{display:grid}
#matumbo-reality25 .r25-panel{padding:20px;background:rgba(4,10,18,.68);border-inline:1px solid rgba(147,213,255,.12);overflow:auto}
#matumbo-reality25 .r25-eyebrow{font-size:10px;letter-spacing:.16em;opacity:.62}
#matumbo-reality25 h2{font-size:22px;line-height:1.05;margin:8px 0}
#matumbo-reality25 p{font-size:12px;line-height:1.5;opacity:.72}
#matumbo-reality25 .r25-stage{position:relative;min-width:0;min-height:0}
#matumbo-reality25 canvas{display:block;width:100%;height:100%}
#matumbo-reality25 .r25-top{position:absolute;left:18px;right:18px;top:16px;display:flex;justify-content:space-between;pointer-events:none}
#matumbo-reality25 .r25-pill{padding:8px 11px;border:1px solid rgba(147,213,255,.18);border-radius:999px;background:rgba(2,8,15,.58);backdrop-filter:blur(10px);font-size:11px}
#matumbo-reality25 .r25-close{pointer-events:auto;cursor:pointer}
#matumbo-reality25 .r25-list{display:grid;gap:5px;margin-top:12px}
#matumbo-reality25 .r25-item,#matumbo-reality25 .r25-action{
  width:100%;text-align:left;border:1px solid rgba(147,213,255,.12);border-radius:10px;
  padding:9px 10px;background:rgba(11,22,35,.56);color:#dff6ff;cursor:pointer;
}
#matumbo-reality25 .r25-item.active{border-color:rgba(243,207,115,.62);background:rgba(70,54,22,.34)}
#matumbo-reality25 .r25-action{margin-top:7px;text-align:center}
#matumbo-reality25 .r25-statgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}
#matumbo-reality25 .r25-stat{padding:9px;border-radius:10px;background:rgba(10,22,37,.5);border:1px solid rgba(147,213,255,.09)}
#matumbo-reality25 .r25-stat b{display:block;font-size:17px}
#matumbo-reality25 .r25-stat span{font-size:9px;text-transform:uppercase;letter-spacing:.1em;opacity:.5}
#matumbo-reality25 .r25-output{white-space:pre-wrap;font:10px/1.45 ui-monospace,SFMono-Regular,monospace;color:#bcd6ea;margin-top:14px}
#matumbo-reality25 .r25-label{
  position:absolute;transform:translate(-50%,-50%);padding:3px 6px;border-radius:999px;
  background:rgba(3,10,18,.72);border:1px solid rgba(147,213,255,.12);
  font:700 9px/1 system-ui,sans-serif;color:#dff6ff;pointer-events:none;white-space:nowrap
}
@media (max-width:900px){
  #matumbo-reality25{grid-template-columns:1fr}
  #matumbo-reality25 .r25-left,#matumbo-reality25 .r25-right{display:none}
}
`;

const style=document.createElement('style');
style.textContent=uiStyle;
document.head.appendChild(style);

const launcher=document.createElement('button');
launcher.id='matumbo-reality25-launcher';
launcher.textContent='REALITY .25 · 18D FIELD';
launcher.title='Open the 18-direction Reality .25 field inside maTumbo';
document.body.appendChild(launcher);

const root=document.createElement('div');
root.id='matumbo-reality25';
root.innerHTML=`
  <aside class="r25-panel r25-left">
    <div class="r25-eyebrow">maTumbo / REALITY .25</div>
    <h2>Living Reality Field</h2>
    <p>18 primary directions. One shared nucleus. Direct reality links can fold without routing through the center.</p>
    <div class="r25-statgrid" data-stats></div>
    <div class="r25-eyebrow" style="margin-top:18px">REALITIES</div>
    <div class="r25-list" data-list></div>
  </aside>
  <main class="r25-stage">
    <canvas data-canvas></canvas>
    <div class="r25-top">
      <div class="r25-pill" data-status>NUCLEUS · shared origin</div>
      <button class="r25-pill r25-close" data-close>BACK TO maTUMBO</button>
    </div>
    <div data-labels></div>
  </main>
  <aside class="r25-panel r25-right">
    <div class="r25-eyebrow">FIELD CONTROL</div>
    <p data-selection>Select a reality.</p>
    <button class="r25-action" data-fold>FOLD R07 ↔ R18</button>
    <button class="r25-action" data-pulse>PULSE R07</button>
    <button class="r25-action" data-step>STEP FIELD</button>
    <button class="r25-action" data-trace>TRACE R01 → R18</button>
    <button class="r25-action" data-nucleus>RETURN TO NUCLEUS</button>
    <div class="r25-output" data-output>Reality .25 ready.</div>
  </aside>`;
document.body.appendChild(root);

const canvas=root.querySelector('[data-canvas]');
const labels=root.querySelector('[data-labels]');
const stats=root.querySelector('[data-stats]');
const status=root.querySelector('[data-status]');
const selection=root.querySelector('[data-selection]');
const output=root.querySelector('[data-output]');

const field=new RealityField();
for(const [a,b] of FIELD_SEEDS)field.connect(a,b);
field.fold('R01','R18');

const positions=new Map();
for(const reality of field.realties.values()){
  const v=reality.address.vector;
  const len=Math.hypot(v[0],v[1],v[2])||1;
  positions.set(reality.id,new THREE.Vector3(v[0]/len,v[1]/len,v[2]/len).multiplyScalar(5.4));
}

const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));
renderer.setClearColor(0x000000,0);

const scene=new THREE.Scene();
scene.fog=new THREE.FogExp2(0x050a12,.035);
const camera=new THREE.PerspectiveCamera(46,1,.1,100);
camera.position.set(9,7,12);
const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true;controls.dampingFactor=.055;
controls.minDistance=7;controls.maxDistance=24;controls.target.set(0,0,0);

scene.add(new THREE.AmbientLight(0x7696cc,.72));
const light=new THREE.PointLight(0x8fdcff,110,35,2);light.position.set(4,7,8);scene.add(light);
const warm=new THREE.PointLight(0xffc56b,85,28,2);warm.position.set(-5,-2,4);scene.add(warm);

const layer=new THREE.Group();scene.add(layer);
const nucleus=new THREE.Mesh(
  new THREE.BoxGeometry(.72,.72,.72),
  new THREE.MeshStandardMaterial({color:0xf3cf73,emissive:0x6b4f10,emissiveIntensity:.45,metalness:.35,roughness:.28})
);
layer.add(nucleus);

const nodeMeshes=new Map();
const realityDirections=new Map();
const realityGroups=new Map();
const realityContents=new Map();
const baseAxis=new THREE.Vector3(0,0,1);

const REALITY_META={
  R01:{name:'Core World',kind:'world',color:0x4ca8ff},
  R02:{name:'Social',kind:'social',color:0xff78b7},
  R03:{name:'Contracts',kind:'contracts',color:0xffc86b},
  R04:{name:'Person',kind:'person',color:0xb891ff},
  R05:{name:'Blocks',kind:'blocks',color:0x68d6a0},
  R06:{name:'Arena',kind:'arena',color:0xff6f63},
  R07:{name:'Academy',kind:'academy',color:0x66b8ff},
  R08:{name:'World Pulse',kind:'world-events',color:0x8de0ff},
  R09:{name:'Sports',kind:'sports',color:0x72e69b},
  R10:{name:'Asset Market',kind:'asset-market',color:0xf2cf71},
  R11:{name:'Gateway',kind:'gateway',color:0x9c8cff},
  R12:{name:'Neural Mesh',kind:'neural',color:0xc08cff},
  R13:{name:'Picture Matter',kind:'picture',color:0xff9a6f},
  R14:{name:'NFT Atelier',kind:'nft',color:0xffd36e},
  R15:{name:'Bot Plaza',kind:'bots',color:0x55d6ff},
  R16:{name:'Ledger',kind:'ledger',color:0x75c77c},
  R17:{name:'T402',kind:'t402',color:0x89a8ff},
  R18:{name:'Living Lens',kind:'lens',color:0xf39ad7},
};

function makeLocalContent(meta){
  const group=new THREE.Group();
  const blockGeo=new THREE.BoxGeometry(.12,.12,.12);
  const accent=new THREE.MeshStandardMaterial({
    color:meta.color,emissive:meta.color,emissiveIntensity:.55,
    metalness:.15,roughness:.3
  });
  const placements=[
    [-.2,-.16,-.06],[.02,.1,.04],[.2,-.02,-.02],
    [-.04,-.22,.10],[.19,.18,.08]
  ];
  placements.forEach(([x,y,z],i)=>{
    const b=new THREE.Mesh(blockGeo,accent);
    b.position.set(x,y,z);
    b.scale.setScalar(i===0?.8:1);
    group.add(b);
  });
  return group;
}

for(const reality of field.realties.values()){
  const raw=new THREE.Vector3(...reality.address.vector).normalize();
  realityDirections.set(reality.id,raw);

  const meta=REALITY_META[reality.id]||{name:'Reality',kind:'world',color:0x8db8ff};
  reality.localState.role=meta.kind;
  reality.localState.domain=meta.name;

  const group=new THREE.Group();
  const orientation=new THREE.Quaternion().setFromUnitVectors(baseAxis,raw);
  const roll=(Number(reality.id.slice(1))%6)*0.15;
  group.quaternion.copy(orientation);
  group.rotateZ(roll);
  group.position.copy(positions.get(reality.id));
  group.userData.realityId=reality.id;
  group.userData.direction=[...reality.address.vector];
  group.userData.directionLabel=reality.address.label;
  group.userData.realityName=meta.name;
  layer.add(group);
  realityGroups.set(reality.id,group);

  const shellMat=new THREE.MeshPhysicalMaterial({
    color:meta.color,emissive:meta.color,emissiveIntensity:.24,
    metalness:.16,roughness:.2,transmission:.28,
    transparent:true,opacity:.4
  });
  const shell=new THREE.Mesh(new THREE.BoxGeometry(1.35,1.35,1.35),shellMat);
  shell.userData.realityId=reality.id;
  group.add(shell);
  nodeMeshes.set(reality.id,shell);

  const portalMat=new THREE.MeshStandardMaterial({
    color:meta.color,emissive:meta.color,emissiveIntensity:1.2,
    transparent:true,opacity:.84,metalness:.12,roughness:.22,
    side:THREE.DoubleSide
  });
  const portal=new THREE.Mesh(new THREE.PlaneGeometry(.82,.82),portalMat);
  portal.position.z=.69;
  portal.userData.realityId=reality.id;
  portal.userData.portal=true;
  group.add(portal);

  const railMat=new THREE.LineBasicMaterial({color:meta.color,transparent:true,opacity:.88});
  const edgePoints=[
    new THREE.Vector3(-.52,-.52,.71),new THREE.Vector3(.52,-.52,.71),
    new THREE.Vector3(.52,.52,.71),new THREE.Vector3(-.52,.52,.71),
    new THREE.Vector3(-.52,-.52,.71)
  ];
  const rail=new THREE.Line(new THREE.BufferGeometry().setFromPoints(edgePoints),railMat);
  rail.userData.realityId=reality.id;
  group.add(rail);

  const content=makeLocalContent(meta);
  content.scale.setScalar(.92);
  content.position.z=-.08;
  content.traverse(object=>object.userData.realityId=reality.id);
  group.add(content);
  realityContents.set(reality.id,content);

  const arrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,.74),.72,meta.color,.16,.1);
  arrow.userData.realityId=reality.id;
  group.add(arrow);

  const p=positions.get(reality.id);
  const start=raw.clone().multiplyScalar(.42);
  const end=p.clone().sub(raw.clone().multiplyScalar(.69));
  const spoke=new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([start,end]),
    new THREE.LineBasicMaterial({color:0x45627f,transparent:true,opacity:.46})
  );
  spoke.userData.realityId=reality.id;
  layer.add(spoke);
}

const edgeGroup=new THREE.Group();
layer.add(edgeGroup);

function redrawEdges(){
  while(edgeGroup.children.length)edgeGroup.remove(edgeGroup.children[0]);
  for(const edge of field.edges.values()){
    if(!edge.active)continue;
    const a=positions.get(edge.from),b=positions.get(edge.to);
    if(!a||!b)continue;
    const direction=b.clone().sub(a).normalize();
    const pa=a.clone().add(direction.clone().multiplyScalar(.72));
    const pb=b.clone().sub(direction.clone().multiplyScalar(.72));
    const g=new THREE.BufferGeometry().setFromPoints([pa,pb]);
    const m=new THREE.LineBasicMaterial({
      color:edge.type==='fold'?0xf3cf73:0x67c9ff,
      transparent:true,opacity:edge.type==='fold'?.88:.6,
      linewidth:edge.type==='fold'?2:1
    });
    const line=new THREE.Line(g,m);
    edgeGroup.add(line);
  }
}
redrawEdges();

const raycaster=new THREE.Raycaster();
const pointer=new THREE.Vector2();
let selected='NUCLEUS';
let started=false;

function resize(){
  const rect=root.querySelector('.r25-stage').getBoundingClientRect();
  renderer.setSize(Math.max(1,rect.width),Math.max(1,rect.height),false);
  camera.aspect=Math.max(1,rect.width)/Math.max(1,rect.height);
  camera.updateProjectionMatrix();
}
addEventListener('resize',()=>{if(started)resize()});

function projectLabel(id){
  const group=realityGroups.get(id);if(!group)return;
  const worldPosition=new THREE.Vector3();
  group.getWorldPosition(worldPosition);
  const p=worldPosition.project(camera);
  const rect=root.querySelector('.r25-stage').getBoundingClientRect();
  const x=(p.x*.5+.5)*rect.width;
  const y=(-p.y*.5+.5)*rect.height;
  const label=labels.querySelector(\`[data-label="\${id}"]\`);
  if(label){label.style.left=\`\${x}px\`;label.style.top=\`\${y}px\`;label.style.opacity=p.z<1?'1':'0';}
}
function ensureLabels(){
  if(labels.childElementCount)return;
  for(const reality of field.realties.values()){
    const el=document.createElement('div');el.className='r25-label';el.dataset.label=reality.id;const meta=REALITY_META[reality.id];el.textContent=meta?reality.id+' · '+meta.name:reality.id;labels.appendChild(el);
  }
}
function renderStats(){
  const s=field.stats();
  stats.innerHTML=`
    <div class="r25-stat"><b>18</b><span>primary</span></div>
    <div class="r25-stat"><b>${s.activeConnections}</b><span>links</span></div>
    <div class="r25-stat"><b>${s.folds}</b><span>folds</span></div>
    <div class="r25-stat"><b>${s.branches}</b><span>branches</span></div>
    <div class="r25-stat"><b>${s.events}</b><span>events</span></div>
    <div class="r25-stat"><b>${s.totalTicks.toFixed(0)}</b><span>ticks</span></div>`;
}
function select(id){
  selected=id;
  for(const [rid,mesh] of nodeMeshes){
    const on=rid===id;
    mesh.scale.setScalar(on?1.08:1);
    mesh.material.emissiveIntensity=on?0.42:.24;
  }
  for(const [rid,group] of realityGroups)group.scale.setScalar(rid===id?1.08:1);
  const reality=field.realties.get(id);
  const meta=REALITY_META[id];
  status.textContent=id==='NUCLEUS'?'NUCLEUS · shared origin':\`\${id} · \${meta?.name||reality.address.label} · \${reality.address.vector.join(',')}\`;
  selection.textContent=id==='NUCLEUS'
    ?'Central nucleus — anchor only; each primary reality owns its own local state, timeline and space.'
    :\`\${id} · \${meta?.name||reality.address.label} · direction \${reality.address.vector.join(',')} · local tick \${reality.timeline.tick.toFixed(0)}\`;
}
const items=root.querySelector('[data-list]');
for(const reality of field.realties.values()){
  const button=document.createElement('button');
  button.className='r25-item';button.innerHTML=`<strong>${reality.id}</strong><div style="opacity:.58;font-size:10px">${reality.address.label}</div>`;
  button.onclick=()=>select(reality.id);
  items.appendChild(button);
}

function showResult(result){output.textContent=typeof result==='string'?result:JSON.stringify(result,null,2);renderStats();}

root.querySelector('[data-fold]').onclick=()=>{field.fold('R07','R18');redrawEdges();showResult('Fold created: R07 ↔ R18');};
root.querySelector('[data-pulse]').onclick=()=>{const r=field.emit('R07','pulse');showResult(r.result);};
root.querySelector('[data-step]').onclick=()=>{field.step(.5);showResult(field.stats());};
root.querySelector('[data-trace]').onclick=()=>showResult(field.trace('R01','R18'));
root.querySelector('[data-nucleus]').onclick=()=>select('NUCLEUS');
root.querySelector('[data-close]').onclick=()=>close();
launcher.onclick=()=>open();

canvas.addEventListener('pointerdown',event=>{
  const rect=canvas.getBoundingClientRect();
  pointer.x=((event.clientX-rect.left)/rect.width)*2-1;
  pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(pointer,camera);
  const hit=raycaster.intersectObjects([nucleus,...realityGroups.values()],true)[0];
  if(hit?.object===nucleus)select('NUCLEUS');
  else if(hit?.object?.userData?.realityId)select(hit.object.userData.realityId);
});

function animate(time){
  if(!started)return;
  const t=time*.001;
  for(const [id,group] of realityGroups){
    const reality=field.realties.get(id);
    const activity=Number(reality.localState.activity||0);
    const pulse=1+activity*.10+Math.sin(t*1.5+reality.address.vector[0]+reality.address.vector[1]*2)*.018;
    const target=id===selected?1.08*pulse:pulse;
    group.scale.lerp(new THREE.Vector3(target,target,target),.12);
    group.children.forEach(child=>{
      if(child.userData?.portal)child.material.emissiveIntensity=1.15+activity*.5;
    });
    projectLabel(id);
  }
  nucleus.rotation.y+=.003;
  controls.update();
  renderer.render(scene,camera);
  requestAnimationFrame(animate);
}

function open(){
  if(root.classList.contains('open'))return;
  root.classList.add('open');started=true;ensureLabels();resize();select(selected);renderStats();
  requestAnimationFrame(animate);
  output.textContent='18 primary realities live. Each cube owns its direction, local space and domain. Spokes terminate at reality faces; they do not collapse the realities into one point.';
}
function close(){root.classList.remove('open');started=false}

document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&root.classList.contains('open'))close();
});

const params=new URLSearchParams(location.search);
let attempts=0;
function autoOpen(){
  if(params.get('feature')!=='reality-25')return;
  if(window.__TUMBO_REALITY_ASSEMBLY__||window.__MATUMBO_RUNTIME__){
    open(); return;
  }
  if(++attempts<120)setTimeout(autoOpen,250);
}
setTimeout(autoOpen,500);
