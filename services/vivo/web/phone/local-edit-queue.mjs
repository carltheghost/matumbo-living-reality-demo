/**
 * Serializes local hand edits while fencing commands that have not yet been
 * submitted. A command already handed to the engine is allowed to finish,
 * but its post-submit rebase is suppressed after stop/fork/contact loss.
 */
export class LocalEditQueue {
  constructor() {
    this.tail = Promise.resolve();
    this.stopped = false;
  }
  stop() {
    this.stopped = true;
  }
  enqueue({ submit, afterSubmit = null } = {}) {
    if (typeof submit !== 'function') throw new TypeError('Local edit submitter is required');
    const run = this.tail.then(async () => {
      if (this.stopped) return { status: 'fenced', submitted: false };
      const result = await submit();
      if (this.stopped) return { status: 'submitted-fenced', submitted: true, result };
      if (typeof afterSubmit === 'function') await afterSubmit(result);
      return { status: 'accepted', submitted: true, result };
    });
    this.tail = run.catch(() => {});
    return run;
  }
}
