import test from 'node:test';
import assert from 'node:assert/strict';
import { mountMyGpt, GPT_REQUEST_TIMEOUT_MS } from '../src/render/my-gpt.js';
import { createWebAiConsole } from '../src/render/web-ai.js';
import { GPT_STORAGE_KEY } from '../src/domains/my-gpt.js';
import { WEB_AI_STORAGE_KEYS } from '../src/domains/web-ai.js';
import { createRealitySurfaceDocument } from '../src/render/reality-surface-document.js';

// A small DOM adapter exercises event behavior and real domain persistence.
function element(tag = 'div') {
  const listeners = new Map(), attributes = new Map();
  let text = '';
  const item = {
    tagName: tag.toUpperCase(), children: [], style: {}, dataset: {}, value: '', checked: false,
    hidden: false, disabled: false, parentNode: null, className: '', files: [],
    get textContent() { return text + this.children.map(child => child.textContent).join(''); },
    set textContent(value) { text = String(value); this.children = []; },
    setAttribute(key, value) { attributes.set(key, String(value)); },
    getAttribute(key) { return attributes.get(key) ?? null; },
    hasAttribute(key) { return attributes.has(key); },
    removeAttribute(key) { attributes.delete(key); },
    appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child; },
    insertBefore(child, before) { child.remove(); const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); child.parentNode = this; return child; },
    append(...children) { children.forEach(child => this.appendChild(child)); },
    replaceChildren(...children) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; text = ''; this.append(...children); },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; },
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    async fire(name, extra = {}) { if (this.disabled) return; return Promise.all([...(listeners.get(name) || [])].map(listener => listener({ preventDefault() {}, stopPropagation() {}, target: this, ...extra }))); },
    click() { return this.fire('click'); }, focus() {}, listeners,
  };
  return item;
}
function walk(root) { return [root, ...root.children.flatMap(walk)]; }
function label(root, name) { const item = walk(root).find(item => item.getAttribute('aria-label') === name); assert.ok(item, `Missing control ${name}`); return item; }
function namedButton(root, name) { const item = walk(root).find(item => item.tagName === 'BUTTON' && item.textContent === name); assert.ok(item, `Missing button ${name}`); return item; }
function classNode(root, name) { const item = walk(root).find(item => item.className === name); assert.ok(item, `Missing class ${name}`); return item; }
function response(data, status = 200) { return { ok: status < 400, status, async json() { return data; } }; }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function flushRequests() { return new Promise(resolve => setImmediate(resolve)); }
function status({ chatgpt = {}, openai = {}, ...extra } = {}) {
  return { service: 'matumbo-gpt-bridge', version: 1, credentialsInBrowser: false,
    chatgpt: { state: 'signed_in', planUsage: true, activeAccountId: 'oaiapp_example', accounts: [{ id: 'oaiapp_example', label: 'Tumbo', active: true }], ...chatgpt },
    openai: { state: 'configured', model: 'api-model', ...openai },
    models: [{ id: 'plan-model', label: 'Plan model', provider: 'chatgpt' }, { id: 'api-model', label: 'API model', provider: 'openai' }], ...extra };
}
function setup({ fetcher, initialStatus = status(), href = 'http://127.0.0.1:8082/?feature=web-ai', storageFailure = false, configureWindow } = {}) {
  const doc = element('document'); doc.head = element('head'); doc.body = element('body');
  doc.createElement = element; doc.createTextNode = value => { const item = element('#text'); item.textContent = value; return item; }; doc.append(doc.head, doc.body);
  const host = element('section'); doc.body.appendChild(host);
  const opened = [], requests = [], saved = new Map();
  const storage = { getItem: key => saved.get(key) || null, setItem(key, value) { if (storageFailure) throw new Error('Quota exceeded'); saved.set(key, value); } };
  const win = element('window'); win.location = { href }; win.localStorage = storage; win.sessionStorage = storage;
  win.history = { state: null, replaceState(_state, _title, next) { win.location.href = next; } };
  win.innerWidth = 390; win.innerHeight = 844;
  win.open = (url, target) => { const openedTab = { url, target, location: { href: url }, opener: win, closed: false, close() { this.closed = true; } }; opened.push(openedTab); return openedTab; };
  win.fetch = async (path, options) => { requests.push({ path, options }); return fetcher ? fetcher(path, options) : response(initialStatus); };
  configureWindow?.(win);
  const api = mountMyGpt({ documentRoot: doc, windowRoot: win, host, storage });
  return { doc, host, win, api, storage, opened, requests, saved };
}

// Browser speech doubles never access a microphone or online speech service.
function speechBrowser() {
  const recognitions = [], spoken = [];
  let cancellations = 0;
  return {
    recognitions, spoken, get cancellations() { return cancellations; },
    configureWindow(win) {
      win.isSecureContext = true; win.navigator = { language: 'en-US' };
      win.SpeechRecognition = class {
        constructor() { recognitions.push(this); this.aborts = 0; }
        start() { this.onstart?.(); }
        stop() { this.onend?.(); }
        abort() { this.aborts += 1; this.onend?.(); }
        result(text, final = true) { const result = [{ transcript: text, confidence: 0.9 }]; result.isFinal = final; this.onresult?.({ resultIndex: 0, results: [result] }); }
      };
      win.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      win.speechSynthesis = {
        speak(utterance) { spoken.push(utterance); utterance.onstart?.(); },
        cancel() { cancellations += 1; },
        getVoices() { return [{ lang: 'en-US', name: 'Local test voice', localService: true }]; },
      };
    },
  };
}
async function voiceDraft(context, speech, text = 'A spoken question') {
  await namedButton(context.host, 'Listen').click();
  speech.recognitions.at(-1).result(text);
  await namedButton(context.host, 'Stop listening').click();
}
async function promptAndSend(context, content = 'Hello there') {
  const prompt = label(context.host, 'Message My GPT'); prompt.value = content; await prompt.fire('input');
  return classNode(context.host, 'my-gpt-composer').fire('submit');
}

test('voice controls disclose the speech service and stay inactive until explicitly started', async t => {
  const speech = speechBrowser();
  const context = setup({ configureWindow: speech.configureWindow }); t.after(() => context.api.destroy());
  assert.match(context.host.textContent, /may send audio to its provider/);
  assert.equal(label(context.host, 'Read voice replies aloud').checked, false);
  assert.equal(speech.recognitions.length, 0); assert.equal(speech.spoken.length, 0);
  await context.api.refresh();
  assert.equal(speech.recognitions.length, 0);
  await namedButton(context.host, 'Listen').click();
  assert.equal(speech.recognitions.length, 1);
  assert.equal(speech.recognitions[0].lang, 'en-US');
  assert.equal(context.requests.length, 1);
  assert.equal(namedButton(context.host, 'Send message').disabled, true);
});

