/**
 * Enterable room-space layer for the local Living Reality projection.
 *
 * This adapter reads the canonical `spatial-rooms` contribution and builds a
 * small, low-poly set of room portals beside the existing organ constellation.
 * Selection, entering, and leaving are presentation state only.  The module
 * never edits the projection and never creates a message, wallet, network, or
 * persistence path.
 */

export const ROOM_SPACES_SOURCE = "spatial-rooms";
export const ROOM_SPACES_CONSOLE_SOURCE = "room-spaces-console";
export const DEFAULT_ROOM_SPACES_BOUNDARY =
  "Rooms are local membership projections. Enter and leave are renderer-only; message content, cryptography, network, identity, and persistence are not active.";

const integerFormatter = new Intl.NumberFormat("en-US");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function freezeSnapshot(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freezeSnapshot(entry)));
  if (!isRecord(value)) return value;
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeSnapshot(entry)])),
  );
}

function findContribution(projection, source) {
  if (projection?.source === source) return projection;
  return asArray(projection?.contributions).find((contribution) => contribution?.source === source) ?? null;
}

function normalizeMembership(entity, index) {
  return {
    id: text(entity?.id, `membership-${index + 1}`),
    roomId: text(entity?.roomId, "unknown-room"),
    memberId: text(entity?.memberId, "local-participant"),
    role: text(entity?.role, "observer"),
    simulation: entity?.simulation !== false,
  };
}

function normalizeRoom(entity, index, memberships) {
  const id = text(entity?.id, `room-${index + 1}`);
  const roomMemberships = memberships.filter((membership) => membership.roomId === id);
  const role = roomMemberships[0]?.role ?? "observer";
  return {
    id,
    label: text(entity?.label, `Room ${index + 1}`),
    context: text(entity?.context, "social"),
    privacy: text(entity?.privacy, "members-only"),
    role,
    memberships: roomMemberships,
    memberCount: roomMemberships.length,
    simulation: entity?.simulation !== false,
    localOnly: true,
  };
}

function summarizeMessageMetadata(projection) {
  const contribution = findContribution(projection, "cipher-messaging");
  const entities = asArray(contribution?.entities);
  const session = entities.find((entity) => entity?.kind === "cipher-session-indicator") ?? null;
  const event = entities.find((entity) => entity?.kind === "message-event-summary") ?? null;
  const revocation = entities.find((entity) => entity?.kind === "cipher-revocation-state") ?? null;
  return {
    indicator: text(session?.indicator, "unavailable"),
    participantCount: Number.isSafeInteger(session?.participantCount) ? session.participantCount : 0,
    eventKind: text(event?.eventKind, "metadata-only"),
    revocationState: text(revocation?.state, "unknown"),
    contentRetained: false,
    cryptographyImplemented: false,
    simulation: true,
  };
}

/**
 * Read the canonical room and membership records into a deterministic
 * renderer summary.  Room geometry is intentionally derived later from this
 * summary, so no second room registry can drift from SIMFABRIC state.
 */
export function summarizeRooms(projection) {
  const contribution = findContribution(projection, ROOM_SPACES_SOURCE);
  const entities = asArray(contribution?.entities);
  const memberships = entities
    .filter((entity) => entity?.kind === "room-membership")
    .map(normalizeMembership);
  const rooms = entities
    .filter((entity) => entity?.kind === "spatial-room")
    .map((entity, index) => normalizeRoom(entity, index, memberships));
  return freezeSnapshot({
    source: contribution?.source ?? ROOM_SPACES_SOURCE,
    updatedAt: text(contribution?.updatedAt),
    rooms,
    memberships,
    roomCount: rooms.length,
    membershipCount: memberships.length,
    message: summarizeMessageMetadata(projection),
    simulation: contribution?.simulation === true,
    localOnly: true,
    boundary: DEFAULT_ROOM_SPACES_BOUNDARY,
  });
}

function formatCount(value) {
  return Number.isSafeInteger(value) ? integerFormatter.format(value) : "—";
}

function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

