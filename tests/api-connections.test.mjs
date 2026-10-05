import test from 'node:test';
import assert from 'node:assert/strict';
import { API_CONNECTIONS_PROBES, API_CONNECTIONS_FX_FALLBACK, API_BRIDGE_DEFAULT_URL, checkApiConnection, normalizeNvidiaStatus, resolveApiBridgeUrl, mountApiConnections } from '../src/render/api-connections.js';

const bridgeStatus = (configured = true) => ({ service: 'matumbo-provider-bridge', version: 1, credentialsInBrowser: false,
  providers: [{ id: 'nvidia', state: configured ? 'configured' : 'key_needed', configured, model: 'nvidia/model', verifiedAt: null }] });
const publicData = url => url.includes('open-meteo') ? { current: { temperature_2m: 20, time: '2026-10-03T12:00' }, current_units: { temperature_2m: '°C' } }
  : url.includes('frankfurter') ? [{ date: '2026-10-02', base: 'EUR', quote: 'USD', rate: 1.1 }]
  : url.includes('usgs') ? { type: 'FeatureCollection', features: [{ id: 'observation' }] } : 1_000_000;
const response = data => ({ ok: true, status: 200, json: async () => data });
const alternateFxData = () => ({ result: 'success', provider: 'https://www.exchangerate-api.com', base_code: 'EUR',
  time_last_update_unix: 1790985752, rates: { EUR: 1, USD: 1.125175, GBP: 0.850777 } });
const gptStatus = () => ({ service: 'matumbo-gpt-bridge', version: 1, credentialsInBrowser: false, credentialStorage: 'windows_dpapi',
  chatgpt: { state: 'signed_out', authAvailable: true, dependencyState: 'ready', planUsage: false, activeAccountId: null }, openai: { state: 'key_needed' } });
const tick = () => new Promise(resolve => setImmediate(resolve));

class Node {
  constructor(tag, document) { this.tagName = tag.toUpperCase(); this.document = document; this.children = []; this.dataset = {}; this.attrs = {}; this.handlers = {}; this.hidden = false; this.value = ''; this.isConnected = true; }
  appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(name, handler) { (this.handlers[name] ??= []).push(handler); }
  focus() { this.document.activeElement = this; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.isConnected = false; }
  async click() { await Promise.all((this.handlers.click ?? []).map(handler => handler({ target: this }))); }
}
function dom() {
  const document = { activeElement: null };
  document.createElement = tag => new Node(tag, document);
  document.head = document.createElement('head'); document.body = document.createElement('body');
  document.getElementById = id => {
    const find = node => node.id === id ? node : node.children.map(find).find(Boolean);
    return find(document.body) ?? find(document.head) ?? null;
  };
  return document;
}
const find = (node, predicate) => predicate(node) ? node : node.children.map(child => find(child, predicate)).find(Boolean);

test('bridge discovery accepts same-origin loopback only', () => {
  assert.equal(resolveApiBridgeUrl({ href: 'http://127.0.0.1:8082/?feature=person' }), API_BRIDGE_DEFAULT_URL);
  assert.equal(resolveApiBridgeUrl({ href: 'http://localhost:8081/' }), 'http://localhost:8081');
  for (const href of ['https://carltheghost.github.io/matumbo-living-reality-demo/', 'http://evil.example/', 'file:///repo/index.html', 'garbage']) assert.equal(resolveApiBridgeUrl({ href }), null);
});

test('configured NVIDIA remains unverified without successful inference', () => {
  assert.equal(normalizeNvidiaStatus(bridgeStatus()).state, 'configured');
  assert.equal(normalizeNvidiaStatus(bridgeStatus(false)).state, 'key-needed');
  const verified = bridgeStatus(); verified.providers[0].state = 'verified';
  assert.equal(normalizeNvidiaStatus(verified).state, 'configured');
  verified.providers[0].verifiedAt = '2026-10-03T12:00:00Z';
  assert.equal(normalizeNvidiaStatus(verified).state, 'verified');
  verified.providers[0].state = 'error'; verified.providers[0].error = { message: 'Key rejected.' };
  assert.equal(normalizeNvidiaStatus(verified).state, 'error');
});

