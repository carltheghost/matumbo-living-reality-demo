import { embed } from './phone-render.mjs';
import {
  CONVERSATION_PROVIDER_SCHEMA,
  CONVERSATION_REACTIONS,
} from '../application/conversation-transport.mjs';

/**
 * Vivo companion surface.
 *
 * This is a presentation/controller layer over the existing phone world. It
 * never allocates a second world, invents an identity, or writes outside the
 * existing PhoneEngineClient CAS + IndexedDB path. Conversation is an
 * explicit provider seam; without a configured provider the UI says so and
 * does not fabricate an assistant reply.
 */

export const COMPANION_SCHEMA = 'vivo.companion/1';
export { CONVERSATION_PROVIDER_SCHEMA };

export const COMPANION_CHARACTERS = Object.freeze([
  Object.freeze({
    id: 'relic',
    entityId: 'relic',
    name: 'Relic',
    role: 'Keeper of the field',
    shortRole: 'Keeper',
    description: 'A steady anchor for the place you already made.',
    prompt: 'Hold the thread of this world.',
    color: '#79adff',
    accent: '#b7d5ff',
    silhouette: 'sentinel',
    idlePresence: 'STILL / LISTENING',
    attentionPresence: 'EYES ON YOU',
    reactionPresence: 'FIELD ANSWERS',
  }),
  Object.freeze({
    id: 'workpiece',
    entityId: 'workpiece',
    name: 'Workpiece',
    role: 'Maker of material',
    shortRole: 'Maker',
    description: 'A responsive work-surface for shaping local matter.',
    prompt: 'Give the material a direction.',
    color: '#f3a35b',
    accent: '#ffd0a4',
    silhouette: 'maker',
    idlePresence: 'HANDS AT REST',
    attentionPresence: 'READY TO MAKE',
    reactionPresence: 'MATERIAL MOVES',
  }),
  Object.freeze({
    id: 'portal',
    entityId: 'portal',
    name: 'Inner world',
    role: 'Guide to the nested space',
    shortRole: 'Wayfinder',
    description: 'The doorway that keeps its own return path.',
    prompt: 'Leave a way back through.',
    color: '#66dfad',
    accent: '#b8f7d8',
    silhouette: 'wayfinder',
    idlePresence: 'DOOR AJAR',
    attentionPresence: 'WAY FOUND',
    reactionPresence: 'PATH OPEN',
  }),
]);

const INITIAL_WORLD_POSITIONS = Object.freeze({
  relic: Object.freeze([-1.15, -0.1, 0.25]),
  workpiece: Object.freeze([0.1, 0.72, 0.25]),
  portal: Object.freeze([1.3, -0.1, 0.25]),
});

const PLACEMENT_POSITIONS = Object.freeze({
  relic: Object.freeze([-0.66, 0.06, 0.25, 0.12]),
  workpiece: Object.freeze([0, 0.5, 0.25, 0]),
  portal: Object.freeze([0.66, 0.06, 0.25, -0.12]),
});

const clone = value => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function formatCompanionPlacementStatus(name, persistence = {}, { pending = false } = {}) {
  const characterName = String(name || 'The companion');
  const persistenceState = persistence?.state || 'ready';
  if (pending && persistenceState !== 'unsaved' && persistenceState !== 'memory-only') {
    return `${characterName} is being placed. Waiting for the local save acknowledgement…`;
  }
  if (persistenceState === 'saved') return `${characterName} is in the world. The accepted placement is saved locally.`;
  if (persistenceState === 'memory-only') return `${characterName} is in the world, but this placement is memory-only and will not survive reload. Retry remains available.`;
  if (persistenceState === 'unsaved') return `${characterName} is in the world, but the placement was not saved: ${persistence?.error || 'storage failed'}. Retry remains available.`;
  if (persistenceState === 'saving' || pending) return `${characterName} is being placed. Waiting for the local save acknowledgement…`;
  return `${characterName} is being placed. Waiting for the local persistence acknowledgement…`;
}

export function companionPersistenceTone(persistence = {}, { pending = false } = {}) {
  if (pending && persistence?.state !== 'unsaved' && persistence?.state !== 'memory-only') return 'info';
  if (persistence?.state === 'saved') return 'success';
  if (persistence?.state === 'memory-only' || persistence?.state === 'unsaved') return 'warn';
  return 'info';
}

export function getCompanion(id) {
  return COMPANION_CHARACTERS.find(character => character.id === id) || COMPANION_CHARACTERS[0];
}

export function placementTarget(characterId, dimension = 4) {
  const character = getCompanion(characterId);
  const source = PLACEMENT_POSITIONS[character.id] || PLACEMENT_POSITIONS.relic;
  const target = Array.from({ length: dimension }, (_, axis) => finite(source[axis], 0));
  if (dimension > 2) target[2] = finite(source[2], 0.25);
  return target;
}

