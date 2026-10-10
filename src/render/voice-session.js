/**
 * Shared, explicit-start browser voice sessions. This module never uploads or
 * persists audio. Browser speech recognition/synthesis can use remote services.
 * Final transcript callbacks are cumulative; interim text is always separate.
 */
const ACTIVITY_KEY = Symbol.for("matumbo.voice.activity.v1");
const SPEECH_LIMIT = 8000;
const SPEECH_DURATION_MS = 90000;
const PERMISSION_TIMEOUT_MS = 15000;
const FINISH_TIMEOUT_MS = 2000;
const MAX_RECORDING_CHUNKS = 512;
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"];
const ALLOWED_MIME_TYPES = new Set([...MIME_TYPES, "audio/mp4;codecs=mp4a.40.2"]);

// Embedded games share the nearest accessible ancestor window's slot. Reading
// document enforces the browser's origin boundary; third-party frames stay local.
function voiceActivityHost(windowRoot) {
  let host = windowRoot || globalThis;
  const visited = new Set([host]);
  try {
    while (host.parent && host.parent !== host && !visited.has(host.parent)) {
      const parent = host.parent;
      void parent.document;
      visited.add(parent);
      host = parent;
    }
  } catch { /* A cross-origin ancestor cannot share an activity registry. */ }
  return host;
}

/** Release only this claim; a stale release cannot stop another voice owner. */
export function claimVoiceActivity(owner, onRevoke = () => {}, windowRoot = globalThis) {
  const host = voiceActivityHost(windowRoot);
  const previous = host[ACTIVITY_KEY];
  const claim = { owner, onRevoke };
  host[ACTIVITY_KEY] = claim;
  try { previous?.onRevoke?.(); } catch { /* Cleanup must not block the new owner. */ }
  return () => {
    if (host[ACTIVITY_KEY] === claim) delete host[ACTIVITY_KEY];
  };
}

function notify(callback, snapshot) {
  try { callback?.(snapshot); } catch { /* A view callback cannot strand a microphone. */ }
}

function languageTag(value) {
  if (typeof value !== "string" || value.length > 64) return "";
  try { return Intl.getCanonicalLocales(value.trim())[0] || ""; } catch { return ""; }
}

function environment(windowRoot) {
  return {
    later: (callback, delay) => (windowRoot.setTimeout || globalThis.setTimeout).call(windowRoot, callback, delay),
    clear: (timer) => (windowRoot.clearTimeout || globalThis.clearTimeout).call(windowRoot, timer),
    now: () => windowRoot.performance?.now?.() ?? Date.now(),
  };
}

function lifecycle(windowRoot, cancel) {
  const listeners = [];
  const listen = (target, event, callback) => {
    target?.addEventListener?.(event, callback);
    listeners.push(() => target?.removeEventListener?.(event, callback));
  };
  listen(windowRoot.document, "visibilitychange", () => {
    if (windowRoot.document.hidden || windowRoot.document.visibilityState === "hidden") cancel("hidden");
  });
  for (const event of ["pagehide", "beforeunload", "popstate", "hashchange"]) {
    listen(windowRoot, event, () => cancel("navigation"));
  }
  return () => listeners.forEach((remove) => remove());
}

function isHidden(windowRoot) {
  return windowRoot.document?.hidden === true || windowRoot.document?.visibilityState === "hidden";
}

/**
 * Generic panel managers can hide an owner without calling its native close().
 * Observe explicit visibility on that owner's current ancestor chain, never its
 * screen rectangle: the 360-degree scene moves and reparents the original DOM.
 * An initial hidden mount and a temporary detach are not close transitions.
 */
