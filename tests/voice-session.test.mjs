import assert from "node:assert/strict";
import { test } from "node:test";
import { claimVoiceActivity, createSpeechInput, createVoiceRecorder, createVoiceOutput, watchVoiceOwnerVisibility } from "../src/render/voice-session.js";

class Events {
  listeners = new Map();
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  dispatch(name) { for (const callback of [...(this.listeners.get(name) || [])]) callback({ type: name }); }
  count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fakeBrowser({ permission, stallStop = false, supportedMimes, actualMime } = {}) {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const windowRoot = new Events();
  const document = new Events();
  document.hidden = false;
  document.visibilityState = "visible";
  const setTimeout = (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { due: now + delay, callback });
    return id;
  };
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      const [id, timer] = next;
      timers.delete(id);
      now = timer.due;
      timer.callback();
    }
    now = end;
  };
  const track = new Events();
  Object.assign(track, { readyState: "live", stops: 0, stop() { this.stops += 1; this.readyState = "ended"; } });
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const recognitionInstances = [];
  class Recognition {
    constructor() { this.starts = 0; this.stops = 0; this.aborts = 0; recognitionInstances.push(this); }
    start() { this.starts += 1; this.onstart?.(); }
    stop() { this.stops += 1; }
    abort() { this.aborts += 1; }
  }
  const recorderInstances = [];
  class Recorder {
    static isTypeSupported(type) { return supportedMimes ? supportedMimes.includes(type) : type === "audio/webm;codecs=opus"; }
    constructor(capture, options) {
      this.stream = capture;
      this.options = options;
      this.mimeType = actualMime || options.mimeType || "audio/webm";
      this.state = "inactive";
      this.finalData = "tail";
      recorderInstances.push(this);
    }
    start(timeslice) { this.state = "recording"; this.timeslice = timeslice; }
    data(text) { this.ondataavailable?.({ data: new Blob([text], { type: this.mimeType }) }); }
    stop() {
      this.state = "inactive";
      if (stallStop) return;
      setTimeout(() => { this.data(this.finalData); this.onstop?.(); }, 0);
    }
  }
  class Utterance { constructor(text) { this.text = text; } }
  const spoken = [];
  let synthesisCancels = 0;
  const mediaRequests = [];
  Object.assign(windowRoot, {
    document, isSecureContext: true, setTimeout, clearTimeout: (id) => timers.delete(id), performance: { now: () => now },
    SpeechRecognition: Recognition, MediaRecorder: Recorder, Blob,
    navigator: { mediaDevices: { getUserMedia(options) { mediaRequests.push(options); return permission?.promise || Promise.resolve(stream); } } },
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: { speak: (utterance) => spoken.push(utterance), cancel: () => { synthesisCancels += 1; } },
  });
  return { windowRoot, document, advance, timers, track, stream, recognitionInstances, recorderInstances, spoken, mediaRequests,
    get synthesisCancels() { return synthesisCancels; },
    hidden() { document.hidden = true; document.visibilityState = "hidden"; document.dispatch("visibilitychange"); },
  };
}

function result(text, isFinal) { return Object.assign([{ transcript: text }], { isFinal }); }
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("same-origin embedded speech and recording share ownership while stale frame releases remain harmless", async () => {
  const parent = fakeBrowser(), child = fakeBrowser();
  parent.windowRoot.parent = parent.windowRoot;
  child.windowRoot.parent = parent.windowRoot;
  const input = createSpeechInput({ windowRoot: parent.windowRoot });
  const recorder = createVoiceRecorder({ windowRoot: child.windowRoot });
  input.start();
  assert.equal(await recorder.start(), true);
  assert.equal(parent.recognitionInstances[0].aborts, 1);
  input.abort();
  assert.equal(recorder.getSnapshot().active, true);
  input.start();
  assert.equal(child.track.readyState, "ended");
  assert.equal(recorder.getSnapshot().active, false);
  input.destroy(); recorder.destroy();
});