test('voice conversation reviews editable text and sends through the existing selected provider', async t => {
  const speech = speechBrowser();
  const context = setup({ configureWindow: speech.configureWindow, fetcher: path => response(path === '/api/gpt/status' ? status() : { provider: 'chatgpt', model: 'plan-model', content: 'Here is the answer.' }) }); t.after(() => context.api.destroy());
  await context.api.refresh();
  const prompt = label(context.host, 'Message My GPT'); prompt.value = 'Consider:';
  await namedButton(context.host, 'Listen').click();
  const recognition = speech.recognitions.at(-1);
  recognition.result('draft words', false);
  assert.equal(prompt.value, 'Consider:');
  assert.match(classNode(context.host, 'my-gpt-voice-interim').textContent, /draft words/);
  recognition.result('my question');
  assert.equal(prompt.value, 'Consider: my question');
  await classNode(context.host, 'my-gpt-composer').fire('submit');
  assert.equal(context.requests.length, 1, 'Recognition never submits and Send is gated until listening ends');
  await namedButton(context.host, 'Stop listening').click();
  prompt.value = 'Consider: my reviewed question'; await prompt.fire('input');
  label(context.host, 'Read voice replies aloud').checked = true;
  await classNode(context.host, 'my-gpt-composer').fire('submit');
  assert.equal(context.requests.length, 2);
  const sent = JSON.parse(context.requests[1].options.body);
  assert.equal(context.requests[1].path, '/api/gpt/chat');
  assert.equal(sent.messages.at(-1).content, 'Consider: my reviewed question');
  assert.equal(sent.accountId, 'oaiapp_example');
  assert.equal(sent.model, 'plan-model');
  assert.deepEqual(speech.spoken.map(item => item.text), ['Here is the answer.']);
  assert.equal(speech.spoken[0].lang, 'en-US');
  assert.equal(speech.spoken[0].voice.localService, true);
  assert.match(classNode(context.host, 'my-gpt-voice-status').textContent, /using a device voice/);
  speech.spoken[0].onend();
  assert.match(classNode(context.host, 'my-gpt-voice-status').textContent, /finished.*Press Listen/);
});

test('hands-free voice dialogue requires explicit consent, sends one paused turn, speaks the reply, and resumes only until stopped', async t => {
  const speech = speechBrowser();
  const context = setup({ configureWindow: speech.configureWindow,
    fetcher: path => response(path === '/api/gpt/status' ? status() : { provider: 'chatgpt', model: 'plan-model', content: 'A spoken answer.' }) });
  t.after(() => context.api.destroy());
  await context.api.refresh();
  const consent = label(context.host, 'Allow automatic sending during voice dialogue');
  const start = namedButton(context.host, 'Start voice dialogue');
  assert.equal(consent.checked, false); assert.equal(start.disabled, true);
  assert.equal(speech.recognitions.length, 0); assert.equal(speech.spoken.length, 0);
  consent.checked = true; await consent.fire('change');
  assert.equal(start.disabled, false);
  await start.click();
  assert.equal(speech.recognitions.length, 1);
  speech.recognitions[0].result('What is in this space?');
  await new Promise(resolve => setTimeout(resolve, 950));
  await flushRequests();
  assert.equal(context.requests.filter(request => request.path === '/api/gpt/chat').length, 1);
  assert.equal(context.api.snapshot().workspace.conversations.at(-1).messages[0].content, 'What is in this space?');
  assert.deepEqual(speech.spoken.map(item => item.text), ['A spoken answer.']);
  speech.spoken[0].onend();
  await flushRequests();
  assert.equal(speech.recognitions.length, 2, 'the next turn starts only after the answer finishes');
  const stop = namedButton(context.host, 'Stop voice dialogue');
  await stop.click();
  assert.ok(namedButton(context.host, 'Start voice dialogue'));
  assert.ok(speech.recognitions[1].aborts > 0);
  assert.equal(label(context.host, 'Allow automatic sending during voice dialogue').checked, false);
});

test('long spoken replies disclose that playback reads only the beginning while preserving the complete text', async t => {
  const speech = speechBrowser(), content = 'Long reply. '.repeat(800);
  const context = setup({ configureWindow: speech.configureWindow, fetcher: path => response(path === '/api/gpt/status' ? status() : { provider: 'chatgpt', model: 'plan-model', content }) }); t.after(() => context.api.destroy());
  await context.api.refresh(); label(context.host, 'Read voice replies aloud').checked = true;
  await voiceDraft(context, speech);
  await classNode(context.host, 'my-gpt-composer').fire('submit');
  assert.ok(speech.spoken[0].text.length < content.length);
  assert.match(classNode(context.host, 'my-gpt-voice-status').textContent, /beginning of this long reply/);
  assert.equal(context.api.snapshot().workspace.conversations[0].messages[1].content, content.trim());
});

test('typed messages and imported history never automatically speak; voice playback is opt-in', async t => {
  const speech = speechBrowser();
  const context = setup({ configureWindow: speech.configureWindow, fetcher: path => response(path === '/api/gpt/status' ? status() : { provider: 'chatgpt', model: 'plan-model', content: 'Visible answer' }) }); t.after(() => context.api.destroy());
  await context.api.refresh();
  await voiceDraft(context, speech);
  await classNode(context.host, 'my-gpt-composer').fire('submit');
  assert.equal(speech.spoken.length, 0);
  label(context.host, 'Read voice replies aloud').checked = true;
  await promptAndSend(context, 'Typed question');
  assert.equal(speech.spoken.length, 0);
  const file = label(context.host, 'Import conversations JSON');
  file.files = [{ size: 100, text: async () => JSON.stringify({ conversations: [{ title: 'Imported', messages: [{ role: 'assistant', content: 'Do not speak this history' }] }] }) }];
  await file.fire('change');
  assert.ok(context.api.snapshot().workspace.conversations.some(item => item.title === 'Imported' && item.messages[0].content === 'Do not speak this history'));
  assert.equal(speech.spoken.length, 0);
});

