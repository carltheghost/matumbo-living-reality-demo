/**
 * Experimental absolute-target transport component, NOT wired into Viva 0.8.1.
 *
 * The caller owns authorization, room/chart transforms, collision, force limits,
 * prediction reconciliation and lease release. This class does not implement them.
 *
 * One acknowledged command at a time, at most one coalesced pending target. This
 * retains the most recent absolute desired position without retaining an old
 * trajectory backlog. Absolute targets require a new validated server endpoint;
 * do NOT send this payload to the old relative `move` endpoint.
 */
export class TargetMailbox {
  constructor({send, preview = () => {}, status = () => {}, now = () => performance.now(), maxAgeMs = 150}) {
    if (typeof send !== 'function' || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw Error('Invalid mailbox configuration');
    this.send = send; this.preview = preview; this.status = status; this.now = now;
    this.maxAgeMs = maxAgeMs; this.epoch = 0; this.flight = null; this.pending = null;
    this.active = false; this.blocked = false; this.sequence = 0;
  }
  begin({entity, dimension, revision}) {
    if (this.flight) throw Error('Reconcile previous in-flight command before a new grab');
    if (this.active) throw Error('End the current grab before starting another');
    if (!entity || !Number.isInteger(dimension) || dimension < 3 || dimension > 11 || !Number.isInteger(revision) || revision < 0) throw Error('Invalid grab state');
    this.epoch++; this.entity = entity; this.dimension = dimension; this.revision = revision;
    this.active = true; this.blocked = false; this.pending = null; this.sequence = 0;
  }
  offer(position, observedAt = this.now()) {
    if (!this.active || this.blocked) return false;
    if (!Array.isArray(position) || position.length !== this.dimension || position.some(x => !Number.isFinite(x) || Math.abs(x) > 1000)) throw Error('Invalid full-dimensional target');
    const age = this.now() - observedAt;
    if (!Number.isFinite(observedAt) || age < -5 || age > this.maxAgeMs) return false;
    this.pending = {entity: this.entity, position: position.slice(), observedAt, sequence: ++this.sequence};
    // This callback displays a provisional intent/handle, NOT accepted shared state.
    this.preview({position: position.slice(), committed: false, sequence: this.sequence});
    this.pump(); return true;
  }
  pump() {
    if (!this.active || this.blocked || this.flight || !this.pending) return;
    const target = this.pending; this.pending = null;
    if (this.now() - target.observedAt > this.maxAgeMs) { this.status('stale-pending-target-discarded'); return; }
    const epoch = this.epoch;
    const message = {...target, type: 'grab_target', expectedRevision: this.revision, epoch};
    const token = {}; this.flight = token;
    Promise.resolve().then(() => this.send(message)).then(ack => {
      if (epoch !== this.epoch || !this.active) return;
      if (!ack || !Number.isInteger(ack.revision) || ack.revision <= this.revision) throw Error('Invalid acknowledgement; reconcile');
      this.revision = ack.revision;
    }).catch(error => {
      if (epoch !== this.epoch) return;
      // The command might already have committed. Never blindly retry it.
      this.blocked = true; this.pending = null;
      this.status('reconcile-required: ' + error.message);
    }).finally(() => {
      if (this.flight === token) this.flight = null;
      if (epoch === this.epoch) this.pump();
    });
  }
  cancel(reason = 'input-ended') {
    this.active = false; this.pending = null; this.epoch++;
    this.status(reason + '; caller must release lease and reconcile any in-flight commit');
  }
}