test("an inaccessible ancestor keeps a frame's activity local without crossing the origin boundary", () => {
  const parent = { get document() { throw new Error("SecurityError"); } };
  const child = { parent }, other = {};
  const revoked = [];
  const releaseChild = claimVoiceActivity("child", () => revoked.push("child"), child);
  const releaseOther = claimVoiceActivity("other", () => revoked.push("other"), other);
  assert.deepEqual(revoked, []);
  const releaseNext = claimVoiceActivity("child-next", () => {}, child);
  assert.deepEqual(revoked, ["child"]);
  releaseChild(); releaseOther(); releaseNext();
});

test("voice factories never capture automatically and unsupported starts fail without requesting permission", async () => {
  const browser = fakeBrowser();
  const input = createSpeechInput({ windowRoot: browser.windowRoot });
  const recorder = createVoiceRecorder({ windowRoot: browser.windowRoot });
  const output = createVoiceOutput({ windowRoot: browser.windowRoot });
  assert.equal(browser.recognitionInstances.length, 0);
  assert.equal(browser.mediaRequests.length, 0);
  assert.equal(browser.spoken.length, 0);
  assert.equal(input.getSnapshot().processingLocation, "browser-service-may-be-remote");
  assert.equal(recorder.getSnapshot().processingLocation, "local-device");
  const unavailable = createSpeechInput({ windowRoot: {} });
  assert.equal(unavailable.start(), false);
  assert.equal(unavailable.getSnapshot().error, "unsupported");
  assert.equal(await createVoiceRecorder({ windowRoot: {} }).start(), false);
  assert.equal(await createVoiceOutput({ windowRoot: {} }).speak("Hello"), false);
  input.destroy(); recorder.destroy(); output.destroy(); unavailable.destroy();
});

test("recognition deduplicates cumulative final events and keeps corrected interim words out of finalized text", () => {
  const browser = fakeBrowser();
  const updates = [];
  const input = createSpeechInput({ windowRoot: browser.windowRoot, onUpdate: (snapshot) => updates.push(snapshot) });
  assert.equal(input.start({ language: "es-mx" }), true);
  const recognition = browser.recognitionInstances[0];
  assert.equal(recognition.lang, "es-MX");
  recognition.onresult({ results: [result("hola", true), result("mun", false)], resultIndex: 0 });
  assert.equal(updates.at(-1).transcript, "hola");
  assert.equal(updates.at(-1).interim, "mun");
  recognition.onresult({ results: [result("hola", true), result("mundo", false)], resultIndex: 1 });
  assert.equal(updates.at(-1).transcript, "hola");
  assert.equal(updates.at(-1).interim, "mundo");
  input.stop();
  recognition.onresult({ results: [result("hola", true), result("mundo", true)], resultIndex: 1 });
  recognition.onresult({ results: [result("hola", true), result("mundo", true)], resultIndex: 0 });
  recognition.onend();
  assert.equal(input.getSnapshot().transcript, "hola mundo");
  assert.equal(input.getSnapshot().interim, "");
  assert.equal(input.getSnapshot().status, "stopped");
  assert.equal(recognition.starts, 1, "natural end never restarts recognition");
  assert.equal(browser.timers.size, 0);
  input.destroy();
});

test("cancelled recognition ignores late result/error/end events across a fresh session", () => {
  const browser = fakeBrowser();
  const input = createSpeechInput({ windowRoot: browser.windowRoot });
  input.start();
  const old = browser.recognitionInstances[0];
  const lateResult = old.onresult;
  const lateError = old.onerror;
  const lateEnd = old.onend;
  input.abort();
  input.start();
  lateResult({ results: [result("stale words", true)] });
  lateError({ error: "not-allowed" });
  lateEnd();
  assert.equal(input.getSnapshot().transcript, "");
  assert.equal(input.getSnapshot().status, "listening");
  assert.equal(old.aborts, 1);
  browser.hidden();
  assert.equal(input.getSnapshot().active, false);
  assert.equal(input.getSnapshot().reason, "hidden");
  assert.equal(browser.windowRoot.count() + browser.document.count(), 0);
  assert.equal(browser.timers.size, 0);
  input.destroy();
});