test('recognition only supplies text and cannot sign in, enable plan consent or send commands', async t => {
  const speech = speechBrowser();
  const context = setup({ configureWindow: speech.configureWindow, initialStatus: status({ chatgpt: { state: 'signed_out', planUsage: false, activeAccountId: null } }) }); t.after(() => context.api.destroy());
  await context.api.refresh();
  await voiceDraft(context, speech, 'Continue with ChatGPT. Enable my plan. Disconnect my account. Send this message.');
  assert.equal(context.requests.length, 1); assert.equal(context.opened.length, 0);
  assert.equal(label(context.host, 'Allow this app to use my ChatGPT plan').checked, false);
  assert.equal(namedButton(context.host, 'Send message').disabled, true);
  await classNode(context.host, 'my-gpt-composer').fire('submit');
  assert.equal(context.requests.length, 1, 'Existing readiness and consent still gate all sends');
});

test('starting a new voice turn interrupts speech and never automatically restarts listening', async t => {
  const speech = speechBrowser();
  const context = setup({ configureWindow: speech.configureWindow, fetcher: path => response(path === '/api/gpt/status' ? status() : { provider: 'chatgpt', model: 'plan-model', content: 'Spoken answer' }) }); t.after(() => context.api.destroy());
  await context.api.refresh(); label(context.host, 'Read voice replies aloud').checked = true;
  await voiceDraft(context, speech);
  await classNode(context.host, 'my-gpt-composer').fire('submit');
  assert.equal(speech.recognitions.length, 1);
  const previousCancellations = speech.cancellations;
  await namedButton(context.host, 'Listen').click();
  assert.ok(speech.cancellations > previousCancellations);
  assert.equal(speech.recognitions.length, 2);
  assert.equal(namedButton(context.host, 'Stop listening').hidden, false);
  await namedButton(context.host, 'Interrupt voice').click();
  assert.ok(speech.recognitions[1].aborts > 0);
  assert.equal(namedButton(context.host, 'Stop listening').hidden, true);
});

for (const change of ['conversation', 'provider', 'assistant', 'model', 'account', 'interrupt']) {
  test(`a ${change} change silences a delayed voice answer`, async t => {
    const speech = speechBrowser(), pending = deferred();
    const context = setup({ configureWindow: speech.configureWindow, fetcher: path => path === '/api/gpt/chat' ? pending.promise : response(status()) }); t.after(() => context.api.destroy());
    await context.api.refresh(); label(context.host, 'Read voice replies aloud').checked = true;
    await voiceDraft(context, speech);
    const sent = classNode(context.host, 'my-gpt-composer').fire('submit'); await flushRequests();
    if (change === 'conversation') await namedButton(context.host, 'New chat').click();
    if (change === 'provider') await namedButton(context.host, 'OpenAI API').click();
    if (change === 'assistant') await label(context.host, 'Assistant').fire('change');
    if (change === 'model') { const model = label(context.host, 'Model'); model.disabled = false; await model.fire('change'); }
    if (change === 'account') await label(context.host, 'ChatGPT account').fire('change');
    if (change === 'interrupt') await namedButton(context.host, 'Interrupt voice').click();
    pending.resolve(response({ provider: 'chatgpt', model: 'plan-model', content: 'Late voice answer' })); await sent;
    assert.equal(speech.spoken.length, 0);
    assert.equal(context.requests[1].options.signal.aborted, true);
  });
}

test('hiding the owner or disabling playback suppresses a pending spoken reply', async t => {
  for (const action of ['hide', 'disable', 'pagehide', 'popstate', 'hashchange']) {
    const speech = speechBrowser(), pending = deferred();
    const context = setup({ configureWindow: speech.configureWindow, fetcher: path => path === '/api/gpt/chat' ? pending.promise : response(status()) }); t.after(() => context.api.destroy());
    await context.api.refresh(); label(context.host, 'Read voice replies aloud').checked = true;
    await voiceDraft(context, speech);
    const sent = classNode(context.host, 'my-gpt-composer').fire('submit'); await flushRequests();
    if (action === 'hide') { context.api.setActive(false); context.api.setActive(true); }
    if (action === 'disable') { const read = label(context.host, 'Read voice replies aloud'); read.checked = false; await read.fire('change'); read.checked = true; }
    if (['pagehide', 'popstate', 'hashchange'].includes(action)) await context.win.fire(action);
    pending.resolve(response({ provider: 'chatgpt', model: 'plan-model', content: 'A visible reply only' })); await sent;
    assert.equal(speech.spoken.length, 0, action);
    assert.match(context.host.textContent, /A visible reply only/);
    context.api.destroy();
  }
});

test('manual prompt edits preserve the draft against late recognition callbacks', async t => {
  const speech = speechBrowser();
  const context = setup({ configureWindow: speech.configureWindow }); t.after(() => context.api.destroy());
  await namedButton(context.host, 'Listen').click();
  const recognition = speech.recognitions[0]; recognition.result('First words');
  const lateResult = recognition.onresult;
  const prompt = label(context.host, 'Message My GPT'); prompt.value = 'My correction'; await prompt.fire('input');
  const result = [{ transcript: 'Late overwrite' }]; result.isFinal = true;
  lateResult?.({ resultIndex: 0, results: [result] });
  assert.equal(prompt.value, 'My correction');
  assert.ok(recognition.aborts > 0);
});

test('general dictation can mark an explicit voice turn without sending it', async t => {
  const speech = speechBrowser();
  const context = setup({ configureWindow: speech.configureWindow, fetcher: path => response(path === '/api/gpt/status' ? status() : { provider: 'chatgpt', model: 'plan-model', content: 'Reply to dictation' }) }); t.after(() => context.api.destroy());
  await context.api.refresh(); label(context.host, 'Read voice replies aloud').checked = true;
  const prompt = label(context.host, 'Message My GPT'); prompt.value = 'Dictated through the general microphone'; await prompt.fire('input');
  await prompt.fire('matumbo:voice-input', { detail: { final: true, source: 'dictation' } });
  assert.equal(context.requests.length, 1);
  await classNode(context.host, 'my-gpt-composer').fire('submit');
  assert.deepEqual(speech.spoken.map(item => item.text), ['Reply to dictation']);
});