function roomDetail(room) {
  if (!room) return "Select a room portal to inspect its membership scope.";
  const role = room.role || "observer";
  return `${room.context} · ${room.privacy} · ${role} · ${formatCount(room.memberCount)} member${room.memberCount === 1 ? "" : "s"}`;
}

function roomById(summary, id) {
  return summary.rooms.find((room) => room.id === id) ?? null;
}

function roomActionSnapshot(summary, roomId, action, method, replayCount) {
  const room = roomById(summary, roomId);
  return freezeSnapshot({
    source: ROOM_SPACES_CONSOLE_SOURCE,
    roomId,
    room,
    action,
    method,
    replayCount,
    selected: true,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  });
}

function markRoomObject(object, roomId, raycastTargets) {
  object.userData.roomId = roomId;
  if (Array.isArray(raycastTargets) && !raycastTargets.includes(object)) raycastTargets.push(object);
  return object;
}

/** Build one deliberately small room portal. `three` is injected for testability. */
function buildRoomNode(three, room, index, isMobile, parent, raycastTargets) {
  const THREE = three;
  const group = new THREE.Group();
  group.name = `room-space:${room.id}`;
  group.userData.roomId = room.id;
  const positions = [
    new THREE.Vector3(-3.35, -0.72, -4.25),
    new THREE.Vector3(3.35, -0.72, -4.25),
    new THREE.Vector3(0, -0.72, -7.15),
  ];
  group.position.copy(positions[index % positions.length]);
  const accent = room.context === "market" ? 0xffc866 : room.context === "private" ? 0x74ecff : 0xb79cff;
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 1.15,
    metalness: 0.48,
    roughness: 0.25,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x08131a,
    emissive: 0x0b2732,
    emissiveIntensity: 0.34,
    metalness: 0.86,
    roughness: 0.28,
    transparent: true,
    opacity: 0.94,
  });
  const glassMaterial = new THREE.MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const floor = markRoomObject(
    new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.15, 2.25), darkMaterial),
    room.id,
    raycastTargets,
  );
  floor.position.y = -0.84;
  group.add(floor);

  const portal = markRoomObject(
    new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.065, 8, isMobile ? 18 : 28), accentMaterial),
    room.id,
    raycastTargets,
  );
  portal.position.set(0, 0.12, 1.03);
  portal.rotation.x = 0;
  group.add(portal);

  const threshold = markRoomObject(
    new THREE.Mesh(new THREE.CircleGeometry(0.78, isMobile ? 12 : 20), glassMaterial),
    room.id,
    raycastTargets,
  );
  threshold.position.set(0, 0.12, 1.015);
  group.add(threshold);

  const posts = new THREE.Group();
  for (const x of [-1.18, 1.18]) {
    const post = markRoomObject(new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.6, 0.11), accentMaterial), room.id, raycastTargets);
    post.position.set(x, -0.05, 0.75);
    posts.add(post);
  }
  group.add(posts);

  const roof = markRoomObject(
    new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.1, 0.16), accentMaterial),
    room.id,
    raycastTargets,
  );
  roof.position.set(0, 0.74, 0.75);
  group.add(roof);

  const rail = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(3.55, 1.75, 2.4)),
    new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.2 }),
  );
  rail.position.y = -0.03;
  rail.userData.roomId = room.id;
  group.add(rail);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(1.5, 0.018, 6, isMobile ? 24 : 42),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.18, depthWrite: false }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = -0.82;
  group.add(halo);

  parent?.add(group);
  return {
    room,
    group,
    portal,
    threshold,
    rail,
    halo,
    accentMaterial,
    glassMaterial,
    darkMaterial,
    hovered: 0,
    selected: 0,
    entered: 0,
    focus: 0,
  };
}

function disposeNode(node, raycastTargets) {
  if (!node) return;
  node.group?.traverse?.((object) => {
    if (Array.isArray(raycastTargets)) {
      const index = raycastTargets.indexOf(object);
      if (index >= 0) raycastTargets.splice(index, 1);
    }
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
    else object.material?.dispose?.();
  });
  node.group?.parent?.remove(node.group);
}

/**
 * Mount the DOM room console and (when injected) the 3-D portal layer.
 * Callbacks receive frozen action snapshots so the host can emit intents and
 * focus the camera without giving this module authority over canonical state.
 */
