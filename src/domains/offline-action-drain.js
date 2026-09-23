export function createOfflineActionDrain(queue, { execute, onEvent } = {}) {
  if (!queue || typeof queue.peek !== "function" || typeof queue.ack !== "function") {
    throw new TypeError("A compatible offline action queue is required");
  }

  if (typeof execute !== "function") {
    throw new TypeError("execute must be a function");
  }

  const emit = typeof onEvent === "function" ? onEvent : () => {};

  let paused = false;
  let draining = false;
  let drainPromise = null;

  let stats = {
    attempted: 0,
    acknowledged: 0,
    retried: 0,
    deadLettered: 0,
  };

  const deadLetterStore = [];

  function getStats() {
    return {
      ...stats,
      queued: queue.size(),
      deadLetters: deadLetterStore.length,
      paused,
      draining,
    };
  }

  function deadLetters() {
    return deadLetterStore.map((entry) => ({
      ...entry,
      action: { ...entry.action },
    }));
  }

  function isRetryable(resultOrError) {
    return Boolean(
      resultOrError &&
      typeof resultOrError === "object" &&
      resultOrError.retryable === true,
    );
  }

  async function processAction(action) {
    emit({
      type: "queued",
      action: { ...action },
    });

    emit({
      type: "attempting",
      action: { ...action },
    });

    stats.attempted += 1;

    let result;

    try {
      result = await execute({ ...action });
    } catch (error) {
      result = {
        ok: false,
        retryable: isRetryable(error),
        error,
      };
    }

    if (result && result.ok === true) {
      queue.ack(action.id);

      stats.acknowledged += 1;

      emit({
        type: "acknowledged",
        action: { ...action },
        result,
      });

      return "acknowledged";
    }

    if (isRetryable(result)) {
      const current = queue.peek();

      if (!current || current.id !== action.id) {
        throw new Error(
          `Queue head changed while retrying action ${action.id}`,
        );
      }

      queue.ack(action.id);

      const retriedAction = queue.enqueue({
        idempotencyKey: action.idempotencyKey,
        type: action.type,
        payload: action.payload,
        createdAt: action.createdAt,
        attempts: action.attempts + 1,
      });

      stats.retried += 1;

      emit({
        type: "queued",
        reason: "retry",
        action: { ...retriedAction },
        previousAction: { ...action },
        result,
      });

      return "retry";
    }

    const current = queue.peek();

    if (!current || current.id !== action.id) {
      throw new Error(
        `Queue head changed while dead-lettering action ${action.id}`,
      );
    }

    queue.ack(action.id);

    const deadLetter = {
      action: {
        ...action,
        attempts: action.attempts + 1,
      },
      result,
    };

    deadLetterStore.push(deadLetter);
    stats.deadLettered += 1;

    emit({
      type: "dead-lettered",
      ...deadLetter,
    });

    return "dead-lettered";
  }

  async function runDrain() {
    while (!paused) {
      const action = queue.peek();

      if (!action) {
        break;
      }

      await processAction(action);
    }

    return getStats();
  }

  function drain() {
    if (draining) {
      return drainPromise;
    }

    draining = true;

    drainPromise = Promise.resolve()
      .then(runDrain)
      .finally(() => {
        draining = false;
        drainPromise = null;
      });

    return drainPromise;
  }

  function pause() {
    paused = true;

    emit({
      type: "paused",
      stats: getStats(),
    });

    return getStats();
  }

  function resume() {
    paused = false;

    emit({
      type: "resumed",
      stats: getStats(),
    });

    return drain();
  }

  return Object.freeze({
    drain,
    pause,
    resume,
    getStats,
    deadLetters,
  });
}