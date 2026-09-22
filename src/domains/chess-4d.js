/**
 * maTumbo Dimensional Chess — native 4D rules engine.
 *
 * The rules are independently implemented from the published mathematical
 * description of 4D chess: an 8^4 lattice, rook/bishop/queen rays in one or
 * two axes, 4D knights, 80-neighbour kings, and Y/W-axis pawns.
 * No upstream source code or assets are copied.
 */
export const DIMENSIONAL_CHESS_SOURCE = "matumbo-dimensional-chess";
export const SIZE = 8;
export const CELL_COUNT = 4096;
const AXES = [0,1,2,3];
const TYPES = ["p","n","b","r","q","k"];

export const key = (x,y,z,w) => (((((w * 8) + z) * 8 + y) * 8) + x);
export const coords = (k) => {
  const x = k & 7;
  const y = (k >> 3) & 7;
  const z = (k >> 6) & 7;
  const w = (k >> 9) & 7;
  return [x,y,z,w];
};
const inside = (v) => v >= 0 && v < 8;
const same = (a,b) => a[0]===b[0] && a[1]===b[1] && a[2]===b[2] && a[3]===b[3];
const cloneBoard = (board) => board.slice();

function placeStandard(board, z, w, color) {
  const back = ["r","n","b","q","k","b","n","r"];
  const pawnY = color === "w" ? 1 : 6;
  const backY = color === "w" ? 0 : 7;
  const pawnW = color === "w" ? 1 : 6;
  for (let x=0;x<8;x++) {
    board[key(x,pawnY,z,w)] = {type:"p",color,axis:"y"};
    board[key(x,backY,z,w)] = {type:back[x],color,axis:"y"};
    if (x % 2 === 0) board[key(x,pawnW,z,w)] = board[key(x,pawnY,z,w)];
  }
  // A second pawn rank would overwrite pieces, so the W-oriented family uses
  // the same physical 16-piece set but records orientation by file parity.
  for (let x=0;x<8;x++) {
    const p = board[key(x,pawnY,z,w)];
    if (p) p.axis = ((z===3||z===4)&&(w===3||w===4)&&x%2===1) ? "w" : "y";
  }
}

export function createDimensionalChessState() {
  const board = new Array(CELL_COUNT).fill(null);
  const central = [];
  const other = [];
  for (let w=0;w<8;w++) for (let z=0;z<8;z++) {
    if ((z===3||z===4) && (w===3||w===4)) central.push([z,w]);
    else other.push([z,w]);
  }
  // 24 white-only, 24 black-only and 12 empty slices. Ordering is stable.
  const whiteOnly = other.slice(0,24);
  const blackOnly = other.slice(24,48);
  const kings = [];
  for (const [z,w] of central) {
    placeStandard(board,z,w,"w");
    placeStandard(board,z,w,"b");
    kings.push([key(4,0,z,w),key(4,7,z,w)]);
  }
  for (const [z,w] of whiteOnly) { placeStandard(board,z,w,"w"); kings.push([key(4,0,z,w)]); }
  for (const [z,w] of blackOnly) { placeStandard(board,z,w,"b"); kings.push([key(4,7,z,w)]); }
  // Every occupied slice has 16 pieces per side; total = 448 each.
  return {
    board,
    turn:"w",
    history:[],
    selected:null,
    ply:0,
    gameOver:false,
    winner:null,
    lastMove:null,
    kings,
  };
}

function pushRay(board, out, origin, dx) {
  let p = origin.slice();
  for (let n=1;n<8;n++) {
    p = p.map((v,i)=>v+dx[i]);
    if (p.some(v=>!inside(v))) break;
    const k=key(...p);
    const target=board[k];
    if (!target) out.push(k);
    else {
      if (target.color!==board[origin.__k]?.color) out.push(k);
      break;
    }
  }
}

function addRay(board,out,origin,color,dx) {
  let p=origin.slice();
  for (let n=1;n<8;n++) {
    p=p.map((v,i)=>v+dx[i]);
    if(p.some(v=>!inside(v))) break;
    const k=key(...p), target=board[k];
    if(!target){out.push(k);continue;}
    if(target.color!==color)out.push(k);
    break;
  }
}

function movementTargets(board, piece, from) {
  const p=coords(from), out=[];
  const color=piece.color;
  const rayDirs=[];
  if(piece.type==="r"||piece.type==="q"){
    for(const a of AXES) for(const s of [-1,1]) { const d=[0,0,0,0]; d[a]=s; rayDirs.push(d); }
  }
  if(piece.type==="b"||piece.type==="q"){
    for(let a=0;a<4;a++) for(let b=a+1;b<4;b++)
      for(const sa of [-1,1]) for(const sb of [-1,1]){
        const d=[0,0,0,0]; d[a]=sa; d[b]=sb; rayDirs.push(d);
      }
  }
  for(const d of rayDirs)addRay(board,out,p,color,d);

  if(piece.type==="k"){
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)for(let dw=-1;dw<=1;dw++){
      if(dx===0&&dy===0&&dz===0&&dw===0)continue;
      const q=[p[0]+dx,p[1]+dy,p[2]+dz,p[3]+dw];
      if(q.every(inside)){const t=board[key(...q)];if(!t||t.color!==color)out.push(key(...q));}
    }
  }

  if(piece.type==="n"){
    for(let a=0;a<4;a++)for(let b=0;b<4;b++)if(a!==b)
      for(const sa of [-1,1])for(const sb of [-1,1]){
        const q=p.slice();q[a]+=2*sa;q[b]+=sb;
        if(q.every(inside)){const t=board[key(...q)];if(!t||t.color!==color)out.push(key(...q));}
      }
  }

  if(piece.type==="p"){
    const axis=piece.axis==="w"?3:1;
    const dir=color==="w"?1:-1;
    const one=p.slice();one[axis]+=dir;
    if(one.every(inside)&&!board[key(...one)]) {
      out.push(key(...one));
      const start=color==="w"?1:6;
      if(p[axis]===start){const two=p.slice();two[axis]+=2*dir;if(two.every(inside)&&!board[key(...two)])out.push(key(...two));}
    }
    const forward=p[axis]+dir;
    if(inside(forward)){
      for(const lateral of [-1,1]){
        const q=p.slice();q[axis]=forward;q[0]+=lateral;
        if(q.every(inside)){const t=board[key(...q)];if(t&&t.color!==color)out.push(key(...q));}
      }
    }
  }
  return [...new Set(out)];
}