test('unsupported speech remains usable as typed chat and destroy tears down active capture', async t => {
  const context = setup(); t.after(() => context.api.destroy());
  assert.equal(namedButton(context.host, 'Listen').disabled, true);
  assert.equal(label(context.host, 'Read voice replies aloud').disabled, true);
  assert.match(context.host.textContent, /Speech recognition is unavailable/);
  const speech = speechBrowser();
  const speakingContext = setup({ configureWindow: speech.configureWindow });
  await namedButton(speakingContext.host, 'Listen').click();
  speakingContext.api.destroy();
  assert.ok(speech.recognitions[0].aborts > 0);
  assert.equal(speakingContext.host.children.length, 0);
});

test('closing and minimizing the owning Web + AI surface stop voice and reopen preserves the provider', async t => {
  const speech = speechBrowser();
  const context = setup({ configureWindow: speech.configureWindow }); context.api.destroy();
  const consoleApi = createWebAiConsole({ documentRoot: context.doc, windowRoot: context.win, storage: context.storage });
  t.after(() => consoleApi.close());
  consoleApi.openGptProvider('openai'); await flushRequests();
  const openedContext = consoleApi.getVoiceContext();
  for (const action of ['close', 'minimize']) {
    await namedButton(context.doc, 'Listen').click();
    const recognition = speech.recognitions.at(-1);
    consoleApi[action]();
    assert.notEqual(consoleApi.getVoiceContext(), openedContext);
    assert.ok(recognition.aborts > 0, action);
    assert.equal(namedButton(context.doc, 'Listen').disabled, true);
    consoleApi.setTab('gpt'); consoleApi.open();
    assert.equal(namedButton(context.doc, 'Listen').disabled, false);
    assert.equal(consoleApi.getGptSnapshot().provider, 'openai');
    assert.equal(consoleApi.getVoiceContext(), openedContext);
  }
});

test('voice context contains only owner identity and remains stable while editing or speaking', async t => {
  const speech = speechBrowser();
  const context = setup({ configureWindow: speech.configureWindow }); t.after(() => context.api.destroy());
  await context.api.refresh();
  const initial = context.api.voiceContext();
  await voiceDraft(context, speech, 'Private dictated words stay outside the context key');
  assert.equal(context.api.voiceContext(), initial);
  const prompt = label(context.host, 'Message My GPT'); prompt.value += ' with a review'; await prompt.fire('input');
  assert.equal(context.api.voiceContext(), initial);
  const readReplies = label(context.host, 'Read voice replies aloud'); readReplies.checked = true; await readReplies.fire('change');
  const language = label(context.host, 'Voice language'); language.value = 'es-ES'; await language.fire('change');
  await context.api.refresh();
  assert.equal(context.api.voiceContext(), initial, 'Voice preferences and readiness refresh do not change the destination');
  assert.doesNotMatch(context.api.voiceContext(), /Private|dictated|review|instructions|messages/);
  context.api.setActive(false); assert.notEqual(context.api.voiceContext(), initial);
  context.api.setActive(true); assert.equal(context.api.voiceContext(), initial);
  await namedButton(context.host, 'OpenAI API').click(); assert.notEqual(context.api.voiceContext(), initial);
  await namedButton(context.host, 'ChatGPT plan').click(); assert.equal(context.api.voiceContext(), initial);
});

test('voice context changes for real assistant, model, active account and conversation transitions only', async t => {
  let bridgeStatus = status({ models: [...status().models, { id: 'second-plan-model', label: 'Second plan model', provider: 'chatgpt' }] });
  const context = setup({ fetcher: path => response(path === '/api/gpt/status' ? bridgeStatus : { provider: 'chatgpt', model: 'plan-model', content: 'Private assistant answer' }) });
  t.after(() => context.api.destroy());
  await context.api.refresh(); let previous = context.api.voiceContext();
  label(context.host, 'Assistant name').value = 'Context test assistant';
  label(context.host, 'Local instructions (optional)').value = 'Private instructions should never enter the key';
  await classNode(context.host, 'my-gpt-form').fire('submit');
  assert.notEqual(context.api.voiceContext(), previous, 'Selecting the new assistant changes destination identity');
  previous = context.api.voiceContext();
  const model = label(context.host, 'Model'); model.value = 'second-plan-model'; await model.fire('change');
  assert.notEqual(context.api.voiceContext(), previous, 'Changing the selected model changes destination identity');
  previous = context.api.voiceContext();
  const account = label(context.host, 'ChatGPT account'); account.value = 'new'; await account.fire('change');
  assert.equal(context.api.voiceContext(), previous, 'Preparing sign-in does not yet change the active account');
  bridgeStatus = status({ ...bridgeStatus, chatgpt: { ...bridgeStatus.chatgpt, activeAccountId: 'oaiapp_second', accounts: [{ id: 'oaiapp_second', label: 'Second account', active: true }] } });
  await context.api.refresh();
  assert.notEqual(context.api.voiceContext(), previous, 'A changed active account invalidates the destination');
  previous = context.api.voiceContext();
  await promptAndSend(context, 'First private conversation message');
  assert.notEqual(context.api.voiceContext(), previous, 'The first Send creates the active conversation');
  previous = context.api.voiceContext();
  await promptAndSend(context, 'Another private message in the same conversation');
  assert.equal(context.api.voiceContext(), previous, 'Appending messages and marking a reply verified retain the same destination');
  await namedButton(context.host, 'New chat').click();
  assert.notEqual(context.api.voiceContext(), previous, 'New chat switches conversation identity');
  await namedButton(context.host, 'First private conversation message').click();
  assert.equal(context.api.voiceContext(), previous, 'Returning to the same conversation restores its destination identity');
  assert.doesNotMatch(context.api.voiceContext(), /Private|private|instructions|message|answer|Context test assistant/);
});

test('directly hiding an owner stops GPT voice without disabling it after the owner reopens', async t => {
  const speech = speechBrowser(), observers = [];
  let disconnected = 0;
  const context = setup({ configureWindow(win) {
    speech.configureWindow(win);
    win.MutationObserver = class {
      constructor(callback) { observers.push(callback); }
      observe() {}
      disconnect() { disconnected += 1; }
    };
  } }); t.after(() => context.api.destroy());
  await namedButton(context.host, 'Listen').click();
  const first = speech.recognitions.at(-1); first.result('Keep this draft');
  context.host.hidden = true;
  for (const callback of [...observers]) callback([{ type: 'attributes', target: context.host, attributeName: 'hidden' }]);
  await flushRequests();
  assert.ok(first.aborts > 0, 'A dock/mobile hidden toggle releases the microphone');
  assert.equal(label(context.host, 'Message My GPT').value, 'Keep this draft');
  context.host.hidden = false;
  for (const callback of [...observers]) callback([{ type: 'attributes', target: context.host, attributeName: 'hidden' }]);
  await flushRequests();
  await namedButton(context.host, 'Listen').click();
  assert.equal(speech.recognitions.length, 2, 'Visibility cleanup does not permanently deactivate the owner');
  context.api.destroy(); assert.ok(disconnected > 0);
});

