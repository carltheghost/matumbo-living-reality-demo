/** World Chess domain — full chess rules + AI orchestration for the avatar
 * world chess lens (Packet 234).
 *
 * Pure logic only: no THREE, no DOM, no network, no timers. Everything a
 * renderer needs to drive a fully playable game lives here so it can be
 * unit-tested in node against the vendored chess.js engine. The renderer
 * (src/render/world-chess.js) owns all scene, animation, and HUD work.
 *
 * Product laws: simulated play only — no money, no wagering, nothing leaves
 * the machine. The AI is the local deterministic minimax in ./chess-ai.js.
 */
import {Chess} from '../vendor/chess-1.4.0/chess.js';
import {chooseAiMove, resolveAiDifficulty, CHESS_AI_DIFFICULTIES} from './chess-ai.js';

export {CHESS_AI_DIFFICULTIES, resolveAiDifficulty};

/** World-space size of one board square. */
export const WORLD_CHESS_SQUARE_SIZE = 2;
/** Full board span in world units (8 squares). */
export const WORLD_CHESS_BOARD_SPAN = 8 * WORLD_CHESS_SQUARE_SIZE;
/** Role stature for the chibi pieces: pawn smallest, king/queen tallest. */
export const WORLD_CHESS_PIECE_HEIGHTS = Object.freeze({p: 1.3, n: 1.5, b: 1.55, r: 1.6, q: 1.75, k: 1.9});
/** Glow-ring radius per role, matching the arena foundry's read. */
export const WORLD_CHESS_RING_RADII = Object.freeze({p: 0.30, n: 0.33, b: 0.34, r: 0.35, q: 0.38, k: 0.42});
/** Role glyphs carried on each piece's badge. */
export const WORLD_CHESS_ROLE_GLYPHS = Object.freeze({p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚'});
/** Promotion choices offered to a human player. */
export const WORLD_CHESS_PROMOTION_CHOICES = Object.freeze(['q', 'r', 'b', 'n']);
/** Play modes: local human-vs-human, or human vs AI playing either side. */
export const WORLD_CHESS_MODES = Object.freeze({
  local: Object.freeze({id: 'local', label: 'Human vs Human'}),
  aiBlack: Object.freeze({id: 'aiBlack', label: 'You (White) vs AI'}),
  aiWhite: Object.freeze({id: 'aiWhite', label: 'AI (White) vs You'}),
});

const FILES = 'abcdefgh';

function assertSquare(square) {
  if (typeof square !== 'string' || square.length !== 2 || FILES.indexOf(square[0]) < 0
    || square[1] < '1' || square[1] > '8') {
    throw Error(`world-chess: invalid square "${square}"`);
  }
}

/** Pure board geometry: square -> {x, z} in board-local world units.
 * White's back rank (rank 1) sits at +z; file a at -x. No THREE needed. */
export function worldChessSquareXZ(square, squareSize = WORLD_CHESS_SQUARE_SIZE) {
  assertSquare(square);
  if (!Number.isFinite(squareSize) || squareSize <= 0) throw Error('world-chess: invalid square size');
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return Object.freeze({x: (file - 3.5) * squareSize, z: (3.5 - rank) * squareSize});
}

/** Manhattan distance in squares between two squares — drives animation time. */
export function worldChessSquareDistance(from, to) {
  assertSquare(from); assertSquare(to);
  return Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0]))
    + Math.abs(Number(from[1]) - Number(to[1]));
}

/** Reduce a verbose chess.js move to the frozen fields the renderer needs. */
function freezeMove(move) {
  return Object.freeze({
    from: move.from,
    to: move.to,
    san: move.san,
    piece: move.piece,
    color: move.color,
    captured: move.captured ?? null,
    promotion: move.promotion ?? null,
    flags: move.flags ?? '',
  });
}

/** Human-readable status key for the current position. */
function statusKeyFor(game, resigned) {
  if (resigned) return 'resigned';
  if (game.isCheckmate()) return 'checkmate';
  if (game.isStalemate()) return 'stalemate';
  if (game.isDraw()) return 'draw';
  if (game.isInsufficientMaterial()) return 'insufficient-material';
  if (game.isThreefoldRepetition()) return 'threefold-repetition';
  if (game.inCheck()) return 'check';
  return 'playing';
}

const STATUS_LABEL = Object.freeze({
  playing: 'to move',
  check: 'in check',
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  draw: 'draw',
  'insufficient-material': 'draw — insufficient material',
  'threefold-repetition': 'draw — threefold repetition',
  resigned: 'resigned',
});

/** Create a world chess game. Owns the chess.js engine and all rule state.
 * The renderer calls legalMoves/move/aiMove/snapshot; the domain never
 * touches the scene. */