function attacks(board, piece, from, targetKey) {
  const target=coords(targetKey), p=coords(from);
  if(piece.type==="p"){
    const axis=piece.axis==="w"?3:1, dir=piece.color==="w"?1:-1;
    return target[axis]===p[axis]+dir &&
      Math.abs(target[0]-p[0])===1 &&
      target.slice(2).every((v,i)=>v===p[i+2]);
  }
  if(piece.type==="k"){
    return Math.max(...target.map((v,i)=>Math.abs(v-p[i])))===1;
  }
  return movementTargets(board,piece,from).includes(targetKey);
}

function isKingAttacked(board,color) {
  const kings=[], attackers=[];
  for(let k=0;k<CELL_COUNT;k++){
    const p=board[k];
    if(!p)continue;
    if(p.color===color&&p.type==="k")kings.push(k);
    else if(p.color!==color)attackers.push(k);
  }
  if(kings.length===0)return true;
  for(const king of kings)for(const q of attackers){
    const a=board[q];
    if(a&&attacks(board,a,q,king))return true;
  }
  return false;
}

function pseudoMoves4D(state, from = null) {
  const board=state.board, side=state.turn, out=[];
  for(let k=0;k<CELL_COUNT;k++){
    const piece=board[k];
    if(!piece||piece.color!==side||(from!==null&&k!==from))continue;
    for(const to of movementTargets(board,piece,k)){
      out.push({from:k,to,san:formatMove(board,k,to),capture:Boolean(board[to]),piece:piece.type});
    }
  }
  return out;
}

export function legalMoves4D(state, from = null) {
  const candidates=pseudoMoves4D(state,from);
  // Full-position enumeration is intentionally pseudo-legal: the renderer
  // uses it for move counts/checkmate probes and must not scan thousands of
  // hypothetical boards. A selected piece gets full royal-king validation.
  if(from===null)return candidates;
  const board=state.board, out=[];
  const piece=board[from];
  if(!piece)return out;
  for(const move of candidates){
    const next=cloneBoard(board);
    next[move.to]=piece;
    next[from]=null;
    if(piece.type==="p"){
      const c=coords(move.to), axis=piece.axis==="w"?3:1;
      if(c[axis]===0||c[axis]===7)next[move.to]={...piece,type:"q"};
    }
    if(!isKingAttacked(next,piece.color))out.push(move);
  }
  return out;
}

function formatMove(board,from,to){
  const p=board[from], a=coords(from), b=coords(to);
  const names={p:"",n:"N",b:"B",r:"R",q:"Q",k:"K"};
  return `${names[p.type]}${String.fromCharCode(97+a[0])}${a[1]+1}:${a[2]+1},${a[3]+1} → ${String.fromCharCode(97+b[0])}${b[1]+1}:${b[2]+1}`;
}

export function applyDimensionalMove(state,from,to){
  const move=legalMoves4D(state,from).find(m=>m.to===to);
  if(!move)return {accepted:false,reason:"Illegal 4D move",state};
  const board=cloneBoard(state.board), piece=board[from];
  board[to]=piece;board[from]=null;
  const c=coords(to), axis=piece.axis==="w"?3:1;
  if(piece.type==="p"&&(c[axis]===0||c[axis]===7))board[to]={...piece,type:"q"};
  const next={...state,board,turn:state.turn==="w"?"b":"w",ply:state.ply+1,history:[...state.history,move],selected:null,lastMove:move};
  const opp=next.turn;
  const oppHasKing=next.board.some(p=>p?.color===opp&&p.type==="k");
  const replies=legalMoves4D(next);
  if(!oppHasKing){next.gameOver=true;next.winner=state.turn;}
  else if(replies.length===0){next.gameOver=true;next.winner=isKingAttacked(board,opp)?state.turn:null;}
  return {accepted:true,move,state:next};
}

export function slicePieces(state,z,w){
  const out=[];
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    const p=state.board[key(x,y,z,w)];
    if(p)out.push({key:key(x,y,z,w),x,y,z,w,...p});
  }
  return out;
}

export function countPieces(state){
  return state.board.reduce((a,p)=>{if(p)a[p.color]++;return a},{w:0,b:0});
}

export const DIMENSIONAL_RULES = Object.freeze({
  board:"8×8×8×8 hypercubic lattice",
  cells:4096,
  initialPiecesPerSide:448,
  rook:"one-axis rays",
  bishop:"two-axis diagonals across all six coordinate planes",
  queen:"rook + bishop",
  knight:"±2/±1 jumps across any two axes",
  king:"all 80 Chebyshev-adjacent cells",
  pawn:"Y or W oriented; captures in X dimension; promotes at terminal axis",
});
