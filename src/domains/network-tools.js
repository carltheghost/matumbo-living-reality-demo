/** Read-only Network adapters. Feature owners retain execution and saved state. */
import { LENS_BOT_FACTORIES } from './lens-bot-plugins.js';

const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const boundedError = value => typeof value?.message === 'string' ? value.message.slice(0, 240) : null;

export const NETWORK_LOCAL_PLUGINS = Object.freeze(Object.entries(LENS_BOT_FACTORIES).map(([id, factory]) => {
  const plugin = factory.create();
  return Object.freeze({ id, name: plugin.name, version: factory.version, description: plugin.description });
}));

/** No account names, tokens, account IDs, or model catalogs enter this snapshot. */
export function normalizeGptConnectionStatus(data) {
  if (data?.service !== 'matumbo-gpt-bridge' || data.version !== 1 || data.credentialsInBrowser !== false) {
    throw new Error('This endpoint is not a recognized My GPT bridge.');
  }
  const chat = data.chatgpt, api = data.openai;
  if (!chat || !['signed_out', 'signed_in', 'verified', 'plan_disabled', 'reauth_required'].includes(chat.state)
    || typeof chat.authAvailable !== 'boolean' || !['ready', 'dependency_needed'].includes(chat.dependencyState)
    || !api || !['key_needed', 'configured', 'verified'].includes(api.state)) {
    throw new Error('The bridge returned invalid My GPT status.');
  }
  const chatReady = ['signed_in', 'verified'].includes(chat.state) && chat.planUsage === true
    && typeof chat.activeAccountId === 'string' && Boolean(chat.activeAccountId);
  const apiReady = ['configured', 'verified'].includes(api.state);
  const chatVerifiedAt = chatReady ? timestamp(chat.verifiedAt) : null;
  const apiVerifiedAt = apiReady ? timestamp(api.verifiedAt) : null;
  const chatError = boundedError(chat.error), apiError = boundedError(api.error);
  return Object.freeze({
    chatgpt: Object.freeze({ state: chatError ? 'error' : chatReady ? chat.state === 'verified' && chatVerifiedAt ? 'verified' : 'signed_in'
      : !chat.authAvailable || chat.dependencyState !== 'ready' ? 'dependency_needed'
      : ['signed_in', 'verified'].includes(chat.state) ? 'plan_disabled' : chat.state,
      ready: chatReady, verifiedAt: chat.state === 'verified' ? chatVerifiedAt : null,
      authAvailable: chat.authAvailable, dependencyState: chat.dependencyState, error: chatError }),
    openai: Object.freeze({ state: apiError ? 'error' : !apiReady ? 'key_needed' : api.state === 'verified' && apiVerifiedAt ? 'verified' : 'configured',
      ready: apiReady, verifiedAt: api.state === 'verified' ? apiVerifiedAt : null, error: apiError }),
    credentialStorage: ['windows_dpapi', 'owner_only_file', 'session_only'].includes(data.credentialStorage) ? data.credentialStorage : 'unknown',
    storageWarning: typeof data.storageWarning === 'string' ? data.storageWarning.slice(0, 240) : null,
    credentialsInBrowser: false,
  });
}

export const REFERENCE_CURRENCIES = Object.freeze(['EUR', 'USD', 'GBP']);
export const REFERENCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Convert the exact fetched reference observation locally; never execute a trade. */
export function convertReferenceAmount({ amount, from, to, observation, now = Date.now() }) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1e12) throw new Error('Enter an amount from 0 to 1,000,000,000,000.');
  if (!REFERENCE_CURRENCIES.includes(from) || !REFERENCE_CURRENCIES.includes(to)) throw new Error('Choose EUR, USD or GBP.');
  if (observation?.state !== 'available' || observation.base !== 'EUR') throw new Error('Check exchange rates before converting.');
  const observed = Date.parse(observation.observedAt);
  const datePart = typeof observation.observedAt === 'string' ? observation.observedAt.slice(0, 10) : '';
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(datePart) && Number.isFinite(Date.parse(datePart)) && new Date(datePart).toISOString().slice(0, 10) === datePart;
  if (!validDate || !Number.isFinite(now) || !Number.isFinite(observed) || now - observed > REFERENCE_MAX_AGE_MS || observed - now > 86400000) {
    throw new Error('These reference rates are stale or have an invalid date. Check exchange rates again.');
  }
  const sources = { 'Frankfurter · ECB': 'https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR&quotes=USD,GBP', 'ExchangeRate-API': 'https://open.er-api.com/v6/latest/EUR' };
  if (!Object.hasOwn(sources, observation.provider) || sources[observation.provider] !== observation.sourceUrl) throw new Error('Reference-rate provenance is missing.');
  const rate = currency => currency === 'EUR' ? 1 : observation.rates?.[currency];
  const fromRate = rate(from), toRate = rate(to);
  if (![fromRate, toRate].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) throw new Error('The provider did not return both selected rates.');
  const converted = amount / fromRate * toRate;
  if (!Number.isFinite(converted)) throw new Error('This amount exceeds the reference calculator range.');
  return Object.freeze({ amount, from, to, converted, rate: toRate / fromRate,
    observedAt: observation.observedAt, provider: observation.provider, sourceUrl: observation.sourceUrl, referenceOnly: true });
}
