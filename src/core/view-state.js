import {
  SAMPLE_CONTRIBUTIONS,
  SAMPLE_UPDATED_AT,
  assembleWorldState,
} from "./world-state.js";

export const PROJECTION_ENVELOPE_SCHEMA_VERSION = 1;

/**
 * Build the renderer-facing projection envelope. This function is pure: it
 * assembles local data and provides no wallet, signing, settlement, or gateway
 * execution surface.
 */
export function createProjectionEnvelope({ contributions = [], projectedAt }) {
  if (typeof projectedAt !== "string" || projectedAt.trim() === "") {
    throw new TypeError("projectedAt must be a non-empty string");
  }

  return Object.freeze({
    schemaVersion: PROJECTION_ENVELOPE_SCHEMA_VERSION,
    kind: "simfabric.projection-envelope",
    simulation: true,
    authority: "none",
    projectedAt,
    world: assembleWorldState(contributions),
  });
}

export const SAMPLE_VIEW_STATE = createProjectionEnvelope({
  contributions: SAMPLE_CONTRIBUTIONS,
  projectedAt: SAMPLE_UPDATED_AT,
});
