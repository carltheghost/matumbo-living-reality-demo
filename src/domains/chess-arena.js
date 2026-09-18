import { Chess } from '../vendor/chess-1.4.0/chess.js';

export const CHESS_ARENA_SOURCE = 'chess-arena';
export const CHESS_ARENA_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function snapshot(game, history = []) {
  return Object.freeze({
    fen: game.fen(), turn: game.turn(),
    board: game.board().map(row => row.map(piece => piece ? Object.freeze({type:piece.type,color:piece.color,square:piece.square}) : null)),
    legalMoves: game.moves({verbose:true}).map(move => Object.freeze({from:move.from,to:move.to,san:move.san,capture:Boolean(move.captured),promotion:move.promotion??null})),
    history: Object.freeze(history.map(move => Object.freeze({...move}))),
    check: game.isCheck(), checkmate: game.isCheckmate(), draw: game.isDraw(), gameOver: game.isGameOver(),
  });
}

export function createChessArenaState(fen = CHESS_ARENA_START_FEN) {
  const game = new Chess(fen);
  return Object.freeze({source:CHESS_ARENA_SOURCE, ...snapshot(game)});
}

export function applyChessArenaMove(state, from, to, promotion = 'q') {
  if (typeof from !== 'string' || typeof to !== 'string') return Object.freeze({accepted:false,reason:'Choose a source and destination square',state});
  const game = new Chess(state.fen);
  try {
    const move = game.move({from,to,promotion});
    const next = Object.freeze({source:CHESS_ARENA_SOURCE,...snapshot(game,[...state.history,move])});
    return Object.freeze({accepted:true, move:Object.freeze({from:move.from,to:move.to,san:move.san,capture:Boolean(move.captured)}), state:next});
  } catch (error) {
    return Object.freeze({accepted:false,reason:'Illegal chess move',detail:error.message,state});
  }
}

export function resetChessArena() { return createChessArenaState(); }
