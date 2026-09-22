/** Local chess AI — deterministic minimax with alpha-beta pruning, quiescence
 * search, and piece-square tables.
 *
 * The search runs directly on the same vendored chess.js engine that backs
 * the Arena domain (src/domains/chess-arena.js), using move/undo traversal
 * so there is no per-node snapshot cost. The public API still speaks the
 * domain's frozen state: chooseAiMove takes a chess-arena snapshot and the
 * renderer applies the chosen move through applyChessArenaMove, so legality
 * can never diverge between the AI and the board.
 *
 * Pure functions only: no network, no keys, no storage, no timers, no
 * randomness beyond an injectable source used for difficulty jitter. It
 * suggests moves for the local simulated board; it never touches identity,
 * wallet, ledger, signing, settlement, or anything outside the board.
 * Projection only.
 */
import {Chess} from '../vendor/chess-1.4.0/chess.js?v=20260922-cache2';

export const CHESS_AI_SOURCE = 'chess-ai-local';

export const CHESS_AI_DIFFICULTIES = Object.freeze({
  easy: Object.freeze({id: 'easy', label: 'Easy', maxDepth: 2, jitter: 120, timeBudgetMs: 250}),
  medium: Object.freeze({id: 'medium', label: 'Medium', maxDepth: 3, jitter: 25, timeBudgetMs: 800}),
  hard: Object.freeze({id: 'hard', label: 'Hard', maxDepth: 6, jitter: 0, timeBudgetMs: 2500}),
});

/** Resolve a difficulty id to its frozen config; unknown ids fall back to medium. */
export function resolveAiDifficulty(id) {
  const config = CHESS_AI_DIFFICULTIES[id];
  return config ?? CHESS_AI_DIFFICULTIES.medium;
}

const PIECE_VALUES = Object.freeze({p: 100, n: 320, b: 330, r: 500, q: 900, k: 0});
const MATE_SCORE = 100000;
const MAX_QUIESCENCE_PLY = 6;
const TIME_CHECK_MASK = 63; // check the clock every 64 nodes

// Piece-square tables in centipawns, white perspective, a1-first row-major
// (rank 1 .. rank 8). Classic simplified evaluation values.
const PST = Object.freeze({
  p: Object.freeze([
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]),
  n: Object.freeze([
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ]),
  b: Object.freeze([
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ]),
  r: Object.freeze([
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ]),
  q: Object.freeze([
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ]),
  k: Object.freeze([
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ]),
});

function squareIndex(square) {
  const file = square.charCodeAt(0) - 97; // a -> 0
  const rank = square.charCodeAt(1) - 49; // 1 -> 0
  return rank * 8 + file;
}

/** Static evaluation in centipawns from White's perspective. Accepts either a
 * chess-arena frozen snapshot or a live chess.js game. */
export function evaluateCentipawns(stateOrGame) {
  const board = typeof stateOrGame.board === 'function' ? stateOrGame.board() : stateOrGame.board;
  let score = 0;
  for (const row of board) {
    for (const piece of row) {
      if (!piece) continue;
      const table = PST[piece.type];
      if (!table) continue;
      const index = squareIndex(piece.square);
      const positional = piece.color === 'w' ? table[index] : table[index ^ 56];
      const value = PIECE_VALUES[piece.type] + positional;
      score += piece.color === 'w' ? value : -value;
    }
  }
  return score;
}

function moveOrderScore(move) {
  return (move.promotion ? 1200 : 0) + (move.captured ? 800 : 0);
}

/** Legal moves ordered for search; `first` (a previous iteration's best)
 *  is tried before everything else. */
function orderedMoves(game, first = null) {
  const moves = game.moves({verbose: true});
  moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
  if (first) {
    const i = moves.findIndex((m) => m.from === first.from && m.to === first.to && (m.promotion ?? null) === (first.promotion ?? null));
    if (i > 0) { const [m] = moves.splice(i, 1); moves.unshift(m); }
  }
  return moves;
}

class SearchTimeout extends Error {}

