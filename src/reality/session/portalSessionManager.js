/**
 * Portal Session Lifecycle
 *
 * Owns live session state for Reality Lens objects.
 * Stores only opaque handles. No credentials, tokens, cookies, or raw auth data.
 *
 * The object owns the session. The face renderer only consumes the safe session view.
 */

const sessions = new Map();

function createOpaqueHandle() {
  return `session_${crypto.randomUUID()}`;
}

export function openPortalSession(objectId, source) {
  const existing = sessions.get(objectId);

  if (existing) {
    existing.open = true;
    return existing;
  }

  const session = {
    objectId,
    handle: createOpaqueHandle(),
    sourceType: source?.type || "unknown",
    sourceRef: source?.ref || null,
    open: true,
    createdAt: Date.now(),
    lastOpenedAt: Date.now()
  };

  sessions.set(objectId, session);

  return session;
}

export function closePortalSession(objectId) {
  const session = sessions.get(objectId);

  if (!session) {
    return null;
  }

  session.open = false;

  return session;
}

export function resumePortalSession(objectId) {
  const session = sessions.get(objectId);

  if (!session) {
    return null;
  }

  session.open = true;
  session.lastOpenedAt = Date.now();

  return session;
}

export function getPortalSession(objectId) {
  return sessions.get(objectId) || null;
}

export function getFacePayload(objectId) {
  const session = sessions.get(objectId);

  if (!session) {
    return {
      mode: "empty",
      content: null
    };
  }

  return {
    mode: session.open ? "live" : "stored",
    content: {
      sessionHandle: session.handle,
      sourceType: session.sourceType,
      sourceRef: session.sourceRef
    }
  };
}

export function removePortalSession(objectId) {
  sessions.delete(objectId);
}
