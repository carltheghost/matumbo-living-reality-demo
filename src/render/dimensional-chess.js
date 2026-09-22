import * as THREE from "three";
import {createChessArenaState,applyChessArenaMove} from "../domains/chess-arena.js?v=20260922-cache2";
import {createDimensionalChessState,legalMoves4D,applyDimensionalMove,undoDimensionalMove,redoDimensionalMove,coords,key,slicePieces,countPieces} from "../domains/chess-4d.js?v=20260922-4d1";
import {createOutcomeContracts} from "../domains/outcome-contracts.js?v=20260922-cache2";

const PIECE_NAMES={p:"Pawn",n:"Knight",b:"Bishop",r:"Rook",q:"Queen",k:"King"};
const GLYPHS={w:{p:"♙",n:"♘",b:"♗",r:"♖",q:"♕",k:"♔"},b:{p:"♟",n:"♞",b:"♝",r:"♜",q:"♛",k:"♚"}};

function mat(THREE,color,metal=.4,rough=.3){return new THREE.MeshStandardMaterial({color,metalness:metal,roughness:rough});}
function part(THREE,geometry,material,parent,name){const m=new THREE.Mesh(geometry,material);m.name=name;parent.add(m);return m;}

function crown(THREE,parent,material,king=false){
  const band=part(THREE,new THREE.CylinderGeometry(.22,.26,.08,16),material,parent,"crown-band");
  band.position.y=.62;
  const points=king?5:7;
  for(let i=0;i<points;i++){
    const a=i/points*Math.PI*2;
    const tooth=part(THREE,new THREE.ConeGeometry(.055,.22,5),material,parent,"crown-point");
    tooth.position.set(Math.cos(a)*.18,.76,Math.sin(a)*.18);
  }
  if(king){
    const cross=part(THREE,new THREE.BoxGeometry(.08,.22,.06),material,parent,"crown-cross");
    cross.position.set(0,.82,0);
    const cross2=part(THREE,new THREE.BoxGeometry(.20,.06,.06),material,parent,"crown-crossbar");
    cross2.position.set(0,.83,0);
  }
}
function armorShoulders(THREE,parent,material){
  for(const x of [-.23,.23]){
    const s=part(THREE,new THREE.SphereGeometry(.14,12,8),material,parent,"shoulder");
    s.scale.set(1,.7,1);s.position.set(x,.35,0);
  }
}
function createCharacterPiece(THREE,type,color){
  const g=new THREE.Group();g.name=`character-${color}-${type}`;
  const white=color==="w";
  const primary=mat(THREE,white?0xe7eef7:0x171a25,.82,.24);
  const secondary=mat(THREE,white?0x3c78a8:0x7b1f3a,.68,.28);
  const gold=mat(THREE,white?0xd6ad52:0x9a5a2b,.9,.2);
  const dark=mat(THREE,white?0x17283d:0x07090f,.55,.32);
  part(THREE,new THREE.CylinderGeometry(.30,.34,.10,20),gold,g,"base");
  part(THREE,new THREE.CylinderGeometry(.24,.28,.10,20),dark,g,"base-trim");
  if(type==="p"){
    part(THREE,new THREE.CylinderGeometry(.16,.22,.30,12),primary,g,"body").position.y=.22;
    part(THREE,new THREE.SphereGeometry(.16,14,10),primary,g,"head").position.y=.46;
    const helmet=part(THREE,new THREE.CylinderGeometry(.20,.22,.08,12),gold,g,"helmet");helmet.position.y=.55;
    const plume=part(THREE,new THREE.ConeGeometry(.045,.22,8),secondary,g,"plume");plume.position.set(0,.67,0);
  }else if(type==="n"){
    part(THREE,new THREE.CylinderGeometry(.18,.23,.28,12),primary,g,"body").position.y=.25;
    const neck=part(THREE,new THREE.CylinderGeometry(.13,.16,.25,10),secondary,g,"neck");neck.position.set(0,.47,.03);neck.rotation.z=-.25;
    const head=part(THREE,new THREE.CapsuleGeometry(.14,.30,5,10),primary,g,"horse-head");head.position.set(0,.70,.10);head.rotation.z=-.18;
    const mane=part(THREE,new THREE.ConeGeometry(.06,.30,7),dark,g,"mane");mane.position.set(-.12,.72,.02);mane.rotation.z=-.2;
    const crest=part(THREE,new THREE.ConeGeometry(.045,.16,6),gold,g,"crest");crest.position.set(.01,.93,.08);
  }else if(type==="b"){
    const robe=part(THREE,new THREE.ConeGeometry(.27,.48,16),primary,g,"robe");robe.position.y=.32;
    const hood=part(THREE,new THREE.ConeGeometry(.18,.30,12),secondary,g,"hood");hood.position.y=.66;
    const orb=part(THREE,new THREE.SphereGeometry(.09,12,8),gold,g,"orb");orb.position.y=.82;
    const slash=part(THREE,new THREE.BoxGeometry(.035,.22,.025),gold,g,"bishop-mark");slash.position.set(0,.69,.17);slash.rotation.z=-.45;
  }else if(type==="r"){
    const torso=part(THREE,new THREE.CylinderGeometry(.22,.27,.46,12),primary,g,"fortress-body");torso.position.y=.34;
    armorShoulders(THREE,g,secondary);
    const helm=part(THREE,new THREE.CylinderGeometry(.25,.23,.13,10),gold,g,"helm");helm.position.y=.66;
    for(let i=0;i<4;i++){const t=part(THREE,new THREE.BoxGeometry(.09,.14,.09),gold,g,"battlement");const a=i*Math.PI/2;t.position.set(Math.cos(a)*.17,.79,Math.sin(a)*.17);}
  }else if(type==="q"){
    const robe=part(THREE,new THREE.ConeGeometry(.29,.52,16),primary,g,"queen-armor");robe.position.y=.34;
    armorShoulders(THREE,g,secondary);
    part(THREE,new THREE.SphereGeometry(.16,14,10),primary,g,"queen-head").position.y=.72;
    crown(THREE,g,gold,false);
    const cape=part(THREE,new THREE.ConeGeometry(.20,.34,12),secondary,g,"cape");cape.position.set(0,.35,-.17);cape.rotation.x=-.35;
  }else{
    const robe=part(THREE,new THREE.CylinderGeometry(.25,.30,.50,12),primary,g,"king-armor");robe.position.y=.35;
    armorShoulders(THREE,g,secondary);
    part(THREE,new THREE.SphereGeometry(.16,14,10),primary,g,"king-head").position.y=.72;
    crown(THREE,g,gold,true);
    const cape=part(THREE,new THREE.ConeGeometry(.22,.36,12),secondary,g,"king-cape");cape.position.set(0,.35,-.17);cape.rotation.x=-.35;
  }
  g.userData={pieceType:type,color,isCharacterPiece:true,role:PIECE_NAMES[type]};
  return g;
}

