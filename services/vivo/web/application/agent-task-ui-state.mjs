/** Small pure helpers for the remote task evidence surface. */

export function mergeAgentTaskRows(rows, details) {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => {
    const detail = details instanceof Map ? details.get(row?.taskId) : null;
    return detail ? {...row, ...detail} : row;
  });
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
