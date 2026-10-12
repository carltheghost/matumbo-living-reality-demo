/*
 * Vivo phone entry point for the local simulated economy.
 *
 * This is an integration seam only: the canonical economy and panel bytes are
 * staged under phone/vendor/economy by scripts/vivo/stage_economy_dependencies.py.
 * The selected Vivo object supplies context, but it never becomes a financial
 * account or a synchronized economic entity.
 */

import mountSimulatedEconomyPanel from './vendor/economy/src/render/simulated-economy-panel.js';
import {
  SIMULATED_ECONOMY_SOURCE,
  SIMULATED_ECONOMY_STORAGE_KEY,
  createSimulatedEconomy,
} from './vendor/economy/src/domains/simulated-economy.js';

export const VIVO_PHONE_ECONOMY_SOURCE = 'vivo-phone-economy-entry';
export const VIVO_PHONE_ECONOMY_OWNER_KEY = '__vivoPhoneSimulatedEconomyOwner';

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
      mounted = mountSimulatedEconomyPanel({
        documentRoot,
        economy: owner.model,
        trigger: null,
        autoOpen: false,
        seedLiquidity: false,
        onWorldFocus: info => onWorldFocus?.({ ...info, selected: selected ? { ...selected } : null }),
      });
      trigger.setAttribute('aria-controls', mounted.element?.id || panelHost.id);
      if (mounted.element && typeof MutationObserver === 'function') {
        panelObserver = new MutationObserver(() => {
          trigger.setAttribute('aria-expanded', String(!mounted.element.hidden));
        });
        panelObserver.observe(mounted.element, { attributes: true, attributeFilter: ['hidden'] });
      }
      ownerOff = owner.model.on(() => renderStatus());
      initError = null;
      renderStatus();
      return owner.model;
    } catch (error) {
      mounted = null;
      owner = null;
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
    destroy() {
      panelObserver?.disconnect();
      ownerOff?.();
      trigger.removeEventListener('click', open);
      retry.removeEventListener('click', onRetry);
      mounted?.destroy?.();
      mounted = null;
      owner = null;
    },
  });
}

export default mountPhoneEconomyContext;