test('mount is local and opening or refreshing never automatically sends a chat', async () => {
  const context = setup();
  assert.equal(context.requests.length, 0);
  await context.api.activate(); await context.win.fire('focus');
  assert.deepEqual(context.requests.map(item => item.path), ['/api/gpt/status', '/api/gpt/status']);
  assert.match(context.host.textContent, /Signing in does not expose or sync/);
  context.api.destroy();
  await context.win.fire('focus');
  assert.equal(context.requests.length, 2);
});

test('owner provider selection updates My GPT locally and accepts only supported providers', () => {
  const context = setup();
  assert.equal(context.api.selectProvider('openai'), true);
  assert.equal(context.api.snapshot().provider, 'openai');
  assert.equal(namedButton(context.host, 'OpenAI API').getAttribute('aria-pressed'), 'true');
  assert.equal(namedButton(context.host, 'ChatGPT plan').getAttribute('aria-pressed'), 'false');
  assert.equal(context.requests.length, 0);
  for (const provider of ['nvidia', '', null, 'OpenAI', {}, undefined]) {
    assert.throws(() => context.api.selectProvider(provider), /Choose ChatGPT plan or OpenAI API/);
    assert.equal(context.api.snapshot().provider, 'openai');
  }
  assert.equal(context.api.selectProvider('chatgpt'), true);
  assert.equal(context.api.snapshot().provider, 'chatgpt');
  assert.equal(context.requests.length, 0);
  context.api.destroy();
  assert.equal(context.api.selectProvider('openai'), false);
  assert.equal(context.api.snapshot().provider, 'chatgpt');
  assert.equal(context.requests.length, 0);
});

test('bridge calls fail closed on public origins and on a mismatched service contract', async () => {
  const publicPage = setup({ href: 'https://example.com/?feature=web-ai' });
  await publicPage.api.refresh();
  assert.equal(publicPage.requests.length, 0);
  assert.match(publicPage.host.textContent, /at localhost/);
  publicPage.api.destroy();
  const wrongBridge = setup({ initialStatus: status({ credentialsInBrowser: true }) });
  await wrongBridge.api.refresh();
  assert.equal(wrongBridge.api.snapshot().connected, false);
  assert.match(wrongBridge.host.textContent, /does not match/);
  wrongBridge.api.destroy();
});

test('plan permission gates sends and API configuration is not labeled as a verified answer', async () => {
  const context = setup({ initialStatus: status({ chatgpt: { planUsage: false } }) });
  await context.api.refresh();
  await promptAndSend(context);
  assert.equal(context.requests.length, 1);
  assert.equal(context.api.snapshot().connected, false);
  await namedButton(context.host, 'OpenAI API').click();
  assert.equal(context.api.snapshot().connected, true);
  assert.equal(classNode(context.host, 'my-gpt-state').textContent, 'Configured · untested');
  context.api.destroy();
});

test('explicit send uses the fixed local route, correct schema and safe assistant text', async () => {
  const hostileText = '<img src=x onerror=alert(1)> **plain text**';
  const context = setup({ fetcher: path => response(path === '/api/gpt/status' ? status() : { content: hostileText, model: 'plan-model', provider: 'chatgpt', verifiedAt: '2026-10-04' }) });
  await context.api.refresh();
  await promptAndSend(context, 'Think with me');
  const sent = context.requests[1];
  assert.equal(sent.path, '/api/gpt/chat');
  assert.equal(sent.options.method, 'POST');
  assert.equal(sent.options.redirect, 'error');
  assert.equal(sent.options.credentials, 'same-origin');
  assert.equal(sent.options.headers['X-Matumbo-Gpt'], '1');
  assert.deepEqual(JSON.parse(sent.options.body), { provider: 'chatgpt', accountId: 'oaiapp_example', model: 'plan-model', instructions: context.api.snapshot().workspace.profiles[0].instructions, messages: [{ role: 'user', content: 'Think with me' }] });
  assert.equal(context.api.snapshot().workspace.conversations[0].messages[1].content, hostileText);
  assert.ok(walk(context.host).some(item => item.tagName === 'P' && item.textContent === hostileText));
  assert.equal(walk(context.host).some(item => item.tagName === 'IMG'), false);
  assert.equal(classNode(context.host, 'my-gpt-state').textContent, 'Answer verified');
  assert.ok(context.saved.has(GPT_STORAGE_KEY));
  context.api.destroy();
});

test('switching conversations aborts the pending request and ignores a late provider answer', async () => {
  const pending = deferred();
  const context = setup({ fetcher: path => path === '/api/gpt/chat' ? pending.promise : response(status()) });
  await context.api.refresh();
  const sent = promptAndSend(context, 'Slow request'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.api.snapshot().pending, true);
  await namedButton(context.host, 'New chat').click();
  assert.equal(context.requests[1].options.signal.aborted, true);
  pending.resolve(response({ provider: 'chatgpt', content: 'Late answer', model: 'plan-model' })); await sent;
  assert.equal(context.api.snapshot().workspace.conversations.length, 2);
  assert.deepEqual(context.api.snapshot().workspace.conversations.map(item => item.messages.length), [1, 0]);
  assert.doesNotMatch(context.host.textContent, /Late answer/);
  context.api.destroy();
});

test('ChatGPT authorization reserves a tab in the click and only grants checked plan consent', async () => {
  const context = setup({ fetcher: path => response(path === '/api/gpt/status' ? status({ chatgpt: { state: 'signed_out', planUsage: false, activeAccountId: null, accounts: [] } }) : { authorizationUrl: 'https://auth.openai.com/api/accounts/authorize?state=test-only' }) });
  await context.api.refresh();
  label(context.host, 'Allow this app to use my ChatGPT plan').checked = true;
  await namedButton(context.host, 'Continue with ChatGPT').click();
  assert.deepEqual(JSON.parse(context.requests[1].options.body), { newAccount: true, enablePlan: true });
  assert.equal(context.opened[0].url, 'about:blank');
  assert.equal(context.opened[0].opener, null);
  assert.equal(context.opened[0].location.href, 'https://auth.openai.com/api/accounts/authorize?state=test-only');
  assert.equal(context.api.snapshot().connected, false);
  context.api.destroy();
});

