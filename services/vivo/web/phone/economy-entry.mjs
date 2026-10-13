/*
 * Vivo phone entry point for the local simulated economy.
 *
 * This is an integration seam only: the canonical economy and panel bytes are
 * staged under phone/vendor/economy by scripts/vivo/stage_economy_dependencies.py.
 * The selected Vivo object supplies context, but it never becomes a financial
 * account or a synchronized economic entity.
 */

import mountSimulatedEconomyPanel from './vendor/economy/src/render/simulated-economy-panel.js';
import { createTokenEconomyOverview } from './vendor/economy/src/domains/token-economy-overview.js';
import { getTumboSupplyPolicy, formatExactInteger } from './vendor/economy/src/domains/token-supply-policy.js';
import renderTokenEconomyOverview from './vendor/economy/src/render/token-economy-overview.js';
import {
  SIMULATED_ECONOMY_SOURCE,
  SIMULATED_ECONOMY_STORAGE_KEY,
  createSimulatedEconomy,
} from './vendor/economy/src/domains/simulated-economy.js';

export const VIVO_PHONE_ECONOMY_SOURCE = 'vivo-phone-economy-entry';
export const VIVO_PHONE_ECONOMY_OWNER_KEY = '__vivoPhoneSimulatedEconomyOwner';
const OVERVIEW_STYLE_ID = 'vivo-token-economy-overview-style';

function ensureOverviewStyles(documentRoot) {
  if (!documentRoot?.head || documentRoot.getElementById(OVERVIEW_STYLE_ID)) return;
  const style = documentRoot.createElement('style');
  style.id = OVERVIEW_STYLE_ID;
  style.textContent = `
.sim-economy-panel .token-economy-overview{display:grid;gap:10px;min-width:0;padding-top:2px}
.sim-economy-panel .token-economy-overview h2{margin:0;color:#e9fbff;font-size:16px;line-height:1.2}
.sim-economy-panel .token-economy-overview h3{margin:0;color:#dcf9ff;font-size:11px;letter-spacing:.07em;text-transform:uppercase}
.sim-economy-panel .token-economy-overview p{margin:0;color:#9ebbc6;font-size:10px;line-height:1.45}
.sim-economy-panel .token-economy-overview__status-list,.sim-economy-panel .token-economy-overview__metrics{display:grid;gap:5px;margin:0;padding:0;list-style:none}
.sim-economy-panel .token-economy-overview__status-list{grid-template-columns:repeat(2,minmax(0,1fr));padding:8px;border:1px solid rgba(137,222,247,.14);border-radius:10px;background:rgba(7,36,51,.42)}
.sim-economy-panel .token-economy-overview__metric{display:flex;justify-content:space-between;gap:8px;min-width:0;color:#9ebbc6;font-size:9px;line-height:1.35}
.sim-economy-panel .token-economy-overview__label{min-width:0}
.sim-economy-panel .token-economy-overview__value{color:#e9fbff;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.sim-economy-panel .token-economy-overview__assets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.sim-economy-panel .token-economy-overview__asset,.sim-economy-panel .token-economy-overview__supply-policy{display:grid;gap:7px;min-width:0;padding:9px;border:1px solid rgba(137,222,247,.14);border-radius:10px;background:rgba(7,36,51,.42)}
.sim-economy-panel .token-economy-overview__asset h3{font-size:10px}
.sim-economy-panel .token-economy-overview__supply-policy{border-color:rgba(113,228,183,.28);background:rgba(39,137,114,.09)}
.sim-economy-panel .token-economy-overview__supply-policy p{color:#b8d9d2}
.sim-economy-panel .token-economy-overview__supply-note{font-size:9px!important;color:#91b1bc!important}
.sim-economy-panel .token-economy-overview__checks{display:flex;flex-wrap:wrap;gap:6px;color:#9de6c8!important;font-size:9px!important}
.sim-economy-panel .token-economy-overview__definitions{border-top:1px solid rgba(137,222,247,.14);padding-top:7px;color:#9ebbc6;font-size:9px}
.sim-economy-panel .token-economy-overview__definitions summary{cursor:pointer;color:#83d9f0;font-weight:700}
@media(max-width:520px){.sim-economy-panel .token-economy-overview__assets{grid-template-columns:1fr}.sim-economy-panel .token-economy-overview__status-list{grid-template-columns:1fr}}
`;
  documentRoot.head.append(style);
}

/**
 * Add the exact, read-only supply-policy metadata to the canonical overview.
 * The policy is intentionally separate from the current ledger/config supply.
 */