export function createRoomSpaces({
  documentRoot = globalThis.document,
  projection = null,
  three = null,
  parent = null,
  raycastTargets = [],
  isMobile = false,
  reducedMotion = false,
  onSelect = null,
  onEnter = null,
  onLeave = null,
  onReplay = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Room spaces need a document-like owner");
  const panel = documentRoot.getElementById("room-console");
  const closeButton = documentRoot.getElementById("room-console-close");
  const replayButton = documentRoot.getElementById("room-console-replay");
  const enterButton = documentRoot.getElementById("room-console-enter");
  const leaveButton = documentRoot.getElementById("room-console-leave");
  const statusEl = documentRoot.getElementById("room-console-status");
  const currentEl = documentRoot.getElementById("room-console-current");
  const membershipEl = documentRoot.getElementById("room-console-membership");
  const roomCountEl = documentRoot.getElementById("room-console-room-count");
  const membershipCountEl = documentRoot.getElementById("room-console-membership-count");
  const messageIndicatorEl = documentRoot.getElementById("room-console-message-indicator");
  const roomsList = documentRoot.getElementById("room-console-list");
  const traceList = documentRoot.getElementById("room-console-trace");
  const boundaryEl = documentRoot.getElementById("room-console-boundary");
  if (!panel || !closeButton || !replayButton || !enterButton || !leaveButton || !statusEl || !roomsList || !traceList) {
    throw new Error("Room console mount points are missing");
  }

  let currentProjection = projection;
  let summary = summarizeRooms(currentProjection);
  let selectedId = summary.rooms[0]?.id ?? null;
  let enteredId = null;
  let hoveredId = null;
  let opened = panel.hidden !== true;
  let replayCount = 0;
  let lastAction = null;
  let lastReplay = null;
  const layer = three && parent ? new three.Group() : null;
  if (layer) {
    layer.name = "room-spaces-layer";
    parent.add(layer);
  }
  const nodes = new Map();

  function selectedRoom() {
    return roomById(summary, selectedId);
  }

  function enteredRoom() {
    return roomById(summary, enteredId);
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.classList.toggle("visible", opened);
    panel.setAttribute("aria-hidden", String(!opened));
    if (opened && method === "open") {
      documentRoot.getElementById(`room-space-button-${selectedId}`)?.focus({ preventScroll: true });
    }
  }

  function renderTrace() {
    traceList.replaceChildren();
    const entries = [];
    if (lastReplay) entries.push(`replay #${lastReplay.replayCount} · ${lastReplay.steps.join(" → ")}`);
    if (lastAction) entries.push(`${lastAction.action} · ${lastAction.room?.label ?? lastAction.roomId}`);
    if (!entries.length) entries.push("No local room action yet. Select a portal, then enter or leave.");
    entries.slice(0, 3).forEach((entry, index) => {
      const row = documentRoot.createElement("div");
      row.className = "room-console-trace-step";
      row.append(
        createText(documentRoot, "b", "room-console-trace-number", String(index + 1)),
        createText(documentRoot, "span", "room-console-trace-copy", entry),
      );
      traceList.appendChild(row);
    });
  }

  function renderList() {
    roomsList.replaceChildren();
    summary.rooms.forEach((room) => {
      const item = documentRoot.createElement("button");
      item.type = "button";
      item.id = `room-space-button-${room.id}`;
      item.className = "room-console-room";
      item.dataset.roomId = room.id;
      item.setAttribute("aria-pressed", String(room.id === selectedId));
      item.append(
        createText(documentRoot, "strong", "room-console-room-title", room.label),
        createText(documentRoot, "span", "room-console-room-meta", roomDetail(room)),
        createText(documentRoot, "span", "room-console-room-summary", room.role === "owner" ? "You own this local room projection." : "You observe this local room projection."),
      );
      item.addEventListener("click", () => selectRoom(room.id, "row"));
      roomsList.appendChild(item);
    });
    if (!summary.rooms.length) {
      roomsList.appendChild(createText(documentRoot, "div", "room-console-empty", "No membership-scoped rooms are available in this projection."));
    }
  }

  function render() {
    const selected = selectedRoom();
    const entered = enteredRoom();
    if (roomCountEl) roomCountEl.textContent = formatCount(summary.roomCount);
    if (membershipCountEl) membershipCountEl.textContent = formatCount(summary.membershipCount);
    if (messageIndicatorEl) {
      messageIndicatorEl.textContent = `${summary.message.indicator.toUpperCase()} · ${summary.message.eventKind.toUpperCase()} · CONTENT OMITTED`;
    }
    if (currentEl) {
      currentEl.textContent = entered
        ? `INSIDE · ${entered.label} · ${entered.role.toUpperCase()} · LOCAL ONLY`
        : selected
          ? `OUTSIDE · ${selected.label} · SELECTED · READY TO ENTER`
          : "OUTSIDE · SELECT A ROOM PORTAL";
    }
    if (membershipEl) {
      membershipEl.textContent = selected
        ? `${selected.label} · ${roomDetail(selected)} · membership is projected, not granted by this button`
        : "Select a room to inspect its membership scope.";
    }
    statusEl.textContent = lastReplay
      ? `REPLAYED · LOCAL ENTER / LEAVE #${replayCount} · NO NETWORK`
      : entered
        ? "INSIDE · RENDERER-ONLY ROOM STATE"
        : "READY · SELECT A ROOM PORTAL";
    boundaryEl.textContent = summary.boundary;
    enterButton.disabled = !selected || enteredId === selectedId;
    leaveButton.disabled = !enteredId;
    replayButton.disabled = !selected;
    renderList();
    renderTrace();
  }

  function selectRoom(id, method = "row") {
    const room = roomById(summary, id);
    if (!room) return null;
    selectedId = id;
    lastAction = roomActionSnapshot(summary, id, "select", method, replayCount);
    render();
    onSelect?.(lastAction);
    updateNodes();
    return lastAction;
  }

  function enterRoom(method = "button") {
    const room = selectedRoom();
    if (!room) return null;
    enteredId = room.id;
    lastAction = roomActionSnapshot(summary, room.id, "enter", method, replayCount);
    render();
    onEnter?.(lastAction);
    updateNodes();
    return lastAction;
  }

  function leaveRoom(method = "button") {
    const room = enteredRoom();
    if (!room) return null;
    enteredId = null;
    lastAction = roomActionSnapshot(summary, room.id, "leave", method, replayCount);
    render();
    onLeave?.(lastAction);
    updateNodes();
    return lastAction;
  }

  function replay(method = "button") {
    const room = selectedRoom() ?? summary.rooms[0];
    if (!room) return null;
    selectedId = room.id;
    replayCount += 1;
    const previousEntered = enteredId;
    enteredId = room.id;
    const enter = roomActionSnapshot(summary, room.id, "enter", `${method}:replay`, replayCount);
    enteredId = null;
    const leave = roomActionSnapshot(summary, room.id, "leave", `${method}:replay`, replayCount);
    lastReplay = freezeSnapshot({
      source: ROOM_SPACES_CONSOLE_SOURCE,
      replayCount,
      roomId: room.id,
      steps: ["entered", "left"],
      previousEnteredRoomId: previousEntered,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    lastAction = leave;
    render();
    onEnter?.(enter);
    onLeave?.(leave);
    onReplay?.(lastReplay);
    updateNodes();
    return lastReplay;
  }

  function getSnapshot() {
    return freezeSnapshot({
      ...summary,
      selectedId,
      enteredRoomId: enteredId,
      hoveredRoomId: hoveredId,
      selectedRoom: selectedRoom(),
      enteredRoom: enteredRoom(),
      opened,
      replayCount,
      lastAction,
      lastReplay,
      localOnly: true,
      simulation: true,
    });
  }

  function syncProjection(nextProjection) {
    currentProjection = nextProjection ?? currentProjection;
    summary = summarizeRooms(currentProjection);
    if (!roomById(summary, selectedId)) selectedId = summary.rooms[0]?.id ?? null;
    if (!roomById(summary, enteredId)) enteredId = null;
    syncNodes();
    render();
    return getSnapshot();
  }

  function setHoveredRoom(id) {
    hoveredId = roomById(summary, id)?.id ?? null;
    updateNodes();
    return hoveredId;
  }

  function resolveTarget(object) {
    let cursor = object;
    while (cursor) {
      const roomId = cursor.userData?.roomId;
      if (roomId) return roomById(summary, roomId);
      cursor = cursor.parent;
    }
    return null;
  }

  function getFocusTarget(id = selectedId) {
    const node = nodes.get(id);
    return node?.group?.position?.clone?.() ?? (three ? new three.Vector3(0, -0.4, -4.5) : null);
  }

  function updateNodes() {
    nodes.forEach((node, id) => {
      const targetSelected = id === selectedId ? 1 : 0;
      const targetEntered = id === enteredId ? 1 : 0;
      const targetHovered = id === hoveredId ? 1 : 0;
      node.selected = targetSelected;
      node.entered = targetEntered;
      node.hovered = targetHovered;
      node.focus = Math.max(targetSelected, targetEntered, targetHovered);
      const glow = 0.72 + node.focus * 1.45;
      if (node.accentMaterial) node.accentMaterial.emissiveIntensity = glow;
      if (node.glassMaterial) node.glassMaterial.opacity = 0.1 + node.focus * 0.11;
      if (node.rail?.material) node.rail.material.opacity = 0.15 + node.focus * 0.34;
    });
  }

  function syncNodes() {
    if (!layer || !three) return;
    const ids = new Set(summary.rooms.map((room) => room.id));
    [...nodes.entries()].forEach(([id, node]) => {
      if (!ids.has(id)) {
        disposeNode(node, raycastTargets);
        nodes.delete(id);
      }
    });
    summary.rooms.forEach((room, index) => {
      const existing = nodes.get(room.id);
      if (existing) {
        existing.room = room;
        existing.group.userData.roomId = room.id;
        return;
      }
      nodes.set(room.id, buildRoomNode(three, room, index, isMobile, layer, raycastTargets));
    });
    updateNodes();
  }

  function update(dt = 0.016, time = 0, options = {}) {
    const motionScale = reducedMotion || options.reducedMotion ? 0.18 : 1;
    nodes.forEach((node, id) => {
      const target = id === enteredId ? 1 : id === selectedId ? 0.58 : id === hoveredId ? 0.8 : 0;
      node.focus += (target - node.focus) * Math.min(1, dt * 7 * motionScale);
      const pulse = 1 + Math.sin(time * 1.6 + id.length) * 0.025 * motionScale;
      node.group.scale.setScalar(0.93 + node.focus * 0.09);
      node.portal.rotation.z += dt * (0.16 + node.focus * 0.38) * motionScale;
      node.portal.scale.setScalar(pulse + node.focus * 0.06);
      node.halo.rotation.z += dt * 0.05 * motionScale;
      node.halo.scale.setScalar(1 + node.focus * 0.12 + Math.sin(time * 1.2) * 0.025 * motionScale);
      if (node.rail?.material) node.rail.material.opacity = 0.14 + node.focus * 0.34;
    });
  }

  closeButton.addEventListener("click", () => setOpen(false, "close"));
  replayButton.addEventListener("click", () => replay("button"));
  enterButton.addEventListener("click", () => enterRoom("button"));
  leaveButton.addEventListener("click", () => leaveRoom("button"));
  documentRoot.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && opened) setOpen(false, "escape");
  });

  syncNodes();
  render();
  setOpen(opened, "initial");

  return Object.freeze({
    open: () => setOpen(true, "open"),
    close: () => setOpen(false, "close"),
    toggle: () => setOpen(!opened, "toggle"),
    selectRoom,
    enterRoom,
    leaveRoom,
    replay,
    syncProjection,
    setProjection: syncProjection,
    setHoveredRoom,
    resolveTarget,
    getFocusTarget,
    update,
    getSnapshot,
    destroy: () => {
      nodes.forEach((node) => disposeNode(node, raycastTargets));
      nodes.clear();
      layer?.parent?.remove(layer);
    },
  });
}

export default createRoomSpaces;