test('an unrecognized authorization URL is rejected and the reserved tab closes', async () => {
  const context = setup({ fetcher: path => response(path === '/api/gpt/status' ? status() : { authorizationUrl: 'https://attacker.example/authorize' }) });
  await context.api.refresh();
  await namedButton(context.host, 'Continue with ChatGPT').click();
  assert.equal(context.opened[0].closed, true);
  assert.match(context.host.textContent, /unrecognized authorization address/);
  context.api.destroy();
});

test('disconnect and model catalog requests match the backend contract', async () => {
  const context = setup({ fetcher: path => response(path === '/api/gpt/models' ? { models: [{ id: 'second', label: 'Another model', provider: 'chatgpt' }] } : status()) });
  await context.api.refresh();
  assert.equal(context.requests.some(item => item.path === '/api/gpt/models'), false);
  await namedButton(context.host, 'Load available models').click();
  assert.equal(label(context.host, 'Model').value, 'second');
  await namedButton(context.host, 'Disconnect ChatGPT').click();
  const disconnect = context.requests.find(item => item.path === '/api/gpt/disconnect');
  assert.deepEqual(JSON.parse(disconnect.options.body), { accountId: 'oaiapp_example' });
  context.api.destroy();
});

test('a storage quota failure remains visible after a successful provider reply', async () => {
  const context = setup({ storageFailure: true, fetcher: path => response(path === '/api/gpt/status' ? status() : { provider: 'chatgpt', content: 'Useful reply', model: 'plan-model' }) });
  await context.api.refresh(); await promptAndSend(context);
  assert.match(context.host.textContent, /Browser storage is full or unavailable/);
  assert.match(context.host.textContent, /Export to keep this conversation/);
  assert.doesNotMatch(context.host.textContent, /Saved to this browser/);
  context.api.destroy();
});

test('missing model catalog gates ChatGPT Send and local dependency guidance is visible', async () => {
  const context = setup({ initialStatus: status({ models: [], chatgpt: { authAvailable: false, dependencyState: 'dependency_needed' } }) });
  await context.api.refresh(); await promptAndSend(context);
  assert.equal(context.requests.length, 1);
  assert.match(context.host.textContent, /Load available models before sending/);
  assert.match(context.host.textContent, /PyJWT\[crypto\]/);
  assert.equal(namedButton(context.host, 'Continue with ChatGPT').disabled, true);
  context.api.destroy();
});

test('Stop waiting settles an uncooperative fetch without claiming that provider processing was cancelled', { timeout: 1_000 }, async () => {
  const pending = deferred();
  const context = setup({ fetcher: path => path === '/api/gpt/chat' ? pending.promise : response(status()) });
  await context.api.refresh(); const sent = promptAndSend(context); await new Promise(resolve => setImmediate(resolve));
  await namedButton(context.host, 'Stop waiting').click();
  await sent;
  assert.match(context.host.textContent, /provider may continue processing/);
  assert.doesNotMatch(context.host.textContent, /timed out|Stopped waiting after/);
  assert.equal(context.requests[1].options.signal.aborted, true);
  assert.equal(context.api.snapshot().pending, false);
  pending.resolve(response({ provider: 'chatgpt', content: 'Late', model: 'plan-model' })); await flushRequests();
  assert.equal(context.api.snapshot().workspace.conversations[0].messages.length, 1);
  context.api.destroy();
});

for (const stalledStage of ['fetch', 'body']) {
  test(`status deadline settles a stalled ${stalledStage}, ignores its late data and restores refresh`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred(); let first = true;
    const context = setup({ fetcher: () => {
      if (!first) return response(status());
      first = false;
      return stalledStage === 'fetch' ? pending.promise : { ...response(null), json: () => pending.promise };
    } });
    t.after(() => context.api.destroy());
    const checking = context.api.refresh(); await flushRequests();
    t.mock.timers.tick(GPT_REQUEST_TIMEOUT_MS['/api/gpt/status'] - 1); await flushRequests();
    assert.equal(namedButton(context.host, 'Refresh status').disabled, true);
    t.mock.timers.tick(1); assert.equal(await checking, null);
    assert.equal(context.requests[0].options.signal.aborted, true);
    assert.equal(namedButton(context.host, 'Refresh status').disabled, false);
    assert.equal(context.api.snapshot().connected, false);
    assert.match(classNode(context.host, 'my-gpt-notice').textContent, /Connection status timed out after 15 seconds/);
    assert.equal(classNode(context.host, 'my-gpt-notice').dataset.kind, 'error');
    pending.resolve(stalledStage === 'fetch' ? response(status()) : status()); await flushRequests();
    assert.equal(context.api.snapshot().connected, false);
    assert.match(classNode(context.host, 'my-gpt-notice').textContent, /timed out/);
    await context.api.refresh();
    assert.equal(context.api.snapshot().connected, true);
    // Successful work releases its deadline; advancing time must not abort it.
    t.mock.timers.tick(GPT_REQUEST_TIMEOUT_MS['/api/gpt/status']); await flushRequests();
    assert.equal(context.requests[1].options.signal.aborted, false);
    assert.match(classNode(context.host, 'my-gpt-notice').textContent, /Ready to send/);
  });
}

test('replacing status settles an aborted uncooperative fetch and preserves the latest readiness', { timeout: 1_000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred(); let first = true;
  const context = setup({ fetcher: () => { if (!first) return response(status()); first = false; return pending.promise; } });
  t.after(() => context.api.destroy());
  const previous = context.api.refresh(); await flushRequests();
  await context.api.refresh(); assert.equal(await previous, null);
  assert.equal(context.requests[0].options.signal.aborted, true);
  assert.equal(context.api.snapshot().connected, true);
  assert.equal(namedButton(context.host, 'Refresh status').disabled, false);
  t.mock.timers.tick(GPT_REQUEST_TIMEOUT_MS['/api/gpt/status']); await flushRequests();
  assert.equal(context.requests[1].options.signal.aborted, false);
  assert.match(classNode(context.host, 'my-gpt-notice').textContent, /Ready to send/);
  pending.resolve(response(status({ credentialsInBrowser: true }))); await flushRequests();
  assert.equal(context.api.snapshot().connected, true);
});

