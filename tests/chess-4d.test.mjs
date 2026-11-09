import test from "node:test";
import assert from "node:assert/strict";
import {createDimensionalChessState,legalMoves4D,applyDimensionalMove,undoDimensionalMove,redoDimensionalMove,countPieces,coords,key,DIMENSIONAL_RULES} from "../src/domains/chess-4d.js";

test("4D board has 4096 cells and 448 pieces per side",()=>{
  const s=createDimensionalChessState();
  assert.equal(s.board.length,4096);
  assert.deepEqual(countPieces(s),{w:448,b:448});
});

test("4D coordinate encoding is reversible",()=>{
  for(const q of [[0,0,0,0],[7,7,7,7],[3,4,5,6]]) assert.deepEqual(coords(key(...q)),q);
});

test("4D rules expose the native hypercube movement model",()=>{
  assert.equal(DIMENSIONAL_RULES.cells,4096);
  assert.match(DIMENSIONAL_RULES.king,/80/);
  const s=createDimensionalChessState();
  const moves=legalMoves4D(s);
  assert.ok(moves.length>0);
  assert.ok(moves.some(m=>coords(m.from)[3]!==coords(m.to)[3]||coords(m.from)[2]!==coords(m.to)[2]));
});

test("a legal 4D move changes turn and preserves piece accounting",()=>{
  const s=createDimensionalChessState();
  const from=key(4,1,3,3);
  const to=key(4,2,3,3);
  assert.ok(legalMoves4D(s,from).some(m=>m.to===to));
  const r=applyDimensionalMove(s,from,to);
  assert.equal(r.accepted,true);
  assert.equal(r.state.turn,"b");
  assert.equal(r.state.ply,1);
  assert.equal(countPieces(r.state).w+countPieces(r.state).b,896);
});

// CI smoke coverage: native 4D rules remain dependency-free.


test("4D rook can move across the Z axis",()=>{
  const s=createDimensionalChessState();
  s.board.fill(null);
  s.board[key(0,0,0,0)]={type:"k",color:"w",axis:"y"};
  s.board[key(7,7,7,7)]={type:"k",color:"b",axis:"y"};
  const from=key(4,4,3,3),to=key(4,4,4,3);
  s.board[from]={type:"r",color:"w",axis:"y"};
  assert.ok(legalMoves4D(s,from).some(m=>m.to===to));
  const r=applyDimensionalMove(s,from,to);
  assert.equal(r.accepted,true);
  assert.deepEqual(coords(r.state.lastMove.to),[4,4,4,3]);
});

test("4D moves support undo and redo",()=>{
  const s=createDimensionalChessState();
  const from=key(4,1,3,3),to=key(4,2,3,3);
  const moved=applyDimensionalMove(s,from,to).state;
  const undone=undoDimensionalMove(moved);
  assert.equal(undone.changed,true);
  assert.equal(undone.state.board[from]?.type,"p");
  assert.equal(undone.state.board[to],null);
  const redone=redoDimensionalMove(undone.state);
  assert.equal(redone.changed,true);
  assert.equal(redone.state.board[from],null);
  assert.equal(redone.state.board[to]?.type,"p");
});
