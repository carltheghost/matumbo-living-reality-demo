/**
 * Ourplace creator economy: reviewed declarative designs and attributable use.
 *
 * This module owns designs, local observations and reward ENTITLEMENTS. It has
 * no balance, faucet, mint, signer or settlement authority. The caller must
 * commit a funded payout through the canonical ledger and verify that receipt.
 */
import {
  sha256Hex
} from './token-sha256.js?v=20261003-skin360';
import {REALITY_TAB_FORM_IDS} from './reality-tab-layout.js?v=20261003-skin360';

export const CREATOR_ECONOMY_SCHEMA_VERSION = 1;
export const CREATOR_CATEGORIES = Object.freeze(['layout', 'object', 'tool', 'agent', 'workflow', 'experience']);
export const CREATOR_LICENSES = Object.freeze(['attribution', 'attribution-sharealike']);
export const DEFAULT_DESIGN_DESCRIPTOR = deepFreeze({
  palette: {
    accent: '#39b9ff',
    background: '#07111f'
  },
  layout: 'spaces',
  density: 'comfortable',
  motion: 'reduced',
  navigation: 'guided',
  surface: null,
  objects: [],
  steps: [],
});
const COLORS = Object.freeze({
  blue: '#39b9ff',
  red: '#ff5875',
  green: '#56d6aa',
  purple: '#a884ff',
  gold: '#f4c969',
  black: '#05070c',
  navy: '#07111f',
  white: '#f3f7ff'
});
const LIMIT = 2500;
const internalStates = new WeakMap();

function fail(message, code = 'CREATOR_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function plain(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object`);
  return value;
}

function fields(value, allowed, label) {
  plain(value, label);
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`Unsupported ${label} field: ${key}`);
}

function text(value, label, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f<>]/.test(value)) fail(`${label} must be bounded plain text`);
  return value.trim();
}

function identity(value) {
  const id = text(value, 'Creator identity', 66);
  if (!/^u:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) fail('Use a canonical local u:<identity> participant account');
  return id;
}

function id(value, label = 'Identifier') {
  const result = text(value, label, 120);
  if (!/^[a-zA-Z0-9_.:-]+$/.test(result)) fail(`${label} contains unsupported characters`);
  return result;
}

function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} must be an exact integer between ${min} and ${max}`);
  return value;
}

function one(value, choices, label) {
  if (!choices.includes(value)) fail(`Unsupported ${label}: ${value}`);
  return value;
}

function color(value) {
  if (typeof value !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(value)) fail('Colors must use six-digit hex');
  return value.toLowerCase();
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function boundedJson(value, depth = 0) {
  if (depth > 12) fail('Receipt metadata is too deeply nested');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('Receipt metadata must use finite numbers');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 16000) fail('Receipt metadata is too long');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) fail('Receipt metadata has too many entries');
    return value.map(child => boundedJson(child, depth + 1));
  }
  plain(value, 'Receipt metadata');
  if (Object.keys(value).length > 100) fail('Receipt metadata has too many fields');
  const output = {};
  for (const key of Object.keys(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('Unsafe receipt metadata key');
    output[key] = boundedJson(value[key], depth + 1);
  }
  return output;
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
// Escaping to ASCII also makes the existing synchronous SHA implementation
// byte-correct for Unicode labels, including surrogate pairs.
function hash(value) {
  return sha256Hex(stable(value).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`));
}

function same(a, b) {
  return stable(a) === stable(b);
}

/** Safe declarative data only. Unknown fields (code/URLs/HTML) are rejected. */
export function normalizeDesignDescriptor(input = DEFAULT_DESIGN_DESCRIPTOR) {
  fields(input, ['palette', 'layout', 'density', 'motion', 'navigation', 'surface', 'objects', 'steps'], 'descriptor');
  const palette = input.palette ?? DEFAULT_DESIGN_DESCRIPTOR.palette;
  fields(palette, ['accent', 'background'], 'palette');
  const objects = input.objects ?? [];
  const steps = input.steps ?? [];
  if (!Array.isArray(objects) || objects.length > 24 || !Array.isArray(steps) || steps.length > 24) fail('Designs allow at most 24 objects and 24 steps');
  const objectIds = new Set();
  let surface = null;
  if (input.surface != null) {
    fields(input.surface, ['scope', 'shape'], 'surface');
    surface = {
      scope: one(input.surface.scope ?? 'selected', ['selected', 'all'], 'surface scope'),
      shape: one(input.surface.shape, REALITY_TAB_FORM_IDS, 'surface shape')
    };
  }
  const result = {
    palette: {
      accent: color(palette.accent ?? DEFAULT_DESIGN_DESCRIPTOR.palette.accent),
      background: color(palette.background ?? DEFAULT_DESIGN_DESCRIPTOR.palette.background)
    },
    layout: one(input.layout ?? 'spaces', ['spaces', 'grid', 'focus', 'flow'], 'layout'),
    density: one(input.density ?? 'comfortable', ['compact', 'comfortable', 'spacious'], 'density'),
    motion: one(input.motion ?? 'reduced', ['reduced', 'full', 'off'], 'motion'),
    navigation: one(input.navigation ?? 'guided', ['guided', 'search', 'minimal'], 'navigation'),
    surface,
    objects: objects.map(object => {
      fields(object, ['id', 'kind', 'label', 'shape', 'color'], 'object');
      const objectId = id(object.id, 'Object ID');
      if (objectIds.has(objectId)) fail('Object IDs must be unique');
      objectIds.add(objectId);
      return {
        id: objectId,
        kind: one(object.kind, ['surface', 'tool', 'agent', 'workflow', 'experience'], 'object kind'),
        label: text(object.label, 'Object label', 80),
        shape: one(object.shape ?? 'rectangle', REALITY_TAB_FORM_IDS, 'shape'),
        color: color(object.color ?? '#39b9ff')
      };
    }),
    steps: steps.map(step => {
      fields(step, ['id', 'action', 'target', 'label'], 'step');
      const target = id(step.target, 'Step target');
      if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(target)) fail('Step targets are local IDs, not executable URLs');
      return {
        id: id(step.id, 'Step ID'),
        action: one(step.action, ['navigate', 'inspect', 'preview', 'ask', 'confirm'], 'step action'),
        target,
        label: text(step.label, 'Step label', 100)
      };
    }),
  };
  if (new Set(result.steps.map(step => step.id)).size !== result.steps.length) fail('Step IDs must be unique');
  if (stable(result).length > 12000) fail('Design descriptor is too large');
  return deepFreeze(result);
}