test('model loading times out, retains the current catalog and allows another load', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred(); let firstModels = true;
  const context = setup({ fetcher: path => {
    if (path !== '/api/gpt/models') return response(status());
    if (!firstModels) return response({ models: [{ id: 'retry-model', provider: 'chatgpt' }] });
    firstModels = false; return pending.promise;
  } });
  t.after(() => context.api.destroy()); await context.api.refresh();
  const loading = namedButton(context.host, 'Load available models').click(); await flushRequests();
  assert.equal(namedButton(context.host, 'Load available models').disabled, true);
  t.mock.timers.tick(GPT_REQUEST_TIMEOUT_MS['/api/gpt/models']); await loading;
  assert.equal(namedButton(context.host, 'Load available models').disabled, false);
  assert.equal(label(context.host, 'Model').value, 'plan-model');
  assert.equal(context.requests[1].options.signal.aborted, true);
  assert.match(classNode(context.host, 'my-gpt-notice').textContent, /Loading models timed out after 180 seconds/);
  pending.resolve(response({ models: [{ id: 'late-model', provider: 'chatgpt' }] })); await flushRequests();
  assert.equal(label(context.host, 'Model').value, 'plan-model');
  await namedButton(context.host, 'Load available models').click();
  assert.equal(label(context.host, 'Model').value, 'retry-model');
  t.mock.timers.tick(GPT_REQUEST_TIMEOUT_MS['/api/gpt/models']); await flushRequests();
  assert.equal(context.requests[0].options.signal.aborted, false);
  assert.equal(context.requests[2].options.signal.aborted, false);
});

test('sign-in initiation timeout closes the reserved tab and permits a new explicit attempt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred(); let firstSignIn = true;
  const authorization = { authorizationUrl: 'https://auth.openai.com/api/accounts/authorize?state=retry-only' };
  const context = setup({ fetcher: path => {
    if (path !== '/api/gpt/sign-in') return response(status());
    if (!firstSignIn) return response(authorization);
    firstSignIn = false; return pending.promise;
  } });
  t.after(() => context.api.destroy()); await context.api.refresh();
  const connecting = namedButton(context.host, 'Continue with ChatGPT').click(); await flushRequests();
  assert.equal(namedButton(context.host, 'Continue with ChatGPT').disabled, true);
  t.mock.timers.tick(GPT_REQUEST_TIMEOUT_MS['/api/gpt/sign-in']); await connecting;
  assert.equal(context.opened[0].closed, true);
  assert.equal(context.opened[0].location.href, 'about:blank');
  assert.equal(namedButton(context.host, 'Continue with ChatGPT').disabled, false);
  assert.equal(context.requests[1].options.signal.aborted, true);
  assert.match(classNode(context.host, 'my-gpt-notice').textContent, /Sign-in setup timed out after 30 seconds/);
  pending.resolve(response(authorization)); await flushRequests();
  assert.equal(context.opened[0].location.href, 'about:blank');
  assert.equal(walk(context.host).find(item => item.tagName === 'A' && item.textContent === 'Open ChatGPT authorization →').hidden, true);
  await namedButton(context.host, 'Continue with ChatGPT').click();
  assert.equal(context.opened[1].location.href, authorization.authorizationUrl);
  assert.equal(context.opened[1].closed, false);
});

test('disconnect timeout releases account controls without claiming revocation or disconnection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred();
  const context = setup({ fetcher: path => path === '/api/gpt/disconnect' ? pending.promise : response(status()) });
  t.after(() => context.api.destroy()); await context.api.refresh();
  const disconnecting = namedButton(context.host, 'Disconnect ChatGPT').click(); await flushRequests();
  t.mock.timers.tick(GPT_REQUEST_TIMEOUT_MS['/api/gpt/disconnect']); await disconnecting;
  assert.equal(namedButton(context.host, 'Disconnect ChatGPT').disabled, false);
  assert.equal(label(context.host, 'ChatGPT account').disabled, false);
  assert.equal(context.requests[1].options.signal.aborted, true);
  assert.match(classNode(context.host, 'my-gpt-notice').textContent, /Disconnection and remote revocation are not confirmed/);
  pending.resolve(response({ disconnected: true, remoteRevocationConfirmed: true, message: 'Signed out.' })); await flushRequests();
  assert.equal(context.requests.length, 2);
  assert.match(classNode(context.host, 'my-gpt-notice').textContent, /not confirmed/);
});

for (const stalledStage of ['fetch', 'body']) {
  test(`chat deadline settles a stalled ${stalledStage}, preserves the prompt and ignores a late answer`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred(); let firstChat = true;
    const context = setup({ fetcher: path => {
      if (path !== '/api/gpt/chat') return response(status());
      if (!firstChat) return response({ provider: 'chatgpt', model: 'plan-model', content: 'A new answer' });
      firstChat = false;
      return stalledStage === 'fetch' ? pending.promise : { ...response(null), json: () => pending.promise };
    } });
    t.after(() => context.api.destroy()); await context.api.refresh();
    const sent = promptAndSend(context, 'Keep my timed-out question'); await flushRequests();
    t.mock.timers.tick(GPT_REQUEST_TIMEOUT_MS['/api/gpt/chat'] - 1); await flushRequests();
    assert.equal(context.api.snapshot().pending, true);
    t.mock.timers.tick(1); await sent;
    assert.equal(context.api.snapshot().pending, false);
    assert.equal(namedButton(context.host, 'Stop waiting').hidden, true);
    assert.equal(namedButton(context.host, 'Send message').textContent, 'Send message');
    assert.equal(classNode(context.host, 'my-gpt-messages').getAttribute('aria-busy'), 'false');
    assert.equal(context.requests[1].options.signal.aborted, true);
    assert.match(classNode(context.host, 'my-gpt-notice').textContent, /Stopped waiting after 240 seconds/);
    assert.match(classNode(context.host, 'my-gpt-notice').textContent, /provider may continue processing/i);
    assert.equal(classNode(context.host, 'my-gpt-notice').dataset.kind, 'error');
    assert.equal(classNode(context.host, 'my-gpt-state').textContent, 'Signed in');
    const lateAnswer = { provider: 'chatgpt', model: 'plan-model', content: 'A late answer' };
    pending.resolve(stalledStage === 'fetch' ? response(lateAnswer) : lateAnswer); await flushRequests();
    assert.deepEqual(context.api.snapshot().workspace.conversations[0].messages, [{ role: 'user', content: 'Keep my timed-out question' }]);
    assert.doesNotMatch(context.host.textContent, /A late answer/);
    await promptAndSend(context, 'A new question');
    assert.equal(context.api.snapshot().workspace.conversations[0].messages.at(-1).content, 'A new answer');
    t.mock.timers.tick(GPT_REQUEST_TIMEOUT_MS['/api/gpt/chat']); await flushRequests();
    assert.equal(context.requests[2].options.signal.aborted, false);
    assert.match(classNode(context.host, 'my-gpt-notice').textContent, /Reply received/);
  });
}