export function decorateTokenEconomyOverview(overview) {
  if (!overview || overview.simulation !== true || overview.format !== 'tumbo-sim-token-economy-overview-v1') {
    throw new TypeError('decorateTokenEconomyOverview requires the canonical overview projection');
  }
  const policy = getTumboSupplyPolicy();
  const currentTumbo = formatExactInteger(BigInt(policy.currentIssued.wholeTumbo));
  const currentFluff = formatExactInteger(BigInt(policy.currentIssued.fluff));
  const intendedTumbo = formatExactInteger(BigInt(policy.intendedMaximum.wholeTumbo));
  const intendedFluff = formatExactInteger(BigInt(policy.intendedMaximum.fluff));
  const definitions = Object.freeze({
    ...overview.definitions,
    currentIssuedSupply: `Current issued simulation supply: ${currentTumbo} TUMBO-SIM (${currentFluff} fluff); conservation anchor only.`,
    intendedMaximumSupply: `Intended fixed maximum: ${intendedTumbo} TUMBO (${intendedFluff} fluff); policy metadata only, not issued or minted.`,
    supplyUnitPolicy: `Exact unit: 1 TUMBO-SIM = ${formatExactInteger(BigInt(policy.fluffPerTumbo))} fluff; cap values are canonical decimal strings.`,
  });
  return Object.freeze({ ...overview, supplyPolicy: policy, definitions });
}

function localStorageOrNull() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function ownerForWindow() {
  const existing = globalThis[VIVO_PHONE_ECONOMY_OWNER_KEY];
  if (existing?.model) return existing;
  const model = createSimulatedEconomy({ storage: localStorageOrNull(), seedLiquidity: true });
  const owner = Object.freeze({
    model,
    source: SIMULATED_ECONOMY_SOURCE,
    storageKey: SIMULATED_ECONOMY_STORAGE_KEY,
    simulation: true,
  });
  globalThis[VIVO_PHONE_ECONOMY_OWNER_KEY] = owner;
  return owner;
}

function textForSelection(selection) {
  const name = String(selection?.name || selection?.entityId || 'selected object');
  return name.length > 42 ? `${name.slice(0, 39)}…` : name;
}

const DURABLE_STORAGE_STATES = new Set([
  'persisted-local-snapshot',
  'restored-local-snapshot',
  'restored-canonical-snapshot',
  'restored-token-snapshot',
]);

function persistenceIsDurable(model) {
  return DURABLE_STORAGE_STATES.has(String(model?.storageStatus || 'unknown'));
}

function persistenceLabel(model) {
  const state = String(model?.storageStatus || 'unknown');
  if (persistenceIsDurable(model)) return `TUMBO-SIM · local receipt ledger · ${state}`;
  if (state === 'storage-unavailable') return 'TUMBO-SIM · local only · storage unavailable; accepted in memory only and not saved';
  if (state === 'in-memory') return 'TUMBO-SIM · local only · in-memory state is not saved';
  if (state.includes('invalid')) return `TUMBO-SIM · local only · ${state}; persistence unavailable`;
  return `TUMBO-SIM · local only · persistence status ${state}; do not assume saved state`;
}

/**
 * Mount the economy trigger into the existing selected-object context slot.
 * The context is hidden until the phone has a real selected field object.
 */
