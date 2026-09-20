/**
 * EchoProof — receipts for every high-impact action (ledger-core).
 *
 * Ported from TumboAgent PR #6 (`matumbo/core/echoproof.py`, tag
 * archive/pr-6-claude-matumbo-master-spec-mz1vv4).
 *
 * A Receipt records actor, realm, reference, before/after state hashes,
 * payload hash, sequence, timestamp, signer, verification state, and a
 * readable summary. In DEMO mode every receipt is stamped
 * "Local Demo Proof" — fabricating real proof hashes is forbidden.
 *
 * Receipts are hash-chained so tampering is detectable. Unlike the Python
 * original (whose verify_chain could only re-anchor linkage), this port
 * retains the before/after states internally so verifyChain() fully
 * recomputes every hash.
 *
 * Simulation-only: receipts are demo proofs, not attestations of real
 * value movement.
 */

import { contentHash } from "./events.js";

export const DEMO_STAMP = "Local Demo Proof";

/** A human-readable, hash-anchored receipt for one action. Immutable. */
export class Receipt {
  constructor({
    sequence,
    actorId,
    realm,
    reference,
    action,
    summary,
    beforeHash,
    afterHash,
    payloadHash,
    verificationState,
    signer,
    issuedAt,
    stamp = DEMO_STAMP,
  }) {
    this.sequence = sequence;
    this.actorId = actorId;
    this.realm = realm;
    this.reference = reference;
    this.action = action;
    this.summary = summary;
    this.beforeHash = beforeHash;
    this.afterHash = afterHash;
    this.payloadHash = payloadHash;
    this.verificationState = verificationState;
    this.signer = signer;
    this.issuedAt = issuedAt;
    this.stamp = stamp;
    Object.freeze(this);
  }

  toDict() {
    return { ...this };
  }

  human() {
    const short = (h) => String(h).slice(0, 12);
    return (
      `[${this.stamp}] #${this.sequence} ${this.realm}:${this.action}\n` +
      `  ${this.summary}\n` +
      `  actor=${this.actorId} ref=${this.reference} verify=${this.verificationState}\n` +
      `  before=${short(this.beforeHash)}… after=${short(this.afterHash)}… ` +
      `payload=${short(this.payloadHash)}…`
    );
  }
}

/** Issues and stores receipts, hash-chained so tampering is detectable. */
export class EchoProof {
  /** @param {string} [signer="matumbo-demo-node"] */
  constructor(signer = "matumbo-demo-node") {
    this._signer = signer;
    this._receipts = [];
    this._states = []; // internal: {beforeState, afterState} per receipt
  }

  /**
   * Issue a receipt for one action. beforeState/afterState are snapshotted
   * (as canonical JSON) so the chain can be fully re-verified later.
   */
  issue({
    actorId,
    realm,
    reference,
    action,
    summary,
    beforeState,
    afterState,
    payload,
    verificationState = "verified-demo",
  }) {
    const seq = this._receipts.length;
    const prevHash = seq === 0 ? "genesis" : this._receipts[seq - 1].afterHash;
    const receipt = new Receipt({
      sequence: seq,
      actorId,
      realm,
      reference,
      action,
      summary,
      beforeHash: contentHash({ prev: prevHash, state: beforeState }),
      afterHash: contentHash({ prev: prevHash, state: afterState }),
      payloadHash: contentHash(payload),
      verificationState,
      signer: this._signer,
      issuedAt: Date.now(),
    });
    this._receipts.push(receipt);
    this._states.push({ beforeState, afterState });
    return receipt;
  }

  all() {
    return [...this._receipts];
  }

  /**
   * Recompute the whole chain: every before/after hash must recompute from
   * the retained states, and every link must carry the previous afterHash.
   * @returns {boolean}
   */
  verifyChain() {
    let prevHash = "genesis";
    for (let i = 0; i < this._receipts.length; i++) {
      const r = this._receipts[i];
      const { beforeState, afterState } = this._states[i];
      if (r.sequence !== i) return false;
      if (r.beforeHash !== contentHash({ prev: prevHash, state: beforeState })) {
        return false;
      }
      if (r.afterHash !== contentHash({ prev: prevHash, state: afterState })) {
        return false;
      }
      prevHash = r.afterHash;
    }
    return true;
  }
}