test('rejects unrelated status payloads and malformed models', () => {
  for (const data of [null, {}, { ...bridgeStatus(), credentialsInBrowser: true }, { ...bridgeStatus(), providers: [{ id: 'nvidia', model: 'https://evil.example' }] }]) assert.throws(() => normalizeNvidiaStatus(data));
});

test('fixed public probes parse returned observations and omit credentials', async () => {
  for (const probe of API_CONNECTIONS_PROBES) {
    const calls = [];
    const result = await checkApiConnection(probe, { fetchImpl: async (url, options) => { calls.push({ url, options }); return response(publicData(url)); } });
    assert.equal(result.state, 'available'); assert.equal(result.sourceUrl, probe.url);
    assert.equal(calls.length, 1); assert.equal(calls[0].options.credentials, 'omit');
    assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.body, undefined);
    assert.equal(new URL(probe.url).protocol, 'https:');
  }
});

test('public failures and malformed values stay unavailable without fabricated data', async () => {
  for (const probe of API_CONNECTIONS_PROBES) {
    assert.equal((await checkApiConnection(probe, { fetchImpl: async () => response({}) })).state, 'unavailable');
    const unavailable = await checkApiConnection(probe, { fetchImpl: async () => ({ ok: false, status: 429 }) });
    assert.equal(unavailable.state, 'unavailable'); assert.match(unavailable.summary, /429/);
  }
});

test('FX tries its one fixed alternate after primary failure and preserves exact provider status', async () => {
  const probe = API_CONNECTIONS_PROBES.find(item => item.id === 'fx'), calls = [];
  const result = await checkApiConnection(probe, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return url === probe.url ? { ok: false, status: 403 } : response(alternateFxData());
  } });
  assert.equal(calls.length, 2); assert.equal(calls[1].url, API_CONNECTIONS_FX_FALLBACK.url);
  assert.ok(calls.every(call => call.options.method === 'GET' && call.options.credentials === 'omit'));
  assert.equal(result.state, 'available'); assert.equal(result.provider, 'ExchangeRate-API');
  assert.equal(result.sourceUrl, API_CONNECTIONS_FX_FALLBACK.url); assert.equal(result.primarySourceUrl, probe.url);
  assert.equal(result.fallbackUsed, true); assert.equal(result.primaryState, 'unavailable');
  assert.equal(result.attempts[0].state, 'unavailable'); assert.equal(result.attempts[0].httpStatus, 403);
  assert.equal(result.attempts[1].state, 'available'); assert.equal(result.observedAt, '2026-10-03T00:02:32.000Z');
  assert.equal(result.attributionUrl, 'https://www.exchangerate-api.com'); assert.equal(result.attributionLabel, 'Rates By Exchange Rate API');
  assert.match(result.summary, /1\.125175 USD/); assert.match(result.summary, /provider update/);
});

test('successful primary FX does not request an alternate or claim its attribution', async () => {
  const probe = API_CONNECTIONS_PROBES.find(item => item.id === 'fx'), calls = [];
  const result = await checkApiConnection(probe, { fetchImpl: async url => { calls.push(url); return response(publicData(url)); } });
  assert.deepEqual(calls, [probe.url]); assert.equal(result.provider, 'Frankfurter · ECB');
  assert.equal(result.fallbackUsed, false); assert.equal(result.attributionLabel, null); assert.equal(result.attempts.length, 1);
  assert.equal(result.observedAt, '2026-10-02');
});

