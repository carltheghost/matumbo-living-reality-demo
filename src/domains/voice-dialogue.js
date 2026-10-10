/** Explicitly opted-in, half-duplex speech turn loop for assistant dialogue. */
export function createVoiceDialogue({
  beginCapture,
  finishCapture,
  abortCapture,
  submit,
  speak,
  onState,
  pauseMs = 900,
  setTimer = globalThis.setTimeout?.bind(globalThis),
  clearTimer = globalThis.clearTimeout?.bind(globalThis),
} = {}) {
  if (![beginCapture, finishCapture, abortCapture, submit, speak].every((fn) => typeof fn === "function")) {
    throw new TypeError("Voice dialogue needs capture, submit, and speech handlers.");
  }
  if (!Number.isFinite(pauseMs) || pauseMs < 250 || pauseMs > 5_000 || typeof setTimer !== "function" || typeof clearTimer !== "function") {
    throw new TypeError("Voice dialogue needs a bounded pause and timer.");
  }

  let running = false;
  let phase = "idle";
  let latest = "";
  let timer = null;
  let generation = 0;
  let error = "";
  const snapshot = () => Object.freeze({ running, phase, error });
  const publish = () => onState?.(snapshot());
  const clearPause = () => { if (timer !== null) clearTimer(timer); timer = null; };

  function listen(token) {
    if (!running || token !== generation) return;
    latest = "";
    phase = "listening";
    publish();
    beginCapture();
  }

  async function takeTurn(text, token) {
    clearPause();
    const words = String(text || "").trim().slice(0, 8_000);
    if (!running || token !== generation || !words || phase !== "listening") return;
    latest = "";
    phase = "sending";
    publish();
    try {
      const response = await submit(words);
      if (!running || token !== generation) return;
      if (typeof response !== "string" || !response.trim()) throw new Error("The assistant returned no spoken reply.");
      phase = "speaking";
      publish();
      const played = await speak(response.trim());
      if (!running || token !== generation) return;
      if (played === false) throw new Error("The reply could not be spoken. It remains visible in the conversation.");
      listen(token);
    } catch (cause) {
      if (!running || token !== generation) return;
      running = false;
      phase = "error";
      error = cause instanceof Error ? cause.message : "The voice conversation stopped.";
      publish();
    }
  }

  function update(snapshot) {
    if (!running || phase !== "listening") return;
    const token = generation;
    if (snapshot?.status === "error") {
      clearPause(); running = false; phase = "error";
      error = snapshot.errorMessage || "Speech recognition stopped. You can type or try again.";
      publish(); return;
    }
    const finalText = String(snapshot?.transcript || latest).trim();
    if (snapshot?.interim) { clearPause(); return; }
    if (snapshot?.status === "stopped") {
      clearPause();
      if (finalText) { void takeTurn(finalText, generation); return; }
      // Some browsers end a continuous recognition session after a quiet turn.
      // Reopen only after a small pause; the Stop button remains available.
      timer = setTimer(() => {
        timer = null;
        if (running && token === generation && phase === "listening") listen(token);
      }, 500);
      return;
    }
    if (!finalText || !["starting", "listening"].includes(snapshot?.status)) return;
    latest = finalText;
    clearPause();
    timer = setTimer(() => { timer = null; if (running && token === generation && phase === "listening") finishCapture(); }, pauseMs);
  }

  return Object.freeze({
    start() {
      if (running) return false;
      running = true; phase = "listening"; error = ""; latest = "";
      const token = ++generation; publish(); beginCapture(); return true;
    },
    stop() {
      if (!running) return false;
      running = false; generation += 1; clearPause(); phase = "idle"; error = "";
      abortCapture(); publish(); return true;
    },
    update,
    getSnapshot: snapshot,
  });
}
