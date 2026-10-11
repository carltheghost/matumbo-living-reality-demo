const INPUT_COPY = Object.freeze({
  touch: {
    label: 'TOUCH',
    status: 'TOUCH READY',
    text: 'Touch: tap an object, then drag. Pinch empty space to zoom. Touch stays available if hand tracking drops.'
  },
  mouse: {
    label: 'MOUSE',
    status: 'MOUSE / TRACKPAD READY',
    text: 'Mouse: drag empty space to orbit. Drag a selected object to move it; wheel or trackpad zooms.'
  },
  hand: {
    label: 'HAND',
    status: 'HAND INPUT · CAMERA LOCAL',
    text: 'Hand: open hand → point → pinch → move → open hand. Camera frames stay local; touch remains the fallback.'
  },
});

export function inputCopy(mode = 'touch') {
  return INPUT_COPY[mode] || INPUT_COPY.touch;
}

export function inputModeForPointer(pointerType = '') {
  return pointerType === 'mouse' || pointerType === 'pen' ? 'mouse' : 'touch';
}

export function inputModeForCameraState({cameraLive = false, state = ''} = {}) {
  const text = String(state).trim();
  if (!cameraLive) return 'touch';
  if (/video\s+(?:live|ready)|camera\s+(?:preview|only)|camera\s+(?:and|\+)\s+touch|tracking\s+is\s+off|model\s+failed|permission|blocked|denied|unavailable/i.test(text)) return 'touch';
  return /hand|pinch|open hand|show your whole hand|tracking/i.test(text) ? 'hand' : 'touch';
}

export function xrSummary({secureContext = false, api = false, ar = false, vr = false} = {}) {
  if (!secureContext) return 'XR UNAVAILABLE · secure HTTPS context required';
  if (!api) return 'XR UNAVAILABLE · this browser does not expose WebXR';
  return `XR HOST · AR ${ar ? 'READY' : 'UNAVAILABLE'} · VR ${vr ? 'READY' : 'UNAVAILABLE'}`;
}

export async function probeXrCapabilities({
  secureContext = globalThis.isSecureContext === true,
  xr = globalThis.navigator?.xr
} = {}) {
  const base = {secureContext: !!secureContext, api: !!xr?.isSessionSupported, ar: false, vr: false};
  if (!base.secureContext || !base.api) return base;
  const supports = async mode => {
    try {
      return !!(await xr.isSessionSupported(mode));
    } catch (_) {
      return false;
    }
  };
  [base.ar, base.vr] = await Promise.all([supports('immersive-ar'), supports('immersive-vr')]);
  return base;
}

function makeStageMark() {
  const mark = document.createElement('div');
  mark.className = 'vivo-stage-mark';
  mark.setAttribute('aria-label', 'maTumbo Vivo spatial surface');
  mark.innerHTML = '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 3 36 12v16L20 37 4 28V12L20 3Z" stroke="currentColor" stroke-width="1.25"/><path d="m12 16 8-4 8 4-8 5-8-5Z" stroke="currentColor" stroke-width="1.1"/><path d="M12 16v9l8 5 8-5v-9M20 21v9" stroke="currentColor" stroke-width="1.1" opacity=".76"/></svg><span>maTUMBO <small>VIVO / SPATIAL</small></span>';
  return mark;
}

function makeInputCard({rootClass = 'vivo-ui-overlay', workshop = false} = {}) {
  const root = document.createElement('section');
  root.className = workshop ? 'vivo-mode-dock' : 'vivo-input-card';
  root.setAttribute('aria-label', workshop ? 'Input guidance' : 'Studio input and XR guidance');
  root.innerHTML = `<div class="vivo-card-heading"><strong>INPUT LENS</strong><span data-vivo-input-status>TOUCH READY</span>${workshop ? '' : '<button type="button" class="vivo-card-toggle" data-vivo-toggle aria-expanded="true">Hide</button>'}</div><div class="vivo-input-body"><div class="vivo-input-tabs" role="tablist" aria-label="Choose an input guide"><button type="button" role="tab" aria-selected="true" aria-pressed="true" data-vivo-mode="touch">Touch</button><button type="button" role="tab" aria-selected="false" aria-pressed="false" data-vivo-mode="hand">Hand</button><button type="button" role="tab" aria-selected="false" aria-pressed="false" data-vivo-mode="mouse">Mouse</button></div><p data-vivo-input-copy>${inputCopy('touch').text}</p><div class="vivo-xr-actions" ${workshop ? 'hidden' : ''}><button type="button" data-vivo-xr="ar">Enter AR</button><button type="button" data-vivo-xr="vr" disabled title="VR rendering is not exposed by this Studio route">Enter VR</button></div><div class="vivo-xr-state" role="status" aria-live="polite" data-vivo-xr-state>Checking local XR capability…</div><small>Input is a local projection. Shared state remains governed by the existing route and authority.</small></div>`;
  root.dataset.vivoRootClass = rootClass;
  return root;
}