export function mountPhoneEconomyContext({
  documentRoot = globalThis.document,
  getSelection = () => null,
  onWorldFocus = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new TypeError('a Vivo phone document is required');
  const context = documentRoot.getElementById('phoneEconomyContext');
  const trigger = documentRoot.getElementById('phoneEconomyTrigger');
  const panelHost = documentRoot.getElementById('phoneEconomyPanelHost');
  if (!context || !trigger || !panelHost) throw new Error('Vivo phone economy context controls are missing');

  let status = documentRoot.getElementById('phoneEconomyStatus');
  if (!status) {
    status = documentRoot.createElement('p');
    status.id = 'phoneEconomyStatus';
    status.className = 'phone-economy-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    context.insertBefore(status, panelHost);
  }
  let retry = documentRoot.getElementById('phoneEconomyRetry');
  if (!retry) {
    retry = documentRoot.createElement('button');
    retry.id = 'phoneEconomyRetry';
    retry.type = 'button';
    retry.textContent = 'Retry local economy';
    retry.hidden = true;
    retry.className = 'phone-economy-retry';
    context.insertBefore(retry, panelHost);
  }

  let selected = null;
  let owner = null;
  let mounted = null;
  let initError = null;
  let panelObserver = null;
  let ownerOff = null;
  let overviewHost = null;
  let latestOverview = null;
  const onRetry = () => { initError = null; trigger.disabled = false; open(); };

  function renderStatus() {
    if (initError) {
      status.dataset.tone = 'error';
      status.textContent = `Local economy unavailable: ${initError.message || String(initError)}. No simulated write was attempted.`;
      retry.hidden = false;
      trigger.disabled = true;
      return;
    }
    if (!owner?.model) {
      status.dataset.tone = 'warn';
      status.textContent = 'TUMBO-SIM · local demo initializes after this object is opened.';
      retry.hidden = true;
      trigger.disabled = false;
      return;
    }
    const durable = persistenceIsDurable(owner.model);
    status.dataset.tone = durable ? 'ok' : 'warn';
    status.textContent = `${persistenceLabel(owner.model)} · simulated only${durable ? '' : ' · reload will discard unsaved state'}`;
    retry.hidden = true;
    trigger.disabled = false;
  }

  function initialize() {
    if (mounted?.element && owner?.model) return owner.model;
    try {
      owner = ownerForWindow();
      ensureOverviewStyles(documentRoot);
      mounted = mountSimulatedEconomyPanel({
        documentRoot,
        economy: owner.model,
        trigger: null,
        autoOpen: false,
        seedLiquidity: false,
        onWorldFocus: info => onWorldFocus?.({ ...info, selected: selected ? { ...selected } : null }),
      });
      overviewHost = documentRoot.createElement('div');
      overviewHost.className = 'sim-economy-form token-economy-overview-host';
      mounted.element?.append(overviewHost);
      const refreshOverview = () => {
        if (!overviewHost || !owner?.model) return null;
        const baseOverview = createTokenEconomyOverview({
          engine: owner.model.engine,
          economy: owner.model,
        });
        latestOverview = decorateTokenEconomyOverview(baseOverview);
        renderTokenEconomyOverview(overviewHost, latestOverview);
        return latestOverview;
      };
      trigger.setAttribute('aria-controls', mounted.element?.id || panelHost.id);
      if (mounted.element && typeof MutationObserver === 'function') {
        panelObserver = new MutationObserver(() => {
          trigger.setAttribute('aria-expanded', String(!mounted.element.hidden));
        });
        panelObserver.observe(mounted.element, { attributes: true, attributeFilter: ['hidden'] });
      }
      ownerOff = owner.model.on(() => {
        renderStatus();
        try { refreshOverview(); } catch (error) {
          overviewHost?.replaceChildren(documentRoot.createElement('p'));
          const message = overviewHost?.firstElementChild;
          if (message) {
            message.className = 'token-economy-overview__status';
            message.textContent = `Economy overview unavailable: ${error instanceof Error ? error.message : String(error)}.`;
          }
          latestOverview = null;
        }
      });
      initError = null;
      renderStatus();
      refreshOverview();
      return owner.model;
    } catch (error) {
      mounted = null;
      owner = null;
      overviewHost = null;
      latestOverview = null;
      initError = error instanceof Error ? error : new Error(String(error));
      renderStatus();
      return null;
    }
  }

  function open() {
    const model = initialize();
    if (!model || !mounted) return false;
    mounted.open();
    trigger.setAttribute('aria-expanded', 'true');
    return true;
  }

  function sync(nextSelection = getSelection()) {
    selected = nextSelection ? { ...nextSelection } : null;
    const active = Boolean(selected?.active && selected?.entityId);
    context.hidden = !active;
    if (!active) {
      trigger.setAttribute('aria-expanded', 'false');
      return;
    }
    trigger.textContent = `Open ${textForSelection(selected)} · local economy`;
    trigger.title = `Open simulated economy context for ${textForSelection(selected)}`;
    renderStatus();
  }

  trigger.addEventListener('click', open);
  retry.addEventListener('click', onRetry);
  trigger.setAttribute('aria-controls', panelHost.id);
  trigger.setAttribute('aria-expanded', 'false');
  sync();

  return Object.freeze({
    source: VIVO_PHONE_ECONOMY_SOURCE,
    initialize,
    open,
    sync,
    get economy() { return owner?.model || null; },
    get panel() { return mounted; },
    get overview() { return latestOverview; },
    destroy() {
      panelObserver?.disconnect();
      ownerOff?.();
      trigger.removeEventListener('click', open);
      retry.removeEventListener('click', onRetry);
      mounted?.destroy?.();
      overviewHost = null;
      latestOverview = null;
      mounted = null;
      owner = null;
    },
  });
}

export default mountPhoneEconomyContext;