test("recognition is bounded by text and time and validates language before opening the microphone", () => {
  const browser = fakeBrowser();
  const input = createSpeechInput({ windowRoot: browser.windowRoot });
  assert.equal(input.start({ language: "../../bad" }), false);
  assert.equal(input.getSnapshot().error, "invalid-language");
  assert.equal(browser.recognitionInstances.length, 0);
  input.start();
  browser.recognitionInstances[0].onresult({ results: [result("x".repeat(9000), true)] });
  assert.ok(input.getSnapshot().transcript.length <= 8000);
  assert.equal(input.getSnapshot().status, "stopping");
  assert.equal(input.getSnapshot().reason, "text-limit");
  browser.advance(2000);
  assert.equal(input.getSnapshot().active, false);
  input.start();
  browser.advance(90000);
  assert.equal(input.getSnapshot().status, "stopping");
  assert.equal(input.getSnapshot().reason, "time-limit");
  browser.advance(2000);
  assert.equal(input.getSnapshot().active, false);
  input.destroy();
});

test("recognition permission errors remain visible and do not trigger retries", () => {
  const browser = fakeBrowser();
  const input = createSpeechInput({ windowRoot: browser.windowRoot });
  input.start();
  const recognition = browser.recognitionInstances[0];
  recognition.onerror({ error: "not-allowed" });
  assert.equal(input.getSnapshot().error, "not-allowed");
  assert.equal(input.getSnapshot().status, "error");
  assert.match(input.getSnapshot().errorMessage, /permission was denied/);
  browser.advance(200000);
  assert.equal(browser.recognitionInstances.length, 1);
  assert.equal(recognition.aborts, 1);
  input.destroy();
});

test("a cancelled permission request resolves promptly and releases a late-granted stream", async () => {
  const permission = deferred();
  const browser = fakeBrowser({ permission });
  const recorder = createVoiceRecorder({ windowRoot: browser.windowRoot });
  const starting = recorder.start();
  assert.deepEqual(browser.mediaRequests, [{ audio: true, video: false }]);
  assert.equal(recorder.getSnapshot().status, "requesting");
  recorder.cancel();
  assert.equal(await starting, false);
  permission.resolve(browser.stream);
  await flush();
  assert.equal(browser.track.stops, 1);
  assert.equal(browser.recorderInstances.length, 0);
  assert.equal(await recorder.stop(), null);
  assert.equal(browser.timers.size, 0);
  recorder.destroy();
});

test("ignored permission prompts time out and cannot resurrect recording after approval", async () => {
  const permission = deferred();
  const browser = fakeBrowser({ permission });
  const recorder = createVoiceRecorder({ windowRoot: browser.windowRoot });
  const starting = recorder.start();
  browser.advance(15000);
  assert.equal(await starting, false);
  assert.equal(recorder.getSnapshot().error, "permission-timeout");
  permission.resolve(browser.stream);
  await flush();
  assert.equal(browser.track.stops, 1);
  assert.equal(browser.recorderInstances.length, 0);
  recorder.destroy();
});

test("normal stop releases the microphone immediately then includes the final audio chunk", async () => {
  const browser = fakeBrowser({ supportedMimes: ["audio/mp4"] });
  const recorder = createVoiceRecorder({ windowRoot: browser.windowRoot });
  assert.equal(await recorder.start(), true);
  const native = browser.recorderInstances[0];
  assert.equal(native.options.mimeType, "audio/mp4");
  assert.equal(native.options.audioBitsPerSecond, 32000);
  assert.equal(native.timeslice, 250);
  native.data("hello");
  browser.advance(1234.4);
  const stopping = recorder.stop();
  assert.equal(browser.track.readyState, "ended");
  assert.equal(recorder.getSnapshot().status, "stopping");
  browser.advance(0);
  const clip = await stopping;
  assert.equal(await clip.blob.text(), "hellotail");
  assert.equal(clip.mimeType, "audio/mp4");
  assert.equal(clip.durationMs, 1234);
  assert.equal(Number.isSafeInteger(clip.durationMs), true);
  assert.equal(clip.blob.type, "audio/mp4");
  assert.equal(recorder.getSnapshot().bytes, 9);
  assert.equal(await recorder.stop(), clip, "completed clip remains available to its view");
  assert.equal(browser.track.count(), 0);
  assert.equal(browser.windowRoot.count() + browser.document.count(), 0);
  assert.equal(browser.timers.size, 0);
  recorder.destroy();
  assert.equal(await recorder.stop(), null);
});