function applyInputMode(card, mode) {
  const copy = inputCopy(mode);
  card.querySelector('[data-vivo-input-status]').textContent = copy.status;
  card.querySelector('[data-vivo-input-copy]').textContent = copy.text;
  card.querySelectorAll('[data-vivo-mode]').forEach(button => {
    const selected = button.dataset.vivoMode === mode;
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-selected', String(selected));
  });
  card.dataset.inputMode = mode;
}

function bindInputCard(card, {onMode, initialMode = 'touch'} = {}) {
  let mode = initialMode;
  const setMode = next => {
    mode = INPUT_COPY[next] ? next : 'touch';
    applyInputMode(card, mode);
    onMode?.(mode);
  };
  card.querySelectorAll('[data-vivo-mode]').forEach(button => {
    button.addEventListener('click', () => setMode(button.dataset.vivoMode));
  });
  const toggle = card.querySelector('[data-vivo-toggle]');
  toggle?.addEventListener('click', () => {
    const collapsed = card.dataset.collapsed === 'true';
    card.dataset.collapsed = String(!collapsed);
    toggle.textContent = collapsed ? 'Hide' : 'Show guide';
    toggle.setAttribute('aria-expanded', String(collapsed));
  });
  applyInputMode(card, mode);
  return {setMode, getMode: () => mode};
}

function observeInputSignals(card, controller) {
  const world = document.querySelector('#world, #field');
  world?.addEventListener('pointerdown', event => {
    const mode = inputModeForPointer(event.pointerType);
    controller.setMode(mode);
  }, {passive: true, capture: true});
  const states = [...document.querySelectorAll('#cameraState, #cameraStatus, #liveCameraState')];
  let cameraSelectedHand = false;
  const syncCamera = () => {
    const cameraLive = document.body.classList.contains('camera-live');
    const state = states.map(element => element.textContent || '').join(' · ');
    const mode = inputModeForCameraState({cameraLive, state});
    if (mode === 'hand') {
      cameraSelectedHand = true;
      controller.setMode('hand');
    } else if (cameraSelectedHand) {
      cameraSelectedHand = false;
      controller.setMode('touch');
    }
  };
  const observer = new MutationObserver(syncCamera);
  observer.observe(document.body, {attributes: true, attributeFilter: ['class']});
  states.forEach(state => observer.observe(state, {childList: true, characterData: true, subtree: true}));
  syncCamera();
  return () => observer.disconnect();
}

async function setXrState(card, {studio = false} = {}) {
  const state = card.querySelector('[data-vivo-xr-state]');
  const arButton = card.querySelector('[data-vivo-xr="ar"]');
  const vrButton = card.querySelector('[data-vivo-xr="vr"]');
  const caps = await probeXrCapabilities();
  state.textContent = studio
    ? `${xrSummary(caps)} · AR placement is session-local; camera hand input pauses.`
    : xrSummary(caps);
  if (arButton) {
    arButton.disabled = !caps.ar;
    arButton.textContent = caps.ar ? 'Enter AR' : 'AR unavailable';
    arButton.title = caps.ar ? 'Start a session-local AR placement' : state.textContent;
  }
  if (vrButton) {
    const routeHasVr = !!globalThis.FieldApp?.xr?.startVr;
    vrButton.disabled = !caps.vr || !routeHasVr;
    vrButton.textContent = caps.vr && routeHasVr ? 'Enter VR' : caps.vr ? 'VR route pending' : 'VR unavailable';
    vrButton.title = caps.vr && !routeHasVr ? 'The current Studio route exposes AR placement only.' : state.textContent;
  }
  return caps;
}

