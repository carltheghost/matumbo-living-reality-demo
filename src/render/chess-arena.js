/** Arena chess — the 3D board IS the play surface.
 *
 * A real chess game (chess.js rules via src/domains/chess-arena.js) played by
 * tapping the 3D avatar pieces and board squares directly (raycast picking).
 * A local minimax AI (src/domains/chess-ai.js, no network) can take either
 * side; 2-player local is also available. The 2D button grid is gone — what
 * remains of 2D is a compact control chip (mode, AI difficulty, new game,
 * resign), a promotion picker, an accessible text move list, and status.
 *
 * The arena lives inside the ARENA / Game Lab console, which the spatial
 * panel system (centered-surfaces.js) makes draggable in 3D with persisted
 * positions — this module never fights that system: it only fills its host.
 *
 * Projection only: local simulation, no identity authority, no wallet, no
 * ledger, no signing, no settlement.
 */
import * as THREE from 'three';
import {createChessArenaState,applyChessArenaMove} from '../domains/chess-arena.js?v=20260918-avatar-chess';
import {chooseAiMove,CHESS_AI_DIFFICULTIES,resolveAiDifficulty} from '../domains/chess-ai.js?v=20260918-avatar-chess';
import {PERSON_STUDIO_STORAGE_KEY} from '../domains/person-studio.js';
import {buildArenaHall,createPieceBuilders,readArenaAvatarAppearance,squarePosition,CHESS_ROLE_GLYPHS} from './chess-arena-pieces.js?v=20260918-avatar-chess';

const pieceName={p:'Pawn',n:'Knight',b:'Bishop',r:'Rook',q:'Queen',k:'King'};
const sideName={w:'White',b:'Black'};
const MODES=Object.freeze({
  white:Object.freeze({id:'white',label:'You play White · AI plays Black'}),
  black:Object.freeze({id:'black',label:'You play Black · AI plays White'}),
  local:Object.freeze({id:'local',label:'Two players · local'}),
});
const PROMOTION_ORDER=['q','r','b','n'];