export function isPlaced(entity, characterId) {
  if (!entity || !Array.isArray(entity.q)) return false;
  const original = INITIAL_WORLD_POSITIONS[characterId] || INITIAL_WORLD_POSITIONS.relic;
  return entity.q.some((value, axis) => Math.abs(finite(value) - finite(original[axis])) > 0.06);
}

/**
 * Build a full-dimensional local edit request. The caller still performs the
 * actual write through VivaPhoneEngine.applyLocalTransform().
 */
export function buildPlacementRequest(envelope, characterId) {
  const character = getCompanion(characterId);
  const snapshot = envelope?.snapshot || envelope;
  const eye = envelope?.eyes?.[envelope?.currentEyeId];
  const spaceId = eye?.spaceId || snapshot?.rootSpaceId;
  const space = snapshot?.spaces?.[spaceId];
  if (!snapshot?.worldId || !eye || !space) return { ok: false, code: 'COMPANION_WORLD_UNAVAILABLE' };
  if (spaceId !== snapshot.rootSpaceId) {
    return { ok: false, code: 'COMPANION_ROOT_EYE_REQUIRED', message: 'Return to the root Eye to place this companion.' };
  }
  const entity = space.entities?.[character.entityId];
  if (!entity || !Array.isArray(entity.q) || entity.q.length !== space.dimension) {
    return { ok: false, code: 'COMPANION_ENTITY_UNAVAILABLE', message: `${character.name} is not present in this world.` };
  }
  const target = placementTarget(character.id, space.dimension);
  const delta = target.map((value, axis) => value - finite(entity.q[axis]));
  return {
    ok: true,
    schema: COMPANION_SCHEMA,
    characterId: character.id,
    entityId: entity.id,
    worldId: snapshot.worldId,
    branchId: envelope?.branchId || null,
    eyeId: envelope.currentEyeId,
    spaceId,
    dimension: space.dimension,
    target,
    delta,
    geometry: clone(entity.geometry || { scale: 1, rotation: 0, axes: [0, 1] }),
    expected: {
      worldId: snapshot.worldId,
      branchId: envelope?.branchId || null,
      eyeId: envelope.currentEyeId,
      spaceId,
      entityId: entity.id,
      baseRevision: Number(entity.revision) || 0,
    },
  };
}

export function readConversationProvider(scope = globalThis) {
  const provider = scope?.VivoConversationProvider;
  if (!provider || provider.schema !== CONVERSATION_PROVIDER_SCHEMA || provider.available === false || typeof provider.respond !== 'function') return null;
  return provider;
}

export function normalizeConversationResult(value) {
  const text = typeof value === 'string' ? value : value?.text;
  if (typeof text !== 'string' || !text.trim()) return null;
  const reaction = typeof value?.reaction === 'string' && CONVERSATION_REACTIONS.includes(value.reaction.trim())
    ? value.reaction.trim()
    : null;
  return { text: text.trim().slice(0, 4000), reaction };
}

