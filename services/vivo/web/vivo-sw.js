/* Static app shell cache only. API traffic, camera frames and shared writes are never cached. */
const SHELL_CACHE = 'vivo-phone-shell-2026-10-12-v5';
const HAND_CACHE = 'vivo-hand-tracker-2026-10';
const SHELL = [
  'index.html', 'shared.css', 'shared.js', 'render.js', 'camera.js', 'hand-worker.js',
  'application/adapters.mjs', 'authority/grip-host.mjs', 'authority/lease-authority.mjs',
  'authority/material-authority.mjs', 'application/bootstrap.mjs', 'application/transport.mjs',
  'application/interactions.mjs', 'application/density-overlay.mjs',
  'phone/index.html', 'phone/bootstrap.mjs', 'phone/client.mjs', 'phone/authority-adapter.mjs', 'phone/authority-mapping.mjs', 'phone/two-hand-camera.mjs', 'phone/two-hand-worker.mjs',
  'phone/engine-worker.mjs', 'phone/engine.mjs', 'phone/storage.mjs', 'phone/material-contract.mjs', 'phone/material-patch.mjs', 'phone/material-input-runtime.mjs', 'phone/fingertip-input.mjs', 'phone/agent-tools.mjs', 'phone/agent-control.mjs', 'phone/persistence-status.mjs', 'phone/camera-start-status.mjs', 'phone/static-shared.js', 'phone/phone-render.mjs', 'phone/phone-world.css', 'phone/field-palette.mjs', 'phone/field-world.mjs', 'phone/spatial-fabric.mjs', 'phone/local-operation.mjs', 'phone/local-edit-queue.mjs', 'phone/economy-entry.mjs', 'phone/vendor/economy/manifest.json', 'phone/vendor/economy/src/domains/simulated-economy.js', 'phone/vendor/economy/src/domains/token.js', 'phone/vendor/economy/src/domains/token-config.js', 'phone/vendor/economy/src/domains/token-store.js', 'phone/vendor/economy/src/render/simulated-economy-panel.js',
  'phone/bridge.mjs', 'phone/projection.mjs', 'phone/hand-gestures.mjs',
];
const scoped = relative => new URL(relative, self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL.map(scoped));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('vivo-phone-shell-') && name !== SHELL_CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (/\/(?:readyz|healthz|api|ws)(?:\/|$)/.test(url.pathname)) return;
  event.respondWith((async () => {
    const hand = await caches.open(HAND_CACHE), handAsset = await hand.match(request);
    if (handAsset) return handAsset;
    const shell = await caches.open(SHELL_CACHE), cached = await shell.match(request);
    if (cached) return cached;
    try { return await fetch(request); }
    catch {
      const scope = new URL(self.registration.scope);
      const scopePath = scope.pathname.endsWith('/') ? scope.pathname : `${scope.pathname}/`;
      const canonicalNavigation = request.mode === 'navigate'
        && url.origin === scope.origin
        && (url.pathname === scopePath || url.pathname === scopePath.slice(0, -1));
      const phonePath = scopePath + 'phone/';
      const phoneNavigation = request.mode === 'navigate'
        && url.origin === scope.origin
        && (url.pathname === phonePath || url.pathname === phonePath.slice(0, -1));
      if (canonicalNavigation || phoneNavigation) {
        const fallback = phoneNavigation
          ? await shell.match(scoped('phone/index.html'))
          : await shell.match(scoped('index.html'));
        if (fallback) return fallback;
      }
      return new Response('This Vivo resource is not cached on this phone yet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
