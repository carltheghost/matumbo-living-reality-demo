import { mountVoiceDictation } from './voice-dictation.js?v=20261005-voice';

/** Keep reviewed dictation independent of Three.js or a failed app boot. */
export function installVoiceFallback({ documentRoot = globalThis.document, windowRoot = globalThis.window } = {}) {
  const status = documentRoot?.getElementById('runtime-status');
  if (!status || !windowRoot) return () => {};
  let fallback = null;
  const check = () => {
    if (status.dataset.runtimeState !== 'error' || windowRoot.__TUMBO_VOICE__) return;
    fallback = mountVoiceDictation({ documentRoot, windowRoot,
      getContext: () => JSON.stringify(['static-fallback', windowRoot.location.href]),
      onNavigate: () => {
        const note = documentRoot.querySelector('#voice-dictation-panel [data-vd-status]');
        if (note) note.textContent = 'The 3D app did not load. Your words are available to copy; Rooms and My GPT need the app to finish loading.';
      },
    });
    windowRoot.__TUMBO_VOICE__ = fallback;
  };
  const observer = new windowRoot.MutationObserver(check);
  observer.observe(status, { attributes: true, attributeFilter: ['data-runtime-state'] });
  check();
  const onPageHide = event => {
    if (windowRoot.__TUMBO_VOICE__ !== fallback) return;
    if (event.persisted) fallback?.close({ restoreFocus: false });
    else fallback?.destroy();
  };
  windowRoot.addEventListener('pagehide', onPageHide);
  return () => {
    observer.disconnect();
    windowRoot.removeEventListener('pagehide', onPageHide);
    if (windowRoot.__TUMBO_VOICE__ === fallback) {
      fallback?.destroy();
      delete windowRoot.__TUMBO_VOICE__;
    }
  };
}

if (typeof document !== 'undefined') installVoiceFallback();