test("recorded MIME is canonical for message encryption and immediate clips have valid integer metadata", async () => {
  const browser = fakeBrowser({ supportedMimes: ["audio/mp4"], actualMime: 'audio/mp4; codecs="mp4a.40.2"' });
  const recorder = createVoiceRecorder({ windowRoot: browser.windowRoot });
  await recorder.start();
  const stopping = recorder.stop();
  browser.advance(0);
  const clip = await stopping;
  assert.equal(clip.durationMs, 1);
  assert.equal(clip.mimeType, "audio/mp4;codecs=mp4a.40.2");
  assert.equal(clip.blob.type, clip.mimeType);
  recorder.destroy();
  const unsupported = fakeBrowser({ actualMime: "audio/webm;codecs=unexpected" });
  const rejected = createVoiceRecorder({ windowRoot: unsupported.windowRoot });
  assert.equal(await rejected.start(), false);
  assert.equal(rejected.getSnapshot().error, "recording-failed");
  assert.equal(unsupported.track.readyState, "ended");
  rejected.destroy();
});

test("oversized and excessively fragmented recordings are discarded instead of returning damaged audio", async () => {
  for (const fragmented of [false, true]) {
    const browser = fakeBrowser();
    const recorder = createVoiceRecorder({ windowRoot: browser.windowRoot, maxBytes: fragmented ? 10000 : 8 });
    await recorder.start();
    const native = browser.recorderInstances[0];
    if (fragmented) for (let index = 0; index < 513; index += 1) native.data("a");
    else native.data("too much audio");
    assert.equal(await recorder.stop(), null);
    assert.equal(recorder.getSnapshot().error, "recording-too-large");
    assert.equal(recorder.getSnapshot().bytes, 0);
    assert.equal(browser.track.readyState, "ended");
    recorder.destroy();
  }
});

test("duration cap completes a clip; hidden pages, navigation, and lost tracks discard active capture", async () => {
  const browser = fakeBrowser();
  const recorder = createVoiceRecorder({ windowRoot: browser.windowRoot, maxDurationMs: 1000 });
  await recorder.start();
  browser.advance(1000);
  const clip = await recorder.stop();
  assert.equal(clip.durationMs, 1000);
  assert.equal(recorder.getSnapshot().reason, "time-limit");
  recorder.destroy();
  for (const cause of ["hidden", "pagehide", "popstate", "hashchange", "track-ended"]) {
    const browser = fakeBrowser();
    const recorder = createVoiceRecorder({ windowRoot: browser.windowRoot });
    await recorder.start();
    browser.recorderInstances[0].data("draft");
    if (cause === "hidden") browser.hidden();
    else if (cause === "track-ended") browser.track.dispatch("ended");
    else browser.windowRoot.dispatch(cause);
    assert.equal(await recorder.stop(), null, cause);
    assert.equal(browser.track.readyState, "ended", cause);
    assert.equal(recorder.getSnapshot().active, false, cause);
    recorder.destroy();
  }
});