test('failed or malformed alternate FX remains unavailable with both failures and no retries', async () => {
  const probe = API_CONNECTIONS_PROBES.find(item => item.id === 'fx');
  for (const alternate of [null, {}, { ...alternateFxData(), result: 'error' }, { ...alternateFxData(), base_code: 'USD' },
    { ...alternateFxData(), provider: 'https://evil.example' }, { ...alternateFxData(), time_last_update_unix: null },
    { ...alternateFxData(), rates: { USD: '1.1', GBP: 0.8 } }]) {
    const calls = [];
    const result = await checkApiConnection(probe, { fetchImpl: async url => { calls.push(url); return url === probe.url ? { ok: false, status: 403 } : response(alternate); } });
    assert.equal(calls.length, 2); assert.equal(result.state, 'unavailable'); assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0].httpStatus, 403); assert.equal(result.attempts[1].state, 'unavailable');
    assert.equal(result.observedAt, null); assert.equal(result.attributionUrl, null);
  }
  const calls = [];
  const limited = await checkApiConnection(probe, { fetchImpl: async url => { calls.push(url); return { ok: false, status: url === probe.url ? 403 : 429 }; } });
  assert.equal(calls.length, 2); assert.equal(limited.state, 'unavailable'); assert.match(limited.summary, /403/); assert.match(limited.summary, /429/);
});

test('cancelled primary check never starts the FX alternate', async () => {
  const probe = API_CONNECTIONS_PROBES.find(item => item.id === 'fx'), calls = [], controller = new AbortController();
  const result = await checkApiConnection(probe, { signal: controller.signal, fetchImpl: async url => { calls.push(url); controller.abort(); throw new Error('cancelled'); } });
  assert.deepEqual(calls, [probe.url]); assert.equal(result.state, 'unavailable'); assert.equal(result.fallbackUsed, false);
});

test('public Pages mount sends no network request or AI inference', async () => {
  const documentRoot = dom(), calls = [];
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: 'https://carltheghost.github.io/matumbo-living-reality-demo/' } }, fetchImpl: async (...args) => { calls.push(args); return response(bridgeStatus()); } });
  await tick(); assert.equal(calls.length, 0); assert.equal(console.getSnapshot().open, false);
  console.open(); assert.equal(console.getSnapshot().open, true); assert.equal(calls.length, 0);
  assert.equal(console.getSnapshot().credentialsInBrowser, false); assert.equal(console.getSnapshot().automaticInference, false);
  console.destroy(); assert.equal(documentRoot.getElementById('api-connections-panel'), null);
});

test('loopback mount discovers status once and never sends a prompt', async () => {
  const documentRoot = dom(), calls = [];
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: 'http://127.0.0.1:8082/' } }, fetchImpl: async (url, options) => { calls.push({ url, options }); return response(bridgeStatus()); } });
  await tick();
  assert.equal(calls.length, 2); assert.equal(calls[0].url, API_BRIDGE_DEFAULT_URL + '/api/providers');
  assert.equal(calls[0].options.method, 'GET'); assert.equal(console.getSnapshot().nvidia.state, 'configured');
  assert.equal(console.getSnapshot().publicSources.length, 0); console.destroy();
});

test('failed bridge discovery exposes its diagnosis instead of hiding the failure', async () => {
  const documentRoot = dom();
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: 'http://127.0.0.1:8082/' } }, fetchImpl: async () => ({ ok: false, status: 503 }) });
  await tick();
  assert.equal(console.getSnapshot().bridgeUrl, null); assert.equal(console.getSnapshot().nvidia, null);
  assert.match(console.getSnapshot().bridgeError, /503/);
  const status = find(documentRoot.body, node => node.className === 'api-connections-nvidia-status');
  assert.match(status.textContent, /503/); console.destroy();
});

test('explicit autoCheck option checks one bounded public batch and never infers or repeats on open', async () => {
  const documentRoot = dom(), calls = [];
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: 'https://carltheghost.github.io/matumbo-living-reality-demo/' } }, autoCheck: true,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response(url.endsWith('/api/providers') ? bridgeStatus() : publicData(url)); } });
  await tick(); await tick();
  assert.equal(calls.length, 6); assert.ok(calls.every(call => call.options.method === 'GET'));
  assert.equal(console.getSnapshot().automaticCheckStarted, true);
  assert.equal(console.getSnapshot().publicSources.length, 4);
  assert.equal(console.getSnapshot().nvidia.state, 'configured');
  console.open(); console.close(); console.open(); await tick();
  assert.equal(calls.length, 6); console.destroy();
});

