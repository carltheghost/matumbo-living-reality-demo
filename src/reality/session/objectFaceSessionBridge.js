/**
 * Bridge between object faces and portal sessions.
 *
 * Account A owns the physical face-mapping system.
 * This module only provides the data that a face texture should display.
 */

import {
  openPortalSession,
  closePortalSession,
  resumePortalSession,
  getFacePayload
} from "./portalSessionManager.js";

export function attachSessionToObject(objectId, source) {
  return openPortalSession(objectId, source);
}

export function dismissObjectSession(objectId) {
  return closePortalSession(objectId);
}

export function restoreObjectSession(objectId) {
  return resumePortalSession(objectId);
}

export function renderObjectFaceSession(objectId) {
  return getFacePayload(objectId);
}