test("recording stop and permission failure have bounded outcomes without unhandled rejections", async () => {
  const browser = fakeBrowser({ stallStop: true });
  const recorder = createVoiceRecorder({ windowRoot: browser.windowRoot });
  await recorder.start();
  browser.recorderInstances[0].data("draft");
  const stopping = recorder.stop();
  browser.advance(2000);
  assert.equal(await stopping, null);
  assert.equal(recorder.getSnapshot().error, "recording-timeout");
  recorder.destroy();
  const permission = deferred();
  const deniedBrowser = fakeBrowser({ permission });
  const denied = createVoiceRecorder({ windowRoot: deniedBrowser.windowRoot });
  const starting = denied.start();
  permission.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
  assert.equal(await starting, false);
  assert.equal(denied.getSnapshot().error, "not-allowed");
  denied.destroy();
});

test("speech playback and capture revoke one another while stale stop calls leave the new owner alone", async () => {
  const permission = deferred();
  const browser = fakeBrowser({ permission });
  const recorder = createVoiceRecorder({ windowRoot: browser.windowRoot });
  const input = createSpeechInput({ windowRoot: browser.windowRoot });
  const output = createVoiceOutput({ windowRoot: browser.windowRoot });
  const starting = recorder.start();
  const speaking = output.speak("Read this answer");
  assert.equal(await starting, false);
  assert.equal(recorder.getSnapshot().reason, "superseded");
  permission.resolve(browser.stream);
  await flush();
  assert.equal(browser.track.readyState, "ended");
  assert.equal(output.getSnapshot().status, "speaking");
  input.start();
  assert.equal(await speaking, false);
  assert.equal(browser.synthesisCancels, 1);
  assert.equal(input.getSnapshot().status, "listening");
  output.stop();
  recorder.cancel();
  assert.equal(input.getSnapshot().status, "listening");
  assert.equal(browser.synthesisCancels, 1);
  const answer = output.speak("Another answer");
  assert.equal(input.getSnapshot().reason, "superseded");
  input.abort();
  assert.equal(output.getSnapshot().status, "speaking");
  browser.spoken.at(-1).onend();
  assert.equal(await answer, true);
  recorder.destroy(); input.destroy(); output.destroy();
});

test("voice output handles errors, timeouts, hidden pages and stale callbacks without restarting", async () => {
  for (const ending of ["error", "timeout", "hidden"]) {
    const browser = fakeBrowser();
    const output = createVoiceOutput({ windowRoot: browser.windowRoot });
    const speaking = output.speak("hello");
    const lateEnd = browser.spoken[0].onend;
    if (ending === "error") browser.spoken[0].onerror({ error: "audio-busy" });
    if (ending === "timeout") browser.advance(15000);
    if (ending === "hidden") browser.hidden();
    assert.equal(await speaking, false);
    lateEnd();
    assert.equal(output.getSnapshot().active, false);
    assert.equal(browser.synthesisCancels, 1);
    assert.equal(browser.spoken.length, 1);
    assert.equal(browser.windowRoot.count() + browser.document.count(), 0);
    assert.equal(browser.timers.size, 0);
    output.destroy();
  }
});

test("voice output prefers a matching local voice and discloses when playback is truncated or potentially remote", async () => {
  const browser = fakeBrowser();
  const remote = { lang: "en-US", localService: false, name: "Remote English" };
  const local = { lang: "en-GB", localService: true, name: "Local English" };
  const wrongLanguage = { lang: "fr-FR", localService: true, name: "Local French" };
  browser.windowRoot.speechSynthesis.getVoices = () => [remote, wrongLanguage, local];
  const output = createVoiceOutput({ windowRoot: browser.windowRoot });
  const speaking = output.speak("x".repeat(9000), { language: "en-US" });
  assert.equal(browser.spoken.at(-1).voice, local);
  assert.equal(browser.spoken.at(-1).text.length, 8000);
  assert.equal(output.getSnapshot().processingLocation, "local-device");
  assert.equal(output.getSnapshot().truncated, true);
  output.stop();
  assert.equal(await speaking, false);
  browser.windowRoot.speechSynthesis.getVoices = () => [remote, wrongLanguage];
  const next = output.speak("hello");
  assert.equal(browser.spoken.at(-1).voice, remote);
  assert.equal(output.getSnapshot().processingLocation, "browser-voice-may-be-remote");
  assert.equal(output.getSnapshot().truncated, false);
  browser.spoken.at(-1).onend();
  assert.equal(await next, true);
  output.destroy();
});

