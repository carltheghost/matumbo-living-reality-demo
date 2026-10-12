/*
 * The Pages phone route has no backend.  Keep the shared bootstrap's
 * readiness check local to this static artifact rather than issuing a
 * request that can only return 404 from a static host.
 */
(() => {
  if (!globalThis.location?.pathname.includes('/services/vivo/web/phone')) return;
  globalThis.VivoStaticPhoneRoute = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, ...args) => {
    const requestUrl = new URL(typeof input === 'string' ? input : input.url, globalThis.location.href);
    if (requestUrl.pathname.endsWith('/readyz')) {
      return Promise.resolve(new Response(JSON.stringify({
        ok: false,
        static: true,
        release: 'PAGES STATIC/OFFLINE',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    return originalFetch(input, ...args);
  };
})();
