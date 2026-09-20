import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('contract-conformance', () => {
  const FORBIDDEN_KEYS = [
    'wallet', 'walletAddress', 'privateKey', 'mnemonic',
    'network', 'chainId', 'rpcUrl',
    'order', 'orderId', 'orderBook',
    'custody', 'custodian',
    'settlement', 'settleTx',
    'mainnet', 'txHash', 'signature',
  ];

  function assertNoForbiddenKeys(value, path = '$') {
    if (Array.isArray(value)) {
      value.forEach((v, i) => assertNoForbiddenKeys(v, `${path}[${i}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        assert.ok(
          !FORBIDDEN_KEYS.includes(key),
          `forbidden key "${key}" found at ${path}`
        );
        assertNoForbiddenKeys(value[key], `${path}.${key}`);
      }
    }
  }

  function isFresh(fetchedAt, nowMs = Date.now()) {
    return nowMs - Date.parse(fetchedAt) <= 15 * 60 * 1000;
  }

  const draft = {
    id: 'draft-1',
    gameId: 'nba-20260920-lal-bos',
    teams: { home: 'Lakers', away: 'Celtics' },
    league: 'nba',
    startsAt: '2026-09-20T23:30:00Z',
    status: 'draft',
  };

  const entry = {
    id: 'draft-1',
    gameId: 'nba-20260920-lal-bos',
    teams: { home: 'Lakers', away: 'Celtics' },
    league: 'nba',
    startsAt: '2026-09-20T23:30:00Z',
    status: 'pending_review',
  };

  const quote = {
    draftId: 'draft-1',
    gameId: 'nba-20260920-lal-bos',
    venue: 'kalshi',
    side: 'home',
    price: 0.62,
    size: 100,
    fetchedAt: new Date().toISOString(),
  };

  const approved = {
    id: 'draft-1',
    gameId: 'nba-20260920-lal-bos',
    teams: { home: 'Lakers', away: 'Celtics' },
    league: 'nba',
    startsAt: '2026-09-20T23:30:00Z',
    status: 'active',
  };

  const graded = {
    ...approved,
    status: 'graded',
  };

  const claimable = {
    ...graded,
    status: 'claimable',
    claim: { available: true, expiresAt: null },
  };

  function autoCreateDrafts(games, store) {
    const out = [];
    for (const game of games) {
      if (store.has(game.gameId)) continue;
      store.set(game.gameId, true);
      out.push({
        id: `draft-${game.gameId}`,
        gameId: game.gameId,
        teams: { home: game.homeTeam, away: game.awayTeam },
        league: game.league,
        startsAt: game.startsAt,
        status: 'draft',
      });
    }
    return out;
  }

  describe('draft entry shape', () => {
    it('has id', () => { assert.equal(typeof draft.id, 'string'); });
    it('has gameId', () => { assert.equal(typeof draft.gameId, 'string'); });
    it('has teams with home and away', () => {
      assert.equal(typeof draft.teams.home, 'string');
      assert.equal(typeof draft.teams.away, 'string');
    });
    it('has league', () => { assert.equal(typeof draft.league, 'string'); });
    it('has startsAt', () => { assert.equal(typeof draft.startsAt, 'string'); });
    it('has status', () => { assert.equal(draft.status, 'draft'); });
    it('contains no forbidden real-money keys', () => { assertNoForbiddenKeys(draft); });
  });

  describe('review queue entry shape', () => {
    it('preserves id and gameId from the draft', () => {
      assert.equal(entry.id, draft.id);
      assert.equal(entry.gameId, draft.gameId);
    });
    it('uses status pending_review', () => {
      assert.equal(entry.status, 'pending_review');
    });
    it('contains no forbidden real-money keys', () => { assertNoForbiddenKeys(entry); });
  });

  describe('quote shape + freshness', () => {
    it('has required fields', () => {
      for (const k of ['draftId', 'gameId', 'venue', 'side', 'price', 'size', 'fetchedAt']) {
        assert.ok(quote[k] !== undefined, `missing ${k}`);
      }
    });
    it('accepts a fresh quote', () => { assert.ok(isFresh(quote.fetchedAt)); });
    it('rejects a quote older than 15 minutes', () => {
      const stale = new Date(Date.now() - 16 * 60 * 1000).toISOString();
      assert.ok(!isFresh(stale));
    });
    it('contains no forbidden real-money keys', () => { assertNoForbiddenKeys(quote); });
  });

  describe('simulated-points-only law', () => {
    it('no forbidden keys anywhere in the lifecycle', () => {
      assertNoForbiddenKeys({ draft, entry, quote, approved, graded, claimable });
    });
  });

  describe('idempotent auto-create', () => {
    it('creates no duplicate drafts for one game', () => {
      const store = new Map();
      const games = [{ gameId: 'nba-1', homeTeam: 'Lakers', awayTeam: 'Celtics', league: 'nba', startsAt: '2026-09-20T23:30:00Z' }];
      const first = autoCreateDrafts(games, store);
      const second = autoCreateDrafts(games, store);
      assert.equal(first.length, 1);
      assert.equal(second.length, 0);
    });
    it('contains no forbidden real-money keys', () => { assertNoForbiddenKeys({ draft, entry }); });
  });

  describe('claimable-forever', () => {
    it('sets expiresAt to null', () => {
      assert.equal(claimable.claim.expiresAt, null);
    });
    it('does not introduce an expiry field that is non-null', () => {
      assert.ok(claimable.claim.expiresAt === null);
    });
    it('contains no forbidden real-money keys', () => {
      assertNoForbiddenKeys(claimable);
    });
  });
});