export function mountChessArena({documentRoot=document,host}){
  const wrap=documentRoot.createElement('section');wrap.className='chess-arena-runtime';
  const style=documentRoot.createElement('style');style.textContent=`
.chess-arena-runtime{margin-top:12px;padding:12px;border:1px solid rgba(154,92,255,.45);border-radius:12px;background:linear-gradient(160deg,rgba(8,6,18,.98),rgba(8,14,26,.96));color:#eaf4ff}
.chess-arena-stage{height:440px;position:relative;border-radius:9px;overflow:hidden;background:radial-gradient(ellipse at 50% 125%,#1c1132 0%,#05070c 62%)}
.chess-arena-canvas{width:100%;height:100%;display:block;touch-action:none;cursor:pointer}
.chess-arena-avatar-badge{position:absolute;top:10px;left:10px;max-width:70%;padding:6px 12px;border-radius:999px;border:1px solid rgba(47,232,212,.5);background:rgba(4,10,14,.72);color:#9df2e6;font-size:12px;letter-spacing:.04em;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chess-arena-thinking{position:absolute;top:10px;right:10px;padding:6px 12px;border-radius:999px;border:1px solid rgba(255,210,106,.55);background:rgba(20,12,4,.78);color:#ffd26a;font-size:12px;letter-spacing:.06em;pointer-events:none;animation:chess-arena-pulse 1.1s ease-in-out infinite}
.chess-arena-thinking[hidden]{display:none}
@keyframes chess-arena-pulse{0%,100%{opacity:.55}50%{opacity:1}}
.chess-arena-chip{margin-top:10px;padding:10px;border:1px solid rgba(120,170,220,.28);border-radius:10px;background:rgba(10,20,34,.55)}
.chess-arena-status{font-weight:700;color:#ffd58a;min-height:22px;margin:0 0 8px;font-size:13px}
.chess-arena-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.chess-arena-controls label{display:flex;align-items:center;gap:6px;font-size:11px;color:#a9c6da;letter-spacing:.04em}
.chess-arena-controls select{min-height:40px;border-radius:6px;border:1px solid #6589a0;background:#0e2233;color:#eef7ff;font-size:12px;padding:4px 6px;max-width:150px}
.chess-arena-controls button{min-height:40px;padding:8px 12px;border-radius:6px;border:1px solid #6589a0;background:#143246;color:#eef7ff;font-size:12px;cursor:pointer}
.chess-arena-controls button:hover{filter:brightness(1.2)}
.chess-arena-resign{border-color:rgba(255,148,164,.4) !important;background:rgba(148,59,76,.25) !important}
.chess-arena-promotion{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}
.chess-arena-promotion[hidden]{display:none}
.chess-arena-promotion span{font-size:12px;color:#ffd58a}
.chess-arena-promotion button{min-width:52px;min-height:52px;font-size:26px;border-radius:8px;border:1px solid rgba(255,210,106,.6);background:rgba(30,22,8,.85);color:#ffe9c0;cursor:pointer}
.chess-arena-moves{margin-top:8px;font-size:12px;color:#b9d2e6}
.chess-arena-moves summary{cursor:pointer;color:#8fd8f2;letter-spacing:.05em;font-size:11px}
.chess-arena-movelist{max-height:84px;overflow:auto;margin-top:6px;padding:6px 8px;border:1px solid rgba(120,170,220,.18);border-radius:8px;background:rgba(6,10,18,.5);font-family:ui-monospace,monospace}
.chess-arena-moverow{display:flex;gap:10px;padding:1px 0}
.chess-arena-moverow .n{color:#6f8ba3;min-width:28px}
.chess-arena-help{font-size:11px;color:#a9c6da;margin:8px 0 0}
@media(max-width:700px){.chess-arena-stage{height:300px}.chess-arena-runtime{padding:8px}}`;
  wrap.append(style);

  const stage=documentRoot.createElement('div');stage.className='chess-arena-stage';
  const badge=documentRoot.createElement('div');badge.className='chess-arena-avatar-badge';badge.setAttribute('role','note');stage.append(badge);
  const thinking=documentRoot.createElement('div');thinking.className='chess-arena-thinking';thinking.hidden=true;thinking.textContent='AI thinking…';stage.append(thinking);

  const chip=documentRoot.createElement('div');chip.className='chess-arena-chip';
  const status=documentRoot.createElement('p');status.className='chess-arena-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const controls=documentRoot.createElement('div');controls.className='chess-arena-controls';
  const modeLabel=documentRoot.createElement('label');modeLabel.textContent='Mode ';
  const modeSelect=documentRoot.createElement('select');modeSelect.setAttribute('aria-label','Game mode');
  for(const key of Object.keys(MODES)){const opt=documentRoot.createElement('option');opt.value=key;opt.textContent=MODES[key].label;modeSelect.append(opt);}
  modeLabel.append(modeSelect);
  const diffLabel=documentRoot.createElement('label');diffLabel.textContent='AI ';
  const diffSelect=documentRoot.createElement('select');diffSelect.setAttribute('aria-label','AI difficulty');
  for(const key of Object.keys(CHESS_AI_DIFFICULTIES)){const opt=documentRoot.createElement('option');opt.value=key;opt.textContent=CHESS_AI_DIFFICULTIES[key].label;diffSelect.append(opt);}
  diffLabel.append(diffSelect);
  const newBtn=documentRoot.createElement('button');newBtn.type='button';newBtn.textContent='New game';
  const resignBtn=documentRoot.createElement('button');resignBtn.type='button';resignBtn.textContent='Resign';resignBtn.className='chess-arena-resign';
  controls.append(modeLabel,diffLabel,newBtn,resignBtn);
  const promotion=documentRoot.createElement('div');promotion.className='chess-arena-promotion';promotion.hidden=true;
  const promoLabel=documentRoot.createElement('span');promoLabel.textContent='Promote to:';promotion.append(promoLabel);
  chip.append(status,controls,promotion);

  const movesDetails=documentRoot.createElement('details');movesDetails.className='chess-arena-moves';
  const movesSummary=documentRoot.createElement('summary');movesSummary.textContent='Moves · text record';
  const moveList=documentRoot.createElement('div');moveList.className='chess-arena-movelist';moveList.setAttribute('role','log');moveList.setAttribute('aria-label','Move list');
  movesDetails.append(movesSummary,moveList);

  const help=documentRoot.createElement('p');help.className='chess-arena-help';
  help.textContent='Tap one of your glowing champions on the 3D board, then tap a highlighted square. Drag the arena to orbit; wheel to zoom.';
  wrap.append(stage,chip,movesDetails,help);host.append(wrap);

  // ---- game state ----
  let state=createChessArenaState();
  let selected=null;
  let mode='white';
  let difficulty='medium';
  let resigned=null;
  let aiThinking=false;
  let pendingPromotion=null;
  let alive=true;
  let aiGeneration=0; // invalidates stale AI timeouts across newGame()
  let activeHops=0; // concurrent hop animations (castling moves two pieces)
  const sanLog=[];
  const meshes=new Map(); // square -> piece group

  const humanSide=()=>mode==='white'?'w':mode==='black'?'b':null;
  const aiSide=()=>mode==='white'?'b':mode==='black'?'w':null;
  const inputOpen=()=>alive&&!state.gameOver&&!resigned&&!aiThinking&&activeHops===0&&!pendingPromotion;
  const pieceAt=(square)=>state.board.flat().find((p)=>p?.square===square)??null;

  // ---- three.js scene ----
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
  const raycaster=new THREE.Raycaster();
  const pointerNDC=new THREE.Vector2();

  function describeBadge(){
    badge.textContent=appearance.approved&&appearance.displayName?`Avatar champions · ${appearance.displayName}`:'Avatar champions · default look';
    badge.title=appearance.approved?'Pieces wear your approved Person Studio appearance.':'Approve a Person Studio profile and the pieces will wear your look.';
  }

  /** Dispose per-piece sprite resources. Ring geometry/materials are shared
   *  caches owned by the foundry and must survive individual captures. */
  function releasePiece(group){
    group.traverse((child)=>{
      if(child.isSprite){
        try{child.material.map?.dispose?.();}catch{/* already released */}
        try{child.material.dispose?.();}catch{/* already released */}
      }
    });
  }

  function buildAllPieces(){
    for(const [,group] of meshes){pieces.remove(group);releasePiece(group);}
    meshes.clear();
    for(const row of state.board)for(const piece of row){
      if(!piece)continue;
      const mesh=builders.buildPiece(piece.type,piece.color);
      const [x,y,z]=squarePosition(piece.square);
      mesh.position.set(x,y,z);
      mesh.userData.square=piece.square;
      mesh.userData.baseY=y;
      pieces.add(mesh);
      meshes.set(piece.square,mesh);
    }
  }

  function refreshStatus(){
    const turnName=sideName[state.turn];
    let text;
    if(resigned){
      text=`${sideName[resigned]} resigned · ${sideName[resigned==='w'?'b':'w']} wins`;
    }else if(state.gameOver){
      text=state.checkmate?`CHECKMATE · ${state.turn==='w'?'Black':'White'} wins`:'DRAW · match complete';
    }else{
      text=`${state.check?'CHECK · ':''}${turnName} to move`;
      if(sanLog.length)text+=` · ${sanLog[sanLog.length-1]}`;
    }
    if(aiThinking)text+=' · AI thinking…';
    status.textContent=text;
    describeBadge();
  }

  function renderMoveList(){
    moveList.replaceChildren();
    for(let i=0;i<sanLog.length;i+=2){
      const row=documentRoot.createElement('div');row.className='chess-arena-moverow';
      const n=documentRoot.createElement('span');n.className='n';n.textContent=`${i/2+1}.`;
      const w=documentRoot.createElement('span');w.textContent=sanLog[i];
      const b=documentRoot.createElement('span');b.textContent=sanLog[i+1]??'';
      row.append(n,w,b);moveList.append(row);
    }
    moveList.scrollTop=moveList.scrollHeight;
  }

  function lift(mesh,on){
    if(!mesh)return;
    mesh.position.y=(mesh.userData.baseY??0.06)+(on?0.22:0);
  }

  function clearSelection(){
    if(selected){lift(meshes.get(selected),false);selected=null;}
    hall.markers.hide();
  }

  function select(square){
    clearSelection();
    selected=square;
    lift(meshes.get(square),true);
    const targets=state.legalMoves.filter((m)=>m.from===square).map((m)=>m.to);
    if(targets.length)hall.markers.show(targets);else hall.markers.hide();
  }

  function animateHop(mesh,fromSquare,toSquare,onDone){
    const [fx,,fz]=squarePosition(fromSquare);
    const [tx,,tz]=squarePosition(toSquare);
    const baseY=mesh.userData.baseY??0.06;
    const from=new THREE.Vector3(fx,baseY,fz);
    const to=new THREE.Vector3(tx,baseY,tz);
    const start=performance.now();
    activeHops++;
    const tick=(now)=>{
      if(!alive)return;
      const t=Math.min(1,(now-start)/480);
      mesh.position.lerpVectors(from,to,t);
      mesh.position.y=baseY+Math.sin(t*Math.PI)*0.7;
      if(t<1){requestAnimationFrame(tick);return;}
      mesh.position.y=baseY;
      activeHops=Math.max(0,activeHops-1);
      onDone?.();
    };
    requestAnimationFrame(tick);
  }

  function shrinkOut(group,onDone){
    const start=performance.now();
    const tick=(now)=>{
      if(!alive)return;
      const t=Math.min(1,(now-start)/260);
      group.scale.setScalar(Math.max(0.001,1-t));
      if(t<1){requestAnimationFrame(tick);return;}
      onDone?.();
    };
    requestAnimationFrame(tick);
  }

  function afterMove(){
    refreshStatus();
    maybeAiMove();
  }

  /** Apply a move to both the rules state and the 3D scene. Handles captures
   *  (including en passant), castling's rook slide, and promotion swaps. */
  function doMove(from,to,promotion='q'){
    const moving=pieceAt(from);
    if(!moving||!alive)return false;
    const targetPiece=pieceAt(to);
    const isEnPassant=moving.type==='p'&&!targetPiece&&from[0]!==to[0];
    const capturedSquare=isEnPassant?to[0]+from[1]:to;
    const isCastle=moving.type==='k'&&Math.abs(from.charCodeAt(0)-to.charCodeAt(0))===2;
    const result=applyChessArenaMove(state,from,to,promotion);
    if(!result.accepted){refreshStatus();status.textContent=result.reason;return false;}
    clearSelection();
    const movingMesh=meshes.get(from);
    if(meshes.has(capturedSquare)&&capturedSquare!==from){
      const victim=meshes.get(capturedSquare);
      meshes.delete(capturedSquare);
      shrinkOut(victim,()=>{pieces.remove(victim);releasePiece(victim);});
    }
    state=result.state;
    sanLog.push(result.move.san);
    renderMoveList();
    let mesh=movingMesh??null;
    meshes.delete(from);
    const landed=pieceAt(to);
    if(mesh&&landed&&landed.type!==moving.type){
      // Promotion: the pawn figure becomes the chosen piece.
      pieces.remove(mesh);releasePiece(mesh);
      mesh=builders.buildPiece(landed.type,landed.color);
      const [x,y,z]=squarePosition(from);
      mesh.position.set(x,y,z);
      mesh.userData.baseY=y;
      pieces.add(mesh);
    }
    if(mesh){
      mesh.userData.square=to;
      mesh.userData.baseY=0.06;
      meshes.set(to,mesh);
      animateHop(mesh,from,to,afterMove);
    }
    if(isCastle){
      const rank=from[1];
      const kingside=to[0]>from[0];
      const rookFrom=(kingside?'h':'a')+rank;
      const rookTo=(kingside?'f':'d')+rank;
      const rookMesh=meshes.get(rookFrom);
      if(rookMesh){
        meshes.delete(rookFrom);
        rookMesh.userData.square=rookTo;
        meshes.set(rookTo,rookMesh);
        animateHop(rookMesh,rookFrom,rookTo,null);
      }
    }
    if(!mesh)afterMove();
    refreshStatus();
    return true;
  }

  function maybeAiMove(){
    const ai=aiSide();
    if(!ai||aiThinking||resigned||state.gameOver||!alive)return;
    if(state.turn!==ai)return;
    aiThinking=true;thinking.hidden=false;refreshStatus();
    const generation=++aiGeneration;
    setTimeout(()=>{
      if(!alive||generation!==aiGeneration)return; // a newer game started
      let pick=null;
      try{pick=chooseAiMove(state,{difficulty});}catch{pick=null;}
      aiThinking=false;thinking.hidden=true;
      if(pick)doMove(pick.from,pick.to,pick.promotion??'q');
      else refreshStatus();
    },420);
  }

  function hidePromotionPicker(){
    pendingPromotion=null;
    promotion.hidden=true;
    promotion.querySelectorAll('button[data-promotion]').forEach((b)=>b.remove());
  }

  function showPromotionPicker(options){
    promotion.hidden=false;
    promotion.querySelectorAll('button[data-promotion]').forEach((b)=>b.remove());
    const side=state.turn;
    for(const type of PROMOTION_ORDER){
      const option=options.find((m)=>m.promotion===type);
      if(!option)continue;
      const button=documentRoot.createElement('button');
      button.type='button';
      button.dataset.promotion=type;
      button.textContent=CHESS_ROLE_GLYPHS[type];
      button.style.color=side==='w'?'#ffe9c0':'#d9c2ff';
      button.setAttribute('aria-label',`Promote to ${pieceName[type]}`);
      button.addEventListener('click',()=>{
        const pending=pendingPromotion;
        hidePromotionPicker();
        if(pending)doMove(pending.from,pending.to,option.promotion);
      });
      promotion.append(button);
    }
  }

  function attemptMove(from,to){
    const options=state.legalMoves.filter((m)=>m.from===from&&m.to===to);
    if(!options.length){clearSelection();return;}
    const promotions=options.filter((m)=>m.promotion);
    if(promotions.length>1){
      pendingPromotion={from,to,options:promotions};
      showPromotionPicker(promotions);
      return;
    }
    doMove(from,to,options[0].promotion??'q');
  }

  function squareFromPoint(clientX,clientY){
    const rect=renderer.domElement.getBoundingClientRect();
    if(!rect.width||!rect.height)return null;
    pointerNDC.set(((clientX-rect.left)/rect.width)*2-1,-((clientY-rect.top)/rect.height)*2+1);
    raycaster.setFromCamera(pointerNDC,camera);
    const hits=raycaster.intersectObjects([pieces,hall.group],true);
    for(const hit of hits){
      let object=hit.object;
      while(object){
        if(object.userData&&typeof object.userData.square==='string')return object.userData.square;
        object=object.parent;
      }
    }
    return null;
  }

  function handleBoardTap(clientX,clientY){
    if(!inputOpen())return;
    const square=squareFromPoint(clientX,clientY);
    if(!square){clearSelection();return;}
    if(selected){
      const targets=state.legalMoves.filter((m)=>m.from===selected);
      if(targets.some((m)=>m.to===square)){attemptMove(selected,square);return;}
    }
    const piece=pieceAt(square);
    const human=humanSide();
    const playable=piece&&piece.color===state.turn&&(mode==='local'||piece.color===human);
    if(playable)select(square);
    else clearSelection();
  }

  function newGame(){
    aiGeneration++; // strand any in-flight AI timeout from the old game
    hidePromotionPicker();
    clearSelection();
    resigned=null;selected=null;aiThinking=false;activeHops=0;
    thinking.hidden=true;
    sanLog.length=0;renderMoveList();
    state=createChessArenaState();
    buildAllPieces();
    refreshStatus();
    maybeAiMove();
  }

  modeSelect.value=mode;
  diffSelect.value=difficulty;
  modeSelect.addEventListener('change',()=>{mode=MODES[modeSelect.value]?modeSelect.value:'white';newGame();});
  diffSelect.addEventListener('change',()=>{difficulty=resolveAiDifficulty(diffSelect.value).id;refreshStatus();});
  newBtn.addEventListener('click',newGame);
  resignBtn.addEventListener('click',()=>{
    if(state.gameOver||resigned||aiThinking||!alive)return;
    resigned=mode==='local'?state.turn:humanSide();
    clearSelection();
    refreshStatus();
  });

  function getSnapshot(){return {state,selected,appearance,mode,difficulty,resigned,aiThinking,sanLog:[...sanLog]};}
  function refreshAppearance(){
    const next=readArenaAvatarAppearance();
    builders.dispose();builders=createPieceBuilders(THREE,next);appearance=next;
    buildAllPieces();refreshStatus();
    return getSnapshot();
  }
  const view=documentRoot.defaultView??null;
  const onStorage=(event)=>{if(!event||event.key===null||event.key===PERSON_STUDIO_STORAGE_KEY)refreshAppearance();};
  view?.addEventListener?.('storage',onStorage);

  // Orbit on drag, board tap on tap: a press that barely moves is a move.
  let yaw=0,pitch=-0.45,dist=13,drag=null,downInfo=null;
  const canvas=renderer.domElement;
  canvas.addEventListener('pointerdown',(e)=>{
    downInfo={x:e.clientX,y:e.clientY,t:performance.now(),moved:false};
    drag={x:e.clientX,y:e.clientY};
    try{canvas.setPointerCapture(e.pointerId);}catch{/* ignore */}
  });
  canvas.addEventListener('pointermove',(e)=>{
    if(!drag||!downInfo)return;
    if(Math.abs(e.clientX-downInfo.x)+Math.abs(e.clientY-downInfo.y)>7)downInfo.moved=true;
    yaw+=(e.clientX-drag.x)*0.008;
    pitch=Math.max(-1.2,Math.min(0.2,pitch+(e.clientY-drag.y)*0.006));
    drag={x:e.clientX,y:e.clientY};
    draw();
  });
  const endPointer=(e)=>{
    const info=downInfo;
    drag=null;downInfo=null;
    if(info&&!info.moved&&performance.now()-info.t<800)handleBoardTap(e.clientX,e.clientY);
  };
  canvas.addEventListener('pointerup',endPointer);
  canvas.addEventListener('pointercancel',()=>{drag=null;downInfo=null;});
  canvas.addEventListener('wheel',(e)=>{e.preventDefault();dist=Math.max(8,Math.min(24,dist+e.deltaY*0.01));draw();},{passive:false});

  const draw=()=>{
    const w=stage.clientWidth,h=stage.clientHeight;
    if(!w||!h)return;
    renderer.setSize(w,h,false);
    camera.aspect=w/h;
    camera.position.set(Math.sin(yaw)*dist,Math.sin(pitch)*dist+10,Math.cos(yaw)*dist+9);
    camera.lookAt(0,0.6,0);
    renderer.render(scene,camera);
  };
  const ro=new ResizeObserver(draw);ro.observe(stage);

  buildAllPieces();
  refreshStatus();
  draw();
  maybeAiMove(); // AI opens when it plays White

  return {
    getSnapshot,
    refreshAppearance,
    destroy:()=>{
      alive=false;
      ro.disconnect();
      view?.removeEventListener?.('storage',onStorage);
      hall.dispose();
      for(const [,group] of meshes){pieces.remove(group);releasePiece(group);}
      meshes.clear();
      builders.dispose();
      renderer.dispose();
      wrap.remove();
    },
  };
}
