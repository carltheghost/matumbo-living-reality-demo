/** Local-only room and membership projections. Message content is out of scope. */

export const ROOMS_SCHEMA_VERSION = 1;
export const ROOMS_SOURCE = "spatial-rooms";

export const RoomContext = Object.freeze({
  PRIVATE: "private",
  SOCIAL: "social",
  CONTRACT: "contract",
  MARKET: "market",
  AI: "ai",
});

const ROOM_CONTEXTS = new Set(Object.values(RoomContext));
const MEMBERSHIP_ROLES = new Set(["owner", "member", "observer", "agent"]);

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function uniqueById(records, label) {
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) throw new TypeError(`Duplicate ${label} id: ${record.id}`);
    seen.add(record.id);
  }
}

function normalizeRoom(room) {
  if (!room || typeof room !== "object" || Array.isArray(room)) {
    throw new TypeError("room must be an object");
  }
  const id = requireString(room.id, "room.id");
  const label = requireString(room.label, "room.label");
  if (!ROOM_CONTEXTS.has(room.context)) {
    throw new TypeError(`Unknown room context: ${String(room.context)}`);
  }
  return Object.freeze({
    id,
    kind: "spatial-room",
    label,
    context: room.context,
    privacy: room.context === RoomContext.PRIVATE ? "private" : "members-only",
    simulation: true,
  });
}

function normalizeMembership(membership) {
  if (!membership || typeof membership !== "object" || Array.isArray(membership)) {
    throw new TypeError("membership must be an object");
  }
  const id = requireString(membership.id, "membership.id");
  const roomId = requireString(membership.roomId, "membership.roomId");
  const memberId = requireString(membership.memberId, "membership.memberId");
  if (!MEMBERSHIP_ROLES.has(membership.role)) {
    throw new TypeError(`Unknown membership role: ${String(membership.role)}`);
  }
  return Object.freeze({
    id,
    kind: "room-membership",
    roomId,
    memberId,
    role: membership.role,
    simulation: true,
  });
}

/**
 * Create the projection visible to one local viewer.
 *
 * Only rooms in which the viewer has an explicit membership are projected.
 * The returned schema deliberately has no message, payload, transcript, or
 * content field, keeping plaintext communication outside this domain boundary.
 */
export function createRoomsContribution({ updatedAt, viewerId, rooms = [], memberships = [] }) {
  requireString(updatedAt, "updatedAt");
  requireString(viewerId, "viewerId");
  if (!Array.isArray(rooms) || !Array.isArray(memberships)) {
    throw new TypeError("rooms and memberships must be arrays");
  }

  const normalizedRooms = rooms.map(normalizeRoom);
  const normalizedMemberships = memberships.map(normalizeMembership);
  uniqueById(normalizedRooms, "room");
  uniqueById(normalizedMemberships, "membership");

  const knownRoomIds = new Set(normalizedRooms.map(({ id }) => id));
  for (const membership of normalizedMemberships) {
    if (!knownRoomIds.has(membership.roomId)) {
      throw new TypeError(`Membership references unknown room: ${membership.roomId}`);
    }
  }

  const visibleRoomIds = new Set(
    normalizedMemberships
      .filter(({ memberId }) => memberId === viewerId)
      .map(({ roomId }) => roomId),
  );
  const visibleRooms = normalizedRooms.filter(({ id }) => visibleRoomIds.has(id));
  const visibleMemberships = normalizedMemberships.filter(({ roomId }) =>
    visibleRoomIds.has(roomId),
  );

  return Object.freeze({
    schemaVersion: ROOMS_SCHEMA_VERSION,
    source: ROOMS_SOURCE,
    simulation: true,
    updatedAt,
    entities: Object.freeze([...visibleRooms, ...visibleMemberships]),
    evidence: Object.freeze([
      Object.freeze({
        id: `rooms-scope:${viewerId}`,
        kind: "local-membership-filter",
        viewerId,
        visibleRoomIds: Object.freeze([...visibleRoomIds].sort()),
        status: "simulated",
      }),
    ]),
    capabilities: Object.freeze([
      Object.freeze({
        id: "rooms-observe-membership",
        mode: "projection",
        authority: "none",
      }),
    ]),
  });
}
