const SESSION_KEY = "matumbo-live-session";

function safeBase(value) {
  try {
    const url = new URL(value || "/api", globalThis.location?.href || "http://localhost/");
    return url.href.replace(/\/$/, "");
  } catch { return ""; }
}
export function resolveLiveApiBase() {
  const query = new URLSearchParams(globalThis.location?.search || "");
  return safeBase(query.get("api") || globalThis.__MATUMBO_API_BASE__ || "");
}
export function createLiveNetworkClient({ base = resolveLiveApiBase() } = {}) {
  let apiBase = base;
  let token = null;
  try { token = globalThis.sessionStorage?.getItem(SESSION_KEY) || null; } catch {}
  const headers = () => ({ "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) });
  async function request(path, options = {}) {
    if (!apiBase) throw new Error("Live API is not configured. Add ?api=https://your-api.example.com");
    const response = await fetch(`${apiBase}${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
    return data;
  }
  return Object.freeze({
    get base() { return apiBase; },
    configure(value) { apiBase = safeBase(value); return apiBase; },
    async register(username, password, displayName) { return request("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password, displayName }) }); },
    async login(username, password) { const data = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }); token = data.token; try { globalThis.sessionStorage?.setItem(SESSION_KEY, token); } catch {} return data; },
    async logout() { try { await request("/api/auth/logout", { method: "POST" }); } finally { token = null; try { globalThis.sessionStorage?.removeItem(SESSION_KEY); } catch {} } },
    async me() { return request("/api/me"); },
    async markets(provider = "all", limit = 50) { return request(`/api/prediction-markets?provider=${encodeURIComponent(provider)}&limit=${limit}`); },
    async providers() { return request("/api/prediction-markets/providers"); },
    async presence(room, payload = {}) { return request(`/api/rooms/${encodeURIComponent(room)}/presence`, { method: "POST", body: JSON.stringify(payload) }); },
    async members(room) { return request(`/api/rooms/${encodeURIComponent(room)}/presence`); },
    async events(room, since = 0) { return request(`/api/rooms/${encodeURIComponent(room)}/events?since=${since}`); },
    async postEvent(room, type, payload) { return request(`/api/rooms/${encodeURIComponent(room)}/events`, { method: "POST", body: JSON.stringify({ type, payload }) }); },
    async getWorld(room) { return request(`/api/world/${encodeURIComponent(room)}`); },
    async saveWorld(room, snapshot, expectedVersion) { return request(`/api/world/${encodeURIComponent(room)}`, { method: "PUT", body: JSON.stringify({ snapshot, expectedVersion }) }); },
    async collect(type, properties = {}) { return request("/api/data/events", { method: "POST", body: JSON.stringify({ type, properties }) }); },
    async exportData() { return request("/api/data/export"); },
    stream(room, since = 0, onEvent = () => {}) {
      if (!apiBase || typeof EventSource !== "function") return null;
      const source = new EventSource(`${apiBase}/api/rooms/${encodeURIComponent(room)}/stream?since=${since}`);
      source.onmessage = event => { try { onEvent(JSON.parse(event.data)); } catch {} };
      source.addEventListener("ready", event => { try { onEvent(JSON.parse(event.data)); } catch {} });
      source.addEventListener("presence", event => { try { onEvent(JSON.parse(event.data)); } catch {} });
      source.addEventListener("world.updated", event => { try { onEvent(JSON.parse(event.data)); } catch {} });
      return source;
    },
  });
}