function makeBoard(THREE,size=8){
  const root=new THREE.Group(),cells=new Map();
  const dark=mat(THREE,0x171d29,.2,.55),light=mat(THREE,0xbaa477,.15,.52);
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    const cell=part(THREE,new THREE.BoxGeometry(size/8-.025,.10,size/8-.025),(x+y)%2?dark:light,root,"cell");
    cell.position.set((x-3.5)*size/8,.0,(3.5-y)*size/8);
    cell.userData={x,y,cell:true};
    cells.set(`${x},${y}`,cell);
  }
  const frame=part(THREE,new THREE.BoxGeometry(size+.22,.20,size+.22),mat(THREE,0x111722,.65,.28),root,"frame");
  frame.position.y=-.10;
  return {root,cells,size};
}

function boardPosition(size,x,y){return [(x-3.5)*size/8,.11,(3.5-y)*size/8];}

function makePanel(doc){
  const root=doc.createElement("section");root.className="dimensional-chess";
  root.innerHTML=`
  <style>
  .dimensional-chess{color:#eef6ff;background:linear-gradient(145deg,#07111b,#0b0e18 55%,#150c1a);border:1px solid rgba(91,188,255,.32);border-radius:18px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.45);font-family:Inter,system-ui,sans-serif}
  .dc-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08)}
  .dc-title{font-size:18px;font-weight:800}.dc-sub{font-size:11px;color:#8da9bd;margin-top:3px}
  .dc-mode{display:flex;gap:6px}.dc-mode button,.dc-action{min-height:40px;border:1px solid #36576d;border-radius:9px;background:#102332;color:#e8f5ff;padding:8px 12px;cursor:pointer}
  .dc-mode button.active{background:#1379b8;border-color:#55c7ff}.dc-body{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:12px;padding:12px}
  .dc-stage{position:relative;min-height:520px;border-radius:14px;overflow:hidden;background:radial-gradient(circle at 50% 40%,#172d42,#05080d 72%)}.dc-canvas{width:100%;height:100%;min-height:520px;display:block;touch-action:none}
  .dc-overlay{position:absolute;left:12px;top:12px;display:flex;gap:6px;flex-wrap:wrap}.dc-pill{padding:7px 10px;border-radius:999px;background:rgba(5,13,21,.78);border:1px solid rgba(117,207,255,.25);font-size:11px}
  .dc-side{display:flex;flex-direction:column;gap:10px;min-width:0}.dc-card{border:1px solid rgba(255,255,255,.08);background:rgba(7,16,25,.78);border-radius:13px;padding:11px}.dc-card h3{margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#9fd9f5}
  .dc-controls{display:grid;grid-template-columns:1fr 1fr;gap:8px}.dc-controls label{font-size:11px;color:#91a9ba;display:grid;gap:5px}.dc-controls input{width:100%}
  .dc-contract{display:grid;gap:7px}.dc-contract button{text-align:left;min-height:42px;border:1px solid rgba(88,176,224,.25);border-radius:9px;background:#0d1d2a;color:#e8f6ff;padding:8px;cursor:pointer}.dc-contract button strong{display:block;font-size:12px}.dc-contract button span{font-size:10px;color:#8ea9b8}
  .dc-moves{max-height:150px;overflow:auto;font:11px ui-monospace,monospace;color:#b9d3e3}.dc-targets{display:grid;gap:5px;max-height:170px;overflow:auto}.dc-target{width:100%;text-align:left;border:1px solid rgba(86,190,255,.22);border-radius:8px;background:#0b1b27;color:#dff5ff;padding:7px;cursor:pointer;font-size:10px}.dc-target.capture{border-color:rgba(255,102,125,.5)}.dc-move{padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)}
  .dc-footer{display:flex;gap:8px;flex-wrap:wrap;padding:0 12px 12px}.dc-footer button{flex:1;min-width:130px}
  @media(max-width:850px){.dc-body{grid-template-columns:1fr}.dc-stage,.dc-canvas{min-height:390px}.dc-side{display:grid;grid-template-columns:1fr 1fr}.dc-card:last-child{grid-column:1/-1}}
  @media(max-width:560px){.dc-head{align-items:flex-start;gap:10px;flex-direction:column}.dc-mode{width:100%}.dc-mode button{flex:1}.dc-side{display:block}.dc-stage,.dc-canvas{min-height:330px}.dc-body{padding:8px}.dc-footer{padding:0 8px 8px}}
  </style>
  <header class="dc-head"><div><div class="dc-title">maTumbo Dimensional Chess</div><div class="dc-sub">Character champions · 3D arena · native 4D hypercube</div></div><div class="dc-mode"><button data-mode="2d">2D</button><button data-mode="3d">3D</button><button data-mode="4d" class="active">4D</button></div></header>
  <div class="dc-body">
    <div class="dc-stage"><canvas class="dc-canvas"></canvas><div class="dc-overlay"><span class="dc-pill" data-turn>WHITE TO MOVE</span><span class="dc-pill" data-coords>W3 · Z3</span><span class="dc-pill" data-status>Ready</span></div></div>
    <aside class="dc-side">
      <section class="dc-card"><h3>Dimension navigator</h3><div class="dc-controls"><label>W slice<input data-w type="range" min="0" max="7" value="3"></label><label>Z slice<input data-z type="range" min="0" max="7" value="3"></label></div><div style="font-size:11px;color:#8fa8b9;margin-top:8px" data-slice-help>Active 8×8 slice. Move across Z/W to travel the hypercube.</div></section>
      <section class="dc-card"><h3>Contracts · TUMBO-SIM</h3><div class="dc-contract"><button data-contract="white"><strong>White wins</strong><span>Game outcome contract · simulated points</span></button><button data-contract="black"><strong>Black wins</strong><span>Game outcome contract · simulated points</span></button><button data-contract="draw"><strong>Draw</strong><span>Game outcome contract · simulated points</span></button><button data-contract="move"><strong>Next move · Knight</strong><span>Move contract tied to the live turn</span></button></div><div style="font-size:10px;color:#718b9c;margin-top:8px">Simulation only. No wallet, real-money wager, custody or settlement.</div></section>
      <section class="dc-card"><h3>Legal dimensional moves</h3><div class="dc-targets" data-targets><div style="font-size:10px;color:#718b9c">Select a character to reveal legal destinations.</div></div></section><section class="dc-card"><h3>Move history</h3><div class="dc-moves" data-moves></div></section>
    </aside>
  </div>
  <footer class="dc-footer"><button class="dc-action" data-undo>Undo</button><button class="dc-action" data-redo>Redo</button><button class="dc-action" data-new>New game</button><button class="dc-action" data-center>Center board</button><button class="dc-action" data-brenda>Ask Brenda</button></footer>`;
  return root;
}

