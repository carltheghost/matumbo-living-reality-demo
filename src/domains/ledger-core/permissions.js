/**
 * Permissions and AI autonomy (ledger-core).
 *
 * Ported from TumboAgent PR #6 (`matumbo/core/permissions.py`, tag
 * archive/pr-6-claude-matumbo-master-spec-mz1vv4).
 *
 * Two things live here:
 *
 *   * A small role-based policy engine. Humans and AI agents go through
 *     the *same* permission system; agents just get stricter budgets.
 *
 *   * The Apollo autonomy ladder A0..A5. Money movement and destructive
 *     actions are gated: an agent below the required level cannot perform
 *     them, and A4+ always requires an explicit human approval token.
 *
 * This complements the tree's policy.js (SIMULATION_POLICY); it does not
 * weaken it. Simulation-only: nothing here authorizes real money movement.
 */

export class PermissionDenied extends Error {}

/** Roles. Mirrors the spec's role table. */
export const Role = Object.freeze({
  GUEST: "guest",
  VERIFIED_HUMAN: "verified_human",
  CREATOR: "creator",
  PLAYER: "player",
  MERCHANT: "merchant",
  DEVELOPER: "developer",
  MODERATOR: "moderator",
  VALIDATOR: "validator",
  GOVERNOR: "governor",
  ADMINISTRATOR: "administrator",
  AI_AGENT: "ai_agent",
});

/** Capability -> roles allowed to hold it. */
const CAPABILITIES = new Map([
  ["wallet.read", new Set(Object.values(Role))],
  [
    "wallet.send",
    new Set([
      Role.VERIFIED_HUMAN,
      Role.CREATOR,
      Role.PLAYER,
      Role.MERCHANT,
      Role.DEVELOPER,
      Role.AI_AGENT,
    ]),
  ],
  [
    "wallet.escrow",
    new Set([Role.VERIFIED_HUMAN, Role.MERCHANT, Role.PLAYER, Role.AI_AGENT]),
  ],
  ["market.read", new Set(Object.values(Role))],
  ["moderation.act", new Set([Role.MODERATOR, Role.ADMINISTRATOR])],
  ["governance.vote", new Set([Role.VERIFIED_HUMAN, Role.GOVERNOR])],
  ["admin.act", new Set([Role.ADMINISTRATOR])],
]);

/** Apollo autonomy ladder (spec 19.4). */
export const AutonomyLevel = Object.freeze({
  A0_OBSERVE: 0,
  A1_SUGGEST: 1,
  A2_PREPARE: 2,
  A3_EXECUTE_REVERSIBLE: 3,
  A4_EXECUTE_GUARDED: 4,
  A5_EMERGENCY: 5,
});

/** Minimum autonomy level required to perform a kind of action autonomously. */
const ACTION_MIN_LEVEL = new Map([
  ["read", AutonomyLevel.A0_OBSERVE],
  ["suggest", AutonomyLevel.A1_SUGGEST],
  ["draft", AutonomyLevel.A2_PREPARE],
  ["reversible_money", AutonomyLevel.A3_EXECUTE_REVERSIBLE],
  ["high_impact_money", AutonomyLevel.A4_EXECUTE_GUARDED],
  ["emergency_pause", AutonomyLevel.A5_EMERGENCY],
]);

/** Actions that always require an explicit human approval token, even at A5. */
const REQUIRES_APPROVAL = new Set(["high_impact_money", "emergency_pause"]);

/**
 * Anyone acting on the system — a human, an org, or an AI agent.
 * For AI agents: autonomy level and a spending budget in base units (BigInt).
 */
export class Principal {
  /**
   * @param {string} principalId
   * @param {string} role - one of Role
   * @param {object} [opts]
   * @param {number} [opts.autonomy] - AutonomyLevel, default A0_OBSERVE
   * @param {bigint} [opts.budgetUnits] - spending budget in base units
   */
  constructor(principalId, role, { autonomy = AutonomyLevel.A0_OBSERVE, budgetUnits = 0n } = {}) {
    if (typeof principalId !== "string" || principalId.trim() === "") {
      throw new TypeError("principalId must be a non-empty string");
    }
    if (!Object.values(Role).includes(role)) {
      throw new TypeError(`unknown role: ${role}`);
    }
    if (typeof budgetUnits !== "bigint") {
      throw new TypeError("budgetUnits must be BigInt base units");
    }
    this.principalId = principalId;
    this.role = role;
    this.autonomy = autonomy;
    this.budgetUnits = budgetUnits;
    this.spentUnits = 0n;
  }

  get remainingBudget() {
    return this.budgetUnits - this.spentUnits;
  }
}

/** Answers: may this principal do this? Never fabricates a yes. */
export class PolicyEngine {
  can(principal, capability) {
    const allowed = CAPABILITIES.get(capability);
    return Boolean(allowed && allowed.has(principal.role));
  }

  require(principal, capability) {
    if (!this.can(principal, capability)) {
      throw new PermissionDenied(
        `${principal.role} lacks capability '${capability}'`
      );
    }
  }

  /**
   * Gate an AI/agent action by autonomy level, budget, and approval.
   * Raises PermissionDenied on any failure. This is the boundary AI must
   * never be able to move on its own.
   *
   * @param {Principal} principal
   * @param {string} actionKind - one of the ACTION_MIN_LEVEL keys
   * @param {object} [opts]
   * @param {bigint} [opts.amountUnits] - spend against the principal's budget
   * @param {string|null} [opts.approvalToken] - explicit human approval
   */
  authorizeAction(principal, actionKind, { amountUnits = 0n, approvalToken = null } = {}) {
    const minLevel = ACTION_MIN_LEVEL.get(actionKind);
    if (minLevel === undefined) {
      throw new PermissionDenied(`unknown action kind '${actionKind}'`);
    }
    if (principal.autonomy < minLevel) {
      throw new PermissionDenied(
        `autonomy ${principal.autonomy} < required ${minLevel} for '${actionKind}'`
      );
    }
    if (REQUIRES_APPROVAL.has(actionKind) && !approvalToken) {
      throw new PermissionDenied(
        `action '${actionKind}' requires an explicit human approval token`
      );
    }
    if (typeof amountUnits !== "bigint") {
      throw new TypeError("amountUnits must be BigInt base units");
    }
    if (amountUnits !== 0n) {
      if (amountUnits > principal.remainingBudget) {
        throw new PermissionDenied(
          `amount ${amountUnits} exceeds remaining budget ${principal.remainingBudget}`
        );
      }
      principal.spentUnits += amountUnits;
    }
  }
}
