import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGptConnectionStatus, NETWORK_LOCAL_PLUGINS, convertReferenceAmount } from '../src/domains/network-tools.js';

const status = () => ({ service: 'matumbo-gpt-bridge', version: 1, credentialsInBrowser: false, credentialStorage: 'windows_dpapi', storageWarning: null,
  chatgpt: { state: 'signed_out', authAvailable: true, dependencyState: 'ready', planUsage: false, activeAccountId: null, verifiedAt: null, accounts: [{ label: 'Private account', id: 'private-id' }] },
  openai: { state: 'key_needed', verifiedAt: null } });
const observation = () => ({ state: 'available', base: 'EUR', rates: { EUR: 1, USD: 1.1, GBP: .8 }, observedAt: '2026-10-05', provider: 'Frankfurter · ECB', sourceUrl: 'https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR&quotes=USD,GBP' });
const now = Date.parse('2026-10-05T12:00:00Z');
const quote = fields => convertReferenceAmount({ amount: 100, from: 'EUR', to: 'USD', observation: observation(), now, ...fields });

test('local plugin manifest comes from the two trusted shipped factories', () => {
  assert.deepEqual(NETWORK_LOCAL_PLUGINS.map(p => p.id), ['lens-guide', 'plan-helper']);
  assert.ok(NETWORK_LOCAL_PLUGINS.every(p => p.version === '1.0.0' && !('onMessage' in p)));
});
test('safe GPT status distinguishes disconnected, configured, and verified states', () => {
  const data = status(); const initial = normalizeGptConnectionStatus(data);
  assert.equal(initial.chatgpt.state, 'signed_out'); assert.equal(initial.openai.state, 'key_needed');
  data.chatgpt.state = 'signed_in'; data.chatgpt.planUsage = true; data.chatgpt.activeAccountId = 'private-id'; data.openai.state = 'configured';
  const connected = normalizeGptConnectionStatus(data); assert.equal(connected.chatgpt.ready, true); assert.equal(connected.openai.state, 'configured');
  data.chatgpt.state = data.openai.state = 'verified'; data.chatgpt.verifiedAt = data.openai.verifiedAt = '2026-10-05T12:00:00Z';
  const verified = normalizeGptConnectionStatus(data); assert.equal(verified.chatgpt.state, 'verified'); assert.equal(verified.openai.state, 'verified');
  assert.ok(!JSON.stringify(verified).includes('private')); assert.ok(!('models' in verified));
});
test('missing completion evidence or plan permission never claims a verified GPT', () => {
  const data = status(); data.chatgpt.state = data.openai.state = 'verified'; data.chatgpt.verifiedAt = data.openai.verifiedAt = 'invalid';
  assert.equal(normalizeGptConnectionStatus(data).openai.state, 'configured');
  assert.equal(normalizeGptConnectionStatus(data).chatgpt.state, 'plan_disabled');
  data.chatgpt.state = 'signed_out'; data.chatgpt.authAvailable = false; data.chatgpt.dependencyState = 'dependency_needed';
  assert.equal(normalizeGptConnectionStatus(data).chatgpt.state, 'dependency_needed');
  data.chatgpt.state = 'signed_in'; data.chatgpt.planUsage = true; data.chatgpt.activeAccountId = 'private-id';
  assert.equal(normalizeGptConnectionStatus(data).chatgpt.ready, true); // Existing authorized tokens remain usable.
});
test('actual backend storage modes and bounded provider errors remain visible', () => {
  const data = status();
  for (const mode of ['windows_dpapi', 'owner_only_file', 'session_only']) { data.credentialStorage = mode; assert.equal(normalizeGptConnectionStatus(data).credentialStorage, mode); }
  data.openai.error = { message: 'x'.repeat(1000) }; assert.equal(normalizeGptConnectionStatus(data).openai.error.length, 240); assert.equal(normalizeGptConnectionStatus(data).openai.state, 'error');
});
test('unknown or credential-bearing GPT status fails closed', () => {
  for (const data of [null, {}, { ...status(), credentialsInBrowser: true }, { ...status(), version: 2 }, { ...status(), openai: { state: 'ready' } }, { ...status(), chatgpt: { ...status().chatgpt, authAvailable: 'yes' } }]) assert.throws(() => normalizeGptConnectionStatus(data));
});
test('reference calculation supports EUR anchor and cross currency conversion without mutating observations', () => {
  assert.ok(Math.abs(quote({}).converted - 110) < 1e-9);
  assert.ok(Math.abs(quote({ from: 'USD', to: 'GBP', amount: 110 }).converted - 80) < 1e-9);
  assert.equal(quote({ amount: 0 }).converted, 0); assert.equal(quote({ from: 'GBP', to: 'GBP' }).converted, 100);
  const source = observation(); const before = JSON.stringify(source); const result = quote({ observation: source });
  assert.equal(JSON.stringify(source), before); assert.equal(result.sourceUrl, source.sourceUrl); assert.equal(result.observedAt, source.observedAt); assert.equal(result.referenceOnly, true);
});
test('reference calculation rejects missing, invalid, unsupported or unsafe amounts/rates', () => {
  for (const amount of [NaN, Infinity, -1, 1e13, '100', null]) assert.throws(() => quote({ amount }));
  assert.throws(() => quote({ from: 'BTC' }));
  for (const rates of [{}, { USD: '1.1' }, { USD: 0 }, { USD: Infinity }]) assert.throws(() => quote({ observation: { ...observation(), rates } }));
  assert.throws(() => quote({ observation: null })); assert.throws(() => quote({ observation: { ...observation(), state: 'unavailable' } }));
});
test('reference calculation rejects stale, future and mismatched provenance', () => {
  for (const observedAt of ['invalid', '2026-09-01', '2026-10-07']) assert.throws(() => quote({ observation: { ...observation(), observedAt } }));
  assert.throws(() => quote({ observation: { ...observation(), provider: 'ExchangeRate-API' } }));
  assert.throws(() => quote({ observation: { ...observation(), sourceUrl: 'https://evil.example/' } }));
  const alternate = { ...observation(), provider: 'ExchangeRate-API', sourceUrl: 'https://open.er-api.com/v6/latest/EUR' };
  assert.equal(quote({ observation: alternate }).provider, 'ExchangeRate-API');
  assert.throws(() => quote({ observation: { ...observation(), observedAt: '2026-02-31' }, now: Date.parse('2026-03-04') }));
});