export function watchVoiceOwnerVisibility({ element, windowRoot = element?.ownerDocument?.defaultView ?? globalThis, onHidden } = {}) {
  if (!element) return () => {};
  const Observer = windowRoot.MutationObserver;
  const documentRoot = element.ownerDocument || windowRoot.document;
  let disposed = false;
  let ancestors = [];
  let lastHidden = null;
  let attributes = null;
  let tree = null;
  let detachDeadline = null;
  const timers = environment(windowRoot);
  function ownerAncestors() {
    const nodes = [], seen = new Set();
    for (let node = element; node && !seen.has(node); node = node.parentElement ?? node.parentNode ?? node.host) {
      seen.add(node);
      nodes.push(node);
    }
    return nodes;
  }
  function hidden(nodes) {
    return nodes.some((node) => {
      if (node.hidden === true || node.getAttribute?.("aria-hidden") === "true") return true;
      const concealed = (style) => style?.display === "none" || ["hidden", "collapse"].includes(style?.visibility);
      if (concealed(node.style)) return true;
      try { return node.nodeType !== 9 && concealed(windowRoot.getComputedStyle?.(node)); } catch { return false; }
    });
  }
  function check(force = true) {
    if (disposed) return;
    if (element.isConnected === false) {
      // Give a synchronous/microtask reparent time to complete, but never leave
      // capture running indefinitely after the owning element is removed.
      if (lastHidden === false && detachDeadline === null) detachDeadline = timers.later(() => {
        detachDeadline = null;
        if (disposed) return;
        if (element.isConnected === false) {
          lastHidden = true;
          notify(onHidden, Object.freeze({ hidden: true, reason: "owner-detached" }));
        } else check();
      }, 0);
      return;
    }
    if (detachDeadline !== null) { timers.clear(detachDeadline); detachDeadline = null; }
    const next = ownerAncestors();
    const changed = next.length !== ancestors.length || next.some((node, index) => node !== ancestors[index]);
    if (!force && !changed) return;
    if (changed) {
      ancestors = next;
      attributes?.disconnect();
      for (const node of ancestors) {
        try { attributes?.observe(node, { attributes: true, attributeFilter: ["hidden", "aria-hidden", "style", "class", "open"] }); } catch { /* Synthetic/non-element ancestors. */ }
      }
    }
    const nextHidden = hidden(ancestors);
    const closed = lastHidden === false && nextHidden;
    lastHidden = nextHidden;
    if (closed) notify(onHidden, Object.freeze({ hidden: true, reason: "owner-hidden" }));
  }
  if (typeof Observer === "function") {
    attributes = new Observer(() => check());
    tree = new Observer(() => check(false));
    // Reparenting invalidates the old ancestor subscriptions. Child-only
    // changes inside a stable owner do not need another computed-style read.
    const treeRoot = documentRoot?.documentElement || documentRoot?.body;
    if (treeRoot) tree.observe(treeRoot, { childList: true, subtree: true });
  }
  check();
  const onResize = () => check();
  windowRoot.addEventListener?.("resize", onResize);
  return () => {
    if (disposed) return;
    disposed = true;
    attributes?.disconnect();
    tree?.disconnect();
    if (detachDeadline !== null) timers.clear(detachDeadline);
    windowRoot.removeEventListener?.("resize", onResize);
    ancestors = [];
  };
}

const ERROR_MESSAGES = {
  unsupported: "This browser does not support this voice feature.",
  "invalid-language": "Choose a valid speech language, such as en-US.",
  "not-allowed": "Microphone permission was denied. Allow it in your browser to try again.",
  "service-not-allowed": "The browser speech service is not allowed.",
  "audio-capture": "A working microphone could not be opened.",
  "no-speech": "No speech was recognized. Press Listen to try again.",
  network: "The browser speech service could not connect.",
  "language-not-supported": "This speech language is unavailable in your browser.",
  "permission-timeout": "The microphone request timed out. Press Record to try again.",
  "recording-too-large": "The recording exceeded its size limit. Record a shorter voice message.",
  "recording-failed": "The browser could not record this audio.",
  "recording-timeout": "The browser did not finish the recording in time.",
  "empty-recording": "No audio was captured. Record a new voice message.",
  "track-ended": "The microphone disconnected. Record a new voice message.",
  "speech-timeout": "The browser did not finish speaking in time.",
  "speech-failed": "The browser could not speak this reply.",
};

function errorMessage(code) { return ERROR_MESSAGES[code] || "The voice session ended. You can try again."; }

