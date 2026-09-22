/* Side Living Reality graph: renderer-agnostic local reality nodes + explicit connections. */

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function freezeNode(node) {
  return Object.freeze({...node, state: clone(node.state)});
}

function normalizeId(value, fallback) {
  const id = String(value ?? '').trim();
  if (id) return id;
  if (fallback) return fallback;
  throw new Error('Reality id is required');
}

function assertLabel(value) {
  const label = String(value ?? '').trim();
  if (!label) throw new Error('Reality label is required');
  if (label.length > 120) throw new Error('Reality label is too long');
  return label;
}

export function createRealityGraph(options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const rootId = normalizeId(options.rootId, 'reality:root');
  const nodes = new Map();
  const edges = new Map();
  let activeId = rootId;
  let revision = 0;
  let edgeSequence = 0;
  let sideSequence = 0;

  nodes.set(rootId, {
    id: rootId, parentId: null, kind: 'root',
    label: assertLabel(options.rootLabel ?? 'Living Reality'),
    depth: 0, state: clone(options.rootState ?? {}), createdAt: now(),
  });

  function requireNode(id) {
    const node = nodes.get(normalizeId(id));
    if (!node) throw new Error('Unknown reality: ' + id);
    return node;
  }

  function nextSideId(parentId) {
    sideSequence += 1;
    return parentId + ':side-' + sideSequence;
  }

  function findEdge(from, to, type = null) {
    return [...edges.values()].find(edge => edge.from === from && edge.to === to && (!type || edge.type === type)) ?? null;
  }

  function connect(fromId, toId, options = {}) {
    const from = requireNode(fromId).id, to = requireNode(toId).id;
    if (from === to) throw new Error('A reality cannot connect to itself');
    const type = options.type ?? 'portal';
    if (!['portal', 'fork'].includes(type)) throw new Error('Unsupported reality edge type: ' + type);
    if (findEdge(from, to, type)) return false;
    edges.set('edge:' + (++edgeSequence), {id:'edge:' + edgeSequence, from, to, type, createdAt: now()});
    if (options.bidirectional === true && !findEdge(to, from, type)) {
      edges.set('edge:' + (++edgeSequence), {id:'edge:' + edgeSequence, from:to, to:from, type, createdAt: now()});
    }
    revision += 1;
    return true;
  }

  function fork(sourceId, options = {}) {
    const source = requireNode(sourceId);
    const id = normalizeId(options.id, nextSideId(source.id));
    if (nodes.has(id)) throw new Error('Reality already exists: ' + id);
    const node = {
      id, parentId: source.id, kind: 'side',
      label: assertLabel(options.label ?? (source.label + ' · Side Reality')),
      depth: source.depth + 1, state: clone(options.state ?? source.state), createdAt: now(),
    };
    nodes.set(id, node);
    connect(source.id, id, {type:'fork', bidirectional: options.bidirectional === true});
    revision += 1;
    return freezeNode(node);
  }

  function canTravel(fromId, toId) {
    const from = requireNode(fromId).id, to = requireNode(toId).id;
    return Boolean(findEdge(from, to));
  }

  function travel(toId) {
    const to = requireNode(toId).id;
    if (to === activeId) return true;
    if (!canTravel(activeId, to)) throw new Error('No reality connection: ' + activeId + ' -> ' + to);
    activeId = to;
    revision += 1;
    return true;
  }

  function updateState(id, nextState) {
    const node = requireNode(id);
    node.state = clone(nextState);
    revision += 1;
    return freezeNode(node);
  }

  function getNode(id = activeId) { return freezeNode(requireNode(id)); }

  function getSnapshot() {
    return Object.freeze({
      revision, activeId,
      nodes: Object.freeze([...nodes.values()].map(freezeNode)),
      edges: Object.freeze([...edges.values()].map(edge => Object.freeze({...edge}))),
    });
  }

  return Object.freeze({connect, fork, canTravel, travel, updateState, getNode, getSnapshot, get activeId(){return activeId;}});
}

export function cloneRealityState(state) { return clone(state); }