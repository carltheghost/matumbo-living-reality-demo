import { ROOM_WORKSPACE_LIMITS } from '../domains/room-workspace.js';
import { createPlainVoice, createVoiceEncryptionAdapter, plainVoiceBlob, parseVoiceEnvelope, serializeVoiceAttachment, voiceFileExtension, VOICE_LIMITS } from '../domains/voice-message.js';
import { createVoiceRecorder, claimVoiceActivity, watchVoiceOwnerVisibility } from './voice-session.js?v=20261005-voice';

const STYLE = `
.room-conversations audio{width:100%;max-width:100%;min-width:0}.room-conversations [hidden]{display:none!important}.room-voice{display:grid;gap:8px;padding:10px;border:1px solid #73c7ec44;border-radius:10px}.room-voice input[type=checkbox]{width:auto;justify-self:start}.room-voice-key input{font-family:monospace;overflow-wrap:anywhere}
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
  const voiceEncryption = createVoiceEncryptionAdapter(windowRoot);
  const doc = documentRoot, style = node(doc, 'style'); style.textContent = STYLE; (doc.head || host).appendChild(style);
  const root = node(doc, 'section', 'room-conversations'); root.dataset.roomConversations = 'true'; root.setAttribute('aria-label', 'Local room conversations');
  const heading = node(doc, 'h3', '', 'Room conversation');
  const chooser = field(doc, 'Conversation room', 'select');
  const notice = node(doc, 'p'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  const composer = node(doc, 'form', 'room-conversations-compose');
  const message = field(doc, 'Message this local room', 'textarea'); message.input.rows = 3; message.input.maxLength = ROOM_WORKSPACE_LIMITS.message; message.input.placeholder = 'Write a thought, plan or conversation note…';
  const send = button(doc, 'Save local message'); send.type = 'submit'; send.dataset.primary = 'true';
  const actions = node(doc, 'div', 'room-conversations-actions'); actions.appendChild(send); composer.append(message.label, actions);
  const voice = node(doc, 'div', 'room-voice'); voice.setAttribute('aria-label', 'Local voice message');
  const voiceMode = field(doc, 'Voice privacy', 'select');
  for (const [value, title] of [['plain', 'Readable audio'], ['encrypted', 'Encrypt audio with an unlock code']]) { const option = node(doc, 'option', '', title); option.value = value; voiceMode.input.appendChild(option); }
  voiceMode.input.value = 'plain';
  const voiceStatus = node(doc, 'p', '', 'Voice clips stay here. Maximum 60 seconds / 384 KB.'); voiceStatus.setAttribute('role', 'status');
  const voiceActions = node(doc, 'div', 'room-conversations-actions');
  const recordVoice = button(doc, 'Record voice', startRecording), stopVoice = button(doc, 'Stop recording', finishRecording), cancelVoice = button(doc, 'Cancel voice', () => clearVoiceDraft());
  voiceActions.append(recordVoice, stopVoice, cancelVoice);
  const preview = node(doc, 'audio'); preview.controls = true; preview.preload = 'none'; preview.hidden = true; preview.setAttribute('aria-label', 'Voice recording preview');
  const previewActions = node(doc, 'div', 'room-conversations-actions');
  const playPreview = button(doc, 'Play preview', async () => {
    if (!recordingDraft || !canWriteVoice() || voiceBusy) return;
    const generation = voiceGeneration;
    try {
      if (!audioUrls.has(preview)) setAudio(preview, recordingDraft.blob);
      renderPreviewButtons();
      if (await playAudio(preview, () => generation === voiceGeneration && !destroyed, text => { voiceStatus.textContent = text; })) voiceStatus.textContent = 'Playing the voice preview locally.';
    } catch (error) { if (!destroyed && generation === voiceGeneration) voiceStatus.textContent = error.message; }
    renderPreviewButtons();
  });
  const stopPreview = button(doc, 'Stop preview', () => { stopAudio(preview); voiceStatus.textContent = 'Preview stopped. The recorded clip is still ready to save.'; renderPreviewButtons(); });
  previewActions.append(playPreview, stopPreview);
  const prepareVoice = button(doc, 'Encrypt voice & show unlock code', prepareEncryptedVoice);
  const unlockCode = field(doc, 'Keep this unlock code separately'); unlockCode.label.className = 'room-voice-key'; unlockCode.input.readOnly = true; unlockCode.input.autocomplete = 'off'; unlockCode.input.spellcheck = false; unlockCode.label.hidden = true;
  const codeSaved = field(doc, 'I saved the unlock code separately'); codeSaved.input.type = 'checkbox'; codeSaved.label.hidden = true;
  const saveVoice = button(doc, 'Save local voice', saveVoiceMessage); saveVoice.dataset.primary = 'true';
  const envelopeImport = field(doc, 'Import encrypted voice envelope'); envelopeImport.input.type = 'file'; envelopeImport.input.accept = '.json,application/json';
  voice.append(voiceMode.label, voiceStatus, voiceActions, preview, previewActions, prepareVoice, unlockCode.label, codeSaved.label, saveVoice, envelopeImport.label, node(doc, 'p', '', 'Encryption protects only the audio. Captions, room names, authors, dates, audio type and duration remain readable. Keep the unlock code outside this workspace; it cannot be recovered here.'));
  composer.appendChild(voice);
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
  backup.body.append(backupActions, importField.label, node(doc, 'p', '', 'Exports contain readable text and plain audio, plus encrypted audio envelopes without unlock codes. Keep the file private. Import merges rooms and messages without replacing saved history; files must be smaller than 2 MB. The file picker is also available in Text view.'));
  root.append(heading, chooser.label, notice, composer, log, storageNotice, reload, newRoom.element, backup.element, node(doc, 'p', '', 'Messages stay in this browser. Optional AES-GCM encryption protects voice audio only. No messages are delivered to another person, and canonical membership/cipher badges remain projections.'));
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
  let voiceGeneration = 0, logGeneration = 0, recordingDraft = null, preparedAttachment = null, voiceBusy = false, finishing = false;
  let recorderState = { status: 'idle', supported: false }, previewRelease = null;
  const playbackCleanups = new Set(), downloadUrls = new Set(), audioUrls = new WeakMap(), audioActivities = new WeakMap(), audioAttempts = new WeakMap();
  const recorder = createVoiceRecorder({ windowRoot, maxDurationMs: VOICE_LIMITS.durationMs, maxBytes: VOICE_LIMITS.bytes, onState(state) {
    recorderState = state;
    renderVoice();
    if (state.status === 'error') voiceStatus.textContent = state.errorMessage || 'Recording could not finish. Try again.';
    if (state.status === 'stopped' && state.bytes > 0 && !recordingDraft && !finishing) Promise.resolve().then(finishRecording);
  } });
  recorderState = recorder.getSnapshot();
  function stopAudio(audio) {
    audioAttempts.set(audio, (audioAttempts.get(audio) || 0) + 1); audio.pause?.(); audioActivities.get(audio)?.end();
    try { audio.currentTime = 0; } catch { /* A clip without metadata cannot seek yet. */ }
  }
  function releaseAudio(audio) { stopAudio(audio); const url = audioUrls.get(audio); if (url) windowRoot?.URL?.revokeObjectURL?.(url); audioUrls.delete(audio); if (audio.removeAttribute) audio.removeAttribute('src'); else audio.src = ''; audio.load?.(); audio.hidden = true; }
  function setAudio(audio, blob) { releaseAudio(audio); const url = windowRoot?.URL?.createObjectURL?.(blob); if (!url) throw new Error('Audio playback is unavailable in this browser.'); audioUrls.set(audio, url); audio.src = url; audio.hidden = false; }
  function playbackError(error) {
    if (error?.name === 'NotAllowedError') return 'Playback was blocked by the browser. Press Play again or allow audio playback.';
    if (error?.name === 'NotSupportedError' || error?.code === 4) return 'This browser cannot play this audio format. Try a compatible browser or player.';
    return 'Audio playback failed. Press Play to try again.';
  }
  async function playAudio(audio, isCurrent, reportError) {
    if (!isCurrent() || !audioUrls.has(audio)) return false;
    const attempt = (audioAttempts.get(audio) || 0) + 1, source = audioUrls.get(audio); audioAttempts.set(audio, attempt);
    // Claim before play() so microphone capture stops even while playback loads.
    audioActivities.get(audio)?.begin();
    if (!isCurrent() || attempt !== audioAttempts.get(audio) || source !== audioUrls.get(audio)) return false;
    try {
      if (typeof audio.play !== 'function') throw new Error('Audio playback unavailable');
      await audio.play();
      return isCurrent() && attempt === audioAttempts.get(audio) && source === audioUrls.get(audio);
    } catch (error) {
      if (isCurrent() && attempt === audioAttempts.get(audio) && source === audioUrls.get(audio)) { stopAudio(audio); reportError(playbackError(error)); }
      return false;
    }
  }
  function attachAudioActivity(audio, owner, onRevoke = () => releaseAudio(audio), onError = () => {}) {
    let release = null;
    const end = () => { release?.(); release = null; };
    const begin = () => { if (!release) release = claimVoiceActivity(owner, () => { end(); onRevoke(); }, windowRoot); };
    const play = () => { if (audio.paused !== true && audioUrls.has(audio)) begin(); };
    const pause = () => { if (audio.paused !== false) end(); };
    const failed = () => { if (!audioUrls.has(audio)) return; stopAudio(audio); onError(playbackError(audio.error)); };
    audioActivities.set(audio, { begin, end });
    audio.addEventListener('play', play); audio.addEventListener('pause', pause); audio.addEventListener('ended', pause);
    audio.addEventListener('error', failed);
    return () => { end(); audio.removeEventListener?.('play', play); audio.removeEventListener?.('pause', pause); audio.removeEventListener?.('ended', pause); audio.removeEventListener?.('error', failed); releaseAudio(audio); audioActivities.delete(audio); };
  }
  previewRelease = attachAudioActivity(preview, 'room-voice-preview', () => { releaseAudio(preview); renderPreviewButtons(); voiceStatus.textContent = 'Voice preview stopped because another voice activity started. Press Play preview to hear the retained clip again.'; }, text => { if (!destroyed) voiceStatus.textContent = text; });
  function canWriteVoice() { const room = workspace.getRoom(); return room?.origin === 'local' && room.joined && room.role !== 'observer' && !workspace.snapshot().conflict; }
  function clearPreparedVoice() { preparedAttachment = null; unlockCode.input.value = ''; codeSaved.input.checked = false; }
  function clearVoiceDraft() {
    voiceGeneration += 1; recorder.cancel(); recordingDraft = null; clearPreparedVoice(); voiceBusy = false; finishing = false; releaseAudio(preview); renderVoice();
  }
  function suspendVoice() { clearVoiceDraft(); render(); }
  function renderPreviewButtons() {
    const active = ['requesting', 'recording', 'stopping'].includes(recorderState.status);
    playPreview.disabled = !recordingDraft || !canWriteVoice() || voiceBusy || active;
    stopPreview.disabled = !audioUrls.has(preview);
  }
  function renderVoice() {
    if (destroyed) return;
    const allowed = canWriteVoice(), active = ['requesting', 'recording', 'stopping'].includes(recorderState.status), encrypted = voiceMode.input.value === 'encrypted';
    recordVoice.disabled = !allowed || voiceBusy || active || recorderState.supported === false;
    stopVoice.disabled = !allowed || !['requesting', 'recording'].includes(recorderState.status);
    cancelVoice.disabled = !active && !recordingDraft && !preparedAttachment && !voiceBusy;
    voiceMode.input.disabled = !allowed || active || voiceBusy;
    prepareVoice.hidden = !encrypted; prepareVoice.disabled = !allowed || active || voiceBusy || !recordingDraft || !!preparedAttachment;
    unlockCode.label.hidden = !unlockCode.input.value; codeSaved.label.hidden = !unlockCode.input.value;
    saveVoice.disabled = !allowed || active || voiceBusy || (encrypted ? !preparedAttachment || (!!unlockCode.input.value && !codeSaved.input.checked) : !recordingDraft);
    envelopeImport.input.disabled = !allowed || active || voiceBusy;
    renderPreviewButtons();
    if (!allowed) voiceStatus.textContent = 'Create and enter your own local room to record voice messages.';
    else if (recorderState.supported === false) voiceStatus.textContent = 'Microphone recording is unavailable here. You can import an encrypted voice envelope.';
    else if (active) voiceStatus.textContent = recorderState.status === 'requesting' ? 'Waiting for microphone permission…' : recorderState.status === 'stopping' ? 'Finishing the recording…' : `Recording locally · ${Math.ceil((recorderState.durationMs || 0) / 1000)} seconds · stop when ready.`;
    else if (voiceBusy) voiceStatus.textContent = 'Preparing audio locally…';
    else if (preparedAttachment) voiceStatus.textContent = unlockCode.input.value ? 'Retain the unlock code separately, confirm below, then save. It is never included in history or exports.' : 'Encrypted envelope ready to save locally. Use its separate unlock code for playback.';
    else if (recordingDraft) voiceStatus.textContent = `Recording captured · ${(recordingDraft.durationMs / 1000).toFixed(1)} seconds. ${encrypted ? 'Encrypt the audio before saving.' : 'Save when ready.'}`;
    else voiceStatus.textContent = recorderState.errorMessage || 'Voice clips stay here. Maximum 60 seconds / 384 KB.';
  }
  async function startRecording() {
    if (!canWriteVoice() || voiceBusy) return;
    clearVoiceDraft(); const generation = voiceGeneration;
    try { await recorder.start(); if (generation !== voiceGeneration || destroyed) return; renderVoice(); }
    catch (error) { if (generation === voiceGeneration && !destroyed) { renderVoice(); voiceStatus.textContent = error.message; } }
  }
  async function finishRecording() {
    if (destroyed || finishing || recordingDraft) return;
    finishing = true; const generation = voiceGeneration;
    try {
      const result = await recorder.stop();
      if (!result || destroyed || generation !== voiceGeneration || !canWriteVoice()) return;
      recordingDraft = result; setAudio(preview, result.blob); renderVoice();
    } catch (error) { if (generation === voiceGeneration && !destroyed) say(error.message, true); }
    finally { if (generation === voiceGeneration) { finishing = false; renderVoice(); } }
  }
  async function prepareEncryptedVoice() {
    if (!canWriteVoice() || !recordingDraft || voiceBusy) return;
    const generation = voiceGeneration; voiceBusy = true; renderVoice();
    try {
      const result = await voiceEncryption.encrypt(recordingDraft);
      if (destroyed || generation !== voiceGeneration || !canWriteVoice()) return;
      preparedAttachment = result.attachment; unlockCode.input.value = result.unlockCode; codeSaved.input.checked = false;
    } catch (error) { if (!destroyed && generation === voiceGeneration) say(error.message, true); }
    finally { if (generation === voiceGeneration) { voiceBusy = false; renderVoice(); } }
  }
  async function saveVoiceMessage() {
    if (!canWriteVoice() || voiceBusy || saveVoice.disabled) return;
    const generation = voiceGeneration, roomId = workspace.getRoom().id, caption = message.input.value.trim(); voiceBusy = true; renderVoice();
    try {
      const attachment = voiceMode.input.value === 'encrypted' ? preparedAttachment : await createPlainVoice(recordingDraft);
      if (destroyed || generation !== voiceGeneration || workspace.getRoom()?.id !== roomId || !canWriteVoice()) return;
      if (mutate(() => { workspace.sendVoiceMessage(attachment, caption, roomId); message.input.value = ''; onChange?.(); }, 'Voice saved locally. No remote delivery.')) clearVoiceDraft();
    } catch (error) { if (!destroyed && generation === voiceGeneration) say(error.message, true); }
    finally { if (generation === voiceGeneration) { voiceBusy = false; renderVoice(); } }
  }
  function say(text, error = false) { notice.textContent = text; notice.className = error ? 'room-conversations-warning' : ''; }
  function mutate(change, success) { try { change(); render(); if (success) say(success); return true; } catch (error) { render(); say(error.message, true); return false; } }
  function render() {
    if (destroyed) return;
    const snapshot = workspace.snapshot(), current = workspace.getRoom();
    if (visibleRoomId !== current?.id) { message.input.value = ''; deleteArmed = null; clearVoiceDraft(); }
    else if (!canWriteVoice() && (recordingDraft || preparedAttachment || ['requesting', 'recording', 'stopping'].includes(recorderState.status))) clearVoiceDraft();
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
    logGeneration += 1; for (const cleanup of playbackCleanups) cleanup(); playbackCleanups.clear(); log.replaceChildren();
    const messages = snapshot.messages.filter(row => row.roomId === current?.id);
    if (!messages.length) log.appendChild(node(doc, 'p', 'room-conversations-empty', 'A clear space. Your messages will appear here.'));
    for (const row of messages) {
      const item = node(doc, 'article', 'room-conversations-message'); item.dataset.messageId = row.id;
      item.append(node(doc, 'small', '', `${row.author} · ${new Date(row.sentAt).toLocaleString()}`));
      if (row.text) item.appendChild(node(doc, 'p', '', row.text));
      if (row.voice) appendVoiceMessage(item, row);
      item.appendChild(button(doc, 'Delete message', () => mutate(() => { workspace.deleteMessage(row.id); onChange?.(); }, 'Deleted this local message.')));
      log.appendChild(item);
    }
    renderVoice();
  }
  function download(blob, filename) {
    const url = windowRoot?.URL?.createObjectURL?.(blob);
    if (!url) throw new Error('Downloads are unavailable here. Use Text view in a browser with downloads enabled.');
    downloadUrls.add(url);
    const anchor = node(doc, 'a'); anchor.href = url; anchor.download = filename; host.appendChild(anchor); anchor.click(); anchor.remove?.();
    windowRoot?.setTimeout?.(() => { windowRoot.URL.revokeObjectURL(url); downloadUrls.delete(url); }, 1000);
  }
  function appendVoiceMessage(item, row) {
    const attachment = row.voice, encrypted = attachment.mode === 'encrypted', generation = logGeneration;
    const audio = node(doc, 'audio'); audio.controls = true; audio.preload = 'none'; audio.hidden = true; audio.setAttribute('aria-label', encrypted ? 'Unlocked voice playback' : 'Voice message playback');
    const status = node(doc, 'p', '', `${encrypted ? 'Encrypted audio · locked' : 'Readable audio'} · ${(attachment.durationMs / 1000).toFixed(1)} seconds`); status.setAttribute('role', 'status');
    let playVoice, stopVoicePlayback;
    const updatePlaybackButtons = () => { if (playVoice) playVoice.disabled = encrypted && !audioUrls.has(audio); if (stopVoicePlayback) stopVoicePlayback.disabled = !audioUrls.has(audio); };
    const cleanup = attachAudioActivity(audio, `room-voice:${row.id}`, () => { releaseAudio(audio); updatePlaybackButtons(); status.textContent = 'Playback stopped by another voice activity. Play or unlock this clip again.'; }, text => { if (!destroyed && generation === logGeneration) status.textContent = text; });
    playbackCleanups.add(cleanup);
    item.append(status, audio);
    const rowActions = node(doc, 'div', 'room-conversations-actions');
    playVoice = button(doc, 'Play voice', async () => {
      if (destroyed || generation !== logGeneration) return;
      try {
        if (!audioUrls.has(audio)) {
          if (encrypted) { status.textContent = 'Unlock this voice before playback.'; return; }
          setAudio(audio, plainVoiceBlob(attachment));
        }
        updatePlaybackButtons();
        if (await playAudio(audio, () => !destroyed && generation === logGeneration, text => { status.textContent = text; })) status.textContent = 'Playing voice locally.';
      } catch (error) { if (!destroyed && generation === logGeneration) status.textContent = error.message; }
      updatePlaybackButtons();
    });
    stopVoicePlayback = button(doc, 'Stop voice', () => { stopAudio(audio); status.textContent = 'Voice playback stopped.'; updatePlaybackButtons(); });
    rowActions.append(playVoice, stopVoicePlayback); updatePlaybackButtons();
    if (encrypted) {
      let unlockGeneration = 0;
      const key = field(doc, 'Voice unlock code'); key.input.type = 'password'; key.input.maxLength = 43; key.input.autocomplete = 'off'; key.input.spellcheck = false;
      const unlock = button(doc, 'Unlock voice', async () => {
        if (destroyed || generation !== logGeneration) return;
        const code = key.input.value.trim(), attempt = ++unlockGeneration; key.input.value = ''; unlock.disabled = true;
        try {
          const blob = await voiceEncryption.decrypt(attachment, code);
          if (destroyed || generation !== logGeneration || attempt !== unlockGeneration) return;
          setAudio(audio, blob); updatePlaybackButtons(); status.textContent = 'Audio unlocked for this view. Press Play voice when ready.';
        } catch (error) { if (!destroyed && generation === logGeneration && attempt === unlockGeneration) status.textContent = error.message; }
        finally { if (!destroyed && generation === logGeneration && attempt === unlockGeneration) unlock.disabled = false; }
      });
      const lock = button(doc, 'Lock voice', () => { unlockGeneration += 1; unlock.disabled = false; releaseAudio(audio); updatePlaybackButtons(); key.input.value = ''; status.textContent = 'Encrypted audio · locked'; });
      rowActions.append(unlock, lock); item.appendChild(key.label);
    } else rowActions.appendChild(button(doc, 'Load voice playback', () => {
      try { if (destroyed || generation !== logGeneration) return; setAudio(audio, plainVoiceBlob(attachment)); updatePlaybackButtons(); status.textContent = 'Audio ready. Press Play voice when ready.'; } catch (error) { status.textContent = error.message; }
    }));
    rowActions.appendChild(button(doc, encrypted ? 'Download encrypted envelope' : 'Download voice clip', () => {
      try { if (encrypted) download(new Blob([serializeVoiceAttachment(attachment)], { type: 'application/json' }), 'matumbo-encrypted-voice.json'); else download(plainVoiceBlob(attachment), `matumbo-voice.${voiceFileExtension(attachment.mimeType)}`); }
      catch (error) { status.textContent = error.message; }
    }));
    item.appendChild(rowActions);
  }
  function exportData() {
    try {
      const content = workspace.exportJson();
      download(new Blob([content], { type: 'application/json' }), 'matumbo-rooms-backup.json');
      say('Room history export prepared. Text and plain audio are readable; encrypted audio stays locked and unlock codes are excluded.');
    } catch (error) { say(error.message, true); }
  }
  listen(chooser.input, 'change', () => mutate(() => { onSelect?.(chooser.input.value); onChange?.(); }));
  listen(doc, 'visibilitychange', () => { if (doc.hidden || doc.visibilityState === 'hidden') suspendVoice(); });
  if (windowRoot?.addEventListener) for (const event of ['pagehide', 'popstate', 'hashchange']) listen(windowRoot, event, suspendVoice);
  listen(voiceMode.input, 'change', () => { voiceGeneration += 1; clearPreparedVoice(); renderVoice(); });
  listen(codeSaved.input, 'change', renderVoice);
  listen(envelopeImport.input, 'change', async () => {
    const file = envelopeImport.input.files?.[0]; if (!file || !canWriteVoice()) return;
    if (file.size > 514000) { say('Choose a voice envelope smaller than 514 KB.', true); return; }
    clearVoiceDraft(); const generation = voiceGeneration; voiceBusy = true; renderVoice();
    try {
      const attachment = parseVoiceEnvelope(await file.text());
      if (attachment.mode !== 'encrypted') throw new Error('Choose an encrypted voice envelope.');
      if (destroyed || generation !== voiceGeneration || !canWriteVoice()) return;
      preparedAttachment = attachment; voiceMode.input.value = 'encrypted';
    } catch (error) { if (!destroyed && generation === voiceGeneration) say(error.message, true); }
    finally { envelopeImport.input.value = ''; if (generation === voiceGeneration) { voiceBusy = false; renderVoice(); } }
  });
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
  const stopWatchingVisibility = watchVoiceOwnerVisibility({ element: root, windowRoot, onHidden: suspendVoice });
  render();
  return Object.freeze({ render, root, suspendVoice, getSnapshot: () => { const data = workspace.snapshot(); return { currentRoom: workspace.getRoom(), roomCount: data.rooms.length, messageCount: data.messages.length, voiceMessageCount: data.messages.filter(row => row.voice).length, messageContentRetained: data.messages.length > 0, storageError: data.storageError, conflict: data.conflict, localOnly: true, networkConnected: false, cryptographyImplemented: false, voiceEncryptionImplemented: true, voiceEncryptionScope: 'audio-only', recordingStatus: recorderState.status }; }, destroy: () => { destroyed = true; stopWatchingVisibility(); voiceGeneration += 1; logGeneration += 1; recorder.destroy(); recordingDraft = null; clearPreparedVoice(); previewRelease?.(); for (const cleanup of playbackCleanups) cleanup(); playbackCleanups.clear(); for (const url of downloadUrls) windowRoot?.URL?.revokeObjectURL?.(url); downloadUrls.clear(); for (const [element, type, handler] of listeners) element.removeEventListener?.(type, handler); root.remove?.(); style.remove?.(); } });
}
