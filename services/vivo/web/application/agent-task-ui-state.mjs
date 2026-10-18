/** Small pure helpers for the remote task evidence surface. */

export function mergeAgentTaskRows(rows, details) {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => {
    const detail = details instanceof Map ? details.get(row?.taskId) : null;
    if (!detail) return row;
    // List rows are the current summary authority. Detail responses can be
    // older because an evidence request and polling overlap; only carry the
    // event journal across when both representations name the same revision.
    const merged = {...row};
    if (detail.version === row.version && Array.isArray(detail.events)) {
      merged.events = detail.events;
    }
    return merged;
  });
}

export function shouldAcceptAgentTaskDetail(previous, next) {
  if (!next) return false;
  if (!previous) return true;
  if (Number.isInteger(previous.version) && Number.isInteger(next.version)) {
    return next.version >= previous.version;
  }
  return true;
}

export function isCurrentAgentResponse(generation, currentGeneration, client, currentClient) {
  return generation === currentGeneration && client === currentClient && Boolean(client) && !client.closed;
}

export function submissionFingerprint(body) {
  return JSON.stringify({
    goal: body?.goal ?? '',
    permissions: body?.permissions ?? [],
    toolCall: body?.toolCall ?? null,
  });
}
