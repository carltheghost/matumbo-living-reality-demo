import { ROOM_WORKSPACE_LIMITS } from '../domains/room-workspace.js';

const STYLE = `
.room-conversations{display:grid;gap:10px;min-width:0;color:#d9f2fa}.room-conversations h3{margin:0;font-size:19px;letter-spacing:-.02em}.room-conversations p{margin:0;color:#aacbd7;font-size:12px;line-height:1.55}.room-conversations label{display:grid;gap:5px;font-size:12px;color:#b9dbe8}.room-conversations input,.room-conversations textarea,.room-conversations select{box-sizing:border-box;width:100%;min-width:0;appearance:auto;background:#071d2d;color:#e8f8ff;border:1px solid #73c7ec55;border-radius:10px;padding:10px;font:inherit}.room-conversations textarea{resize:vertical;min-height:90px;line-height:1.5;font-size:14px}.room-conversations button{appearance:none;background:#153e57;color:#dcf5ff;border:1px solid #7edafa55;border-radius:9px;padding:9px 11px;font:inherit;font-size:12px;cursor:pointer}.room-conversations button:disabled{opacity:.45;cursor:not-allowed}.room-conversations button:focus-visible,.room-conversations input:focus-visible,.room-conversations select:focus-visible,.room-conversations textarea:focus-visible{outline:2px solid #91e4ff;outline-offset:2px}.room-conversations-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.room-conversations-compose{display:grid;gap:8px}.room-conversations button[data-primary=true]{background:#185763;border-color:#8ee7ce99}.room-conversations-log{display:grid;gap:8px;max-height:280px;overflow:auto;min-height:60px;scrollbar-width:thin}.room-conversations-message{display:grid;gap:5px;padding:10px 11px;border-left:2px solid #7be0b8;border-radius:0 10px 10px 0;background:#1a485333;overflow-wrap:anywhere}.room-conversations-message p{white-space:pre-wrap;color:#e5f6fb;font-size:14px}.room-conversations-message small{color:#94becb;font-size:10px}.room-conversations-message button{justify-self:end;padding:4px 7px;font-size:10px}.room-conversations details{border-top:1px solid #73b9d433;padding-top:10px}.room-conversations summary{cursor:pointer;color:#c4e7f4;font-size:13px;padding-bottom:5px}.room-conversations-details{display:grid;gap:9px;padding-top:7px}.room-conversations-warning{padding:8px;border-left:2px solid #ffb482;color:#ffdbbe!important;background:#5f301e33}.room-conversations-storage[hidden],.room-conversations button[hidden]{display:none}.room-projection-details{border-top:1px solid #73b9d433;padding-top:9px}.room-projection-details summary{color:#b7dce9;font-size:12px;cursor:pointer}.room-projection-details>div{display:grid;gap:7px;padding-top:8px}#room-console:has(.room-conversations){overflow:auto}#room-console-head p{white-space:normal}#room-console-status,#room-console-current,#room-console-membership{white-space:normal!important}#room-console-replay{font-size:10px}.room-conversations-empty{padding:14px 8px;text-align:center}
@media(max-width:430px){.room-conversations input,.room-conversations textarea,.room-conversations select{font-size:16px}.room-conversations-log{max-height:240px}.room-conversations h3{font-size:18px}}
`;
function node(doc, tag, className, text) { const element = doc.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
function button(doc, text, action) { const element = node(doc, 'button', '', text); element.type = 'button'; if (action) element.addEventListener('click', action); return element; }
function field(doc, title, tag = 'input') { const label = node(doc, 'label', '', title), input = node(doc, tag); input.setAttribute('aria-label', title); label.appendChild(input); return { label, input }; }
function details(doc, title) { const element = node(doc, 'details'), summary = node(doc, 'summary', '', title), body = node(doc, 'div', 'room-conversations-details'); element.append(summary, body); return { element, body }; }

/** Mounted within room-console; the original controls remain the object tabs. */
export function mountRoomConversations({ documentRoot = globalThis.document, windowRoot = globalThis.window, host, workspace, onSelect, onCreate, onChange } = {}) {
  if (!documentRoot?.createElement || !host || !workspace) throw new Error('Rooms need their original feature owner and local workspace.');
  const doc = documentRoot, style = node(doc, 'style'); style.textContent = STYLE; (doc.head || host).appendChild(style);
  const root = node(doc, 'section', 'room-conversations'); root.dataset.roomConversations = 'true'; root.setAttribute('aria-label', 'Local room conversations');
  const heading = node(doc, 'h3', '', 'Room conversation');
  const chooser = field(doc, 'Conversation room', 'select');
  const notice = node(doc, 'p'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  const composer = node(doc, 'form', 'room-conversations-compose');
  const message = field(doc, 'Message this local room', 'textarea'); message.input.rows = 3; message.input.maxLength = ROOM_WORKSPACE_LIMITS.message; message.input.placeholder = 'Write a thought, plan or conversation note…';
  const send = button(doc, 'Save local message'); send.type = 'submit'; send.dataset.primary = 'true';
  const actions = node(doc, 'div', 'room-conversations-actions'); actions.appendChild(send); composer.append(message.label, actions);
  const log = node(doc, 'div', 'room-conversations-log'); log.setAttribute('role', 'log'); log.setAttribute('aria-label', 'Messages in selected room'); log.setAttribute('aria-live', 'polite');
  const storageNotice = node(doc, 'p', 'room-conversations-storage room-conversations-warning'); storageNotice.setAttribute('role', 'status'); storageNotice.hidden = true;
  const reload = button(doc, 'Load saved workspace', () => mutate(() => { workspace.reload(); message.input.value = ''; onChange?.(); }, 'Loaded the latest saved workspace.')); reload.hidden = true;
  const newRoom = details(doc, 'Create your own local room');
  const createForm = node(doc, 'form', 'room-conversations-compose');
  const name = field(doc, 'New room name'); name.input.maxLength = ROOM_WORKSPACE_LIMITS.label; name.input.required = true;
  const context = field(doc, 'New room purpose', 'select');
  for (const [value, label] of [['private', 'Private notes'], ['social', 'Social conversation'], ['contract', 'Contract planning'], ['market', 'Market research'], ['ai', 'AI ideas']]) { const option = node(doc, 'option', '', label); option.value = value; context.input.appendChild(option); }
  context.input.value = 'private';
  const create = button(doc, 'Create local room'); create.type = 'submit';
  createForm.append(name.label, context.label, create); newRoom.body.append(createForm, node(doc, 'p', '', 'This creates a room on this browser. It does not invite people or create remote membership.'));
  const backup = details(doc, 'History, backup & import');
  const backupActions = node(doc, 'div', 'room-conversations-actions');
  const exportButton = button(doc, 'Export room history', exportData);
  let deleteArmed = null;
  const deleteRoom = button(doc, 'Remove this local room', () => {
    const current = workspace.getRoom();
    if (!current || current.origin !== 'local') return;
    if (deleteArmed !== current.id) { deleteArmed = current.id; deleteRoom.textContent = 'Confirm remove room & messages'; return; }
    mutate(() => { workspace.removeRoom(current.id); deleteArmed = null; onChange?.(); }, 'Removed the local room and its messages.');
  });
  backupActions.append(exportButton, deleteRoom);
  const importField = field(doc, 'Import rooms JSON backup'); importField.input.type = 'file'; importField.input.accept = '.json,application/json';
  backup.body.append(backupActions, importField.label, node(doc, 'p', '', 'Exports contain readable message text. Keep the file private. Import merges rooms and messages without replacing saved history; files must be smaller than 2 MB. The file picker is also available in Text view.'));
  root.append(heading, chooser.label, notice, composer, log, storageNotice, reload, newRoom.element, backup.element, node(doc, 'p', '', 'Messages stay in this browser and are stored as readable text. No messages are sent to another person; encryption and remote delivery are not connected.'));
  const toolbar = doc.getElementById?.('room-console-toolbar');
  if (host.insertBefore && toolbar?.parentNode === host) host.insertBefore(root, toolbar); else host.appendChild(root);
  if (toolbar && root.insertBefore) root.insertBefore(toolbar, composer);
  // The membership projection remains inspectable without placing its trace
  // and simulated cipher badges in front of the real conversation composer.
  const projectionDetails = node(doc, 'details', 'room-projection-details');
  projectionDetails.appendChild(node(doc, 'summary', '', 'Room spaces & projection evidence'));
  const projectionBody = node(doc, 'div'); projectionDetails.appendChild(projectionBody);
  for (const id of ['room-console-summary', 'room-console-current', 'room-console-membership', 'room-console-message-indicator', 'room-console-list']) {
    const element = doc.getElementById?.(id); if (element?.parentNode === host) projectionBody.appendChild(element);
  }
  const trace = doc.getElementById?.('room-console-trace');
  if (trace?.parentNode?.parentNode === host) projectionBody.appendChild(trace.parentNode);
  if (projectionBody.children.length) root.appendChild(projectionDetails);
  const replayButton = doc.getElementById?.('room-console-replay');
  if (replayButton?.parentNode === toolbar) projectionBody.appendChild(replayButton);
  const title = doc.getElementById?.('room-console-title'); if (title) title.textContent = 'Rooms + Messaging';
  const head = doc.getElementById?.('room-console-head');
  const subtitle = head?.querySelector?.('p'); if (subtitle) subtitle.textContent = 'Your local rooms, conversations and plans. Enter a room, write, and keep its history.';
  const listeners = [];
  function listen(element, type, handler) { element.addEventListener(type, handler); listeners.push([element, type, handler]); }
  let destroyed = false, visibleRoomId = null;
  function say(text, error = false) { notice.textContent = text; notice.className = error ? 'room-conversations-warning' : ''; }
  function mutate(change, success) { try { change(); render(); if (success) say(success); return true; } catch (error) { render(); say(error.message, true); return false; } }
  function render() {
    if (destroyed) return;
    const snapshot = workspace.snapshot(), current = workspace.getRoom();
    if (visibleRoomId !== current?.id) { message.input.value = ''; deleteArmed = null; }
    visibleRoomId = current?.id ?? null;
    chooser.input.replaceChildren();
    for (const room of snapshot.rooms) { const option = node(doc, 'option', '', `${room.label}${room.role === 'observer' ? ' · read-only' : ''}`); option.value = room.id; chooser.input.appendChild(option); }
    chooser.input.value = current?.id ?? '';
    heading.textContent = current ? current.label : 'Your local rooms';
    const readOnly = current?.role === 'observer';
    message.input.disabled = !current || !current.joined || readOnly || snapshot.conflict;
    send.disabled = message.input.disabled;
    say(!current ? 'Create a local room to start your conversation history.' : readOnly ? 'Your projected observer membership is read-only. Create your own local room to write.' : !current.joined ? 'Enter this room to add messages. History is retained when you leave.' : `${current.origin === 'projection' ? 'Projected room · ' : 'Your local room · '}entered here. Messages are saved locally.`);
    storageNotice.hidden = !snapshot.storageError && !snapshot.conflict;
    storageNotice.textContent = snapshot.conflict ? 'Another tab has a newer saved workspace. Export this session before loading it.' : snapshot.storageError || '';
    reload.hidden = !snapshot.conflict;
    deleteRoom.hidden = current?.origin !== 'local';
    deleteRoom.textContent = deleteArmed === current?.id ? 'Confirm remove room & messages' : 'Remove this local room';
    log.replaceChildren();
    const messages = snapshot.messages.filter(row => row.roomId === current?.id);
    if (!messages.length) log.appendChild(node(doc, 'p', 'room-conversations-empty', 'A clear space. Your messages will appear here.'));
    for (const row of messages) {
      const item = node(doc, 'article', 'room-conversations-message'); item.dataset.messageId = row.id;
      item.append(node(doc, 'small', '', `${row.author} · ${new Date(row.sentAt).toLocaleString()}`), node(doc, 'p', '', row.text), button(doc, 'Delete message', () => mutate(() => { workspace.deleteMessage(row.id); onChange?.(); }, 'Deleted this local message.')));
      log.appendChild(item);
    }
  }
  function exportData() {
    try {
      const content = workspace.exportJson();
      const url = windowRoot?.URL?.createObjectURL?.(new Blob([content], { type: 'application/json' }));
      if (!url) throw new Error('Downloads are unavailable here. Use Text view in a browser with downloads enabled.');
      const anchor = node(doc, 'a'); anchor.href = url; anchor.download = 'matumbo-rooms-backup.json'; host.appendChild(anchor); anchor.click(); anchor.remove?.();
      windowRoot?.setTimeout?.(() => windowRoot.URL.revokeObjectURL(url), 1000);
      say('Room history export prepared. It contains readable message text.');
    } catch (error) { say(error.message, true); }
  }
  listen(chooser.input, 'change', () => mutate(() => { onSelect?.(chooser.input.value); onChange?.(); }));
  listen(composer, 'submit', event => {
    event.preventDefault();
    if (mutate(() => { workspace.sendMessage(message.input.value); message.input.value = ''; onChange?.(); }, 'Message saved locally. No remote delivery.')) { message.input.focus?.(); log.scrollTop = log.scrollHeight; }
  });
  listen(createForm, 'submit', event => {
    event.preventDefault();
    mutate(() => { const room = workspace.createRoom({ label: name.input.value, context: context.input.value }); name.input.value = ''; newRoom.element.open = false; onCreate?.(room); onChange?.(); }, 'Created and entered your local room.');
  });
  listen(importField.input, 'change', async () => {
    const file = importField.input.files?.[0]; if (!file) return;
    if (file.size > ROOM_WORKSPACE_LIMITS.importBytes) { say('Choose a rooms backup smaller than 2 MB.', true); return; }
    try {
      const data = await file.text(); if (destroyed) return;
      let count;
      if (mutate(() => { count = workspace.importData(data); onChange?.(); })) say(`Imported ${count.roomsAdded} rooms and ${count.messagesAdded} messages locally.`);
    } catch (error) { if (!destroyed) say(error.message, true); }
    importField.input.value = '';
  });
  render();
  return Object.freeze({ render, root, getSnapshot: () => { const data = workspace.snapshot(); return { currentRoom: workspace.getRoom(), roomCount: data.rooms.length, messageCount: data.messages.length, messageContentRetained: data.messages.length > 0, storageError: data.storageError, conflict: data.conflict, localOnly: true, networkConnected: false, cryptographyImplemented: false }; }, destroy: () => { destroyed = true; for (const [element, type, handler] of listeners) element.removeEventListener?.(type, handler); root.remove?.(); style.remove?.(); } });
}
