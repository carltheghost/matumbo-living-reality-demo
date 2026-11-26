// The export contains bounded provenance and scores, never prompts or credentials.
// SHA-256 validates captured bytes; it does not authenticate a provider signature.
const receiptKeys = ['schema','provider','sourceUrl','requestId','connectionId','requestedModel','resolvedModel','receivedAt','probability','probabilitySource','usage','stateSha256','questionSha256','requestBodySha256','responseBodySha256','worldActionExecuted'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 180 && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
const hash = async (value, cryptoApi) => Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2,'0')).join('');

const fail = () => { throw new Error('No valid downloadable Jev advice receipt was returned.'); };

// Check the envelope and receipt shape for offline import. The digest checks
// consistency of the supplied bytes, which an importer cannot authenticate.
export async function parseJevAdviceReceipt(exported, {cryptoApi=globalThis.crypto}={}) {
  if (!exactKeys(exported,['schema','receiptJson','receiptSha256']) || exported.schema!=='tumbo.jev-advice-export/1' || typeof exported.receiptJson!=='string' || exported.receiptJson.length>16_000 || !digest(exported.receiptSha256)) fail();
  if (await hash(exported.receiptJson,cryptoApi)!==exported.receiptSha256) fail();
  let receipt;try{receipt=JSON.parse(exported.receiptJson);}catch{fail();}
  if (JSON.stringify(receipt)!==exported.receiptJson) fail();
  if (!exactKeys(receipt,receiptKeys) || receipt.schema!=='tumbo.jev-advice-receipt/1' || receipt.provider!=='typesafe' || receipt.sourceUrl!=='https://api.typesafe.ai/v1/systemone' || receipt.probabilitySource!=='answers.decision.noul' || receipt.worldActionExecuted!==false) fail();
  if (!['requestId','connectionId','requestedModel','resolvedModel'].every(key=>text(receipt[key])) || !['stateSha256','questionSha256','requestBodySha256','responseBodySha256'].every(key=>digest(receipt[key]))) fail();
  if (!Number.isFinite(receipt.probability) || receipt.probability<0 || receipt.probability>1) fail();
  if (typeof receipt.receivedAt!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(receipt.receivedAt) || !Number.isFinite(Date.parse(receipt.receivedAt))) fail();
  if (receipt.usage!==null && (!exactKeys(receipt.usage,['input_tokens','output_tokens']) || !Object.values(receipt.usage).every(value=>Number.isSafeInteger(value)&&value>=0))) fail();
  return receipt;
}


// Tab-local, bounded receipt history. This is observed usage, never a billing
// ledger. Hash the request identity so stored history does not expose account IDs.
export const JEV_HISTORY_KEY = "matumbo.jev.usage-history.v1";
export const JEV_HISTORY_LIMIT = 256;
const validUsage = usage => usage === null || (exactKeys(usage, ["input_tokens", "output_tokens"]) &&
  Object.values(usage).every(value => Number.isSafeInteger(value) && value >= 0));
const validHistoryRow = row => exactKeys(row, ["identity", "receiptSha256", "model", "usage"]) &&
  digest(row.identity) && digest(row.receiptSha256) && text(row.model) && validUsage(row.usage);

export function createJevUsageJournal({ storage, cryptoApi = globalThis.crypto } = {}) {
  function load() {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      throw new Error("Tab receipt storage is unavailable.");
    }
    let raw;
    try { raw = storage.getItem(JEV_HISTORY_KEY); }
    catch { throw new Error("Tab receipt storage is unavailable."); }
    if (raw === null) return [];
    let rows;
    try {
      if (typeof raw !== "string" || raw.length > 262144) throw new Error();
      rows = JSON.parse(raw);
      if (!Array.isArray(rows) || rows.length > JEV_HISTORY_LIMIT ||
          !rows.every(validHistoryRow) || new Set(rows.map(row => row.identity)).size !== rows.length) {
        throw new Error();
      }
    } catch { throw new Error("Tab receipt history is invalid; no receipts were changed."); }
    return rows;
  }

  async function importReceipt(exported) {
    const receipt = await parseJevAdviceReceipt(exported, { cryptoApi });
    const identity = await hash(JSON.stringify([receipt.connectionId, receipt.requestId]), cryptoApi);
    // No await between read, duplicate check and write: competing imports within
    // this document cannot interleave those operations.
    const rows = load();
    const previous = rows.find(row => row.identity === identity);
    if (previous) {
      if (previous.receiptSha256 !== exported.receiptSha256) throw new Error("This request has a conflicting receipt.");
      return { status: "duplicate", row: previous };
    }
    if (rows.length >= JEV_HISTORY_LIMIT) throw new Error("Tab receipt history is full; no receipt was added.");
    const row = { identity, receiptSha256: exported.receiptSha256, model: receipt.resolvedModel, usage: receipt.usage };
    const serialized = JSON.stringify([...rows, row]);
    try {
      storage.setItem(JEV_HISTORY_KEY, serialized);
      if (storage.getItem(JEV_HISTORY_KEY) !== serialized) throw new Error();
    } catch { throw new Error("Tab receipt history could not be saved; check storage before retrying."); }
    return { status: "recorded", row };
  }

  return Object.freeze({ importReceipt, snapshot: load });
}
