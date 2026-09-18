/**
 * T402 offer and value-routing rehearsals for local presentation only.
 * This module cannot hold, move, sign, settle, or publish value. Every request
 * for live movement is represented as a denial and causes no side effect.
 */

export const T402_SCHEMA_VERSION = 1;
export const T402_SOURCE = "t402-value-routing";

export const OfferState = Object.freeze({
  OPEN: "open",
  PAUSED: "paused",
  CLOSED: "closed",
});

export const RouteState = Object.freeze({
  REHEARSAL_READY: "rehearsal-ready",
  REHEARSAL_BLOCKED: "rehearsal-blocked",
});

export const EscrowRehearsalState = Object.freeze({
  HELD: "simulated-held",
  RELEASED: "simulated-released",
  RETURNED: "simulated-returned",
});

const OFFER_STATES = new Set(Object.values(OfferState));
const ESCROW_STATES = new Set(Object.values(EscrowRehearsalState));

export const T402_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "t402-project-offers-routes-escrow",
    label: "Project fictional offers, routes, and escrow rehearsals",
    enabled: true,
    mode: "local-projection",
    authority: "none",
  }),
  Object.freeze({
    id: "t402-live-value-movement",
    label: "Move, custody, sign, release, transfer, or settle live value",
    enabled: false,
    mode: "denied",
    authority: "none",
  }),
]);

function requireRecord(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function requireAmount(value, field) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite, non-negative number`);
  }
  return value;
}

function requireEnum(value, allowed, field) {
  if (!allowed.has(value)) throw new TypeError(`Unknown ${field}: ${String(value)}`);
  return value;
}

function requireUniqueIds(records) {
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) throw new TypeError(`Duplicate entity id: ${record.id}`);
    seen.add(record.id);
  }
}

function normalizeOffer(offer) {
  requireRecord(offer, "offer");
  return Object.freeze({
    id: requireString(offer.id, "offer.id"),
    kind: "t402-offer",
    label: requireString(offer.label, "offer.label"),
    unit: requireString(offer.unit, "offer.unit"),
    simulatedAmount: requireAmount(offer.simulatedAmount, "offer.simulatedAmount"),
    state: requireEnum(offer.state, OFFER_STATES, "offer state"),
    simulation: true,
    executable: false,
  });
}

function normalizeRoute(route, offersById) {
  requireRecord(route, "route");
  const offerId = requireString(route.offerId, "route.offerId");
  const offer = offersById.get(offerId);
  if (!offer) throw new TypeError(`Route references unknown offer: ${offerId}`);
  const from = requireString(route.from, "route.from");
  const to = requireString(route.to, "route.to");
  if (from === to) throw new TypeError(`Route endpoints must differ: ${String(route.id)}`);
  const state = offer.state === OfferState.OPEN
    ? RouteState.REHEARSAL_READY
    : RouteState.REHEARSAL_BLOCKED;
  return Object.freeze({
    id: requireString(route.id, "route.id"),
    kind: "t402-route-rehearsal",
    offerId,
    from,
    to,
    unit: offer.unit,
    simulatedAmount: offer.simulatedAmount,
    state,
    reason: state === RouteState.REHEARSAL_BLOCKED ? "offer-not-open" : null,
    simulation: true,
    executable: false,
  });
}

function normalizeEscrow(rehearsal, routesById) {
  requireRecord(rehearsal, "escrowRehearsal");
  const routeId = requireString(rehearsal.routeId, "escrowRehearsal.routeId");
  const route = routesById.get(routeId);
  if (!route) throw new TypeError(`Escrow rehearsal references unknown route: ${routeId}`);
  return Object.freeze({
    id: requireString(rehearsal.id, "escrowRehearsal.id"),
    kind: "t402-escrow-rehearsal",
    routeId,
    unit: route.unit,
    simulatedAmount: route.simulatedAmount,
    state: requireEnum(rehearsal.state, ESCROW_STATES, "escrow rehearsal state"),
    simulation: true,
    custody: false,
    executable: false,
  });
}

function denyLiveMovement(request) {
  requireRecord(request, "liveMovementRequest");
  return Object.freeze({
    id: requireString(request.id, "liveMovementRequest.id"),
    kind: "t402-live-movement-denial",
    requestedAction: requireString(request.action, "liveMovementRequest.action"),
    status: "denied",
    reason: "local-projection-has-no-live-value-authority",
    simulation: true,
    executed: false,
    authority: "none",
  });
}

/** Build a deterministic, side-effect-free T402 projection contribution. */
export function createT402Contribution({
  updatedAt,
  offers = [],
  routes = [],
  escrowRehearsals = [],
  liveMovementRequests = [],
}) {
  requireString(updatedAt, "updatedAt");
  if (![offers, routes, escrowRehearsals, liveMovementRequests].every(Array.isArray)) {
    throw new TypeError(
      "offers, routes, escrowRehearsals, and liveMovementRequests must be arrays",
    );
  }

  const normalizedOffers = offers.map(normalizeOffer);
  const offersById = new Map(normalizedOffers.map((offer) => [offer.id, offer]));
  const normalizedRoutes = routes.map((route) => normalizeRoute(route, offersById));
  const routesById = new Map(normalizedRoutes.map((route) => [route.id, route]));
  const normalizedEscrows = escrowRehearsals.map((item) =>
    normalizeEscrow(item, routesById));
  const denials = liveMovementRequests.map(denyLiveMovement);
  const entities = [
    ...normalizedOffers,
    ...normalizedRoutes,
    ...normalizedEscrows,
    ...denials,
  ];
  requireUniqueIds(entities);

  return Object.freeze({
    schemaVersion: T402_SCHEMA_VERSION,
    source: T402_SOURCE,
    simulation: true,
    updatedAt,
    entities: Object.freeze(entities),
    evidence: Object.freeze([
      Object.freeze({
        id: `t402-boundary:${updatedAt}`,
        kind: "simulation-boundary",
        status: "enforced",
        simulation: true,
        liveValueMovement: "denied",
        custody: false,
        signing: false,
        settlement: false,
        externalProviders: false,
      }),
    ]),
    capabilities: T402_CAPABILITIES,
  });
}
