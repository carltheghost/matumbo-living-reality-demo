/** Bounded conversation between explicitly selected, connected residents.
 * Adapters own authentication and model selection. This module grants no world
 * tools, executes no model output and does not persist or restart a session.
 */
export function createSocialRoom({ residents, resolveConnection, onChange = () => {}, timeoutMs = 60000 } = {}) {
  if (!Array.isArray(residents) || residents.length < 2 || typeof resolveConnection !== 'function') throw new Error('Social room requires residents and a connection resolver.');
  const roster = residents.map(({ id, name }) => ({ id, name }));
  if (roster.some(r => typeof r.id !== 'string' || !r.id || typeof r.name !== 'string' || !r.name) || new Set(roster.map(r => r.id)).size !== roster.length) throw new Error('Resident identities must be unique.');
  let state = { status: 'idle', topic: '', participants: [], limit: 0, turns: 0, speaker: null, messages: [], reason: '' };
  let epoch = 0, controller = null, disposed = false;
  const snapshot = () => structuredClone(state);
  const notify = () => { try { onChange(snapshot()); } catch { /* A view cannot change scheduling. */ } };
  function stop(reason = 'Stopped by you') {
    if (state.status !== 'running') return;
    epoch++;
    controller?.abort();
    controller = null;
    state.status = 'stopped'; state.speaker = null; state.reason = reason;
    notify();
  }
  function connection(id) {
    const value = resolveConnection(id);
    if (!value || value.connected !== true || typeof value.respond !== 'function' || typeof value.key !== 'string' || !value.key) throw new Error('Resident connection unavailable');
    return value;
  }
  async function start({ participants, topic, maxTurns = 6 } = {}) {
    if (disposed || state.status === 'running') throw new Error('Social room is unavailable or already running.');
    if (!Array.isArray(participants) || participants.length < 2 || new Set(participants).size !== participants.length || participants.some(id => !roster.some(r => r.id === id))) throw new Error('Choose at least two different residents.');
    if (typeof topic !== 'string' || !topic.trim() || topic.length > 400) throw new Error('Choose a topic of 1–400 characters.');
    if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 12) throw new Error('Choose 1–12 total turns.');
    const selected = [...participants];
    const keys = new Map(selected.map(id => [id, connection(id).key]));
    const run = ++epoch;
    state = { status: 'running', topic: topic.trim(), participants: selected, limit: maxTurns, turns: 0, speaker: null, messages: [], reason: '' };
    notify();
    for (let turn = 0; turn < maxTurns && epoch === run; turn++) {
      const resident = roster.find(r => r.id === selected[turn % selected.length]);
      let timer, abortListener;
      const pending = new AbortController(); controller = pending;
      try {
        // Pin all selected connections for the entire run, including between replies.
        for (const id of selected) if (connection(id).key !== keys.get(id)) throw new Error('Connection changed');
        const adapter = connection(resident.id);
        state.speaker = resident.id; notify();
        if (epoch !== run) break;
        const cancelled = new Promise((_, reject) => {
          abortListener = () => reject(new Error('Stopped'));
          pending.signal.addEventListener('abort', abortListener, { once: true });
          timer = setTimeout(() => { reject(new Error('Response timed out')); pending.abort(); }, timeoutMs);
        });
        const response = await Promise.race([
          Promise.resolve().then(() => {
            if (pending.signal.aborted) throw new Error('Stopped');
            return adapter.respond({ resident: { ...resident }, participants: selected.map(id => ({ ...roster.find(r => r.id === id) })), topic: state.topic, transcript: structuredClone(state.messages), signal: pending.signal });
          }), cancelled,
        ]);
        if (epoch !== run) break;
        for (const id of selected) if (connection(id).key !== keys.get(id)) throw new Error('Connection changed');
        const text = typeof response === 'string' ? response : response?.text;
        if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Error('Invalid response');
        state.messages.push({ residentId: resident.id, name: resident.name, text: text.trim(), turn: turn + 1 });
        state.turns++; state.speaker = null; notify();
      } catch {
        if (epoch === run) { state.status = 'blocked'; state.speaker = null; state.reason = 'A connection changed, failed, or timed out. Check accounts before starting again.'; notify(); }
        break;
      } finally {
        clearTimeout(timer);
        pending.signal.removeEventListener('abort', abortListener);
        if (controller === pending) controller = null;
      }
    }
    if (epoch === run && state.status === 'running') { state.status = 'complete'; state.speaker = null; state.reason = 'Turn limit reached'; notify(); }
    return snapshot();
  }
  return { start, stop, snapshot, destroy() { stop('Room closed'); disposed = true; } };
}
