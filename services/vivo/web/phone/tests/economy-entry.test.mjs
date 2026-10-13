import test from 'node:test';
import assert from 'node:assert/strict';
import { decorateTokenEconomyOverview } from '../economy-entry.mjs';

test('phone overview decorates canonical data with exact issued and intended supply metadata', () => {
  const source = Object.freeze({
    format: 'tumbo-sim-token-economy-overview-v1',
    simulation: true,
    definitions: Object.freeze({ unit: 'integer fluff' }),
  });

  const decorated = decorateTokenEconomyOverview(source);

  assert.notStrictEqual(decorated, source);
  assert.equal(decorated.supplyPolicy.format, 'tumbo-supply-policy-v1');
  assert.equal(decorated.supplyPolicy.currentIssued.wholeTumbo, '10000000');
  assert.equal(decorated.supplyPolicy.currentIssued.fluff, '10000000000');
  assert.equal(decorated.supplyPolicy.intendedMaximum.wholeTumbo, '42000000000000');
  assert.equal(decorated.supplyPolicy.intendedMaximum.fluff, '42000000000000000');
  assert.match(decorated.definitions.currentIssuedSupply, /10,000,000 TUMBO-SIM/);
  assert.match(decorated.definitions.intendedMaximumSupply, /42,000,000,000,000 TUMBO/);
  assert.match(decorated.definitions.supplyUnitPolicy, /1,000 fluff/);
  assert.equal(source.supplyPolicy, undefined);
  assert.equal(Object.isFrozen(decorated), true);
  assert.equal(Object.isFrozen(decorated.definitions), true);
});

test('phone overview decorator rejects non-canonical or non-simulated input', () => {
  assert.throws(
    () => decorateTokenEconomyOverview({ format: 'other', simulation: true, definitions: {} }),
    /canonical overview projection/,
  );
  assert.throws(
    () => decorateTokenEconomyOverview({ format: 'tumbo-sim-token-economy-overview-v1', simulation: false, definitions: {} }),
    /canonical overview projection/,
  );
});
