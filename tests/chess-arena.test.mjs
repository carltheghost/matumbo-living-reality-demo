import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {createChessArenaState,applyChessArenaMove} from '../src/domains/chess-arena.js';
import {
  AVATAR_CHIBI_FALLBACK_URL,
  CHESS_ARENA_PIECE_TYPES,
  CHESS_BUST_CROPS,
  CHESS_PIECE_HEIGHTS,
  CHESS_PIECE_RING_RADII,
  CHESS_ROLE_GLYPHS,
  buildArenaHall,
  createPieceBuilders,
  readArenaAvatarAppearance,
  squarePosition,
} from '../src/render/chess-arena-pieces.js';

test('chess arena starts with a complete character roster',()=>{
  const state=createChessArenaState();
  assert.equal(state.board.flat().filter(Boolean).length,32);
  assert.equal(state.turn,'w');assert.equal(state.gameOver,false);
});

test('legal moves update one shared state and illegal moves do not',()=>{
  let state=createChessArenaState();const first=applyChessArenaMove(state,'e2','e4');
  assert.equal(first.accepted,true);state=first.state;assert.equal(state.turn,'b');assert.equal(state.history[0].san,'e4');
  const illegal=applyChessArenaMove(state,'e7','e9');assert.equal(illegal.accepted,false);assert.equal(illegal.state.fen,state.fen);
});

test('checkmate state remains terminal',()=>{
  let state=createChessArenaState();for(const [from,to] of [['f2','f3'],['e7','e5'],['g2','g4'],['d8','h4']])state=applyChessArenaMove(state,from,to).state;
  assert.equal(state.checkmate,true);assert.equal(state.gameOver,true);
});

const nullStorage=()=>({getItem:()=>null});
const profileStorage=(profile)=>({getItem:(key)=>key==='matumbo.person-studio.v1'?JSON.stringify(profile):null});
const part=(group,name)=>{let found=null;group.traverse((child)=>{if(!found&&child.userData.part===name)found=child;});return found;};

test('squarePosition maps board corners into arena units',()=>{
  assert.deepEqual(squarePosition('a1'),[-3.5,0.06,3.5]);
  assert.deepEqual(squarePosition('h8'),[3.5,0.06,-3.5]);
  assert.deepEqual(squarePosition('e4'),[0.5,0.06,0.5]);
});

test('avatar appearance falls back to the reference defaults without a saved profile',()=>{
  const appearance=readArenaAvatarAppearance({storage:nullStorage()});
  assert.equal(appearance.skin,'#794b36');
  assert.equal(appearance.hair,'#171311');
  assert.equal(appearance.outfitId,'obsidian');
  assert.equal(appearance.outfitColor,'#111620');
  assert.equal(appearance.outfitTrim,'#d9ae60');
  assert.equal(appearance.approved,false);
});

test('avatar appearance reads the approved outfit from the saved profile',()=>{
  const appearance=readArenaAvatarAppearance({storage:profileStorage({
    schemaVersion:1,displayName:'Tumbo',outfitId:'cobalt',roomId:'city',companion:'drone',companionId:'x',
    avatar:JSON.stringify({appearance:{outfitAssetIds:['studio-outfit:cobalt']}}),
  })});
  assert.equal(appearance.outfitId,'cobalt');
  assert.equal(appearance.outfitColor,'#153b78');
  assert.equal(appearance.outfitTrim,'#90c9fa');
  assert.equal(appearance.displayName,'Tumbo');
  assert.equal(appearance.approved,true);
});

test('avatar appearance prefers the snapshot outfit asset over a stale selection',()=>{
  const appearance=readArenaAvatarAppearance({storage:profileStorage({
    schemaVersion:1,displayName:'Tumbo',outfitId:'cobalt',roomId:'city',companion:'drone',companionId:'x',
    avatar:JSON.stringify({appearance:{outfitAssetIds:['studio-outfit:ivory']}}),
  })});
  assert.equal(appearance.outfitId,'ivory');
  assert.equal(appearance.outfitColor,'#d6cdc0');
});

test('avatar appearance tolerates corrupt or foreign profiles',()=>{
  assert.equal(readArenaAvatarAppearance({storage:{getItem:()=>'not-json'}}).approved,false);
  assert.equal(readArenaAvatarAppearance({storage:profileStorage({schemaVersion:1,outfitId:'nope'})}).outfitId,'obsidian');
  assert.equal(readArenaAvatarAppearance({storage:{getItem:()=>{throw Error('denied');}}}).outfitColor,'#111620');
});

