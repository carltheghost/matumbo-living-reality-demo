import * as THREE from 'three';
import {createChessArenaState,applyChessArenaMove} from '../domains/chess-arena.js';
import {PERSON_STUDIO_STORAGE_KEY} from '../domains/person-studio.js';
import {buildArenaHall,createPieceBuilders,readArenaAvatarAppearance,squarePosition} from './chess-arena-pieces.js';

const pieceName={p:'Pawn',n:'Knight',b:'Bishop',r:'Rook',q:'Queen',k:'King'};
const glyph={w:{k:'♔',q:'♕',r:'♖',b:'♗',n:'♘',p:'♙'},b:{k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'}};
const sideName={w:'White',b:'Black'};

export function mountChessArena({documentRoot=document,host}){
  const wrap=documentRoot.createElement('section');wrap.className='chess-arena-runtime';
  const style=documentRoot.createElement('style');style.textContent=`.chess-arena-runtime{margin-top:12px;padding:12px;border:1px solid rgba(154,92,255,.45);border-radius:12px;background:linear-gradient(160deg,rgba(8,6,18,.98),rgba(8,14,26,.96));color:#eaf4ff}.chess-arena-stage{height:380px;position:relative;border-radius:9px;overflow:hidden;background:radial-gradient(ellipse at 50% 125%,#1c1132 0%,#05070c 62%)}.chess-arena-canvas{width:100%;height:100%;display:block;touch-action:none}.chess-arena-avatar-badge{position:absolute;top:10px;left:10px;max-width:70%;padding:6px 12px;border-radius:999px;border:1px solid rgba(47,232,212,.5);background:rgba(4,10,14,.72);color:#9df2e6;font-size:12px;letter-spacing:.04em;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chess-arena-board{display:grid;grid-template-columns:repeat(8,minmax(26px,1fr));gap:2px;max-width:520px;margin:12px auto}.chess-arena-square{aspect-ratio:1;border:1px solid rgba(255,255,255,.1);cursor:pointer;position:relative;color:#0b0f16;font-weight:700}.chess-arena-square.light{background:#8a6a45}.chess-arena-square.dark{background:#2b3b52}.chess-arena-square.legal{box-shadow:inset 0 0 0 4px #57d6a2}.chess-arena-square.selected{box-shadow:inset 0 0 0 4px #ffd26a}.chess-arena-square:hover{filter:brightness(1.25)}.chess-arena-status{font-weight:700;color:#ffd58a;min-height:24px}.chess-arena-help{font-size:12px;color:#a9c6da}.chess-arena-runtime button:not(.chess-arena-square){min-height:44px;padding:8px 12px;border-radius:6px;border:1px solid #6589a0;background:#143246;color:#eef7ff}@media(max-width:700px){.chess-arena-stage{height:280px}.chess-arena-runtime{padding:8px}.chess-arena-board{gap:1px}}`;wrap.append(style);
  const stage=documentRoot.createElement('div');stage.className='chess-arena-stage';
  const badge=documentRoot.createElement('div');badge.className='chess-arena-avatar-badge';badge.setAttribute('role','note');stage.append(badge);
  const board=documentRoot.createElement('div');board.className='chess-arena-board';board.setAttribute('aria-label','Chess board');
  const status=documentRoot.createElement('p');status.className='chess-arena-status';status.setAttribute('role','status');
  const reset=documentRoot.createElement('button');reset.type='button';reset.textContent='Reset chess match';
  const help=documentRoot.createElement('p');help.className='chess-arena-help';help.textContent='Your avatar takes the board as ivory and obsidian champions. Select a champion, then a highlighted square. Drag the 3D arena to orbit; wheel to zoom.';
  wrap.append(stage,status,board,reset,help);host.append(wrap);
  let state=createChessArenaState(),selected=null,meshes=new Map(),targetMeshes=new Map(),pendingAnimation=null;
  let appearance=readArenaAvatarAppearance();
  let builders=createPieceBuilders(THREE,appearance);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.domElement.className='chess-arena-canvas';stage.append(renderer.domElement);
  const scene=new THREE.Scene();scene.fog=new THREE.Fog(0x05070c,20,46);
  scene.add(new THREE.HemisphereLight(0x8fa8ff,0x140a20,1.15));
  const key=new THREE.DirectionalLight(0xffd9a0,2.6);key.position.set(5,9,6);scene.add(key);
  const rimViolet=new THREE.PointLight(0x8b46ff,70,34,1.8);rimViolet.position.set(-8,5.5,-7);scene.add(rimViolet);
  const rimTeal=new THREE.PointLight(0x2fe8d4,45,32,1.8);rimTeal.position.set(8,4.5,-6);scene.add(rimTeal);
  const camera=new THREE.PerspectiveCamera(38,1,.1,120);camera.position.set(0,10,9);camera.lookAt(0,0,0);
  const world=new THREE.Group();scene.add(world);
  const hall=buildArenaHall(THREE);world.add(hall.group);
  const pieces=new THREE.Group();world.add(pieces);
  function describeBadge(){
    badge.textContent=appearance.approved&&appearance.displayName?`Avatar champions · ${appearance.displayName}`:'Avatar champions · default look';
    badge.title=appearance.approved?'Pieces wear your approved Person Studio appearance (skin, hair, outfit).':'Approve a Person Studio profile and the pieces will wear your look.';
  }
  function render(){pieces.clear();meshes.clear();targetMeshes.clear();board.replaceChildren();for(let rank=0;rank<8;rank++)for(let file=0;file<8;file++){const square='abcdefgh'[file]+(rank+1),button=documentRoot.createElement('button');button.type='button';button.className='chess-arena-square '+((file+rank)%2?'dark':'light');button.dataset.square=square;const piece=state.board.flat().find(p=>p?.square===square);if(piece){button.textContent=glyph[piece.color][piece.type];button.classList.add('occupied');button.setAttribute('aria-label',`${pieceName[piece.type]} ${sideName[piece.color]} on ${square}`);}else button.setAttribute('aria-label',square);button.addEventListener('click',()=>clickSquare(square));board.append(button);}
    for(const row of state.board)for(const piece of row)if(piece){const mesh=builders.buildPiece(piece.type,piece.color);const [x,y,z]=squarePosition(piece.square);mesh.position.set(x,y,z);mesh.rotation.y=piece.color==='w'?Math.PI:0;mesh.userData.square=piece.square;pieces.add(mesh);meshes.set(piece.square,mesh);}
    const selectedMesh=selected?meshes.get(selected):null;if(selectedMesh)selectedMesh.position.y+=.22;
    if(pendingAnimation){const mesh=meshes.get(pendingAnimation.to);if(mesh){const [fx,fy,fz]=squarePosition(pendingAnimation.from),[tx,ty,tz]=squarePosition(pendingAnimation.to),from=new THREE.Vector3(fx,fy,fz),to=new THREE.Vector3(tx,ty,tz),start=performance.now();const tick=now=>{const t=Math.min(1,(now-start)/520);mesh.position.lerpVectors(from,to,t);mesh.position.y+=Math.sin(t*Math.PI)*.7;if(t<1)requestAnimationFrame(tick);};requestAnimationFrame(tick);}pendingAnimation=null;}
    const legal=selected?state.legalMoves.filter(m=>m.from===selected):[];legal.forEach(move=>{const target=documentRoot.querySelector(`[data-square="${move.to}"]`);target?.classList.add('legal');targetMeshes.set(move.to,move);});
    if(legal.length)hall.markers.show(legal.map(move=>move.to));else hall.markers.hide();
    documentRoot.querySelector(`[data-square="${selected}"]`)?.classList.add('selected');
    status.textContent=state.gameOver?(state.checkmate?'CHECKMATE · '+(state.turn==='w'?'Black':'White')+' wins':'DRAW · match complete'):(state.check?'CHECK · ':'')+(state.turn==='w'?'White':'Black')+' to move'+(state.history.length?' · '+state.history.at(-1).san:'');
    describeBadge();
  }
  function clickSquare(square){const piece=state.board.flat().find(p=>p?.square===square);if(selected&&targetMeshes.has(square)){const result=applyChessArenaMove(state,selected,square);if(result.accepted){pendingAnimation={from:selected,to:square};state=result.state;selected=null;}else status.textContent=result.reason;render();return;}selected=piece?.color===state.turn?square:null;render();}
  reset.addEventListener('click',()=>{state=createChessArenaState();selected=null;render();});
  function getSnapshot(){return {state,selected,appearance};}
  function refreshAppearance(){const next=readArenaAvatarAppearance();builders.dispose();builders=createPieceBuilders(THREE,next);appearance=next;render();return getSnapshot();}
  const view=documentRoot.defaultView??null;const onStorage=event=>{if(!event||event.key===null||event.key===PERSON_STUDIO_STORAGE_KEY)refreshAppearance();};view?.addEventListener?.('storage',onStorage);
  let yaw=.0,pitch=-.45,dist=13,drag=null;renderer.domElement.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture(e.pointerId);});renderer.domElement.addEventListener('pointermove',e=>{if(!drag)return;yaw+=(e.clientX-drag.x)*.008;pitch=Math.max(-1.2,Math.min(.2,pitch+(e.clientY-drag.y)*.006));drag={x:e.clientX,y:e.clientY};draw();});renderer.domElement.addEventListener('pointerup',()=>{drag=null});renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();dist=Math.max(8,Math.min(24,dist+e.deltaY*.01));draw();},{passive:false});
  const draw=()=>{const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.position.set(Math.sin(yaw)*dist,Math.sin(pitch)*dist,Math.cos(yaw)*dist);camera.lookAt(0,0,0);renderer.render(scene,camera);};const ro=new ResizeObserver(draw);ro.observe(stage);render();draw();
  return {getSnapshot,refreshAppearance,destroy:()=>{ro.disconnect();view?.removeEventListener?.('storage',onStorage);hall.dispose();builders.dispose();renderer.dispose();wrap.remove();}};
}