/** Bounded local language adapter; it never invents arbitrary app functionality. */
export function parseCreatorDesignRequest(request, base = DEFAULT_DESIGN_DESCRIPTOR) {
  const command = text(request, 'Design request', 1200).toLowerCase();
  const descriptor = clone(normalizeDesignDescriptor(base));
  const supported = [];
  const unsupported = [];
  const clauses = command.split(/\s*(?:[;,.]|\band\b|\bthen\b)\s*/).filter(Boolean);
  for (let clause of clauses) {
    clause = clause.replace(/^(?:please\s+)?(?:make|set|use|change|switch to|give me)\s+/, '').replace(/\s+(?:please|layout|mode)$/, '').trim();
    let match;
    if ((match = clause.match(/^(?:(?:accent|color|accent color)\s+(?:to\s+)?)?(blue|red|green|purple|gold|black|navy|white|#[a-f0-9]{6})$/))) {
      descriptor.palette.accent = COLORS[match[1]] ?? match[1];
      supported.push('accent');
    } else if ((match = clause.match(/^background\s+(?:to\s+)?(blue|red|green|purple|gold|black|navy|white|#[a-f0-9]{6})$/))) {
      descriptor.palette.background = COLORS[match[1]] ?? match[1];
      supported.push('background');
    } else if ((match = clause.match(/^(?:layout\s+(?:to\s+)?)?(spaces|grid|focus|flow)$/))) {
      descriptor.layout = match[1];
      supported.push('layout');
    } else if ((match = clause.match(/^(?:density\s+(?:to\s+)?)?(compact|comfortable|spacious)$/))) {
      descriptor.density = match[1];
      supported.push('density');
    } else if (/^(?:reduce(?:d)? motion|motion (?:to )?reduced|less motion)$/.test(clause)) {
      descriptor.motion = 'reduced';
      supported.push('motion');
    } else if (/^(?:no motion|motion (?:to )?off|disable motion)$/.test(clause)) {
      descriptor.motion = 'off';
      supported.push('motion');
    } else if (/^(?:full motion|motion (?:to )?full)$/.test(clause)) {
      descriptor.motion = 'full';
      supported.push('motion');
    } else if ((match = clause.match(/^(?:navigation\s+(?:to\s+)?)?(guided|search|minimal)$/))) {
      descriptor.navigation = match[1];
      supported.push('navigation');
    } else if ((match = clause.match(/^(?:(selected|all)\s+)?(?:objects?|surfaces?|shape)\s+(?:(?:to|a)\s+)?([a-z]+(?:[ -][a-z]+)?)$/))
        && REALITY_TAB_FORM_IDS.includes(match[2].replace(/\s+/g, '-'))) {
      descriptor.surface = {
        scope: match[1] ?? 'selected',
        shape: match[2].replace(/\s+/g, '-')
      };
      supported.push('surface');
    } else unsupported.push(clause);
  }
  return deepFreeze({
    descriptor: normalizeDesignDescriptor(descriptor),
    supported: [...new Set(supported)],
    unsupported,
    complete: unsupported.length === 0,
    boundary: 'Local declarative preview only; unsupported instructions are not executed. No payment authorization.'
  });
}

/** Attribution is part of the design session, never transient widget state. */
export function normalizeDesignProvenance(input = {
  kind: 'fresh'
}) {
  plain(input, 'design provenance');
  if (input.kind === 'fresh') {
    fields(input, ['kind'], 'design provenance');
    return deepFreeze({
      kind: 'fresh'
    });
  }
  if (input.kind === 'legacy-unverified') {
    fields(input, ['kind'], 'design provenance');
    return deepFreeze({
      kind: 'legacy-unverified'
    });
  }
  const rootKey = text(input.rootKey, 'Provenance design key', 132);
  if (!/^[a-zA-Z0-9_.:-]+@[1-9][0-9]{0,8}$/.test(rootKey)) fail('Invalid provenance design key');
  if (input.kind === 'local-design') {
    fields(input, ['kind', 'rootKey'], 'design provenance');
    return deepFreeze({
      kind: 'local-design',
      rootKey
    });
  }
  if (input.kind !== 'shared-package') fail('Unknown design provenance');
  fields(input, ['kind', 'rootKey', 'packetHash', 'attribution'], 'design provenance');
  if (!/^[a-f0-9]{64}$/.test(input.packetHash ?? '') || !Array.isArray(input.attribution) || input.attribution.length < 1 || input.attribution.length > 64) fail('Invalid shared provenance');
  const keys = new Set(),
    attribution = input.attribution.map(row => {
      fields(row, ['key', 'creator', 'license'], 'provenance attribution');
      const key = text(row.key, 'Attribution design key', 132);
      if (!/^[a-zA-Z0-9_.:-]+@[1-9][0-9]{0,8}$/.test(key) || keys.has(key)) fail('Invalid or duplicate provenance attribution');
      keys.add(key);
      return {
        key,
        creator: identity(row.creator),
        license: one(row.license, CREATOR_LICENSES, 'attribution license')
      };
    });
  if (!keys.has(rootKey)) fail('Shared provenance is missing its root attribution');
  return deepFreeze({
    kind: 'shared-package',
    rootKey,
    packetHash: input.packetHash,
    attribution
  });
}

/** Preview is separate from explicit apply. All UI effects belong to the caller. */
export function createDesignSession({
  descriptor = DEFAULT_DESIGN_DESCRIPTOR
} = {}) {
  const original = normalizeDesignDescriptor(descriptor),
    fresh = normalizeDesignProvenance();
  let current = original,
    provenance = fresh,
    previous = [];
  const proposals = new Map(),
    baseHash = () => hash({
      descriptor: current,
      provenance
    });

  function preview(request, options = {}) {
    fields(options, ['provenance'], 'preview options');
    const parsed = typeof request === 'string' ? parseCreatorDesignRequest(request, current) : {
      descriptor: normalizeDesignDescriptor(request),
      supported: ['structured-descriptor'],
      unsupported: [],
      complete: true
    };
    const source = normalizeDesignProvenance(options.provenance ?? provenance),
      basis = baseHash();
    const proposalId = `preview:${hash({ baseHash: basis, descriptor: parsed.descriptor, provenance: source })}`;
    const result = deepFreeze({
      ...parsed,
      provenance: source,
      proposalId,
      baseHash: basis,
      previewOnly: true
    });
    proposals.set(proposalId, result);
    return result;
  }

  function remember() {
    previous.push({
      descriptor: current,
      provenance
    });
    previous = previous.slice(-50);
  }

  function apply({
    proposalId,
    explicit = false
  } = {}) {
    if (explicit !== true) fail('Explicit design application is required', 'CREATOR_AUTH_REQUIRED');
    const proposal = proposals.get(proposalId);
    if (!proposal || proposal.baseHash !== baseHash()) fail('Preview is unknown or stale');
    if (!proposal.supported.length) fail('The request contains no supported design change');
    remember();
    current = proposal.descriptor;
    provenance = proposal.provenance;
    proposals.clear();
    return snapshot();
  }

  function undo() {
    if (previous.length) {
      const row = previous.pop();
      current = row.descriptor;
      provenance = row.provenance;
    }
    proposals.clear();
    return snapshot();
  }

  function reset() {
    remember();
    current = original;
    provenance = fresh;
    proposals.clear();
    return snapshot();
  }

  function snapshot() {
    return deepFreeze({
      schemaVersion: 2,
      descriptor: current,
      descriptorHash: hash(current),
      provenance,
      publicationEligible: ['fresh', 'local-design'].includes(provenance.kind),
      undoDepth: previous.length,
      localOnly: true,
      moneyAuthorized: false
    });
  }

  function serialize() {
    return JSON.stringify({
      schemaVersion: 2,
      original,
      current,
      provenance,
      previous
    });
  }

  function restore(serialized) {
    if (typeof serialized !== 'string' || serialized.length > 2000000) fail('Invalid design-session export');
    const value = JSON.parse(serialized);
    fields(value, ['schemaVersion', 'original', 'current', 'provenance', 'previous'], 'session export');
    if (![1, 2].includes(value.schemaVersion) || !Array.isArray(value.previous) || value.previous.length > 50 || !same(normalizeDesignDescriptor(value.original), original)) fail('Incompatible design-session export');
    const next = normalizeDesignDescriptor(value.current);
    // Legacy changed sessions have no trustworthy attribution. Keep their usable
    // appearance, but require an explicit fresh start before claiming authorship.
    const legacySource = descriptor => same(descriptor, original) ? fresh : normalizeDesignProvenance({
      kind: 'legacy-unverified'
    });
    const source = value.schemaVersion === 2 ? normalizeDesignProvenance(value.provenance) : legacySource(next);
    if (value.schemaVersion === 2 && !value.provenance) fail('Design provenance is required');
    const stack = value.previous.map(row => {
      if (value.schemaVersion === 1) {
        const descriptor = normalizeDesignDescriptor(row);
        return {
          descriptor,
          provenance: legacySource(descriptor)
        };
      }
      fields(row, ['descriptor', 'provenance'], 'undo entry');
      if (!row.provenance) fail('Undo provenance is required');
      return {
        descriptor: normalizeDesignDescriptor(row.descriptor),
        provenance: normalizeDesignProvenance(row.provenance)
      };
    });
    current = next;
    provenance = source;
    previous = stack;
    proposals.clear();
    return snapshot();
  }
  return Object.freeze({
    preview,
    apply,
    undo,
    reset,
    snapshot,
    serialize,
    restore
  });
}

/** Portable public data; integrity is checked, author identity is not attested. */
export function parseSharedCreatorDesign(serialized) {
  if (typeof serialized !== 'string' || serialized.length > 850000) fail('Shared design packet is too large');
  const packet = JSON.parse(serialized);
  const derivative = packet?.format === 'matumbo-unverified-derivative-v1';
  fields(packet, ['format', 'rootKey', 'designs', 'packetHash', ...(derivative ? ['derivation'] : [])], 'shared design packet');
  if ((!derivative && packet.format !== 'matumbo-reviewed-design-v1') || !Array.isArray(packet.designs) || !packet.designs.length || packet.designs.length > 64) fail('Unsupported shared design packet');
  const {
    packetHash,
    ...body
  } = packet;
  if (packetHash !== hash(body)) fail('Shared design integrity check failed');
  const byKey = new Map();
  for (const input of packet.designs) {
    fields(input, ['id', 'version', 'key', 'creator', 'category', 'title', 'descriptor', 'descriptorHash', 'parents', 'license'], 'shared design');
    const designId = id(input.id, 'Shared design ID');
    const version = integer(input.version, 'Shared design version', 1, 10000);
    const key = `${designId}@${version}`;
    if (key !== input.key || byKey.has(key)) fail('Invalid or duplicate shared design version');
    const descriptor = normalizeDesignDescriptor(input.descriptor);
    if (input.descriptorHash !== hash(descriptor) || !Array.isArray(input.parents) || input.parents.length > 8 || new Set(input.parents).size !== input.parents.length) fail('Invalid shared descriptor or parents');
    byKey.set(key, deepFreeze({
      id: designId,
      version,
      key,
      creator: identity(input.creator),
      category: one(input.category, CREATOR_CATEGORIES, 'shared category'),
      title: text(input.title, 'Shared title', 100),
      descriptor,
      descriptorHash: input.descriptorHash,
      parents: input.parents.map(parent => text(parent, 'Parent key', 132)),
      license: one(input.license, CREATOR_LICENSES, 'shared license')
    }));
  }
  const active = new Set();
  const heights = new Map();

  function walk(key) {
    if (active.has(key) || !byKey.has(key)) fail('Shared attribution graph is incomplete or cyclic');
    if (heights.has(key)) return heights.get(key);
    active.add(key);
    const design = byKey.get(key);
    let height = 0;
    for (const parent of design.parents) {
      height = Math.max(height, walk(parent) + 1);
      if (height > 12) fail('Shared attribution graph exceeds 12 levels');
      if (byKey.get(parent).license === 'attribution-sharealike' && design.license !== 'attribution-sharealike') fail('Shared license does not preserve parent terms');
    }
    active.delete(key);
    heights.set(key, height);
    return height;
  }
  walk(packet.rootKey);
  if (heights.size !== byKey.size) fail('Shared packet contains unrelated designs');
  let derivation = null;
  if (derivative) {
    fields(packet.derivation, ['sourceRootKey', 'sourcePacketHash', 'declaredLocalAuthor', 'authorIdentityVerified', 'externalPublicationVerified', 'catalogRegistered', 'moneyAuthorized'], 'derivation');
    const root = byKey.get(packet.rootKey), source = byKey.get(packet.derivation.sourceRootKey);
    if (!source || !same(root.parents, [source.key]) || root.id === source.id || [...byKey.values()].some(row => row.key !== root.key && row.id === root.id)) fail('Derivative must have a new design ID and preserve its source ancestry');
    if (same(root.descriptor, source.descriptor)) fail('Derivative descriptor must contain an applied edit');
    if (!/^[a-f0-9]{64}$/.test(packet.derivation.sourcePacketHash ?? '') || identity(packet.derivation.declaredLocalAuthor) !== root.creator) fail('Invalid derivative source or declared local author');
    for (const field of ['authorIdentityVerified', 'externalPublicationVerified', 'catalogRegistered', 'moneyAuthorized'])
      if (packet.derivation[field] !== false) fail('Portable derivatives cannot claim identity, publication, catalog or money authority');
    // The current packet checksum protects its data. Its historical source hash
    // remains a declaration; it is not an external identity or publication proof.
    derivation = clone(packet.derivation);
  }
  return deepFreeze({
    root: byKey.get(packet.rootKey),
    designs: [...byKey.values()],
    packetHash,
    derivation,
    integrityVerified: true,
    authorIdentityVerified: false,
    externalPublicationVerified: false,
    requiresExplicitReview: true,
    moneyAuthorized: false
  });
}

/**
 * Export applied edits as an unverified derivative without registering a design,
 * crediting an entitlement, changing session origin or invoking a runtime owner.
 */
export function exportSharedCreatorDerivative(input = {}) {
  fields(input, ['serialized', 'descriptor', 'provenance', 'id', 'creator', 'category', 'title', 'license', 'explicit'], 'derivative export');
  if (input.explicit !== true) fail('Explicit derivative review is required', 'CREATOR_AUTH_REQUIRED');
  const source = parseSharedCreatorDesign(input.serialized);
  const provenance = normalizeDesignProvenance(input.provenance);
  const expectedProvenance = normalizeDesignProvenance({
    kind: 'shared-package',
    rootKey: source.root.key,
    packetHash: source.packetHash,
    attribution: source.designs.map(({ key, creator, license }) => ({ key, creator, license }))
  });
  // Attribution order is not authority. Compare the complete keyed ancestry so
  // restored sessions cannot remove credits or graft a different reviewed file.
  const ordered = rows => [...rows].sort((a, b) => a.key.localeCompare(b.key));
  if (provenance.kind !== 'shared-package' || provenance.rootKey !== expectedProvenance.rootKey || provenance.packetHash !== expectedProvenance.packetHash || !same(ordered(provenance.attribution), ordered(expectedProvenance.attribution))) fail('Review the original package matching the current shared session and its full attribution');
  const descriptor = normalizeDesignDescriptor(input.descriptor);
  if (same(descriptor, source.root.descriptor)) fail('Apply an edit to the imported descriptor before exporting a derivative');
  const designId = id(input.id, 'Derivative design ID');
  if (source.designs.some(row => row.id === designId)) fail('Derivative design ID collides with licensed ancestry');
  const license = one(input.license, CREATOR_LICENSES, 'derivative license');
  if (source.designs.some(row => row.license === 'attribution-sharealike') && license !== 'attribution-sharealike') fail('Parent share-alike license must be preserved');
  const creator = identity(input.creator);
  const root = {
    id: designId,
    version: 1,
    key: `${designId}@1`,
    creator,
    category: one(input.category, CREATOR_CATEGORIES, 'derivative category'),
    title: text(input.title, 'Derivative title', 100),
    descriptor,
    descriptorHash: hash(descriptor),
    parents: [source.root.key],
    license
  };
  const body = {
    format: 'matumbo-unverified-derivative-v1',
    rootKey: root.key,
    designs: [root, ...source.designs],
    derivation: {
      sourceRootKey: source.root.key,
      sourcePacketHash: source.packetHash,
      declaredLocalAuthor: creator,
      authorIdentityVerified: false,
      externalPublicationVerified: false,
      catalogRegistered: false,
      moneyAuthorized: false
    }
  };
  const serialized = JSON.stringify({ ...body, packetHash: hash(body) });
  // Reuse the import gate for total size, ancestry count/depth and license rules.
  parseSharedCreatorDesign(serialized);
  return serialized;
}

/**
 * Observation and payout verifiers are injected by the trusted runtime owner.
 * Both default to rejection. Imported history is rechecked by these verifiers.
 */
export function createCreatorEconomy({
  rewardFluffPerUsage = 10,
  maxActorUsesPerPeriod = 20,
  maxCreatorRewardFluffPerPeriod = 1000,
  maxTotalRewardFluffPerPeriod = 10000,
  observationVerifier = () => false,
  payoutVerifier = () => false,
  settlementJournalCount = null,
} = {}) {
  const policy = deepFreeze({
    rewardFluffPerUsage: integer(rewardFluffPerUsage, 'Usage reward', 1, 1000000),
    maxActorUsesPerPeriod: integer(maxActorUsesPerPeriod, 'Actor use cap', 1, 1000),
    maxCreatorRewardFluffPerPeriod: integer(maxCreatorRewardFluffPerPeriod, 'Creator period cap', 1, 100000000),
    maxTotalRewardFluffPerPeriod: integer(maxTotalRewardFluffPerPeriod, 'Total period cap', 1, 1000000000)
  });
  if (typeof observationVerifier !== 'function' || typeof payoutVerifier !== 'function') fail('Runtime verifiers must be functions');
  if (settlementJournalCount !== null && typeof settlementJournalCount !== 'function') fail('Settlement journal observer must be a function');
  const designs = new Map();
  const usages = new Map();
  const entitlements = new Map();
  const plans = new Map();
  const idem = new Map();
  const events = [];
  const evidenceIds = new Set();
  const sessionKeys = new Set();
  const actorDesignPeriods = new Set();
  let busy = false;

  function transact(method, input, operation) {
    if (busy) fail('Creator transitions cannot reenter an in-progress operation', 'CREATOR_REENTRY');
    const key = id(input.idempotencyKey, 'Idempotency key');
    const fingerprint = hash({
      method,
      input
    });
    if (idem.has(key)) {
      const old = idem.get(key);
      if (old.fingerprint !== fingerprint) fail('Idempotency key was reused with a different payload', 'IDEM_MISMATCH');
      return old.result;
    }
    if (events.length >= LIMIT) fail('Local creator history capacity reached');
    if (JSON.stringify(events).length + stable(input).length + 512 > 3900000) fail('Local creator export capacity reached');
    busy = true;
    try {
      const result = deepFreeze(operation());
      const body = {
        sequence: events.length + 1,
        method,
        input: clone(input),
        resultHash: hash(result),
        previousHash: events.at(-1)?.hash ?? 'CREATOR-GENESIS'
      };
      const event = deepFreeze({
        ...body,
        hash: hash(body)
      });
      events.push(event);
      idem.set(key, {
        fingerprint,
        result
      });
      return result;
    } finally {
      busy = false;
    }
  }

  function requireDesign(key) {
    const value = designs.get(key);
    if (!value) fail('Unknown design version');
    return value;
  }

  function ancestry(key) {
    const ancestors = new Map();

    function walk(next, depth = 0) {
      if (depth > 12) fail('Design ancestry exceeds 12 levels');
      const design = requireDesign(next);
      if (ancestors.has(next)) return;
      ancestors.set(next, design);
      for (const parent of design.parents) walk(parent, depth + 1);
    }
    walk(key);
    if (ancestors.size > 64) fail('Attribution ancestry exceeds 64 versions');
    return [...ancestors.values()];
  }

  function registerDesign(input = {}) {
    fields(input, ['id', 'version', 'creator', 'category', 'title', 'descriptor', 'parents', 'privacy', 'idempotencyKey'], 'design registration');
    const designId = id(input.id, 'Design ID');
    const version = integer(input.version ?? 1, 'Design version', 1, 10000);
    const creator = identity(input.creator);
    const category = one(input.category, CREATOR_CATEGORIES, 'creator category');
    const title = text(input.title, 'Design title', 100);
    const descriptor = normalizeDesignDescriptor(input.descriptor);
    const privacy = one(input.privacy ?? 'private', ['private', 'public'], 'privacy');
    const parents = input.parents ?? [];
    if (!Array.isArray(parents) || parents.length > 8 || new Set(parents).size !== parents.length) fail('At most eight unique parent versions are permitted');
    const key = `${designId}@${version}`;
    for (const parent of parents) {
      const design = requireDesign(parent);
      if (design.state !== 'published' || design.privacy !== 'public' || !CREATOR_LICENSES.includes(design.license)) fail('Remix parents must be publicly published and licensed');
      if (parent === key || ancestry(parent).some(value => value.key === key)) fail('A remix cannot form a cycle');
    }
    const versions = [...designs.values()].filter(design => design.id === designId);
    const normalized = {
      id: designId,
      version,
      creator,
      category,
      title,
      descriptor,
      parents: parents.map(parent => text(parent, 'Parent key')),
      privacy,
      idempotencyKey: input.idempotencyKey
    };
    return transact('registerDesign', normalized, () => {
      if (designs.has(key)) fail('Design version already exists');
      if (versions.some(design => design.creator !== creator)) fail('Only the original creator can version a design');
      if (version !== Math.max(0, ...versions.map(design => design.version)) + 1) fail('Design versions must advance consecutively');
      const design = deepFreeze({
        ...normalized,
        key,
        descriptorHash: hash(descriptor),
        state: 'draft',
        license: null,
        simulation: true
      });
      designs.set(key, design);
      return design;
    });
  }

  function publish(input = {}) {
    fields(input, ['key', 'creator', 'license', 'explicit', 'idempotencyKey'], 'publication');
    const normalized = {
      key: text(input.key, 'Design key'),
      creator: identity(input.creator),
      license: one(input.license, CREATOR_LICENSES, 'license'),
      explicit: input.explicit === true,
      idempotencyKey: input.idempotencyKey
    };
    return transact('publish', normalized, () => {
      const design = requireDesign(normalized.key);
      if (normalized.explicit !== true || normalized.creator !== design.creator) fail('Only the creator can explicitly publish a reviewed design', 'CREATOR_AUTH_REQUIRED');
      if (design.privacy !== 'public') fail('Private designs cannot be shared or earn adoption rewards');
      if (design.state !== 'draft') fail('Published versions are immutable; create a new version');
      if (design.parents.some(parent => requireDesign(parent).license === 'attribution-sharealike') && normalized.license !== 'attribution-sharealike') fail('Parent share-alike license must be preserved');
      const next = deepFreeze({
        ...design,
        state: 'published',
        license: normalized.license
      });
      designs.set(design.key, next);
      return next;
    });
  }

  function recordUsage(input = {}) {
    fields(input, ['usageId', 'designKey', 'actor', 'sessionId', 'period', 'kind', 'evidenceId', 'idempotencyKey'], 'usage');
    const normalized = {
      usageId: id(input.usageId, 'Usage ID'),
      designKey: text(input.designKey, 'Design key'),
      actor: identity(input.actor),
      sessionId: id(input.sessionId, 'Session ID'),
      period: id(input.period, 'Policy period'),
      kind: one(input.kind, ['adoption', 'derived-use'], 'usage kind'),
      evidenceId: id(input.evidenceId, 'Evidence ID'),
      idempotencyKey: input.idempotencyKey
    };
    return transact('recordUsage', normalized, () => {
      if (usages.has(normalized.usageId)) fail('Usage ID already recorded');
      const design = requireDesign(normalized.designKey);
      const lineage = ancestry(design.key);
      let reason = null;
      if (design.state !== 'published' || design.privacy !== 'public') reason = 'design-not-publicly-published';
      else if (normalized.actor === design.creator || lineage.some(value => value.creator === normalized.actor)) reason = 'self-use';
      else if (normalized.kind === 'derived-use' && design.parents.length === 0) reason = 'no-derived-ancestry';
      else if (evidenceIds.has(normalized.evidenceId)) reason = 'duplicate-evidence';
      const sessionKey = `${normalized.actor}|${normalized.designKey}|${normalized.sessionId}`;
      const periodKey = `${normalized.actor}|${normalized.designKey}|${normalized.period}`;
      if (!reason && sessionKeys.has(sessionKey)) reason = 'duplicate-session';
      if (!reason && actorDesignPeriods.has(periodKey)) reason = 'repeated-design-in-period';
      const accepted = [...usages.values()].filter(value => value.qualified && value.period === normalized.period);
      if (!reason && accepted.filter(value => value.actor === normalized.actor).length >= policy.maxActorUsesPerPeriod) reason = 'actor-period-cap';
      if (!reason) {
        let verified = false;
        try {
          verified = observationVerifier(deepFreeze(clone(normalized))) === true;
        } catch {
          /* Failed verification never earns. */ }
        if (!verified) reason = 'observation-unverified';
      }
      // Unique creators receive equal, deterministic shares, so duplicate DAG
      // paths or multiple versions from one creator never multiply rewards.
      const creators = [...new Set(lineage.map(value => value.creator))].sort();
      let allocations = [];
      if (!reason) {
        const totalUsed = [...entitlements.values()].filter(value => value.period === normalized.period).reduce((sum, value) => sum + value.amountFluff, 0);
        let remaining = Math.min(policy.rewardFluffPerUsage, Math.max(0, policy.maxTotalRewardFluffPerPeriod - totalUsed));
        const plannedTotal = remaining;
        const share = Math.floor(plannedTotal / creators.length);
        const remainder = plannedTotal % creators.length;
        allocations = creators.map((creator, index) => {
          const creatorUsed = [...entitlements.values()].filter(value => value.creator === creator && value.period === normalized.period).reduce((sum, value) => sum + value.amountFluff, 0);
          const requested = share + (index < remainder ? 1 : 0);
          return {
            creator,
            amountFluff: Math.min(requested, Math.max(0, policy.maxCreatorRewardFluffPerPeriod - creatorUsed))
          };
        }).filter(value => value.amountFluff > 0);
        remaining = allocations.reduce((sum, value) => sum + value.amountFluff, 0);
        if (!remaining) reason = 'reward-period-cap';
      }
      const usage = deepFreeze({
        ...normalized,
        qualified: !reason,
        reason: reason ?? 'observed-use',
        attribution: creators,
        entitlementIds: allocations.map(value => `ent:${normalized.usageId}:${value.creator}`),
        rewardFluff: allocations.reduce((sum, value) => sum + value.amountFluff, 0),
        settled: false,
        evidenceAuthority: 'runtime-verified-local-observation'
      });
      usages.set(usage.usageId, usage);
      // Even rejected observations consume their usage ID, but not another
      // person's evidence/session. Corrected observations need a new event ID.
      if (usage.qualified) {
        evidenceIds.add(normalized.evidenceId);
        sessionKeys.add(sessionKey);
        actorDesignPeriods.add(periodKey);
        for (const allocation of allocations) {
          const entitlementId = `ent:${normalized.usageId}:${allocation.creator}`;
          entitlements.set(entitlementId, deepFreeze({
            id: entitlementId,
            usageId: normalized.usageId,
            designKey: normalized.designKey,
            creator: allocation.creator,
            period: normalized.period,
            amountFluff: allocation.amountFluff,
            asset: 'TUMBO',
            state: 'pending',
            receiptHash: null,
            planId: null
          }));
        }
      }
      return usage;
    });
  }

  function planPayout(input = {}) {
    fields(input, ['planId', 'period', 'fundingAccount', 'availableFluff', 'idempotencyKey'], 'payout plan');
    const normalized = {
      planId: id(input.planId, 'Plan ID'),
      period: id(input.period, 'Policy period'),
      fundingAccount: one(input.fundingAccount ?? 'b:economic-rewards', ['b:economic-rewards'], 'funded creator reward pool'),
      availableFluff: integer(input.availableFluff, 'Available funded reward fluff'),
      idempotencyKey: input.idempotencyKey
    };
    return transact('planPayout', normalized, () => {
      if (plans.has(normalized.planId)) fail('Payout plan ID already exists');
      const selectedCreators = new Set();
      const pending = [...entitlements.values()].filter(value => value.period === normalized.period && value.state === 'pending').sort((a, b) => a.id.localeCompare(b.id)).filter(value => {
        if (!selectedCreators.has(value.creator) && selectedCreators.size >= 64) return false;
        selectedCreators.add(value.creator);
        return true;
      });
      const totalFluff = pending.reduce((sum, value) => sum + value.amountFluff, 0);
      integer(totalFluff, 'Payout total');
      if (!totalFluff) fail('No pending creator entitlements');
      if (totalFluff > normalized.availableFluff) fail('Canonical treasury cannot fund these entitlements', 'CREATOR_UNFUNDED');
      const sums = new Map();
      for (const entitlement of pending) sums.set(entitlement.creator, (sums.get(entitlement.creator) ?? 0) + entitlement.amountFluff);
      const entries = [{
        account: normalized.fundingAccount,
        asset: 'TUMBO',
        delta: String(-totalFluff)
      }, ...[...sums.entries()].sort().map(([account, amount]) => ({
        account,
        asset: 'TUMBO',
        delta: String(amount)
      }))];
      const plan = deepFreeze({
        ...normalized,
        entitlementIds: pending.map(value => value.id),
        totalFluff,
        entries,
        state: 'planned',
        funded: false,
        settled: false,
        simulation: true,
        moneyAuthorized: false,
        planHash: hash({
          planId: normalized.planId,
          entries,
          entitlementIds: pending.map(value => value.id)
        })
      });
      for (const entitlement of pending) entitlements.set(entitlement.id, deepFreeze({
        ...entitlement,
        state: 'planned',
        planId: plan.planId
      }));
      plans.set(plan.planId, plan);
      return plan;
    });
  }

  function cancelPayout(input = {}) {
    fields(input, ['planId', 'idempotencyKey'], 'payout cancellation');
    const normalized = {
      planId: id(input.planId, 'Plan ID'),
      idempotencyKey: input.idempotencyKey
    };
    return transact('cancelPayout', normalized, () => {
      const plan = plans.get(normalized.planId);
      if (!plan || plan.state !== 'planned') fail('Only an unsettled plan can be canceled');
      for (const entitlementId of plan.entitlementIds) {
        const entitlement = entitlements.get(entitlementId);
        entitlements.set(entitlementId, deepFreeze({
          ...entitlement,
          state: 'pending',
          planId: null
        }));
      }
      const canceled = deepFreeze({
        ...plan,
        state: 'canceled'
      });
      plans.set(plan.planId, canceled);
      return canceled;
    });
  }

  function acknowledgePayout(input = {}) {
    fields(input, ['planId', 'receipt', 'explicit', 'idempotencyKey'], 'payout acknowledgment');
    const normalized = {
      planId: id(input.planId, 'Plan ID'),
      receipt: boundedJson(plain(input.receipt, 'Canonical ledger receipt')),
      explicit: input.explicit === true,
      idempotencyKey: input.idempotencyKey
    };
    if (stable(normalized.receipt).length > 50000) fail('Receipt is too large');
    return transact('acknowledgePayout', normalized, () => {
      const plan = plans.get(normalized.planId);
      if (!plan || !['planned', 'reconciliation-required'].includes(plan.state)) fail('Unknown or terminal payout plan');
      if (!normalized.explicit) fail('Payout acknowledgment requires explicit runtime authority', 'CREATOR_AUTH_REQUIRED');
      const receiptHash = text(normalized.receipt.hash, 'Receipt hash', 100);
      const receiptId = typeof normalized.receipt.id === 'number' ? integer(normalized.receipt.id, 'Canonical receipt ID', 0) : id(normalized.receipt.id, 'Canonical receipt ID');
      if (!/^[a-f0-9]{16}$/.test(receiptHash) || !Array.isArray(normalized.receipt.postings)) fail('A canonical FNV-1a-64 journal receipt is required');
      const receiptEntries = normalized.receipt.postings.map(posting => {
        fields(posting, ['account', 'asset', 'amount'], 'receipt posting');
        if (!Number.isSafeInteger(posting.amount) || posting.amount === 0) fail('Receipt posting must contain an exact nonzero amount');
        return {
          account: id(posting.account, 'Posting account'),
          asset: one(posting.asset, ['TUMBO'], 'creator payout asset'),
          delta: String(posting.amount)
        };
      });
      if (!same(receiptEntries, plan.entries)) fail('Receipt does not match the exact funded payout plan');
      if ([...plans.values()].some(value => value.receiptHash === receiptHash)) fail('A ledger receipt cannot pay two plans');
      let verified = false;
      try {
        verified = payoutVerifier(deepFreeze(clone(normalized.receipt)), plan) === true;
      } catch {
        /* Reject unverifiable settlement. */ }
      if (!verified) fail('Canonical ledger payout receipt was not verified', 'CREATOR_RECEIPT_UNVERIFIED');
      for (const entitlementId of plan.entitlementIds) {
        const entitlement = entitlements.get(entitlementId);
        entitlements.set(entitlementId, deepFreeze({
          ...entitlement,
          state: 'paid',
          receiptHash
        }));
      }
      const paid = deepFreeze({
        ...plan,
        state: 'paid',
        funded: true,
        settled: true,
        receiptId,
        receiptHash,
        hashAlgorithm: 'FNV-1a-64',
        cryptographicSettlementProof: false
      });
      plans.set(plan.planId, paid);
      return paid;
    });
  }

  function markSettlementReview(input) {
    fields(input, ['planId', 'explicit', 'idempotencyKey'], 'settlement review');
    id(input.planId, 'Plan ID');
    if (input.explicit !== true) fail('Settlement review must reference an explicitly authorized attempt');
    return transact('markSettlementReview', input, () => {
      const plan = plans.get(input.planId);
      if (!plan || plan.state !== 'planned') fail('Unknown payout requiring review');
      const next = deepFreeze({
        ...plan,
        state: 'reconciliation-required',
        settled: false,
        reconciliationRequired: true,
        reviewReason: 'Settlement callback outcome or receipt could not be safely acknowledged. Inspect the canonical ledger before any retry.'
      });
      plans.set(plan.planId, next);
      return next;
    });
  }

  /** Lock the creator owner while the canonical ledger invokes commit listeners. */
  function commitPayout(input = {}, settle) {
    fields(input, ['planId', 'explicit', 'idempotencyKey'], 'guarded payout');
    const normalized = {
      planId: id(input.planId, 'Plan ID'),
      explicit: input.explicit === true,
      idempotencyKey: id(input.idempotencyKey, 'Idempotency key')
    };
    if (!normalized.explicit) fail('Explicit funded payout authorization is required', 'CREATOR_AUTH_REQUIRED');
    if (busy) fail('Creator transitions cannot reenter an in-progress operation', 'CREATOR_REENTRY');
    if (typeof settle !== 'function' || ['AsyncFunction', 'AsyncGeneratorFunction'].includes(settle.constructor?.name)) fail('Settlement must use a synchronous canonical-ledger callback');
    const old = idem.get(normalized.idempotencyKey);
    if (old) {
      if (old.result.planId !== normalized.planId || !['paid', 'reconciliation-required'].includes(old.result.state)) fail('Idempotency key was reused with a different payload', 'IDEM_MISMATCH');
      return old.result;
    }
    const plan = plans.get(normalized.planId);
    if (!plan || plan.state !== 'planned') fail('Unknown or terminal payout plan');
    // Reserve ample space for the bounded receipt before crossing ledger commit.
    if (events.length >= LIMIT || JSON.stringify(events).length + 70000 > 3900000) fail('Local creator history capacity cannot safely record settlement');
    const before = settlementJournalCount === null ? null : integer(settlementJournalCount(), 'Canonical journal count');
    let receipt;
    busy = true;
    try {
      receipt = settle(plan);
      if (receipt && typeof receipt.then === 'function') fail('Settlement callback returned an asynchronous result');
    } catch (error) {
      busy = false;
      let unchanged = false;
      try {
        unchanged = before !== null && settlementJournalCount() === before;
      } catch {
        /* Unknown outcome requires review. */ }
      if (unchanged) throw error;
      return markSettlementReview(normalized);
    } finally {
      busy = false;
    }
    try {
      return acknowledgePayout({
        ...normalized,
        receipt
      });
    } catch (error) {
      let unchanged = false;
      try {
        unchanged = before !== null && settlementJournalCount() === before;
      } catch {
        /* Unknown outcome requires review. */ }
      if (unchanged) throw error;
      return markSettlementReview(normalized);
    }
  }

  function snapshot({
    publicOnly = false
  } = {}) {
    const rows = [...designs.values()].filter(design => !publicOnly || (design.state === 'published' && design.privacy === 'public'));
    const usageRows = publicOnly ? [] : [...usages.values()].map(usage => {
      const rewards = usage.entitlementIds.map(key => entitlements.get(key));
      const settled = usage.qualified && rewards.length > 0 && rewards.every(value => value.state === 'paid');
      return {
        ...usage,
        settled,
        rewardSettlementState: !usage.qualified ? 'ineligible' : settled ? 'paid' : rewards.some(value => value.state === 'planned') ? 'reserved' : 'pending'
      };
    });
    return deepFreeze({
      schemaVersion: 1,
      policy,
      designs: rows,
      usages: usageRows,
      entitlements: publicOnly ? [] : [...entitlements.values()],
      payoutPlans: publicOnly ? [] : [...plans.values()],
      historyLength: events.length,
      historyHash: events.at(-1)?.hash ?? 'CREATOR-GENESIS',
      localOnly: true,
      simulation: true,
      ownsTokenBalance: false,
      issuesTokens: false,
      realMoneyAuthority: false
    });
  }

  function serialize() {
    return JSON.stringify({
      schemaVersion: 1,
      policy,
      events
    });
  }

  function exportDesign(key) {
    const lineage = ancestry(key);
    if (lineage.some(design => design.state !== 'published' || design.privacy !== 'public')) fail('Only public reviewed and licensed designs can be shared');
    const body = {
      format: 'matumbo-reviewed-design-v1',
      rootKey: key,
      designs: lineage.map(({
        id,
        version,
        key: versionKey,
        creator,
        category,
        title,
        descriptor,
        descriptorHash,
        parents,
        license
      }) => ({
        id,
        version,
        key: versionKey,
        creator,
        category,
        title,
        descriptor,
        descriptorHash,
        parents,
        license
      }))
    };
    return JSON.stringify({
      ...body,
      packetHash: hash(body)
    });
  }

  function restore(serialized) {
    if (busy) fail('Creator restore cannot reenter a transition', 'CREATOR_REENTRY');
    if (events.length || designs.size) fail('Restore requires a fresh creator economy');
    if (typeof serialized !== 'string' || serialized.length > 4000000) fail('Invalid creator export size');
    const input = JSON.parse(serialized);
    fields(input, ['schemaVersion', 'policy', 'events'], 'creator export');
    if (input.schemaVersion !== 1 || !same(input.policy, policy) || !Array.isArray(input.events) || input.events.length > LIMIT) fail('Incompatible creator export');
    // Replay in a separate instance makes malformed import atomic. Receipt and
    // observation verification are repeated; a checksum is not an authority.
    const replay = createCreatorEconomy({
      ...policy,
      observationVerifier,
      payoutVerifier,
      settlementJournalCount
    });
    busy = true;
    try {
      const methods = {
        registerDesign: replay.registerDesign,
        publish: replay.publish,
        recordUsage: replay.recordUsage,
        planPayout: replay.planPayout,
        cancelPayout: replay.cancelPayout,
        acknowledgePayout: replay.acknowledgePayout,
        markSettlementReview: internalStates.get(replay).markSettlementReview
      };
      let previous = 'CREATOR-GENESIS';
      input.events.forEach((event, index) => {
        fields(event, ['sequence', 'method', 'input', 'resultHash', 'previousHash', 'hash'], 'history event');
        const {
          hash: recorded,
          ...body
        } = event;
        if (event.sequence !== index + 1 || event.previousHash !== previous || recorded !== hash(body) || !methods[event.method]) fail('Creator history integrity check failed');
        methods[event.method](event.input);
        previous = recorded;
      });
      if (!same(JSON.parse(replay.serialize()).events, input.events)) fail('Creator replay did not reproduce exported history');
      // Copy the fully validated replay. Calling verifier callbacks a second time
      // would introduce a new failure boundary and could leave a partial import.
      const validated = internalStates.get(replay);
      for (const name of ['designs', 'usages', 'entitlements', 'plans', 'idem']) {
        const target = {
          designs,
          usages,
          entitlements,
          plans,
          idem
        } [name];
        for (const [key, value] of validated[name]) target.set(key, value);
      }
      for (const name of ['evidenceIds', 'sessionKeys', 'actorDesignPeriods']) {
        const target = {
          evidenceIds,
          sessionKeys,
          actorDesignPeriods
        } [name];
        for (const value of validated[name]) target.add(value);
      }
      events.push(...validated.events);
      return snapshot();
    } finally {
      busy = false;
    }
  }
  const api = Object.freeze({
    registerDesign,
    publish,
    recordUsage,
    planPayout,
    cancelPayout,
    acknowledgePayout,
    commitPayout,
    snapshot,
    serialize,
    restore,
    exportDesign
  });
  internalStates.set(api, {
    designs,
    usages,
    entitlements,
    plans,
    idem,
    events,
    evidenceIds,
    sessionKeys,
    actorDesignPeriods,
    markSettlementReview
  });
  return api;
}