test('automatic batch uses at most one FX alternate and exposes alternate attribution in UI and snapshot', async () => {
  const documentRoot = dom(), calls = [];
  const fx = API_CONNECTIONS_PROBES.find(item => item.id === 'fx');
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: 'https://carltheghost.github.io/' } }, autoCheck: true,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === fx.url) return { ok: false, status: 403 };
      return response(url === API_CONNECTIONS_FX_FALLBACK.url ? alternateFxData() : url.endsWith('/api/providers') ? bridgeStatus(false) : publicData(url));
    } });
  await tick(); await tick();
  assert.equal(calls.length, 7); assert.ok(calls.every(call => call.options.method === 'GET'));
  const snapshot = console.getSnapshot();
  assert.equal(snapshot.publicSources.filter(source => source.state === 'available').length, 4);
  const result = snapshot.publicSources.find(source => source.id === 'fx');
  assert.equal(result.provider, 'ExchangeRate-API'); assert.equal(result.attempts[0].httpStatus, 403);
  const attribution = find(documentRoot.body, node => node.textContent === 'Rates By Exchange Rate API');
  assert.equal(attribution.href, 'https://www.exchangerate-api.com');
  assert.ok(find(documentRoot.body, node => node.textContent === 'Available · alternate'));
  assert.ok(find(documentRoot.body, node => typeof node.textContent === 'string' && node.textContent.includes('Frankfurter · ECB unavailable: Provider returned HTTP 403.')));
  console.open(); console.close(); console.open(); await tick(); assert.equal(calls.length, 7); console.destroy();
});

test('Check connections reads four public APIs once and discovers a bridge', async () => {
  const documentRoot = dom(), calls = [];
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: 'https://carltheghost.github.io/matumbo-living-reality-demo/' } }, fetchImpl: async (url, options) => { calls.push({ url, options }); return response(url.endsWith('/api/providers') ? bridgeStatus(false) : publicData(url)); } });
  await console.checkConnections();
  assert.equal(calls.length, 6); assert.ok(calls.every(call => call.options.method === 'GET'));
  assert.equal(console.getSnapshot().publicSources.length, 4); assert.equal(console.getSnapshot().nvidia.state, 'key-needed');
  const send = find(documentRoot.body, node => node.textContent === 'Send to NVIDIA'); assert.equal(send.disabled, true); console.destroy();
});

test('explicit Send uses local fixed route and marks only successful answer verified', async () => {
  const documentRoot = dom(), calls = [];
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: 'http://127.0.0.1:8082/' } }, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return response(url.endsWith('/api/providers') ? bridgeStatus() : { provider: 'nvidia', model: 'nvidia/model', content: '<script>untrusted plain text</script>', advisory: true, verifiedAt: '2026-10-03T12:00:00Z' });
  } });
  await tick(); console.open();
  documentRoot.getElementById('api-connections-prompt').value = 'Explain this lens.';
  const send = find(documentRoot.body, node => node.textContent === 'Send to NVIDIA'); await send.click();
  assert.equal(calls.length, 3); assert.equal(calls[2].url, API_BRIDGE_DEFAULT_URL + '/api/nvidia/chat');
  assert.deepEqual(JSON.parse(calls[2].options.body), { prompt: 'Explain this lens.' });
  assert.equal(console.getSnapshot().nvidia.state, 'verified');
  const answer = find(documentRoot.body, node => node.className === 'api-connections-answer');
  assert.equal(answer.textContent, '<script>untrusted plain text</script>'); assert.equal(answer.innerHTML, undefined);
  console.destroy();
});

test('Send error remains visible and does not claim live NVIDIA', async () => {
  const documentRoot = dom();
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: 'http://127.0.0.1:8082/' } }, fetchImpl: async url => url.endsWith('/api/providers') ? response(bridgeStatus()) : { ok: false, status: 429, json: async () => ({ error: { message: 'NVIDIA rate-limited this request.' } }) } });
  await tick(); documentRoot.getElementById('api-connections-prompt').value = 'Explain.';
  await find(documentRoot.body, node => node.textContent === 'Send to NVIDIA').click();
  assert.equal(console.getSnapshot().nvidia.state, 'error'); assert.match(console.getSnapshot().nvidia.error, /rate-limited/); assert.equal(console.getSnapshot().nvidia.verifiedAt, null);
  console.destroy();
});