test('disconnect preserves a warning when remote revocation cannot be confirmed', async () => {
  const context = setup({ fetcher: path => response(path === '/api/gpt/disconnect' ? { remoteRevocationConfirmed: false, message: 'Local credentials removed. OpenAI revocation could not be confirmed.' } : status()) });
  await context.api.refresh(); await namedButton(context.host, 'Disconnect ChatGPT').click();
  assert.match(context.host.textContent, /OpenAI revocation could not be confirmed/);
  assert.equal(classNode(context.host, 'my-gpt-notice').dataset.kind, 'error');
  context.api.destroy();
});

test('JSON import stays local and clearing local history requires the visible second action', async () => {
  const context = setup();
  const input = label(context.host, 'Import conversations JSON');
  input.files = [{ size: 100, text: async () => JSON.stringify([{ id: 'imported', title: 'Imported history', messages: [{ role: 'user', content: 'My previous question' }] }]) }];
  await input.fire('change');
  assert.equal(context.requests.length, 0);
  assert.equal(context.api.snapshot().workspace.conversations.length, 1);
  await namedButton(context.host, 'Clear local history').click();
  assert.equal(context.api.snapshot().workspace.conversations.length, 1);
  await namedButton(context.host, 'Confirm clear local history').click();
  assert.equal(context.api.snapshot().workspace.conversations.length, 0);
  assert.equal(context.api.snapshot().workspace.profiles.length, 1);
  context.api.destroy();
});

test('destroy aborts pending work and prevents a late answer from mutating persisted history', async () => {
  const pending = deferred();
  const context = setup({ fetcher: path => path === '/api/gpt/chat' ? pending.promise : response(status()) });
  await context.api.refresh(); const sent = promptAndSend(context); await new Promise(resolve => setImmediate(resolve));
  context.api.destroy();
  assert.equal(context.requests[1].options.signal.aborted, true);
  pending.resolve(response({ provider: 'chatgpt', model: 'plan-model', content: 'Too late' })); await sent;
  assert.equal(JSON.parse(context.saved.get(GPT_STORAGE_KEY)).conversations[0].messages.length, 1);
  assert.equal(context.host.children.length, 0);
});

test('Web + AI owns one My GPT surface and preserves all existing sections', async () => {
  const context = setup(); context.api.destroy();
  const consoleApi = createWebAiConsole({ documentRoot: context.doc, windowRoot: context.win, storage: context.storage });
  assert.equal(consoleApi.getState().tab, 'gpt');
  assert.equal(walk(context.doc).filter(item => item.dataset.myGpt === 'true').length, 1);
  assert.equal(context.requests.length, 0);
  consoleApi.open(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.requests[0].path, '/api/gpt/status');
  for (const tab of ['web', 'ai', 'economy', 'gpt']) {
    consoleApi.setTab(tab);
    assert.equal(consoleApi.getState().tab, tab);
    const sections = walk(context.doc).filter(item => item.dataset.panel);
    assert.deepEqual(sections.filter(item => !item.hidden).map(item => item.dataset.panel), [tab]);
    const autofocus = walk(context.doc).filter(item => item.hasAttribute('data-autofocus'));
    assert.equal(autofocus.length, tab === 'gpt' ? 1 : 0);
    if (tab === 'gpt') assert.equal(autofocus[0].tagName, 'H3');
  }
  assert.ok(consoleApi.getGptSnapshot().workspace.profiles.length);
  const panel = walk(context.doc).find(item => item.id === 'web-ai-console');
  const semantic = createRealitySurfaceDocument({ element: panel, feature: { id: 'web-ai' } });
  const blocks = semantic.read();
  assert.equal(blocks.find(item => item.kind === 'heading').text, 'My GPT');
  assert.ok(blocks.findIndex(item => item.text === 'Message My GPT') < blocks.findIndex(item => item.text === 'Account & setup'));
  assert.ok(blocks.findIndex(item => item.text === 'Message My GPT') < blocks.findIndex(item => item.text === 'Web + AI'));
  semantic.dispose();
});

test('OAuth callback selects My GPT over a saved Web tab and consumes the callback flag', async () => {
  const context = setup({ href: 'http://127.0.0.1:8082/?feature=web-ai&gpt_connected=1', fetcher: path => response(path === '/api/gpt/models' ? { models: [] } : status()) }); context.api.destroy();
  context.storage.setItem(WEB_AI_STORAGE_KEYS.lastTab, 'web');
  const consoleApi = createWebAiConsole({ documentRoot: context.doc, windowRoot: context.win, storage: context.storage });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(consoleApi.getState().tab, 'gpt');
  assert.equal(new URL(context.win.location.href).searchParams.has('gpt_connected'), false);
  assert.deepEqual(context.requests.map(item => item.path), ['/api/gpt/status', '/api/gpt/models']);
});

test('shared provider link and explicit owner handoff select the requested GPT mode over a saved web tab', () => {
  const context = setup({ href: 'http://127.0.0.1:8082/?feature=web-ai&gpt-provider=openai' }); context.api.destroy();
  context.storage.setItem(WEB_AI_STORAGE_KEYS.lastTab, 'web');
  const consoleApi = createWebAiConsole({ documentRoot: context.doc, windowRoot: context.win, storage: context.storage });
  assert.equal(consoleApi.getState().tab, 'gpt'); assert.equal(consoleApi.getGptSnapshot().provider, 'openai'); assert.equal(context.requests.length, 0);
  consoleApi.openGptProvider('chatgpt'); assert.equal(consoleApi.getGptSnapshot().provider, 'chatgpt'); assert.equal(consoleApi.getState().opened, true);
  assert.throws(() => consoleApi.openGptProvider('unknown')); assert.equal(consoleApi.getGptSnapshot().provider, 'chatgpt');
});