function createSearcher(game, deadline) {
  let nodes = 0;
  function checkTime() {
    if ((++nodes & TIME_CHECK_MASK) === 0 && Date.now() > deadline) throw new SearchTimeout();
  }
  function terminalScore(ply) {
    if (!game.isGameOver()) return null;
    // Side to move is checkmated -> loss; any other game-over is neutral.
    return game.isCheckmate() ? -(MATE_SCORE - ply) : 0;
  }
  function quiescence(alpha, beta, ply) {
    checkTime();
    const terminal = terminalScore(ply);
    if (terminal !== null) return terminal;
    const perspective = game.turn() === 'w' ? 1 : -1;
    const standPat = evaluateCentipawns(game) * perspective;
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (ply >= MAX_QUIESCENCE_PLY) return alpha;
    for (const move of orderedMoves(game)) {
      if (!move.captured && !move.promotion) continue;
      game.move({from: move.from, to: move.to, promotion: move.promotion});
      const score = -quiescence(-beta, -alpha, ply + 1);
      game.undo();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }
  function negamax(depth, alpha, beta, ply) {
    checkTime();
    const terminal = terminalScore(ply);
    if (terminal !== null) return terminal;
    if (depth <= 0) return quiescence(alpha, beta, ply);
    let best = -Infinity;
    for (const move of orderedMoves(game)) {
      game.move({from: move.from, to: move.to, promotion: move.promotion});
      const score = -negamax(depth - 1, -beta, -alpha, ply + 1);
      game.undo();
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best === -Infinity ? 0 : best;
  }
  return {
    quiescence,
    negamax,
    get nodeCount() { return nodes; },
  };
}

/**
 * Choose the AI's move for the side to move in the given chess-arena
 * snapshot. Iterative deepening spends up to the difficulty's time budget,
 * so the UI always gets a legal move back quickly and stronger hardware
 * simply searches deeper. Returns a frozen
 * {from,to,promotion,san,capture,score,depth,difficulty,source} or null
 * when there is no legal move. `random` is injectable so tests can seed
 * the difficulty jitter; production passes Math.random. `timeBudgetMs`
 * overrides the difficulty default (tests use a tiny budget).
 */
export function chooseAiMove(state, {difficulty = 'medium', random = Math.random, timeBudgetMs} = {}) {
  const config = resolveAiDifficulty(difficulty);
  if (!state || state.gameOver || !Array.isArray(state.legalMoves) || state.legalMoves.length === 0) {
    return null;
  }
  const budget = Number.isFinite(timeBudgetMs) && timeBudgetMs >= 0 ? timeBudgetMs : config.timeBudgetMs;
  const deadline = Date.now() + budget;
  const game = new Chess(state.fen);
  const searcher = createSearcher(game, deadline);
  const jitterOf = () => (random() * 2 - 1) * (config.jitter || 0);
  const rootMoves = orderedMoves(game);
  // Fallback: the first ordered move is always legal, so even a zero budget
  // returns something playable.
  let best = {
    from: rootMoves[0].from,
    to: rootMoves[0].to,
    promotion: rootMoves[0].promotion ?? null,
    san: rootMoves[0].san,
    capture: Boolean(rootMoves[0].captured),
  };
  let bestScore = -Infinity;
  let completedDepth = 0;
  for (let depth = 1; depth <= config.maxDepth; depth++) {
    let candidate = null;
    let candidateScore = -Infinity;
    let alpha = -Infinity;
    try {
      for (const move of orderedMoves(game, best)) {
        const applied = game.move({from: move.from, to: move.to, promotion: move.promotion});
        // Root scores are from the mover's perspective: delivering
        // checkmate is a win (+), any other terminal position is neutral.
        let score;
        if (game.isGameOver()) {
          score = game.isCheckmate() ? (MATE_SCORE - 1) : 0;
        } else {
          score = -searcher.negamax(depth - 1, -Infinity, -alpha, 1);
        }
        game.undo();
        score += jitterOf();
        if (score > candidateScore) {
          candidateScore = score;
          candidate = {
            from: applied.from,
            to: applied.to,
            promotion: applied.promotion ?? null,
            san: applied.san,
            capture: Boolean(applied.captured),
          };
        }
        if (score > alpha) alpha = score;
      }
    } catch (error) {
      if (error instanceof SearchTimeout) break; // keep the last completed depth
      throw error;
    }
    if (candidate) {
      best = candidate;
      bestScore = candidateScore;
      completedDepth = depth;
    }
    if (Date.now() > deadline) break;
    if (bestScore > MATE_SCORE - 1000) break; // forced mate found; stop searching
  }
  return Object.freeze({
    ...best,
    score: Math.round(bestScore),
    depth: completedDepth,
    difficulty: config.id,
    source: CHESS_AI_SOURCE,
  });
}