test('piece foundry builds standard chess pieces for every type and side',()=>{
  const foundry=createPieceBuilders(THREE);
  assert.equal(AVATAR_CHIBI_FALLBACK_URL,null);
  const expectedWhite={p:'♙',n:'♘',b:'♗',r:'♖',q:'♕',k:'♔'};
  const expectedBlack={p:'♟',n:'♞',b:'♝',r:'♜',q:'♛',k:'♚'};
  for(const type of CHESS_ARENA_PIECE_TYPES){
    assert.equal(CHESS_ROLE_GLYPHS[type],expectedBlack[type]);
    assert.deepEqual(CHESS_BUST_CROPS,{});
    for(const color of ['w','b']){
      const piece=foundry.buildPiece(type,color);
      assert.equal(piece.userData.standardChessPiece,true);
      assert.equal(piece.userData.avatarPiece,false);
      assert.equal(piece.userData.pieceType,type);
      assert.equal(piece.userData.color,color);
      const glyph=part(piece,'chess-piece');
      assert.ok(glyph&&glyph.isSprite,'each piece uses a standard chess glyph');
      assert.equal(glyph.userData.chessGlyph,color==='w'?expectedWhite[type]:expectedBlack[type]);
      assert.equal(glyph.userData.isStandardChessPiece,true);
      const ring=part(piece,'ring');
      assert.equal(ring.userData.ringRadius,CHESS_PIECE_RING_RADII[type]);
    }
  }
  foundry.dispose();
});

test('standard piece identities are unique and king stands tallest',()=>{
  const foundry=createPieceBuilders(THREE);
  const glyphs=new Set();
  for(const type of CHESS_ARENA_PIECE_TYPES){
    glyphs.add(part(foundry.buildPiece(type,'w'),'chess-piece').userData.chessGlyph);
  }
  assert.equal(glyphs.size,CHESS_ARENA_PIECE_TYPES.length);
  const height=(type)=>part(foundry.buildPiece(type,'w'),'chess-piece').scale.y;
  const radius=(type)=>part(foundry.buildPiece(type,'w'),'ring').userData.ringRadius;
  assert.ok(height('k')>height('q'));
  assert.ok(height('q')>height('r'));
  assert.ok(height('r')>height('p'));
  assert.ok(radius('k')>radius('q'));
  assert.ok(radius('q')>radius('p'));
  foundry.dispose();
});

test('piece foundry reuses shared ring geometry while sides keep their own material',()=>{
  const foundry=createPieceBuilders(THREE);
  const first=foundry.buildPiece('p','w'),second=foundry.buildPiece('p','w'),foe=foundry.buildPiece('p','b');
  assert.equal(part(first,'ring').geometry,part(second,'ring').geometry);
  assert.notEqual(part(first,'ring').material,part(foe,'ring').material);
  assert.notEqual(part(first,'chess-piece').material,part(foe,'chess-piece').material);
  assert.throws(()=>foundry.buildPiece('x','w'),/Unknown chess piece type/);
  assert.throws(()=>foundry.buildPiece('p','g'),/Unknown chess side/);
  foundry.dispose();
});

test('arena hall stages a glowing cinematic board',()=>{
  const hall=buildArenaHall(THREE);
  assert.equal(hall.tiles.length,64);
  const squares=new Set(hall.tiles.map((tile)=>tile.userData.square));
  assert.equal(squares.size,64);
  assert.ok(squares.has('a1')&&squares.has('h8'));
  const count=(name)=>{let n=0;hall.group.traverse((child)=>{if(child.userData.part===name)n++;});return n;};
  assert.equal(count('pillar'),8);
  assert.equal(count('frame'),4);
  assert.equal(count('halo'),2);
  hall.markers.show(['e2','e4']);
  const visible=hall.markers.list.filter((marker)=>marker.visible);
  assert.equal(visible.length,2);
  assert.deepEqual([visible[0].position.x,visible[0].position.z],[0.5,2.5]);
  hall.markers.hide();
  assert.equal(hall.markers.list.filter((marker)=>marker.visible).length,0);
  hall.dispose();
});