test('open delegates exclusivity and feature handoff closes this panel', async () => {
  const documentRoot = dom(), events = [];
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: 'https://example.com/' } }, onOpen: () => events.push('open'), onOpenFeature: feature => events.push(feature) });
  console.open(); console.open(); assert.deepEqual(events, ['open']);
  const feature = find(documentRoot.body, node => node.className === 'api-connections-feature'); await feature.click();
  assert.equal(console.getSnapshot().open, false); assert.deepEqual(events, ['open', 'gateway']); console.destroy();
});

test('destroy aborts pending connection reads and removes its DOM and stylesheet', async () => {
  const documentRoot = dom(), signals = [];
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: 'https://carltheghost.github.io/' } }, fetchImpl: async (url, options) => {
    signals.push(options.signal);
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  const pending = console.checkConnections(); await tick();
  assert.equal(signals.length, 5); console.destroy(); await pending;
  assert.ok(signals.every(signal => signal.aborted));
  assert.equal(documentRoot.body.children.length, 0); assert.equal(documentRoot.head.children.length, 0);
});

test('assistant status and helper readiness use safe live owner state without inference', async () => {
  const documentRoot = dom(), calls = [], events = [];
  const tools = [{ id: 'lens-guide', enabled: true }, { id: 'plan-helper', enabled: false }];
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: API_BRIDGE_DEFAULT_URL } }, getLocalTools: () => tools,
    onOpenFeature: (id, options) => events.push({ id, options }), fetchImpl: async (url, options) => { calls.push({ url, options }); return response(url.endsWith('/api/gpt/status') ? gptStatus() : bridgeStatus(false)); } });
  await tick(); console.open();
  assert.equal(console.getSnapshot().gpt.chatgpt.state, 'signed_out'); assert.equal(console.getSnapshot().gpt.openai.state, 'key_needed');
  assert.deepEqual(console.getSnapshot().localTools.map(t => t.state), ['enabled', 'resting']);
  tools[1].enabled = true; console.close(); console.open(); assert.equal(console.getSnapshot().localTools[1].state, 'enabled');
  await find(documentRoot.body, n => n.textContent === 'Open API setup').click();
  assert.deepEqual(events, [{ id: 'web-ai', options: { provider: 'openai' } }]); assert.equal(console.getSnapshot().open, false);
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c.options.method === 'GET')); console.destroy();
});

test('assistant refresh does not poll public endpoints or trigger sign-in and inference', async () => {
  const documentRoot = dom(), calls = [];
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: 'https://example.com/' } }, fetchImpl: async (url, options) => { calls.push({ url, options }); return response(url.endsWith('/api/gpt/status') ? gptStatus() : bridgeStatus(false)); } });
  await find(documentRoot.body, n => n.textContent === 'Refresh assistant status').click();
  assert.deepEqual(calls.map(c => c.url), [API_BRIDGE_DEFAULT_URL + '/api/providers', API_BRIDGE_DEFAULT_URL + '/api/gpt/status']);
  assert.ok(calls.every(c => c.options.credentials === 'omit' && c.options.redirect === 'error')); assert.equal(console.getSnapshot().publicSources.length, 0); console.destroy();
});

test('a malformed GPT endpoint leaves NVIDIA usable and shows a separate status failure', async () => {
  const documentRoot = dom();
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: API_BRIDGE_DEFAULT_URL } }, fetchImpl: async url => response(url.endsWith('/api/providers') ? bridgeStatus() : {}) });
  await tick(); assert.equal(console.getSnapshot().nvidia.state, 'configured'); assert.equal(console.getSnapshot().gpt, null); assert.match(console.getSnapshot().gptError, /recognized/); console.destroy();
});