/** Browser recognition, possibly remote. start() must be called by a user action. */
export function createSpeechInput({ windowRoot = globalThis, onUpdate, onState, language = "en-US" } = {}) {
  const Recognition = windowRoot.SpeechRecognition || windowRoot.webkitSpeechRecognition;
  const supported = typeof Recognition === "function" && windowRoot.isSecureContext !== false;
  const timers = environment(windowRoot);
  const state = { status: "idle", transcript: "", interim: "", error: "", errorMessage: "", reason: "", supported,
    language: languageTag(language), processingLocation: "browser-service-may-be-remote" };
  let session = null;
  let destroyed = false;
  const getSnapshot = () => Object.freeze({ ...state, phase: state.status, active: Boolean(session) });
  const emit = () => notify(onState, getSnapshot());
  const update = () => notify(onUpdate, getSnapshot());

  function finish(current, { status = "stopped", error = "", reason = "", abort = false } = {}) {
    if (session !== current) return;
    session = null;
    timers.clear(current.deadline);
    timers.clear(current.finishDeadline);
    current.removeLifecycle?.();
    current.release?.();
    for (const name of ["onstart", "onresult", "onerror", "onend"]) current.recognition[name] = null;
    if (abort) { try { current.recognition.abort(); } catch { /* Already disconnected. */ } }
    Object.assign(state, { status, interim: "", error, errorMessage: error ? errorMessage(error) : "", reason });
    update();
    emit();
  }

  function abort(reason = "cancelled") {
    if (session) finish(session, { abort: true, reason });
    return getSnapshot();
  }

  function stop(reason = "user") {
    const current = session;
    if (!current || state.status === "stopping") return getSnapshot();
    state.status = "stopping";
    state.reason = reason;
    timers.clear(current.deadline);
    current.finishDeadline = timers.later(() => finish(current, { abort: true, reason }), FINISH_TIMEOUT_MS);
    try { current.recognition.stop(); } catch { finish(current, { abort: true, reason }); }
    if (session === current) emit();
    return getSnapshot();
  }

  function start(options = {}) {
    if (destroyed) return false;
    const nextLanguage = languageTag(options.language ?? state.language);
    if (!supported || !nextLanguage) {
      abort();
      const error = supported ? "invalid-language" : "unsupported";
      Object.assign(state, { status: "error", error, errorMessage: errorMessage(error) });
      emit();
      return false;
    }
    if (isHidden(windowRoot)) return false;
    if (session && state.status !== "stopping") return true;
    abort("restarted");
    let recognition;
    try { recognition = new Recognition(); } catch {
      Object.assign(state, { status: "error", error: "audio-capture", errorMessage: errorMessage("audio-capture") });
      emit();
      return false;
    }
    const current = { recognition, finals: new Map() };
    session = current;
    Object.assign(state, { status: "starting", transcript: "", interim: "", error: "", errorMessage: "", reason: "", language: nextLanguage });
    recognition.lang = nextLanguage;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    current.release = claimVoiceActivity(current, () => abort("superseded"), windowRoot);
    current.removeLifecycle = lifecycle(windowRoot, abort);
    recognition.onstart = () => {
      if (session !== current || state.status === "stopping") return;
      state.status = "listening";
      emit();
    };
    recognition.onresult = (event) => {
      if (session !== current) return;
      const results = event.results || [];
      const interim = [];
      let finalLength = Array.from(current.finals.values()).reduce((size, text) => size + text.length + 1, 0);
      let interimLength = 0;
      let limitReached = false;
      // Results are cumulative and indexed. Repeated final events are not new words.
      for (let index = 0; index < Math.min(results.length, SPEECH_LIMIT); index += 1) {
        const result = results[index];
        const text = String(result?.[0]?.transcript || "").slice(0, SPEECH_LIMIT).trim();
        if (result?.isFinal) {
          if (!current.finals.has(index) && text) {
            const bounded = text.slice(0, Math.max(0, SPEECH_LIMIT - finalLength));
            current.finals.set(index, bounded);
            finalLength += bounded.length + 1;
            if (bounded.length < text.length || finalLength >= SPEECH_LIMIT) limitReached = true;
          }
        } else if (!current.finals.has(index)) {
          const bounded = text.slice(0, Math.max(0, SPEECH_LIMIT - finalLength - interimLength));
          interim.push(bounded);
          interimLength += bounded.length + 1;
          if (bounded.length < text.length || interimLength + finalLength >= SPEECH_LIMIT) limitReached = true;
        }
        if (limitReached) break;
      }
      const transcript = Array.from(current.finals.entries()).sort((a, b) => a[0] - b[0]).map(([, text]) => text).join(" ");
      state.transcript = transcript.slice(0, SPEECH_LIMIT);
      state.interim = interim.join(" ").slice(0, SPEECH_LIMIT - state.transcript.length);
      update();
      if (session === current && (limitReached || transcript.length >= SPEECH_LIMIT)) stop("text-limit");
    };
    recognition.onerror = (event) => {
      if (session !== current) return;
      const error = String(event.error || "audio-capture").slice(0, 80);
      finish(current, { status: "error", error, reason: "recognition-error", abort: true });
    };
    recognition.onend = () => finish(current, { reason: state.reason || "ended" });
    current.deadline = timers.later(() => stop("time-limit"), SPEECH_DURATION_MS);
    emit();
    if (session !== current) return false;
    try { recognition.start(); } catch (error) {
      finish(current, { status: "error", error: error?.name === "NotAllowedError" ? "not-allowed" : "audio-capture", abort: true });
      return false;
    }
    return session === current;
  }

  return { start, stop, abort, getSnapshot, destroy() {
    if (destroyed) return;
    destroyed = true;
    abort("destroyed");
    state.status = "destroyed";
    emit();
  } };
}

