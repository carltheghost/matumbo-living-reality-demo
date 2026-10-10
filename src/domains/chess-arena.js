import { Chess } from '../vendor/chess-1.4.0/chess.js?v=20261003-skin360';

export const CHESS_ARENA_SOURCE = 'chess-arena';
export const CHESS_ARENA_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function snapshot(game, history = []) {
  const drawReason = game.isStalemate() ? 'stalemate'
    : game.isThreefoldRepetition() ? 'threefold repetition'
      : game.isInsufficientMaterial() ? 'insufficient material'
        : game.isDrawByFiftyMoves() ? 'fifty-move rule' : null;
  return Object.freeze({
    fen: game.fen(), turn: game.turn(),
    board: Object.freeze(game.board().map(row => Object.freeze(row.map(piece => piece ? Object.freeze({type:piece.type,color:piece.color,square:piece.square}) : null)))),
    legalMoves: Object.freeze((game.isGameOver() ? [] : game.moves({verbose:true})).map(move => Object.freeze({from:move.from,to:move.to,san:move.san,capture:Boolean(move.captured),promotion:move.promotion??null}))),
    history: Object.freeze(history.map(move => Object.freeze({...move}))),
    check: game.isCheck(), checkmate: game.isCheckmate(), draw: game.isDraw(), drawReason, gameOver: game.isGameOver(),
  });
}

export function createChessArenaState(fen = CHESS_ARENA_START_FEN) {
  const game = new Chess(fen);
  return Object.freeze({source:CHESS_ARENA_SOURCE, initialFen:game.fen(), ...snapshot(game)});
}

/** FEN alone cannot preserve repetition. Rebuild the complete local line. */
export function restoreChessArenaGame(state) {
  const history = Array.isArray(state?.history) ? state.history : [];
  const initialFen = state?.initialFen ?? history[0]?.before ?? state?.fen;
  const game = new Chess(initialFen);
  for (const move of history) game.move({from:move.from,to:move.to,promotion:move.promotion});
  if (game.fen() !== state.fen) throw new RangeError('Chess history does not match its position');
  return game;
}

export function applyChessArenaMove(state, from, to, promotion = 'q') {
  if (typeof from !== 'string' || typeof to !== 'string') return Object.freeze({accepted:false,reason:'Choose a source and destination square',state});
  if (state.gameOver) return Object.freeze({accepted:false,reason:'Match is complete; start a new game or take back a move',state});
  const game = restoreChessArenaGame(state);
  try {
    const move = game.move({from,to,promotion});
    const next = Object.freeze({source:CHESS_ARENA_SOURCE,initialFen:state.initialFen ?? state.history[0]?.before ?? state.fen,...snapshot(game,[...state.history,move])});
    return Object.freeze({accepted:true, move:Object.freeze({from:move.from,to:move.to,san:move.san,capture:Boolean(move.captured)}), state:next});
  } catch (error) {
    return Object.freeze({accepted:false,reason:'Illegal chess move',detail:error.message,state});
  }
}

/** Takebacks rebuild legal history, including captures, castling and promotion. */
export function undoChessArenaMove(state, count = 1) {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('Takeback count must be a positive integer');
  const game = restoreChessArenaGame(state);
  const remaining = Math.max(0, state.history.length - count);
  while (game.history().length > remaining) game.undo();
  return Object.freeze({source:CHESS_ARENA_SOURCE,initialFen:state.initialFen ?? state.history[0]?.before ?? state.fen,...snapshot(game,state.history.slice(0,remaining))});
}

export function resetChessArena() { return createChessArenaState(); }