export function mountDimensionalChess({documentRoot=document,host=document.body}={}){
  if(!documentRoot||!host)throw new TypeError("mountDimensionalChess needs documentRoot and host");
  const root=makePanel(documentRoot);host.replaceChildren(root);
  const canvas=root.querySelector(".dc-canvas"),ctx=canvas.getContext("webgl2")||canvas.getContext("webgl");
  if(!ctx){root.querySelector("[data-status]").textContent="WebGL unavailable";return {destroy(){root.remove();}};}
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,1.5));
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,.1,200);
  camera.position.set(0,7.8,8.6);
  const light=new THREE.HemisphereLight(0x9fc8ff,0x120817,1.8);scene.add(light);
  const keyLight=new THREE.DirectionalLight(0xffdca2,3.2);keyLight.position.set(5,10,7);scene.add(keyLight);
  const rim=new THREE.PointLight(0x4ecfff,55,25,2);rim.position.set(-7,5,-6);scene.add(rim);
  const red=new THREE.PointLight(0xff4b6e,28,20,2);red.position.set(6,3,3);scene.add(red);
  const world=new THREE.Group();scene.add(world);
  const board3=makeBoard(THREE,6.5);world.add(board3.root);
  const board4=makeBoard(THREE,5.2);world.add(board4.root);board4.root.visible=false;
  const pieces=new THREE.Group();world.add(pieces);
  const links=new THREE.Group();world.add(links);const targets=new THREE.Group();world.add(targets);
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let mode="4d", state2=createChessArenaState(), state4=createDimensionalChessState();
  let sliceZ=3,sliceW=3,selected2=null,selected4=null, destroyed=false,drag=false,lastX=0,lastY=0,yaw=0,pitch=-.55,distance=10;
  let contractDesk=createOutcomeContracts({seed:"matumbo-chess"});
  let contractCount=0;
  const meshes=new Map();

  function clearGroup(g){while(g.children.length){const c=g.children.pop();c.traverse?.(o=>{o.geometry?.dispose?.();o.material?.dispose?.();});}}
  function resize(){const r=canvas.getBoundingClientRect();const w=Math.max(1,r.width),h=Math.max(1,r.height);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
  function cameraUpdate(){camera.position.set(Math.sin(yaw)*Math.cos(pitch)*distance,Math.sin(-pitch)*distance,Math.cos(yaw)*Math.cos(pitch)*distance);camera.lookAt(0,0,0);}
  function showPiece(group,x,y,size){const p=boardPosition(size,x,y);group.position.set(p[0],p[1],p[2]);}

  function render2Pieces(){
    clearGroup(pieces);meshes.clear();
    for(let y=0;y<8;y++)for(let x=0;x<8;x++){
      const p=state2.board[y][x];if(!p)continue;
      const g=createCharacterPiece(THREE,p.type,p.color);showPiece(g,x,y,6.5);g.userData.square=p.square;pieces.add(g);meshes.set(p.square,g);
    }
  }
  function render4Pieces(){
    clearGroup(pieces);meshes.clear();clearGroup(targets);
    const list=slicePieces(state4,sliceZ,sliceW);
    for(const p of list){
      const g=createCharacterPiece(THREE,p.type,p.color);showPiece(g,p.x,p.y,5.2);g.userData.key=p.key;pieces.add(g);meshes.set(p.key,g);
    }
    renderSliceLinks();
    if(selected4!==null){
      const moves=legalMoves4D(state4,selected4);
      for(const move of moves){
        const c=coords(move.to); if(c[2]!==sliceZ||c[3]!==sliceW)continue;
        const p=boardPosition(5.2,c[0],c[1]);
        const g=new THREE.Group();g.position.set(p[0],p[1]+.08,p[2]);g.userData.destinationKey=move.to;
        const ring=new THREE.Mesh(new THREE.TorusGeometry(.22,.045,8,20),new THREE.MeshBasicMaterial({color:state4.board[move.to]?0xff6b7d:0x55d8ff,transparent:true,opacity:.9}));ring.rotation.x=Math.PI/2;g.add(ring);targets.add(g);
      }
    }
  }
  function renderSliceLinks(){
    clearGroup(links);
    const center=(sliceZ-3.5)*.75, w=(sliceW-3.5)*.75;
    for(let i=0;i<4;i++){
      const x=(i-1.5)*.78+center,y=.18,z=-3.3;
      const geom=new THREE.TorusGeometry(.18,.018,6,18);const m=new THREE.MeshBasicMaterial({color:0x4ecfff,transparent:true,opacity:.35});const t=new THREE.Mesh(geom,m);t.position.set(x,y,z);t.rotation.x=Math.PI/2;links.add(t);
    }
    // Tesseract edges: nested cube projection communicates the W/Z dimensions.
    const outer=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3.2,3.2,3.2)),new THREE.LineBasicMaterial({color:0x55c9ff,transparent:true,opacity:.28}));
    const inner=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.65,1.65,1.65)),new THREE.LineBasicMaterial({color:0xd778ff,transparent:true,opacity:.38}));
    outer.position.set(0,2.0,-2.6);inner.position.set(0,2.0,-2.6);links.add(outer,inner);
    const edgePairs=[];for(const a of [-1,1])for(const b of [-1,1])for(const c of [-1,1])edgePairs.push([a,b,c]);
    for(const [a,b,c] of edgePairs){
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a*1.6,b*1.6,c*1.6),new THREE.Vector3(a*.825,b*.825,c*.825)]),new THREE.LineBasicMaterial({color:0x9e6cff,transparent:true,opacity:.28}));
      line.position.set(0,2.0,-2.6);links.add(line);
    }
  }

  function legal2(from){return state2.legalMoves.filter(m=>m.from===from).map(m=>m.to);}
  function legal4(from){return legalMoves4D(state4,from).filter(m=>m.from===from).map(m=>m.to);}

  function select2(square){
    selected2=square;
    for(const [sq,g] of meshes){g.scale.setScalar(sq===square?1.18:1);}
  }
  function select4(k){selected4=k;for(const [id,g] of meshes)g.scale.setScalar(id===k?1.18:1);}

  function pick(event){
    const r=canvas.getBoundingClientRect();pointer.x=((event.clientX-r.left)/r.width)*2-1;pointer.y=-((event.clientY-r.top)/r.height)*2+1;
    raycaster.setFromCamera(pointer,camera);
    const hits=raycaster.intersectObjects([...targets.children,...meshes.values()],true);
    let g=hits[0]?.object;while(g&&!Number.isInteger(g.userData?.destinationKey)&&!g.userData?.square&&!Number.isInteger(g.userData?.key))g=g.parent;
    if(g&&Number.isInteger(g.userData?.destinationKey)&&mode==="4d"&&selected4!==null){
      const result=applyDimensionalMove(state4,selected4,g.userData.destinationKey);
      if(result.accepted){const destination=coords(g.userData.destinationKey);state4=result.state;sliceZ=destination[2];sliceW=destination[3];selected4=null;root.querySelector("[data-z]").value=sliceZ;root.querySelector("[data-w]").value=sliceW;render4Pieces();refresh();return;}
    }while(g&&!g.userData?.square&&!Number.isInteger(g.userData?.key))g=g.parent;
    if(!g)return;
    if(mode==="4d"){
      const k=g.userData.key;
      if(selected4!==null&&legal4(selected4).includes(k)){
        const result=applyDimensionalMove(state4,selected4,k);if(result.accepted){state4=result.state;selected4=null;render4Pieces();refresh();return;}
      }
      const p=state4.board[k];if(p?.color===state4.turn)select4(k);
    }else{
      const sq=g.userData.square;
      if(selected2&&legal2(selected2).includes(sq)){
        const result=applyChessArenaMove(state2,selected2,sq,"q");if(result.accepted){state2=result.state;selected2=null;render2Pieces();refresh();return;}
      }
      const p=state2.board.flat().find(x=>x?.square===sq);if(p?.color===state2.turn)select2(sq);
    }
  }

  function refresh(){
    const targetBox=root.querySelector("[data-targets]");
    targetBox.replaceChildren();
    if(mode==="4d"&&selected4!==null){
      const moves=legalMoves4D(state4,selected4);
      if(!moves.length){const d=documentRoot.createElement("div");d.style.cssText="font-size:10px;color:#718b9c";d.textContent="No legal destinations.";targetBox.append(d);}
      else moves.slice(0,80).forEach(m=>{const q=coords(m.to),b=documentRoot.createElement("button");b.className="dc-target"+(state4.board[m.to]?" capture":"");b.textContent=(state4.board[m.to]?"Capture · ":"Move · ")+String.fromCharCode(97+q[0])+(q[1]+1)+" · Z"+q[2]+" W"+q[3];b.addEventListener("click",()=>{sliceZ=q[2];sliceW=q[3];root.querySelector("[data-z]").value=sliceZ;root.querySelector("[data-w]").value=sliceW;const result=applyDimensionalMove(state4,selected4,m.to);if(result.accepted){state4=result.state;selected4=null;render4Pieces();refresh();}});targetBox.append(b);});
    }else{const d=documentRoot.createElement("div");d.style.cssText="font-size:10px;color:#718b9c";d.textContent=mode==="4d"?"Select a character to reveal legal destinations.":"Switch to 4D for dimensional move targets.";targetBox.append(d);}
    const turn=mode==="4d"?state4.turn:state2.turn;
    root.querySelector("[data-turn]").textContent=`${turn==="w"?"WHITE":"BLACK"} TO MOVE`;
    root.querySelector("[data-coords]").textContent=mode==="4d"?`Z${sliceZ} · W${sliceW}`:"CLASSIC BOARD";
    const status=mode==="4d"?(state4.gameOver?`${state4.winner?"CHECKMATE":"DRAW"} · 4D`:`${countPieces(state4).w}W / ${countPieces(state4).b}B pieces`):(state2.checkmate?"CHECKMATE":state2.check?"CHECK":"Classic chess");
    root.querySelector("[data-status]").textContent=status;
    root.querySelector("[data-slice-help]").textContent=mode==="4d"?`Active slice Z=${sliceZ}, W=${sliceW}. A move may land on another slice; select a destination after switching Z/W.`:"Classic chess board with the same character champions.";
    const list=root.querySelector("[data-moves]");const history=mode==="4d"?state4.history:state2.history;
    list.replaceChildren();history.slice(-18).forEach((m,i)=>{const d=documentRoot.createElement("div");d.className="dc-move";d.textContent=m.san||`${m.from} → ${m.to}`;list.append(d);});
  }

  function setMode(next){
    mode=next;root.querySelectorAll("[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===next));
    board3.root.visible=next!=="4d";board4.root.visible=next==="4d";
    if(next==="4d")render4Pieces();else render2Pieces();resize();refresh();
  }

  root.querySelectorAll("[data-mode]").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));
  root.querySelector("[data-w]").addEventListener("input",e=>{sliceW=Number(e.target.value);if(mode==="4d")render4Pieces();refresh();});
  root.querySelector("[data-z]").addEventListener("input",e=>{sliceZ=Number(e.target.value);if(mode==="4d")render4Pieces();refresh();});
  root.querySelector("[data-undo]").addEventListener("click",()=>{if(mode!=="4d")return;const r=undoDimensionalMove(state4);if(r.changed){state4=r.state;selected4=null;const last=state4.lastMove;if(last){const q=coords(last.to);sliceZ=q[2];sliceW=q[3];root.querySelector("[data-z]").value=sliceZ;root.querySelector("[data-w]").value=sliceW;}render4Pieces();refresh();}});
  root.querySelector("[data-redo]").addEventListener("click",()=>{if(mode!=="4d")return;const r=redoDimensionalMove(state4);if(r.changed){state4=r.state;selected4=null;const last=state4.lastMove;if(last){const q=coords(last.to);sliceZ=q[2];sliceW=q[3];root.querySelector("[data-z]").value=sliceZ;root.querySelector("[data-w]").value=sliceW;}render4Pieces();refresh();}});
  root.querySelector("[data-new]").addEventListener("click",()=>{state2=createChessArenaState();state4=createDimensionalChessState();selected2=null;selected4=null;contractDesk=createOutcomeContracts({seed:"matumbo-chess"});contractCount=0;setMode(mode);});
  root.querySelector("[data-center]").addEventListener("click",()=>{yaw=0;pitch=-.55;distance=10;cameraUpdate();});
  root.querySelector("[data-brenda]").addEventListener("click",()=>{root.querySelector("[data-status]").textContent=mode==="4d"?"Brenda: Watch the Z/W slice indicators — they are your doorway through the fourth dimension.":"Brenda: The champions are ordinary chess pieces in the classic mode; 4D is where they gain dimensional movement.";});
  root.querySelectorAll("[data-contract]").forEach(btn=>btn.addEventListener("click",()=>{
    const kind=btn.dataset.contract;const outcome=kind==="white"?"WHITE":kind==="black"?"BLACK":kind==="draw"?"DRAW":"NEXT-MOVE-KNIGHT";
    try{
      const c=contractDesk.createContract({eventId:`chess:${mode}:contract-${contractCount+1}`,eventLabel:kind==="move"?"Next move contract":"Dimensional Chess outcome",outcomes:kind==="move"?["NEXT-MOVE-KNIGHT","OTHER"]:["WHITE","BLACK","DRAW"],creator:"player"});
      contractCount++;root.querySelector("[data-status]").textContent=`Contract #${contractCount} staged · ${outcome} · TUMBO-SIM`;
    }catch{root.querySelector("[data-status]").textContent="Contract unavailable in this session";}
  }));
  canvas.addEventListener("pointerdown",e=>{drag=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture?.(e.pointerId);});
  canvas.addEventListener("pointermove",e=>{if(!drag)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;yaw-=dx*.008;pitch=Math.max(-1.25,Math.min(.15,pitch+dy*.006));cameraUpdate();});
  canvas.addEventListener("pointerup",()=>{drag=false;});
  canvas.addEventListener("click",e=>{if(Math.abs(e.clientX-lastX)<4&&Math.abs(e.clientY-lastY)<4)pick(e);});
  canvas.addEventListener("wheel",e=>{e.preventDefault();distance=Math.max(5.5,Math.min(17,distance+e.deltaY*.008));cameraUpdate();},{passive:false});
  window.addEventListener("resize",resize);
  render4Pieces();cameraUpdate();resize();refresh();

  function animate(t){
    if(destroyed)return;
    links.rotation.y=Math.sin(t*.00018)*.08;
    renderer.render(scene,camera);requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  return {destroy(){destroyed=true;window.removeEventListener("resize",resize);renderer.dispose();root.remove();}};
}