export function installWorkshopOverlay() {
  if (typeof document === 'undefined' || document.getElementById('vivo-workshop-ui')) return null;
  document.body.classList.add('vivo-workshop-page');
  const root = document.createElement('div');
  root.id = 'vivo-workshop-ui';
  root.className = 'vivo-workshop-ui';
  const card = makeInputCard({workshop: true, rootClass: 'vivo-workshop-ui'});
  root.append(card);
  document.body.append(root);
  const controller = bindInputCard(card);
  observeInputSignals(card, controller);
  const syncReady = () => root.classList.toggle('vivo-ready', document.querySelector('#welcome')?.hidden === true);
  const readyObserver = new MutationObserver(syncReady);
  const welcome = document.querySelector('#welcome');
  if (welcome) readyObserver.observe(welcome, {attributes: true, attributeFilter: ['hidden', 'class']});
  const panel = document.getElementById('panel');
  document.querySelectorAll('[data-panel]').forEach(button => {
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-panel]').forEach(candidate => candidate.setAttribute('aria-pressed', String(candidate === button)));
    });
  });
  panel?.addEventListener('close', () => document.querySelectorAll('[data-panel]').forEach(button => button.setAttribute('aria-pressed', 'false')));
  panel?.addEventListener('click', event => { if (event.target === panel) panel.close(); });
  syncReady();
  setXrState(card).catch(() => { card.querySelector('[data-vivo-xr-state]').textContent = 'XR CHECK UNAVAILABLE · touch and mouse remain ready'; });
  return {root, card, setMode: controller.setMode};
}

export function installStudioOverlay() {
  if (typeof document === 'undefined' || document.getElementById('vivo-studio-ui')) return null;
  const root = document.createElement('div');
  root.id = 'vivo-studio-ui';
  root.className = 'vivo-ui-overlay';
  root.append(makeStageMark());
  const card = makeInputCard();
  root.append(card);
  document.body.append(root);
  const controller = bindInputCard(card, {initialMode: 'touch'});
  observeInputSignals(card, controller);
  if (innerWidth <= 1280) {
    card.dataset.collapsed = 'true';
    const toggle = card.querySelector('[data-vivo-toggle]');
    toggle.textContent = 'Show guide';
    toggle.setAttribute('aria-expanded', 'false');
  }
  const state = card.querySelector('[data-vivo-xr-state]');
  const arButton = card.querySelector('[data-vivo-xr="ar"]');
  const vrButton = card.querySelector('[data-vivo-xr="vr"]');
  arButton.addEventListener('click', async () => {
    state.textContent = 'AR STARTING · waiting for the browser permission prompt…';
    try {
      if (globalThis.FieldApp?.xr?.start) await globalThis.FieldApp.xr.start();
      else document.getElementById('startRoomAR')?.click();
    } catch (error) {
      state.textContent = `AR NOT STARTED · ${error?.message || 'permission or device unavailable'}`;
    }
  });
  vrButton.addEventListener('click', async () => {
    try {
      if (globalThis.FieldApp?.xr?.startVr) await globalThis.FieldApp.xr.startVr();
      else state.textContent = 'VR CAPABILITY DETECTED · this Studio route exposes AR placement only.';
    } catch (error) {
      state.textContent = `VR NOT STARTED · ${error?.message || 'route unavailable'}`;
    }
  });
  const xrStatus = document.getElementById('xrStatus');
  const syncExistingXr = () => {
    if (!xrStatus || document.body.classList.contains('xr-running')) return;
    const existing = xrStatus.textContent.trim();
    if (existing) state.textContent = `${existing} · touch placement; camera hand controls pause in AR.`;
  };
  const xrObserver = new MutationObserver(syncExistingXr);
  if (xrStatus) xrObserver.observe(xrStatus, {childList: true, characterData: true, subtree: true});
  syncExistingXr();
  setXrState(card, {studio: true}).catch(() => { state.textContent = 'XR CHECK UNAVAILABLE · touch, mouse and camera fallback remain ready'; });
  return {root, card, setMode: controller.setMode, setXrState: () => setXrState(card, {studio: true})};
}