function stopTracks(stream) {
  for (const track of stream?.getTracks?.() || []) {
    try { track.stop(); } catch { /* Continue releasing the remaining tracks. */ }
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/** In-memory audio capture. A successful stop returns the local Blob to its caller. */
export function createVoiceRecorder({ windowRoot = globalThis, onState, maxDurationMs = 60000, maxBytes = 384000 } = {}) {
  const MediaRecorder = windowRoot.MediaRecorder;
  const mediaDevices = windowRoot.navigator?.mediaDevices;
  const BlobType = windowRoot.Blob || globalThis.Blob;
  const supported = Boolean(typeof MediaRecorder === "function" && mediaDevices?.getUserMedia && BlobType && windowRoot.isSecureContext !== false);
  const durationLimit = Math.floor(Math.min(60000, Math.max(100, Number(maxDurationMs) || 60000)));
  const byteLimit = Math.min(384000, Math.max(1, Math.floor(Number(maxBytes) || 384000)));
  const timers = environment(windowRoot);
  const state = { status: "idle", error: "", errorMessage: "", reason: "", supported, bytes: 0, durationMs: 0,
    mimeType: "", processingLocation: "local-device", maxDurationMs: durationLimit, maxBytes: byteLimit };
  let session = null;
  let lastResult = null;
  let destroyed = false;
  const getSnapshot = () => Object.freeze({ ...state, phase: state.status, active: Boolean(session),
    durationMs: session?.startedAt != null ? Math.max(0, Math.min(durationLimit, (session.stoppedAt ?? timers.now()) - session.startedAt)) : state.durationMs });
  const emit = () => notify(onState, getSnapshot());

  function releaseMicrophone(current) {
    current.removeTracks?.();
    stopTracks(current.stream);
  }

  function finish(current, { error = "", reason = state.reason, discard = false } = {}) {
    if (session !== current) return;
    const durationMs = getSnapshot().durationMs;
    session = null;
    timers.clear(current.permissionDeadline);
    timers.clear(current.deadline);
    timers.clear(current.finishDeadline);
    current.removeLifecycle?.();
    releaseMicrophone(current);
    current.release?.();
    if (current.recorder) {
      for (const name of ["ondataavailable", "onerror", "onstop"]) current.recorder[name] = null;
      try { if (current.recorder.state !== "inactive") current.recorder.stop(); } catch { /* Already stopped. */ }
    }
    let result = null;
    if (!discard && !error) {
      if (!current.bytes) error = "empty-recording";
      else {
        try {
          const blob = new BlobType(current.chunks, { type: state.mimeType });
          result = Object.freeze({ blob, mimeType: state.mimeType, durationMs: Math.max(1, Math.round(durationMs)) });
        } catch { error = "recording-failed"; }
      }
    }
    current.chunks.length = 0;
    lastResult = result;
    Object.assign(state, { status: error ? "error" : "stopped", error, errorMessage: error ? errorMessage(error) : "", reason,
      durationMs: result?.durationMs ?? durationMs, bytes: result?.blob.size || 0 });
    current.started.resolve(false);
    current.completed.resolve(result);
    emit();
  }

  function cancel(reason = "cancelled") {
    lastResult = null;
    if (session) finish(session, { discard: true, reason });
    else if (!destroyed) {
      Object.assign(state, { status: "stopped", bytes: 0, durationMs: 0, error: "", errorMessage: "", reason });
      emit();
    }
    return getSnapshot();
  }

  function stop(reason = "user") {
    const current = session;
    if (!current) return Promise.resolve(lastResult);
    if (!current.recorder) {
      cancel(reason);
      return current.completed.promise;
    }
    if (state.status === "stopping") return current.completed.promise;
    current.stoppedAt = timers.now();
    Object.assign(state, { status: "stopping", reason });
    timers.clear(current.deadline);
    current.finishDeadline = timers.later(() => finish(current, { error: "recording-timeout", discard: true }), FINISH_TIMEOUT_MS);
    try {
      if (current.recorder.state === "inactive") finish(current);
      else current.recorder.stop();
    } catch { finish(current, { error: "recording-failed", discard: true }); }
    // Stop the actual microphone now; the queued final data/stop events can still finish.
    releaseMicrophone(current);
    if (session === current) emit();
    return current.completed.promise;
  }

  function start() {
    if (destroyed) return Promise.resolve(false);
    if (!supported) {
      Object.assign(state, { status: "error", error: "unsupported", errorMessage: errorMessage("unsupported") });
      emit();
      return Promise.resolve(false);
    }
    if (isHidden(windowRoot)) return Promise.resolve(false);
    if (session && state.status !== "stopping") return session.started.promise;
    if (session) cancel("restarted");
    lastResult = null;
    const current = { started: deferred(), completed: deferred(), chunks: [], bytes: 0, startedAt: null };
    session = current;
    Object.assign(state, { status: "requesting", bytes: 0, durationMs: 0, mimeType: "", error: "", errorMessage: "", reason: "" });
    current.release = claimVoiceActivity(current, () => cancel("superseded"), windowRoot);
    current.removeLifecycle = lifecycle(windowRoot, cancel);
    current.permissionDeadline = timers.later(() => finish(current, { error: "permission-timeout", discard: true }), PERMISSION_TIMEOUT_MS);
    emit();
    if (session !== current) return current.started.promise;
    let permission;
    try { permission = mediaDevices.getUserMedia({ audio: true, video: false }); } catch (error) { permission = Promise.reject(error); }
    Promise.resolve(permission).then((stream) => {
      // A late permission grant must release its tracks, never resurrect a cancelled session.
      if (session !== current) { stopTracks(stream); return; }
      timers.clear(current.permissionDeadline);
      current.stream = stream;
      if (isHidden(windowRoot)) { cancel("hidden"); return; }
      const tracks = stream?.getAudioTracks?.() || stream?.getTracks?.() || [];
      if (!tracks.length || tracks.every((track) => track.readyState === "ended")) {
        finish(current, { error: "audio-capture", discard: true });
        return;
      }
      const trackEnded = () => finish(current, { error: "track-ended", reason: "track-ended", discard: true });
      for (const track of tracks) track.addEventListener?.("ended", trackEnded);
      current.removeTracks = () => tracks.forEach((track) => track.removeEventListener?.("ended", trackEnded));
      try {
        const mimeType = MIME_TYPES.find((type) => typeof MediaRecorder.isTypeSupported !== "function" || MediaRecorder.isTypeSupported(type));
        const options = { audioBitsPerSecond: 32000, ...(mimeType ? { mimeType } : {}) };
        const recorder = new MediaRecorder(stream, options);
        current.recorder = recorder;
        state.mimeType = String(recorder.mimeType || mimeType || "").toLowerCase().replace(/\s+/g, "").replace(/codecs="([^"]+)"/, "codecs=$1");
        if (!ALLOWED_MIME_TYPES.has(state.mimeType)) throw new Error("Unsupported audio container");
        recorder.ondataavailable = (event) => {
          if (session !== current || !event.data?.size) return;
          if (current.bytes + event.data.size > byteLimit || current.chunks.length >= MAX_RECORDING_CHUNKS) {
            finish(current, { error: "recording-too-large", reason: "byte-limit", discard: true });
            return;
          }
          current.chunks.push(event.data);
          current.bytes += event.data.size;
          state.bytes = current.bytes;
          if (current.bytes >= byteLimit) stop("byte-limit");
          else emit();
        };
        recorder.onerror = () => finish(current, { error: "recording-failed", discard: true });
        recorder.onstop = () => finish(current);
        current.startedAt = timers.now();
        state.status = "recording";
        recorder.start(250);
        if (session !== current) return;
        current.deadline = timers.later(() => stop("time-limit"), durationLimit);
        current.started.resolve(true);
        emit();
      } catch { finish(current, { error: "recording-failed", discard: true }); }
    }, (error) => {
      if (session !== current) return;
      const code = error?.name === "NotAllowedError" || error?.name === "SecurityError" ? "not-allowed" : "audio-capture";
      finish(current, { error: code, discard: true });
    });
    return current.started.promise;
  }

  return { start, stop, cancel, getSnapshot, destroy() {
    if (destroyed) return;
    destroyed = true;
    cancel("destroyed");
    state.status = "destroyed";
    emit();
  } };
}

/** Speech playback claims the shared voice slot before any utterance is queued. */
export function createVoiceOutput({ windowRoot = globalThis, onState } = {}) {
  const synthesis = windowRoot.speechSynthesis;
  const Utterance = windowRoot.SpeechSynthesisUtterance;
  const supported = Boolean(synthesis?.speak && typeof Utterance === "function");
  const timers = environment(windowRoot);
  const state = { status: "idle", error: "", errorMessage: "", reason: "", supported, language: "en-US", truncated: false,
    processingLocation: "browser-voice-may-be-remote" };
  let session = null;
  let destroyed = false;
  const getSnapshot = () => Object.freeze({ ...state, phase: state.status, active: Boolean(session) });
  const emit = () => notify(onState, getSnapshot());

  function finish(current, { success = false, reason = "", error = "", cancel = false } = {}) {
    if (session !== current) return;
    session = null;
    timers.clear(current.deadline);
    current.removeLifecycle?.();
    current.utterance.onend = null;
    current.utterance.onerror = null;
    // Only cancel synthesis when this object actually owns a live utterance.
    if (cancel) { try { synthesis.cancel(); } catch { /* Browser may have already stopped. */ } }
    current.release?.();
    Object.assign(state, { status: error ? "error" : "stopped", error, errorMessage: error ? errorMessage(error) : "", reason });
    current.completed.resolve(success);
    emit();
  }

  function stop(reason = "cancelled") {
    if (session) finish(session, { reason, cancel: true });
    return getSnapshot();
  }

  function speak(text, { language = "en-US" } = {}) {
    if (destroyed) return Promise.resolve(false);
    stop("replaced");
    const nextLanguage = languageTag(language);
    if (!supported || !nextLanguage) {
      const error = supported ? "invalid-language" : "unsupported";
      Object.assign(state, { status: "error", error, errorMessage: errorMessage(error) });
      emit();
      return Promise.resolve(false);
    }
    const fullText = String(text ?? "").trim();
    const speech = fullText.slice(0, SPEECH_LIMIT);
    if (!speech || isHidden(windowRoot)) return Promise.resolve(false);
    let utterance;
    try { utterance = new Utterance(speech); } catch {
      Object.assign(state, { status: "error", error: "speech-failed", errorMessage: errorMessage("speech-failed") });
      emit();
      return Promise.resolve(false);
    }
    const current = { utterance, completed: deferred() };
    session = current;
    utterance.lang = nextLanguage;
    // A voice marked localService is the browser's explicit on-device guarantee.
    // Do not select a different language just because that voice is installed.
    let selectedVoice;
    try {
      const voices = Array.from(synthesis.getVoices?.() || []);
      const exact = (voice) => String(voice.lang).toLowerCase() === nextLanguage.toLowerCase();
      const sameLanguage = (voice) => String(voice.lang).toLowerCase().split("-")[0] === nextLanguage.toLowerCase().split("-")[0];
      selectedVoice = voices.find((voice) => voice.localService && exact(voice))
        || voices.find((voice) => voice.localService && sameLanguage(voice))
        || voices.find(exact) || voices.find(sameLanguage);
      if (selectedVoice) utterance.voice = selectedVoice;
    } catch { /* The browser may not have populated its voice list yet. */ }
    state.processingLocation = selectedVoice?.localService ? "local-device" : "browser-voice-may-be-remote";
    state.truncated = fullText.length > SPEECH_LIMIT;
    current.release = claimVoiceActivity(current, () => stop("superseded"), windowRoot);
    current.removeLifecycle = lifecycle(windowRoot, stop);
    utterance.onend = () => finish(current, { success: true, reason: "ended" });
    utterance.onerror = () => finish(current, { error: "speech-failed", reason: "playback-error", cancel: true });
    current.deadline = timers.later(() => finish(current, { error: "speech-timeout", cancel: true }), Math.min(120000, Math.max(15000, speech.length * 100)));
    Object.assign(state, { status: "speaking", error: "", errorMessage: "", reason: "", language: nextLanguage });
    emit();
    if (session !== current) return current.completed.promise;
    try { synthesis.speak(utterance); } catch { finish(current, { error: "speech-failed", cancel: true }); }
    return current.completed.promise;
  }

  return { speak, stop, getSnapshot, destroy() {
    if (destroyed) return;
    destroyed = true;
    stop("destroyed");
    state.status = "destroyed";
    emit();
  } };
}
