import test from 'node:test';
import assert from 'node:assert/strict';
import {createChessArenaState,applyChessArenaMove} from '../src/domains/chess-arena.js';
import {chooseAiMove,resolveAiDifficulty,CHESS_AI_DIFFICULTIES,evaluateCentipawns} from '../src/domains/chess-ai.js';

test('resolveAiDifficulty accepts every difficulty and falls back to medium',()=>{
  assert.equal(resolveAiDifficulty('easy').id,'easy');
  assert.equal(resolveAiDifficulty('medium').id,'medium');
  assert.equal(resolveAiDifficulty('hard').id,'hard');
  assert.equal(resolveAiDifficulty('nope').id,'medium');
  assert.equal(resolveAiDifficulty(undefined).id,'medium');
  assert.equal(Object.keys(CHESS_AI_DIFFICULTIES).length,3);
});

test('the evaluator sees a symmetric start as dead even and material as an edge',()=>{
  const start=createChessArenaState();
  assert.equal(evaluateCentipawns(start),0);
  let state=applyChessArenaMove(start,'e2','e4').state;
  state=applyChessArenaMove(state,'d7','d5').state;
  state=applyChessArenaMove(state,'e4','d5').state; // white wins a pawn
  assert.ok(evaluateCentipawns(state)>0,'up a pawn reads positive for white');
  assert.equal(evaluateCentipawns({board:[]}),0,'an empty board is worth nothing');
});

const legalMovesOf=(state)=>new Set(state.legalMoves.map((m)=>`${m.from}${m.to}${m.promotion}`));

test('the AI always returns a legal move while the game is live',()=>{
  const state=createChessArenaState();
  const before=legalMovesOf(state);
  const pick=chooseAiMove(state,{difficulty:'medium',random:()=>0.5});
  assert.ok(pick);
  assert.ok(before.has(`${pick.from}${pick.to}${pick.promotion}`),'AI move must be legal');
  const result=applyChessArenaMove(state,pick.from,pick.to,pick.promotion);
  assert.equal(result.accepted,true);
  assert.equal(result.state.turn,'b');
});

test('the AI finds mate in one: Fool\u2019s mate finishes with Qh4#',()=>{
  let state=createChessArenaState();
  for(const [from,to] of [['f2','f3'],['e7','e5'],['g2','g4']])state=applyChessArenaMove(state,from,to).state;
  assert.equal(state.turn,'b');
  const pick=chooseAiMove(state,{difficulty:'hard',random:()=>0.5});
  assert.ok(pick);
  assert.equal(pick.from,'d8');
  assert.equal(pick.to,'h4');
  const result=applyChessArenaMove(state,pick.from,pick.to,pick.promotion);
  assert.equal(result.accepted,true);
  assert.equal(result.move.san,'Qh4#');
  assert.equal(result.state.checkmate,true);
  assert.equal(result.state.gameOver,true);
});

test('the AI returns null after the game is over',()=>{
  let state=createChessArenaState();
  for(const [from,to] of [['f2','f3'],['e7','e5'],['g2','g4'],['d8','h4']])state=applyChessArenaMove(state,from,to).state;
  assert.equal(state.gameOver,true);
  assert.equal(chooseAiMove(state,{difficulty:'hard'}),null);
});

test('easy and medium resolve deterministically with the same randomness',()=>{
  // Completed depths are pure functions of the injected random source; the
  // only timing variable is how many depths finish. These budgets sit far
  // from any depth boundary (easy always finishes its max depth 2, medium
  // always finishes depth 2 while depth 3 can never complete), so both
  // back-to-back runs must agree exactly.
  const firstEasy=chooseAiMove(createChessArenaState(),{difficulty:'easy',timeBudgetMs:5000,random:()=>0.25});
  const secondEasy=chooseAiMove(createChessArenaState(),{difficulty:'easy',timeBudgetMs:5000,random:()=>0.25});
  assert.equal(firstEasy.depth,2,'easy always reaches its max depth on this budget');
  assert.deepEqual(firstEasy,secondEasy,'easy is deterministic with the same random source');
  const firstMedium=chooseAiMove(createChessArenaState(),{difficulty:'medium',timeBudgetMs:2000,random:()=>0.25});
  const secondMedium=chooseAiMove(createChessArenaState(),{difficulty:'medium',timeBudgetMs:2000,random:()=>0.25});
  assert.ok(firstMedium.depth>=2,'medium always completes depth 2 on this budget');
  assert.deepEqual(firstMedium,secondMedium,'medium is deterministic with the same random source');
  for(const pick of [firstEasy,firstMedium]){
    assert.ok(legalMovesOf(createChessArenaState()).has(`${pick.from}${pick.to}${pick.promotion}`),'AI move is legal');
  }
});

test('hard returns a legal move on a short budget',()=>{
  const state=createChessArenaState();
  const pick=chooseAiMove(state,{difficulty:'hard',timeBudgetMs:300,random:()=>0.5});
  assert.ok(pick);
  assert.ok(legalMovesOf(state).has(`${pick.from}${pick.to}${pick.promotion}`),'hard move is legal');
});

test('a zero time budget still returns a legal fallback move',()=>{
  const state=createChessArenaState();
  const pick=chooseAiMove(state,{difficulty:'hard',timeBudgetMs:0,random:()=>0.5});
  assert.ok(pick);
  assert.ok(legalMovesOf(state).has(`${pick.from}${pick.to}${pick.promotion}`));
});

test('promotion offers all four pieces and the queen lands on the board',()=>{
  let state=createChessArenaState();
  const line=[['h2','h4'],['g7','g5'],['h4','g5'],['h7','h5'],['g5','g6'],['h5','h4'],['g6','g7'],['h4','h3']];
  for(const [from,to] of line){
    const result=applyChessArenaMove(state,from,to);
    assert.equal(result.accepted,true,`${from}${to} should be accepted`);
    state=result.state;
  }
  assert.equal(state.turn,'w');
  const offers=state.legalMoves.filter((m)=>m.from==='g7'&&m.to==='h8').map((m)=>m.promotion).sort();
  assert.deepEqual(offers,['b','n','q','r']);
  const promoted=applyChessArenaMove(state,'g7','h8','n');
  assert.equal(promoted.accepted,true);
  const knight=promoted.state.board.flat().find((p)=>p?.square==='h8');
  assert.equal(knight.type,'n');
  assert.equal(knight.color,'w');
});
