const SCHEMA_VERSION = 1;
const SOURCE = "person-profile";
const UPDATED_AT = "2025-01-01T00:00:00.000Z";

/**
 * Capability labels describe what this local projection may present. They do
 * not grant authentication, identity-provider, credential, or execution
 * authority.
 */
export const PROFILE_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "profile.display-name",
    label: "Display a consented simulation name",
    enabled: true,
    authority: "local-projection",
  }),
  Object.freeze({
    id: "profile.pronouns",
    label: "Display consented pronouns",
    enabled: true,
    authority: "local-projection",
  }),
  Object.freeze({
    id: "profile.presence",
    label: "Project a simulated presence state",
    enabled: true,
    authority: "local-projection",
  }),
  Object.freeze({
    id: "profile.external-identity",
    label: "Collect or resolve an external identity",
    enabled: false,
    authority: "denied",
  }),
  Object.freeze({
    id: "profile.authentication",
    label: "Authenticate or authorize a person",
    enabled: false,
    authority: "denied",
  }),
]);

const explicitConsent = (scope, granted, recordedAt = UPDATED_AT) =>
  Object.freeze({
    scope,
    granted,
    method: "explicit-simulation-choice",
    recordedAt,
    revocable: true,
  });

const visualGenome = ({
  identitySeed,
  primary,
  accent,
  aura,
  shapeFamily,
  cellPattern,
  motionPattern,
  connectionStyle,
}) =>
  Object.freeze({
    identitySeed,
    primary,
    accent,
    aura,
    shapeFamily,
    cellPattern,
    motionPattern,
    connectionStyle,
  });

const semanticCell = (label, kind) => Object.freeze({ label, kind });

const profileEntity = ({
  id,
  displayName,
  pronouns,
  presence,
  position,
  genome,
  cells,
}) =>
  Object.freeze({
    id,
    type: "person-profile",
    simulation: true,
    fictional: true,
    attributes: Object.freeze({ displayName, pronouns, presence }),
    consent: Object.freeze({
      displayName: explicitConsent("displayName", true),
      pronouns: explicitConsent("pronouns", true),
      presence: explicitConsent("presence", true),
      externalIdentityCollection: explicitConsent(
        "externalIdentityCollection",
        false,
      ),
    }),
    // This is visual projection data only. It describes a persistent aesthetic
    // signature, not a biometric identity, profile authority, or real person.
    presentation: Object.freeze({
      kind: "person-organism",
      label: displayName,
      summary:
        "Fictional, consented local profile projected as an identity-specific block organism.",
      position: Object.freeze(position),
      visualGenome: genome,
      semanticCells: Object.freeze(cells),
    }),
  });

/**
 * Sample entities are fictional local state. Each projected personal field is
 * paired with the explicit consent record that permits its presentation. Their
 * color/material language is a stable digital world signature, never a proxy
 * for a person's race, body, or external identity.
 */
export const PROFILE_ENTITIES = Object.freeze([
  profileEntity({
    id: "profile:local-participant",
    displayName: "Local Participant",
    pronouns: "they/them",
    presence: "present",
    position: [-1.9, 0.2, 1.1],
    genome: visualGenome({
      identitySeed: "local-participant-omega",
      primary: "#e9ad58",
      accent: "#fff0bc",
      aura: "#563217",
      shapeFamily: "orbital-spire",
      cellPattern: "ascending-spiral",
      motionPattern: "tidal",
      connectionStyle: "consent-halo",
    }),
    cells: [
      semanticCell("CONSENT", "authority"),
      semanticCell("PRESENCE", "signal"),
      semanticCell("MEMORY", "history"),
    ],
  }),
  profileEntity({
    id: "profile:aster-thread",
    displayName: "Aster Thread",
    pronouns: "she/they",
    presence: "active",
    position: [2.05, 0.2, 1.35],
    genome: visualGenome({
      identitySeed: "aster-thread-omega",
      primary: "#64e5ff",
      accent: "#d7fbff",
      aura: "#123d55",
      shapeFamily: "branching-arc",
      cellPattern: "fan-arc",
      motionPattern: "radiant",
      connectionStyle: "signal-bridge",
    }),
    cells: [
      semanticCell("SIGNAL", "connection"),
      semanticCell("VOICE", "expression"),
      semanticCell("TRUST", "relation"),
    ],
  }),
  profileEntity({
    id: "profile:mira-vale",
    displayName: "Mira Vale",
    pronouns: "she/her",
    presence: "reflecting",
    position: [-0.35, 0.2, -1.35],
    genome: visualGenome({
      identitySeed: "mira-vale-omega",
      primary: "#b99aff",
      accent: "#f0e6ff",
      aura: "#38215f",
      shapeFamily: "layered-ring",
      cellPattern: "concentric-layers",
      motionPattern: "orbital",
      connectionStyle: "memory-lattice",
    }),
    cells: [
      semanticCell("CONTEXT", "memory"),
      semanticCell("CARE", "relation"),
      semanticCell("TRACE", "proof"),
    ],
  }),
  profileEntity({
    id: "profile:rowan-field",
    displayName: "Rowan Field",
    pronouns: "he/they",
    presence: "building",
    position: [0.15, 0.2, 3.3],
    genome: visualGenome({
      identitySeed: "rowan-field-omega",
      primary: "#75f3b1",
      accent: "#dcffe9",
      aura: "#164432",
      shapeFamily: "modular-cluster",
      cellPattern: "woven-grid",
      motionPattern: "growing",
      connectionStyle: "root-network",
    }),
    cells: [
      semanticCell("MAKING", "action"),
      semanticCell("BOND", "relation"),
      semanticCell("FUTURE", "intent"),
    ],
  }),
]);

export const profileProjection = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  source: SOURCE,
  simulation: true,
  updatedAt: UPDATED_AT,
  entities: PROFILE_ENTITIES,
  evidence: Object.freeze([
    Object.freeze({
      id: "profile-evidence:explicit-consent",
      type: "consent-record",
      entityId: "profile:local-participant",
      simulation: true,
      note: "Local fixture consent only; no identity was inferred or collected.",
    }),
    Object.freeze({
      id: "profile-evidence:visual-genomes",
      type: "projection-design-record",
      entityId: "profile:local-participant",
      simulation: true,
      note: "Visual genomes are deterministic fictional presentation data only.",
    }),
  ]),
  capabilities: PROFILE_CAPABILITIES,
});

export default profileProjection;