export function createWorldChessGame({mode = 'local', difficulty = 'medium', fen} = {}) {
  if (!WORLD_CHESS_MODES[mode]) throw Error(`world-chess: unknown mode "${mode}"`);
  const game = fen === undefined ? new Chess() : new Chess(fen);
  let currentMode = mode;
  let currentDifficulty = resolveAiDifficulty(difficulty).id;
  let resigned = null; // 'w' | 'b' | null

  function snapshot() {
    const statusKey = statusKeyFor(game, resigned);
    const turn = game.turn();
    let result = null;
    if (statusKey === 'checkmate') result = turn === 'w' ? '0-1' : '1-0';
    else if (['stalemate', 'draw', 'insufficient-material', 'threefold-repetition'].includes(statusKey)) result = '1/2-1/2';
    else if (statusKey === 'resigned') result = resigned === 'w' ? '0-1' : '1-0';
    const legal = game.moves({verbose: true}).map(freezeMove);
    return Object.freeze({
      fen: game.fen(),
      turn,
      turnLabel: turn === 'w' ? 'White' : 'Black',
      inCheck: game.inCheck(),
      gameOver: game.isGameOver() || resigned !== null,
      statusKey,
      statusText: `${turn === 'w' ? 'White' : 'Black'} ${STATUS_LABEL[statusKey]}`,
      result,
      history: Object.freeze(game.history()),
      legalMoves: Object.freeze(legal),
      mode: currentMode,
      difficulty: currentDifficulty,
      resigned,
    });
  }

  /** Legal moves for the piece on `square` (verbose, frozen). Empty when
   * the square is empty or holds the wrong side's piece. */
  function legalMoves(square) {
    assertSquare(square);
    if (resigned) return Object.freeze([]);
    const piece = game.get(square);
    if (!piece || piece.color !== game.turn()) return Object.freeze([]);
    return Object.freeze(game.moves({square, verbose: true}).map(freezeMove));
  }

  /** Distinct promotion options among a move list (from a pawn move), frozen.
   * Empty when the moves are not promotions. */
  function promotionOptionsFor(moves) {
    const options = [];
    for (const move of moves) {
      if (move.promotion && !options.includes(move.promotion)) options.push(move.promotion);
    }
    return Object.freeze(options);
  }

  /** Apply a human/AI move. Returns {ok:true, move} on success, or
   * {ok:false, needsPromotion:true, options} when the destination is a
   * promotion square and no promotion piece was chosen yet. Throws on an
   * illegal move. */
  function move(from, to, promotion = null) {
    assertSquare(from); assertSquare(to);
    if (resigned) return Object.freeze({ok: false, reason: 'game-over'});
    const candidates = legalMoves(from).filter((m) => m.to === to);
    if (candidates.length === 0) throw Error(`world-chess: illegal move ${from}-${to}`);
    if (candidates.some((m) => m.promotion)) {
      const wanted = promotion === null ? null : String(promotion).toLowerCase();
      const chosen = candidates.find((m) => m.promotion === wanted);
      if (!chosen) {
        return Object.freeze({ok: false, needsPromotion: true, options: promotionOptionsFor(candidates)});
      }
      const applied = game.move({from, to, promotion: chosen.promotion});
      return Object.freeze({ok: true, move: freezeMove(applied)});
    }
    const applied = game.move({from, to});
    return Object.freeze({ok: true, move: freezeMove(applied)});
  }

  /** Ask the local AI for the side to move. Returns the frozen AI move
   * record or null when no move exists. `random` is injectable for tests;
   * `timeBudgetMs` overrides the difficulty budget (tests use tiny). */
  function aiMove({random = Math.random, timeBudgetMs} = {}) {
    const snap = snapshot();
    if (snap.gameOver) return null;
    return chooseAiMove(snap, {difficulty: currentDifficulty, random, timeBudgetMs});
  }

  /** Whether the AI should move right now in the current mode/position. */
  function aiToMove() {
    const turn = game.turn();
    if (resigned || game.isGameOver()) return false;
    return (currentMode === 'aiBlack' && turn === 'b') || (currentMode === 'aiWhite' && turn === 'w');
  }

  /** The side the human plays (or 'both' in local mode). */
  function humanSide() {
    if (currentMode === 'aiBlack') return 'w';
    if (currentMode === 'aiWhite') return 'b';
    return 'both';
  }

  function newGame(fenOverride) {
    game.reset();
    if (fenOverride !== undefined) game.load(fenOverride);
    resigned = null;
  }

  function resign() {
    if (resigned || game.isGameOver()) return false;
    resigned = game.turn();
    return true;
  }

  return Object.freeze({
    snapshot,
    legalMoves,
    promotionOptionsFor,
    move,
    aiMove,
    aiToMove,
    humanSide,
    newGame,
    resign,
    setMode(next) {
      if (!WORLD_CHESS_MODES[next]) throw Error(`world-chess: unknown mode "${next}"`);
      currentMode = next;
    },
    setDifficulty(next) {
      currentDifficulty = resolveAiDifficulty(next).id;
    },
  });
}
