const QUEUE_KEY = "matumbo_offline_action_queue_v1";

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function enqueueOfflineAction(action) {
  const queue = readQueue();

  queue.push({
    ...action,
    queuedAt: Date.now(),
  });

  writeQueue(queue);
}

export function getOfflineActions() {
  return readQueue();
}

export function drainOfflineActions(applyAction) {
  const queue = readQueue();
  const remaining = [];

  for (const action of queue) {
    try {
      applyAction(action);
    } catch {
      remaining.push(action);
    }
  }

  writeQueue(remaining);
  return {
    applied: queue.length - remaining.length,
    remaining: remaining.length,
  };
}
