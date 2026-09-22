import test from "node:test";
import assert from "node:assert/strict";
import {createDimensionalChessState,legalMoves4D,applyDimensionalMove,countPieces,coords,key,DIMENSIONAL_RULES} from "../src/domains/chess-4d.js";

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
  const move=legalMoves4D(s)[0];
  const r=applyDimensionalMove(s,move.from,move.to);
  assert.equal(r.accepted,true);
  assert.equal(r.state.turn,"b");
  assert.equal(r.state.ply,1);
  assert.equal(countPieces(r.state).w+countPieces(r.state).b,896);
});

// CI smoke coverage: native 4D rules remain dependency-free.