test('individual source retry and reference conversion send no amount or extra requests', async () => {
  const documentRoot = dom(), calls = [];
  const date = new Date().toISOString().slice(0, 10);
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: 'https://example.com/' } }, fetchImpl: async (url, options) => { calls.push({ url, options }); return response([{ date, base: 'EUR', quote: 'USD', rate: 1.1 }, { date, base: 'EUR', quote: 'GBP', rate: .8 }]); } });
  assert.equal(await console.checkSource('unreviewed'), null); assert.equal(calls.length, 0);
  await console.checkSource('fx'); assert.equal(calls.length, 1); assert.ok(calls[0].url.includes('frankfurter'));
  documentRoot.getElementById('network-fx-amount').value = '110'; documentRoot.getElementById('network-fx-from').value = 'USD'; documentRoot.getElementById('network-fx-to').value = 'GBP';
  assert.equal(documentRoot.getElementById('network-fx-from').attrs['aria-label'], 'From'); assert.equal(documentRoot.getElementById('network-fx-to').attrs['aria-label'], 'To');
  await find(documentRoot.body, n => n.textContent === 'Convert reference amount').click();
  assert.match(find(documentRoot.body, n => n.className === 'api-connections-conversion').textContent, /80 GBP/);
  assert.equal(calls.length, 1); assert.ok(!calls[0].options.body);
  documentRoot.getElementById('network-fx-amount').value = ''; await find(documentRoot.body, n => n.textContent === 'Convert reference amount').click();
  assert.match(find(documentRoot.body, n => n.className === 'api-connections-conversion').textContent, /Enter an amount/); console.destroy();
});

test('cancel restores controls and prior public observations even for uncooperative transport', async () => {
  const documentRoot = dom(); let stall = false; let late;
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: 'https://example.com/' } }, fetchImpl: async url => stall ? new Promise(resolve => { late = resolve; }) : response(publicData(url)) });
  await console.checkSource('weather'); const previous = console.getSnapshot().publicSources[0]; stall = true;
  const pending = console.checkSource('weather'); await tick(); console.cancel(); await pending;
  assert.equal(console.getSnapshot().checking, false); assert.deepEqual(console.getSnapshot().publicSources[0], previous);
  assert.equal(find(documentRoot.body, n => n.textContent === 'Check connections').disabled, false);
  late(response({})); await tick(); assert.deepEqual(console.getSnapshot().publicSources[0], previous); console.destroy();
});

test('public deadline includes stalled response decoding and blocks invalid calendar dates', async () => {
  const probe = API_CONNECTIONS_PROBES.find(p => p.id === 'weather');
  const stalled = await checkApiConnection(probe, { timeoutMs: 5, fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }) });
  assert.equal(stalled.state, 'unavailable'); assert.match(stalled.summary, /timed out/);
  const fx = API_CONNECTIONS_PROBES.find(p => p.id === 'fx');
  const invalid = await checkApiConnection(fx, { fetchImpl: async url => url === fx.url ? response([{ date: '2026-02-31', base: 'EUR', quote: 'USD', rate: 1.1 }]) : response({}) });
  assert.equal(invalid.state, 'unavailable'); assert.match(invalid.attempts[0].reason, /invalid/);
});

test('stopping NVIDIA waits suppresses late answers without claiming provider cancellation', async () => {
  const documentRoot = dom(); let finish;
  const console = mountApiConnections({ documentRoot, windowRoot: { location: { href: API_BRIDGE_DEFAULT_URL } }, fetchImpl: async url => url.endsWith('/api/nvidia/chat') ? new Promise(resolve => { finish = resolve; }) : response(url.endsWith('/api/gpt/status') ? gptStatus() : bridgeStatus()) });
  await tick(); documentRoot.getElementById('api-connections-prompt').value = 'Explain.';
  const pending = find(documentRoot.body, n => n.textContent === 'Send to NVIDIA').click(); await tick(); console.cancel(); await pending;
  assert.equal(console.getSnapshot().sending, false); assert.equal(console.getSnapshot().nvidia.state, 'configured');
  assert.match(find(documentRoot.body, n => n.className === 'api-connections-answer').textContent, /provider may still finish/);
  finish(response({ provider: 'nvidia', content: 'late reply', advisory: true, verifiedAt: new Date().toISOString() })); await tick();
  assert.equal(console.getSnapshot().nvidia.state, 'configured'); console.destroy();
});