function element(documentRoot, tag, className = '', text = undefined) {
  const node = documentRoot.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function avatar(documentRoot, character, large = false) {
  const shell = element(documentRoot, 'span', `companion-avatar companion-avatar--${character.id}${large ? ' companion-avatar--large' : ''}`);
  shell.setAttribute('aria-hidden', 'true');
  const halo = element(documentRoot, 'span', 'companion-avatar-halo');
  const orbit = element(documentRoot, 'span', 'companion-avatar-orbit');
  const ground = element(documentRoot, 'span', 'companion-avatar-ground');
  const anchor = element(documentRoot, 'span', 'companion-avatar-anchor');
  const ring = element(documentRoot, 'span', 'companion-avatar-ring');
  const core = element(documentRoot, 'span', 'companion-avatar-core');
  const body = element(documentRoot, 'span', 'companion-avatar-body');
  const shoulders = element(documentRoot, 'span', 'companion-avatar-shoulders');
  const crest = element(documentRoot, 'span', 'companion-avatar-crest');
  const head = element(documentRoot, 'span', 'companion-avatar-head');
  const face = element(documentRoot, 'span', 'companion-avatar-face');
  const browLeft = element(documentRoot, 'i', 'companion-avatar-brow companion-avatar-brow--left');
  const browRight = element(documentRoot, 'i', 'companion-avatar-brow companion-avatar-brow--right');
  const eyeLeft = element(documentRoot, 'i', 'companion-avatar-eye companion-avatar-eye--left');
  const eyeRight = element(documentRoot, 'i', 'companion-avatar-eye companion-avatar-eye--right');
  const mouth = element(documentRoot, 'i', 'companion-avatar-mouth');
  face.append(browLeft, browRight, eyeLeft, eyeRight, mouth);
  head.append(face);
  body.append(shoulders, crest, head);
  core.append(body);
  shell.append(halo, orbit, ground, anchor, ring, core);
  if (character.id === 'portal') shell.append(element(documentRoot, 'span', 'companion-avatar-gate'));
  return shell;
}

function safeStorage(scope) {
  try { return scope.localStorage; } catch { return null; }
}

function initialSelection(scope) {
  try {
    const value = safeStorage(scope)?.getItem('vivo.companion.selection');
    return COMPANION_CHARACTERS.some(character => character.id === value) ? value : COMPANION_CHARACTERS[0].id;
  } catch { return COMPANION_CHARACTERS[0].id; }
}

function persistSelection(scope, id) {
  try { safeStorage(scope)?.setItem('vivo.companion.selection', id); } catch { /* storage is optional */ }
}

function worldForProvider(envelope, character) {
  const snapshot = envelope?.snapshot || envelope;
  const eye = envelope?.eyes?.[envelope?.currentEyeId];
  const spaceId = eye?.spaceId || snapshot?.rootSpaceId;
  const entity = snapshot?.spaces?.[spaceId]?.entities?.[character?.entityId];
  return {
    worldId: snapshot?.worldId || null,
    branchId: envelope?.branchId || null,
    eyeId: envelope?.currentEyeId || null,
    spaceId: spaceId || null,
    dimension: snapshot?.spaces?.[spaceId]?.dimension || null,
    entity: entity ? { id: entity.id, name: entity.name, q: [...entity.q], revision: entity.revision } : null,
  };
}

export function mountVivoCompanion({ documentRoot = globalThis.document, scope = globalThis, pollMs = 700 } = {}) {
  if (!documentRoot?.getElementById) return null;
  const dock = documentRoot.getElementById('phoneFieldDock');
  if (!dock) return null;
  const existing = scope.VivoCompanion;
  if (existing?.schema === COMPANION_SCHEMA) return existing;

  const shell = element(documentRoot, 'section', 'vivo-companion');
  shell.id = 'vivoCompanion';
  shell.setAttribute('aria-labelledby', 'vivoCompanionTitle');
  shell.innerHTML = `
    <div class="companion-kicker"><span class="eyebrow">VIVO / EMBODIED COMPANION</span><span class="companion-live-state" data-companion="persistence">LOCAL · READY</span></div>
    <div class="companion-heading"><div><h2 id="vivoCompanionTitle">Choose a companion.</h2><p>Place it here. Return later to find it where you left it.</p></div><button type="button" class="companion-minimize" data-companion="focus" aria-label="Return to the world"><span data-companion="focus-label">RETURN TO WORLD</span><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 13 13 3M6 3h7v7" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6"/></svg></button></div>
    <div class="companion-flow" aria-label="Vivo companion flow"><span data-companion="flow-choose" class="is-current">01 / CHOOSE</span><i></i><span data-companion="flow-place">02 / PLACE</span><i></i><span data-companion="flow-return">03 / RETURN</span></div>
    <div class="companion-character-grid" data-companion="roster" role="listbox" aria-label="Choose an embodied world identity"></div>
    <div class="companion-presence" data-companion="presence">
      <div class="companion-avatar-stage" data-companion="avatar-stage"></div>
      <div class="companion-detail"><div class="companion-presence-meta"><span class="companion-presence-state" data-companion="presence-state"></span><span class="companion-detail-label" data-companion="role"></span></div><h3 data-companion="name"></h3><p data-companion="description"></p><div class="companion-anchor-copy" data-companion="anchor-copy"></div><div class="companion-coordinates" data-companion="coordinates"></div></div>
    </div>
    <div class="companion-actions"><button type="button" class="companion-primary" data-companion="place">Place in world</button><button type="button" data-companion="select-world">Focus in world</button></div>
    <div class="companion-reaction" data-companion="reaction" role="status" aria-live="polite"></div>
    <details class="companion-conversation" data-companion="conversation">
      <summary class="companion-conversation-summary"><span><span class="companion-detail-label">CONVERSATION</span><strong id="companionConversationTitle">Talk when connected.</strong></span><span class="companion-provider-badge" data-companion="provider-badge">BACKEND NOT CONNECTED</span></summary>
      <div class="companion-conversation-body">
        <p class="companion-chat-unavailable" data-companion="chat-unavailable">No backend connected · conversation unavailable.</p>
        <div class="companion-chat-log" data-companion="chat-log" aria-live="polite"></div>
        <form class="companion-chat-form" data-companion="chat-form"><input data-companion="chat-input" maxlength="400" autocomplete="off" placeholder="Ask about this place…" aria-label="Message the selected companion"><button type="submit" class="companion-send" data-companion="send">Send</button><button type="button" class="companion-stop" data-companion="stop" hidden>Stop</button></form>
        <p class="companion-chat-note" data-companion="chat-note"></p>
      </div>
    </details>
  `;
  dock.prepend(shell);

  const worldContext = element(documentRoot, 'details', 'vivo-companion-world-context');
  worldContext.open = false;
  const worldSummary = element(documentRoot, 'summary', '', 'Open field controls · saved state');
  worldSummary.setAttribute('aria-label', 'Open field controls and saved state');
  const worldBody = element(documentRoot, 'div', 'vivo-companion-world-body');
  for (const child of [...dock.children]) if (child !== shell) worldBody.append(child);
  worldContext.append(worldSummary, worldBody);
  dock.append(worldContext);

  const query = key => shell.querySelector(`[data-companion="${key}"]`);
  const state = {
    schema: COMPANION_SCHEMA,
    envelope: null,
    selectedId: initialSelection(scope),
    reaction: 'Select an identity to wake its presence.',
    presence: 'idle',
    presenceTimer: null,
    messages: new Map(),
    placementBusy: false,
    placementAttempt: 0,
    responseBusy: false,
    responseController: null,
    responseAttempt: 0,
    lastSyncKey: '',
    lastFrameKey: '',
    providerConnected: false,
    collapsed: false,
    inFlightSnapshot: null,
    refreshPromise: null,
    pendingEnvelope: null,
    timer: null,
  };

  function selected() { return getCompanion(state.selectedId); }
  function presenceCopy(character = selected()) {
    const key = state.presence === 'attention'
      ? 'attentionPresence'
      : state.presence === 'reacting'
        ? 'reactionPresence'
        : 'idlePresence';
    return character[key] || 'PRESENT IN THIS WORLD';
  }
  function frameSelectedCharacter(character = selected()) {
    const renderer = scope.VivaShared?.R;
    const sharedState = scope.VivaShared?.S?.state;
    const entity = currentEntity(state.envelope, character);
    const geometry = sharedState?.geometry;
    if (!renderer || !entity || !geometry) return;
    // Personal view only: this changes renderer origin/slice, never entity q,
    // revision, world identity, or accepted history.
    renderer.resize?.();
    const baseOrigin = embed(entity.q, geometry, entity.chart);
    renderer.origin = baseOrigin;
    renderer.slice = [...entity.q];
    renderer.distance = Math.min(Number(renderer.distance) || 10.5, 9.4);
    renderer.companionFocus = !state.collapsed;
    renderer.companionWorldView = state.collapsed;
    // Reframe only this personal camera. The selected resident sits in the
    // unobstructed portion of the canvas when the desktop companion panel is
    // open; canonical q/revisions and the saved world never move.
    if (renderer.companionFocus && (renderer.w || scope.innerWidth || 0) >= 760) {
      const panelLeft = dock.getBoundingClientRect?.().left;
      const width = Number(renderer.w) || Number(scope.innerWidth) || 0;
      const targetX = Number.isFinite(panelLeft) && panelLeft > 0 ? panelLeft * .5 : width * .34;
      const basePoint = renderer.project(embed(entity.q, geometry, entity.chart));
      const shift = basePoint.x - targetX;
      const scale = Math.max(.15, Number(basePoint.k) || 1);
      const right = [Math.cos(Number(renderer.yaw) || 0), 0, -Math.sin(Number(renderer.yaw) || 0)];
      const viewShift = shift / scale;
      renderer.origin = baseOrigin.map((value, axis) => value + right[axis] * viewShift);
    }
    // On a narrow viewport the expanded dock starts high enough to cover the
    // lower half of the canvas. Reframe the selected resident vertically so
    // its full silhouette and identity label remain visible above that dock.
    // This is a camera-origin shift only; canonical q values and hit testing
    // continue to use the same projected point.
    if (renderer.companionFocus && (renderer.w || scope.innerWidth || 0) < 760) {
      const height = Number(renderer.h) || Number(scope.innerHeight) || 0;
      const dockTop = Number(dock.getBoundingClientRect?.().top);
      const point = renderer.project(embed(entity.q, geometry, entity.chart));
      const targetY = Number.isFinite(dockTop) && dockTop > 0
        ? Math.max(104, Math.min(dockTop - 112, height * .38))
        : height * .3;
      const shift = targetY - point.y;
      const scale = Math.max(.15, Number(point.k) || 1);
      const yaw = Number(renderer.yaw) || 0;
      const pitch = Number(renderer.pitch) || 0;
      const up = [-Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), -Math.sin(pitch) * Math.cos(yaw)];
      renderer.origin = renderer.origin.map((value, axis) => value + up[axis] * (shift / scale));
    }
    renderer.draw?.(performance.now());
  }
  function syncRendererFocus() {
    const renderer = scope.VivaShared?.R;
    if (!renderer) return;
    const nextFocus = !state.collapsed;
    const nextWorldView = state.collapsed;
    if (renderer.companionFocus === nextFocus && renderer.companionWorldView === nextWorldView) return;
    renderer.companionFocus = nextFocus;
    renderer.companionWorldView = nextWorldView;
    if (!nextFocus) frameSelectedCharacter();
    else renderer.draw?.(performance.now());
  }
  function renderFlow(placed) {
    const choose = query('flow-choose');
    const place = query('flow-place');
    const returned = query('flow-return');
    choose.textContent = placed ? '01 / CHOSEN' : '01 / CHOOSE';
    place.textContent = placed ? '02 / PLACED' : '02 / PLACE';
    choose.classList.toggle('is-current', !placed);
    choose.classList.toggle('is-complete', placed);
    place.classList.toggle('is-current', !placed);
    place.classList.toggle('is-complete', placed);
    returned.textContent = state.collapsed ? '03 / WORLD' : '03 / RETURN';
    returned.classList.toggle('is-current', state.collapsed);
    returned.classList.toggle('is-complete', state.collapsed);
  }
  function setPresence(next, holdMs = 0) {
    const allowed = new Set(['idle', 'attention', 'reacting']);
    state.presence = allowed.has(next) ? next : 'idle';
    if (state.presenceTimer) scope.clearTimeout?.(state.presenceTimer);
    state.presenceTimer = null;
    if (holdMs > 0) {
      state.presenceTimer = scope.setTimeout?.(() => {
        state.presence = 'idle';
        state.presenceTimer = null;
        render();
      }, holdMs) || null;
    }
  }
  function selectWorldEntity(entityId) {
    if (scope.VivaPhoneEngine?.active && typeof scope.VivaPhoneEngine.select === 'function') return scope.VivaPhoneEngine.select(entityId);
    return scope.VivaShared?.select?.(entityId);
  }
  function currentEntity(envelope, character = selected()) {
    const snapshot = envelope?.snapshot || envelope;
    const eye = envelope?.eyes?.[envelope?.currentEyeId];
    const spaceId = eye?.spaceId || snapshot?.rootSpaceId;
    return snapshot?.spaces?.[spaceId]?.entities?.[character.entityId] || null;
  }
  function setReaction(text, tone = '') {
    state.reaction = String(text || '');
    const view = query('reaction');
    view.textContent = state.reaction;
    view.hidden = !state.reaction;
    view.dataset.tone = tone;
  }
  function placementReaction(character, persistence = {}, { pending = false } = {}) {
    return formatCompanionPlacementStatus(character.name, persistence, { pending });
  }
  function persistenceTone(persistence = {}, options = {}) {
    return companionPersistenceTone(persistence, options);
  }
  async function freshSnapshot() {
    const engine = scope.VivaPhoneEngine;
    if (!engine?.active || typeof engine.snapshot !== 'function') return state.envelope;
    const envelope = await engine.snapshot();
    return renderSnapshot(envelope) || envelope;
  }
  async function waitForPersistenceAcknowledgement(envelope) {
    let current = envelope || state.envelope;
    const deadline = Date.now() + 30_000;
    while (current?.persistence?.state === 'saving' && Date.now() < deadline) {
      render(current);
      await new Promise(resolve => scope.setTimeout?.(resolve, 150));
      current = await freshSnapshot();
    }
    return current;
  }
  function stopResponse(reason = 'conversation-stopped') {
    state.responseAttempt += 1;
    state.responseController?.abort(reason);
    state.responseController = null;
    if (state.responseBusy) {
      state.responseBusy = false;
      if (!['selection-changed', 'navigation-changed', 'pagehide'].includes(reason)) setReaction('Conversation stopped. The world is unchanged.', 'warn');
      render();
    }
  }
  function renderRoster() {
    const roster = query('roster');
    roster.replaceChildren();
    for (const character of COMPANION_CHARACTERS) {
      const card = element(documentRoot, 'button', `companion-character${character.id === state.selectedId ? ' is-selected' : ''}`);
      card.type = 'button'; card.dataset.characterId = character.id; card.setAttribute('role', 'option'); card.setAttribute('aria-selected', character.id === state.selectedId ? 'true' : 'false'); card.setAttribute('aria-label', `${character.name}, ${character.role}`);
      const copy = element(documentRoot, 'span', 'companion-character-copy');
      copy.append(element(documentRoot, 'span', 'companion-character-name', character.name), element(documentRoot, 'span', 'companion-character-role', character.shortRole));
      card.append(avatar(documentRoot, character), copy);
      card.addEventListener('click', () => select(character.id));
      roster.append(card);
    }
  }
  function renderChat(provider) {
    const character = selected();
    const log = query('chat-log');
    log.replaceChildren();
    const messages = state.messages.get(character.id) || [];
    if (!messages.length) {
      log.append(element(documentRoot, 'p', 'companion-chat-empty', provider ? `Ask ${character.name} something about this place.` : 'Conversation will appear here when a real provider is connected.'));
    } else {
      for (const message of messages) {
        const row = element(documentRoot, 'div', `companion-message companion-message--${message.from}`);
        row.append(element(documentRoot, 'span', 'companion-message-label', message.from === 'user' ? 'YOU' : character.name));
        row.append(element(documentRoot, 'p', '', message.text));
        log.append(row);
      }
      log.scrollTop = log.scrollHeight;
    }
    const badge = query('provider-badge');
    badge.textContent = provider ? 'LIVE PROVIDER READY' : 'BACKEND NOT CONNECTED';
    badge.dataset.connected = provider ? 'true' : 'false';
    const conversation = query('conversation');
    conversation.dataset.connected = provider ? 'true' : 'false';
    const unavailable = query('chat-unavailable');
    unavailable.hidden = Boolean(provider);
    const input = query('chat-input'), send = query('send'), stop = query('stop');
    input.placeholder = provider ? `Ask ${character.name} about this place…` : 'Conversation unavailable';
    input.disabled = !provider || state.responseBusy;
    send.disabled = !provider || state.responseBusy;
    stop.hidden = !state.responseBusy;
    log.hidden = !provider;
    query('chat-form').hidden = !provider;
    query('chat-note').hidden = !provider;
    if (provider && (state.messages.get(character.id) || []).length) conversation.open = true;
    query('chat-note').textContent = provider
      ? 'Messages use the configured provider and stay scoped to this selected world identity.'
      : 'No conversational backend is configured in this build. Nothing is being simulated as an AI reply.';
  }
  function render(envelope = state.envelope) {
    state.envelope = envelope || state.envelope;
    const character = selected();
    const entity = currentEntity(state.envelope, character);
    const activeEye = state.envelope?.eyes?.[state.envelope?.currentEyeId];
    const activeRoot = activeEye?.spaceId === state.envelope?.snapshot?.rootSpaceId;
    shell.dataset.presence = state.presence;
    shell.dataset.collapsed = state.collapsed ? 'true' : 'false';
    dock.dataset.companionCollapsed = state.collapsed ? 'true' : 'false';
    if (state.collapsed) worldContext.open = false;
    query('avatar-stage').replaceChildren(avatar(documentRoot, character, true));
    query('role').textContent = character.role.toUpperCase();
    query('name').textContent = character.name;
    query('description').textContent = character.description;
    query('presence-state').textContent = presenceCopy(character);
    query('anchor-copy').textContent = activeRoot
      ? `${activeEye?.spaceId || 'root'} EYE · ${entity?.q?.length || 0}D ANCHOR`
      : `${activeEye?.spaceId || 'unknown'} SPACE · RETURN TO ROOT`;
    query('coordinates').textContent = entity
      ? `${entity.id} · ${activeEye?.spaceId || 'unknown space'} · ${entity.q.slice(0, 4).map((value, axis) => `x${axis + 1} ${finite(value).toFixed(2)}`).join(' · ')}`
      : activeRoot ? 'Identity unavailable in this saved world.' : 'Return the Eye to root to place this identity.';
    const placed = isPlaced(entity, character.id);
    if (placed && state.reaction === 'Select an identity to wake its presence.') state.reaction = `${character.name} is in the world. Saved placement is active in this field.`;
    renderFlow(placed);
    const persistence = query('persistence');
    const persistenceState = state.envelope?.persistence?.state || 'ready';
    const persistenceLabels = {
      saved: placed ? 'PLACEMENT · SAVED LOCALLY' : 'LOCAL · SAVED',
      saving: placed ? 'PLACEMENT · SAVING…' : 'LOCAL · SAVING…',
      'memory-only': placed ? 'PLACEMENT · MEMORY ONLY' : 'LOCAL · MEMORY ONLY',
      unsaved: placed ? 'PLACEMENT · NOT SAVED' : 'LOCAL · NOT SAVED',
    };
    persistence.textContent = persistenceLabels[persistenceState] || (placed ? 'PLACEMENT · READY' : 'LOCAL · READY');
    persistence.dataset.placed = placed ? 'true' : 'false';
    persistence.dataset.state = persistenceState;
    const reaction = query('reaction');
    const reactionText = state.placementBusy
      ? placementReaction(character, state.envelope?.persistence, { pending: true })
      : state.reaction;
    reaction.textContent = reactionText;
    reaction.hidden = !reactionText;
    reaction.dataset.tone = state.placementBusy
      ? persistenceTone(state.envelope?.persistence, { pending: true })
      : (reaction.dataset.tone || '');
    const place = query('place');
    place.disabled = state.placementBusy || !entity || !activeRoot;
    place.textContent = state.placementBusy ? 'Saving placement…' : placed ? 'Re-place in world' : 'Place in world';
    query('select-world').disabled = !entity;
    renderRoster();
    const provider = readConversationProvider(scope);
    renderChat(provider);
    query('focus-label').textContent = state.collapsed ? 'OPEN COMPANION' : 'RETURN TO WORLD';
    query('focus').setAttribute('aria-label', state.collapsed ? 'Open companion chooser' : 'Return to the world');
    const frameKey = entity
      ? [state.envelope?.snapshot?.worldId, activeEye?.spaceId, character.id].join('|')
      : '';
    if (!state.collapsed && frameKey && frameKey !== state.lastFrameKey) {
      selectWorldEntity(character.entityId);
      frameSelectedCharacter(character);
      state.lastFrameKey = frameKey;
    } else {
      syncRendererFocus();
    }
    shell.dataset.state = state.placementBusy ? 'placing' : placed ? 'placed' : 'ready';
  }
  function select(id, { announce = true } = {}) {
    if (!COMPANION_CHARACTERS.some(character => character.id === id)) return false;
    if (state.selectedId !== id) stopResponse('selection-changed');
    state.selectedId = id;
    persistSelection(scope, id);
    selectWorldEntity(getCompanion(id).entityId);
    frameSelectedCharacter(getCompanion(id));
    setPresence('attention', 2600);
    if (announce) setReaction(`${getCompanion(id).name} is looking back. Place it in the world when you are ready.`);
    render();
    return true;
  }
  function renderSnapshot(envelope) {
    if (!envelope) return null;
    const snapshot = envelope?.snapshot || envelope;
    const eye = envelope?.eyes?.[envelope?.currentEyeId];
    const entity = currentEntity(envelope);
    const key = [snapshot?.worldId, envelope?.branchId, envelope?.currentEyeId, eye?.spaceId, entity?.revision, ...(entity?.q || [])].join('|');
    const providerConnected = Boolean(readConversationProvider(scope));
    if (key !== state.lastSyncKey || providerConnected !== state.providerConnected) {
      state.lastSyncKey = key;
      state.providerConnected = providerConnected;
      render(envelope);
    }
    return envelope;
  }
  function scheduleSnapshot(envelope) {
    if (!envelope) return Promise.resolve(null);
    state.pendingEnvelope = envelope;
    if (state.refreshPromise) return state.refreshPromise;
    state.refreshPromise = Promise.resolve().then(() => {
      const next = state.pendingEnvelope;
      state.pendingEnvelope = null;
      return renderSnapshot(next);
    }).finally(() => {
      const pending = state.pendingEnvelope;
      state.refreshPromise = null;
      if (pending) scheduleSnapshot(pending);
    });
    return state.refreshPromise;
  }
  async function snapshot(published = null) {
    const engine = scope.VivaPhoneEngine;
    if (!engine?.active || typeof engine.snapshot !== 'function') return null;
    // Bootstrap publishes the immutable worker envelope with each statechange.
    // Read that value instead of opening a competing worker snapshot request
    // from the companion's render loop.
    const known = published || engine.publishedSnapshot?.();
    if (known) return renderSnapshot(known);
    if (state.inFlightSnapshot) return state.inFlightSnapshot;
    state.inFlightSnapshot = Promise.resolve(engine.snapshot()).then(renderSnapshot).finally(() => { state.inFlightSnapshot = null; });
    return state.inFlightSnapshot;
  }
  async function place() {
    if (state.placementBusy) return null;
    const envelope = await snapshot();
    const request = buildPlacementRequest(envelope, state.selectedId);
    if (!request.ok) { setReaction(request.message || 'The selected identity is not available in the active Eye.', 'warn'); render(); return request; }
    const unchanged = request.delta.every(value => Math.abs(value) < 1e-9);
    const retryingPersistence = ['unsaved', 'memory-only'].includes(envelope?.persistence?.state);
    if (unchanged && !retryingPersistence) {
      setReaction(`${selected().name} is already in its saved place.`, 'success'); render(); return { ...request, unchanged: true };
    }
    state.placementBusy = true;
    const placementAttempt = ++state.placementAttempt;
    setPresence('attention');
    render();
    try {
      const engine = scope.VivaPhoneEngine;
      const operationId = `companion-place:${request.worldId}:${request.branchId || 'local'}:${request.characterId}:r${request.expected.baseRevision}:a${placementAttempt}`;
      // A failed placement leaves the entity at its target with an unsaved
      // envelope. Keep the zero-delta operation explicit on retry so the
      // engine records a fresh persistence fence instead of treating the
      // retry as a UI-only no-op.
      const result = await engine.applyLocalTransform(request.entityId, request.delta, request.geometry, { ...request.expected, operationId });
      const next = await waitForPersistenceAcknowledgement(await freshSnapshot());
      frameSelectedCharacter();
      setPresence('reacting', 3600);
      setReaction(placementReaction(selected(), next?.persistence), persistenceTone(next?.persistence));
      shell.classList.remove('has-reaction'); void shell.offsetWidth; shell.classList.add('has-reaction');
      render(next);
      return { request, result, envelope: next, retried: unchanged && retryingPersistence };
    } catch (error) {
      let current = state.envelope;
      try { current = await freshSnapshot(); } catch { /* keep the last honest state */ }
      const persistence = current?.persistence;
      setReaction(
        persistence?.state === 'unsaved' || persistence?.state === 'memory-only'
          ? placementReaction(selected(), persistence)
          : `Placement did not save: ${error?.message || String(error)}`,
        persistenceTone(persistence),
      );
      render(current);
      return { request, error };
    } finally { state.placementBusy = false; render(); }
  }
  async function send(message = query('chat-input').value) {
    const text = String(message || '').trim();
    const provider = readConversationProvider(scope);
    if (!text) return null;
    if (!provider) { setReaction('Conversation is unavailable until a real provider is connected.', 'warn'); render(); return { status: 'unavailable' }; }
    query('chat-input').value = '';
    const character = selected();
    const messages = state.messages.get(character.id) || [];
    messages.push({ from: 'user', text: text.slice(0, 400) });
    state.messages.set(character.id, messages);
    const attempt = ++state.responseAttempt;
    const controller = new AbortController();
    state.responseBusy = true;
    state.responseController = controller;
    render();
    try {
      const envelope = await snapshot();
      if (attempt !== state.responseAttempt || controller.signal.aborted) return { status: 'cancelled' };
      const response = await provider.respond({ message: text.slice(0, 400), companion: clone(character), world: worldForProvider(envelope, character), signal: controller.signal });
      if (attempt !== state.responseAttempt || controller.signal.aborted) return { status: 'cancelled' };
      const result = normalizeConversationResult(response);
      if (!result) throw new Error('Conversation provider returned no readable text.');
      messages.push({ from: 'companion', text: result.text });
      setReaction(result.reaction || `${character.name} responded in this world.`, 'success');
      return result;
    } catch (error) {
      const stale = attempt !== state.responseAttempt || controller.signal.aborted || error?.name === 'AbortError' || ['selection-changed', 'navigation-changed', 'pagehide'].includes(error?.message);
      if (!stale) {
        setReaction(`Conversation failed: ${error?.message || String(error)}`, 'error');
      }
      return { error };
    } finally {
      if (attempt === state.responseAttempt) {
        state.responseController = null;
        state.responseBusy = false;
        render();
      }
    }
  }

  query('place').addEventListener('click', () => { void place(); });
  query('select-world').addEventListener('click', () => {
    stopResponse('navigation-changed');
    selectWorldEntity(selected().entityId);
    frameSelectedCharacter();
    setPresence('attention', 2400);
    setReaction(`${selected().name} is focused in the world. Its saved coordinates remain visible above.`, 'success');
    render();
  });
  query('focus').addEventListener('click', () => {
    stopResponse('navigation-changed');
    if (state.collapsed) {
      state.collapsed = false;
      frameSelectedCharacter();
      render();
      return;
    }
    selectWorldEntity(selected().entityId);
    documentRoot.getElementById('world')?.focus?.({ preventScroll: true });
    state.collapsed = true;
    worldContext.open = false;
    frameSelectedCharacter();
    setPresence('attention', 2400);
    setReaction('World focus restored. Touch and dimensional controls remain available below.', 'success');
    render();
  });
  query('chat-form').addEventListener('submit', event => { event.preventDefault(); void send(); });
  query('stop').addEventListener('click', () => stopResponse('conversation-stopped'));

  const api = {
    schema: COMPANION_SCHEMA,
    state,
    characters: COMPANION_CHARACTERS,
    refresh: snapshot,
    select,
    place,
    send,
    stop: stopResponse,
    provider: () => readConversationProvider(scope),
    destroy() { stopResponse('pagehide'); if (state.timer) scope.clearInterval?.(state.timer); if (state.presenceTimer) scope.clearTimeout?.(state.presenceTimer); scope.removeEventListener?.('vivo:phone-local-ready', refreshOnLocalReady); scope.removeEventListener?.('vivo:phone-statechange', refreshOnLocalStateChange); scope.removeEventListener?.('resize', refreshOnResize); shell.remove(); worldContext.remove(); if (scope.VivoCompanion === api) delete scope.VivoCompanion; },
  };
  function refreshOnLocalReady(event) {
    scheduleSnapshot(event.detail?.state).catch(error => setReaction(`World read failed: ${error?.message || String(error)}`, 'error'));
  }
  function refreshOnLocalStateChange(event) {
    scheduleSnapshot(event.detail?.state).catch(error => setReaction(`World read failed: ${error?.message || String(error)}`, 'error'));
  }
  function refreshOnResize() {
    if (state.envelope) frameSelectedCharacter();
  }
  scope.VivoCompanion = api;
  render();
  scope.addEventListener?.('vivo:phone-local-ready', refreshOnLocalReady);
  scope.addEventListener?.('vivo:phone-statechange', refreshOnLocalStateChange);
  scope.addEventListener?.('resize', refreshOnResize);
  state.timer = scope.setInterval?.(() => {
    if (scope.VivaPhoneEngine?.active) snapshot(scope.VivaPhoneEngine.publishedSnapshot?.()).catch(error => setReaction(`World read failed: ${error?.message || String(error)}`, 'error'));
  }, pollMs) || null;
  scope.addEventListener?.('pagehide', () => stopResponse('pagehide'), { once: true });
  return api;
}

function autoMount(scope = globalThis) {
  if (!scope.document?.getElementById) return;
  const attempt = () => {
    if (scope.VivoCompanion?.schema === COMPANION_SCHEMA) return true;
    const mounted = mountVivoCompanion({ documentRoot: scope.document, scope });
    return Boolean(mounted);
  };
  if (attempt()) return;
  const timer = scope.setInterval(() => { if (attempt()) scope.clearInterval(timer); }, 80);
  scope.setTimeout(() => scope.clearInterval(timer), 10_000);
}

autoMount();
