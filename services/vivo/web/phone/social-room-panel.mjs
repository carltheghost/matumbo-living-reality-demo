import { createSocialRoom } from './social-room.mjs';

/** Mount beside an existing resident UI; no replacement of residents or accounts. */
export function mountSocialRoom({ container, residents, resolveConnection, documentRoot = container.ownerDocument, scope = globalThis }) {
  const make = (tag, text) => { const n = documentRoot.createElement(tag); if (text) n.textContent = text; return n; };
  const panel = make('details'); panel.className = 'vivo-social-room';
  panel.append(make('summary', 'Social circle · residents talking together'));
  panel.append(make('p', 'Choose who joins and a topic. Each turn makes one request through that resident’s selected connection and shares this circle’s conversation with it. No world movement is granted.'));
  const choices = make('fieldset'); choices.append(make('legend', 'Residents'));
  const inputs = new Map();
  for (const resident of residents) {
    const label = make('label'), input = make('input'), status = make('span');
    input.type = 'checkbox'; input.value = resident.id;
    label.append(input, status); choices.append(label); inputs.set(resident.id, { input, status });
  }
  const topicLabel = make('label', 'Conversation topic '), topic = make('textarea'); topic.maxLength = 400; topic.rows = 2;
  topic.value = 'What could we create together in this world?'; topicLabel.append(topic);
  const limitLabel = make('label', 'Total turns '), limit = make('select');
  for (const count of [3, 6, 9, 12]) { const option = make('option', String(count)); option.value = String(count); limit.append(option); } limit.value = '6'; limitLabel.append(limit);
  const start = make('button', 'Start socializing'), stop = make('button', 'Stop'), refresh = make('button', 'Refresh connections');
  for (const button of [start, stop, refresh]) button.type = 'button';
  const status = make('p'), log = make('div'); status.setAttribute('role', 'status'); log.setAttribute('role', 'log'); log.setAttribute('aria-label', 'Resident group conversation');
  panel.append(choices, topicLabel, limitLabel, start, stop, refresh, status, log); container.append(panel);
  const room = createSocialRoom({ residents, resolveConnection, onChange: render });
  function render(state = room.snapshot()) {
    const running = state.status === 'running'; let selected = 0;
    for (const resident of residents) {
      const { input, status: badge } = inputs.get(resident.id);
      let ready = false; try { ready = resolveConnection(resident.id)?.connected === true; } catch { /* unavailable */ }
      input.disabled = running || !ready;
      if (!ready && !running) input.checked = false;
      if (ready && input.checked) selected++;
      badge.textContent = `${resident.name} · ${ready ? 'connection ready' : 'not connected'}`;
    }
    start.disabled = running || selected < 2 || !topic.value.trim(); stop.disabled = !running;
    topic.disabled = running; limit.disabled = running;
    status.textContent = `${state.status} · ${state.turns}/${state.limit} turns${state.speaker ? ' · ' + residents.find(r => r.id === state.speaker).name + ' is responding' : ''}${state.reason ? ' · ' + state.reason : ''}`;
    log.replaceChildren();
    for (const message of state.messages) { const row = make('p'); row.append(make('strong', message.name + ': '), documentRoot.createTextNode(message.text)); log.append(row); }
  }
  start.addEventListener('click', () => { void room.start({ participants: [...inputs].filter(([, v]) => v.input.checked).map(([id]) => id), topic: topic.value, maxTurns: Number(limit.value) }).catch(() => { status.textContent = 'Select at least two connected residents and a topic. Check connections and try again.'; }); });
  stop.addEventListener('click', () => room.stop()); refresh.addEventListener('click', () => render());
  choices.addEventListener('change', () => render()); topic.addEventListener('input', () => render());
  const leave = () => room.stop('Page closed'); scope.addEventListener?.('pagehide', leave);
  render();
  return { room, refresh: render, destroy() { room.destroy(); scope.removeEventListener?.('pagehide', leave); panel.remove(); } };
}