test("activity coordination survives duplicate module URLs and old releases cannot erase a new claim", async () => {
  const duplicate = await import("../src/render/voice-session.js?separate-module-instance");
  const revoked = [];
  const releaseFirst = claimVoiceActivity("first", () => revoked.push("first"));
  const releaseSecond = duplicate.claimVoiceActivity("second", () => revoked.push("second"));
  assert.deepEqual(revoked, ["first"]);
  releaseFirst();
  const releaseThird = claimVoiceActivity("third", () => revoked.push("third"));
  assert.deepEqual(revoked, ["first", "second"]);
  releaseSecond();
  releaseThird();
});

test("destroyed controllers cannot reacquire capture or playback even through state callbacks", async () => {
  const browser = fakeBrowser();
  let recorder;
  recorder = createVoiceRecorder({ windowRoot: browser.windowRoot, onState: (snapshot) => {
    if (snapshot.reason === "destroyed") recorder.start();
  } });
  await recorder.start();
  recorder.destroy();
  assert.equal(await recorder.start(), false);
  assert.equal(browser.mediaRequests.length, 1);
  const input = createSpeechInput({ windowRoot: browser.windowRoot });
  input.start();
  input.destroy();
  assert.equal(input.start(), false);
  const output = createVoiceOutput({ windowRoot: browser.windowRoot });
  const speaking = output.speak("Hello");
  output.destroy();
  assert.equal(await speaking, false);
  assert.equal(await output.speak("Again"), false);
  assert.equal(browser.track.readyState, "ended");
});

function visibilityTree() {
  const observers = [];
  const clock = fakeBrowser();
  let styleReads = 0;
  class Observer {
    constructor(callback) { this.callback = callback; this.observations = []; this.disconnections = 0; observers.push(this); }
    observe(node, options) { this.observations.push({ node, options }); }
    disconnect() { this.observations = []; this.disconnections += 1; }
    notify() { this.callback([]); }
  }
  const windowRoot = new Events();
  const make = (parentElement = null) => ({ nodeType: 1, isConnected: true, parentElement, style: {}, attributes: {},
    getAttribute(name) { return this.attributes[name] ?? null; },
    getClientRects() { throw new Error("Offscreen geometry must not govern voice ownership"); },
  });
  const html = make(), body = make(html), parent = make(body), owner = make(parent);
  const document = { documentElement: html, body, defaultView: windowRoot };
  for (const element of [html, body, parent, owner]) element.ownerDocument = document;
  Object.assign(windowRoot, { document, MutationObserver: Observer, setTimeout: clock.windowRoot.setTimeout, clearTimeout: clock.windowRoot.clearTimeout, getComputedStyle(node) { styleReads += 1; return node.computedStyle || node.style; } });
  return { owner, parent, body, html, windowRoot, observers, make, advance: clock.advance, timers: clock.timers, get styleReads() { return styleReads; } };
}

test("owner visibility watcher stops voice once per real hide transition including ancestor and stylesheet hiding", () => {
  const tree = visibilityTree(), closed = [];
  const stop = watchVoiceOwnerVisibility({ element: tree.owner, windowRoot: tree.windowRoot, onHidden: (state) => closed.push(state) });
  const [attributes, children] = tree.observers;
  assert.equal(closed.length, 0);
  tree.owner.hidden = true;
  attributes.notify(); attributes.notify();
  assert.deepEqual(closed, [{ hidden: true, reason: "owner-hidden" }]);
  tree.owner.hidden = false; attributes.notify();
  tree.parent.attributes['aria-hidden'] = 'true'; attributes.notify();
  assert.equal(closed.length, 2);
  tree.parent.attributes['aria-hidden'] = 'false'; attributes.notify();
  tree.body.computedStyle = { display: 'none' }; attributes.notify();
  assert.equal(closed.length, 3);
  tree.body.computedStyle = {}; attributes.notify();
  tree.parent.style.visibility = 'hidden'; attributes.notify();
  assert.equal(closed.length, 4);
  const reads = tree.styleReads;
  children.notify();
  assert.equal(tree.styleReads, reads, "editing descendants does not repeatedly measure a stable owner");
  stop();
  tree.owner.hidden = false; attributes.notify();
  tree.owner.hidden = true; attributes.notify();
  assert.equal(closed.length, 4);
  assert.equal(tree.windowRoot.count(), 0);
  assert.ok(attributes.disconnections >= 1 && children.disconnections >= 1);
});

test("owner visibility watcher ignores initial hidden mounts and 360-degree offscreen styling", () => {
  const tree = visibilityTree();
  let closed = 0;
  tree.owner.hidden = true;
  const stop = watchVoiceOwnerVisibility({ element: tree.owner, windowRoot: tree.windowRoot, onHidden: () => { closed += 1; } });
  const [attributes] = tree.observers;
  attributes.notify();
  assert.equal(closed, 0);
  tree.owner.hidden = false;
  Object.assign(tree.owner.style, { opacity: '0', transform: 'translateX(-10000px) rotateY(180deg)', clipPath: 'circle(0px)' });
  attributes.notify();
  assert.equal(closed, 0);
  tree.owner.hidden = true; attributes.notify();
  assert.equal(closed, 1);
  stop();
});

test("owner visibility watcher follows reparenting without treating a temporary detach as a close", () => {
  const tree = visibilityTree();
  let closed = 0;
  const stop = watchVoiceOwnerVisibility({ element: tree.owner, windowRoot: tree.windowRoot, onHidden: () => { closed += 1; } });
  const [attributes, children] = tree.observers;
  tree.owner.isConnected = false;
  tree.owner.parentElement = null;
  children.notify();
  assert.equal(closed, 0);
  const nextParent = tree.make(tree.body);
  tree.owner.parentElement = nextParent; tree.owner.isConnected = true;
  children.notify();
  tree.advance(0);
  assert.equal(tree.timers.size, 0);
  assert.ok(attributes.observations.some(({ node }) => node === nextParent));
  assert.ok(!attributes.observations.some(({ node }) => node === tree.parent));
  tree.parent.hidden = true; attributes.notify();
  assert.equal(closed, 0, "an old ancestor no longer owns this voice surface");
  nextParent.hidden = true; attributes.notify();
  assert.equal(closed, 1);
  stop();
});

test("owner removal stops voice after a deferred reparent check and destroying the watcher clears that deadline", () => {
  for (const destroyBeforeDeadline of [false, true]) {
    const tree = visibilityTree(), closed = [];
    const stop = watchVoiceOwnerVisibility({ element: tree.owner, windowRoot: tree.windowRoot, onHidden: (state) => closed.push(state) });
    const [, children] = tree.observers;
    tree.owner.isConnected = false; tree.owner.parentElement = null;
    children.notify(); children.notify();
    assert.equal(closed.length, 0, "allow the current reparent operation to finish");
    assert.equal(tree.timers.size, 1);
    if (destroyBeforeDeadline) stop();
    tree.advance(0);
    assert.deepEqual(closed, destroyBeforeDeadline ? [] : [{ hidden: true, reason: "owner-detached" }]);
    children.notify(); tree.advance(0);
    assert.equal(closed.length, destroyBeforeDeadline ? 0 : 1);
    stop();
    assert.equal(tree.timers.size, 0);
  }
});

test("responsive stylesheet changes stop an owner through the visibility watcher without observing geometry", () => {
  const tree = visibilityTree();
  let closed = 0;
  const stop = watchVoiceOwnerVisibility({ element: tree.owner, windowRoot: tree.windowRoot, onHidden: () => { closed += 1; } });
  tree.parent.computedStyle = { display: 'none' };
  tree.windowRoot.dispatch('resize');
  assert.equal(closed, 1);
  stop();
});
