import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 8091);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.resolve(process.env.MATUMBO_DATA_DIR || ".data");
const TRUSTED_ORIGIN = process.env.CORS_ORIGIN || "";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const BODY_LIMIT = 512 * 1024;
const MAX_ROOM_EVENTS = 5000;
const MAX_MARKETS = 100;

const providers = {
  kalshi: {
    label: "Kalshi",
    url: "https://api.elections.kalshi.com/trade-api/v2/markets?limit=100",
    docs: "https://docs.kalshi.com/",
  },
  polymarket: {
    label: "Polymarket",
    url: "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100",
    docs: "https://docs.polymarket.com/",
  },
  manifold: {
    label: "Manifold",
    url: "https://api.manifold.markets/v0/search-markets?sort=last-updated&filter=open&limit=100",
    docs: "https://docs.manifold.markets/",
  },
};

let state = {
  version: 1,
  users: {},
  sessions: {},
  rooms: { lobby: { version: 0, events: [], presence: {}, world: null } },
  telemetry: [],
  marketSnapshots: {},
};
const streams = new Map();
let writeChain = Promise.resolve();

function now() { return new Date().toISOString(); }
function id(prefix = "id") { return `${prefix}_${crypto.randomBytes(12).toString("base64url")}`; }
function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(payload);
}
function cors(res) {
  const origin = TRUSTED_ORIGIN || "*";
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("access-control-allow-methods", "DELETE,GET,POST,PUT,OPTIONS");
  res.setHeader("access-control-expose-headers", "x-matumboversion");
}
const rateBuckets = new Map();
function rateLimit(req, key, limit, windowMs = 60_000) {
  const address = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  const bucketKey = `${address}:${key}`;
  const current = rateBuckets.get(bucketKey);
  const timestamp = Date.now();
  if (!current || timestamp - current.startedAt >= windowMs) {
    rateBuckets.set(bucketKey, { startedAt: timestamp, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}
function enforceRateLimit(req, res, key, limit) {
  if (rateLimit(req, key, limit)) return true;
  res.setHeader("retry-after", "60");
  json(res, 429, { error: "rate_limited" });
  return false;
}
function originAllowed(req) {
  return !TRUSTED_ORIGIN || !req.headers.origin || req.headers.origin === TRUSTED_ORIGIN;
}
function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName, createdAt: user.createdAt };
}
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(`${salt}:${key.toString("hex")}`)));
}
async function verifyPassword(password, encoded) {
  const [salt, expected] = String(encoded || "").split(":");
  if (!salt || !expected) return false;
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => {
    if (err) return reject(err);
    const actual = key.toString("hex");
    resolve(actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected)));
  }));
}
async function load() {
  try { state = JSON.parse(await fs.readFile(STATE_FILE, "utf8")); } catch {}
  state.rooms ||= {};
  state.rooms.lobby ||= { version: 0, events: [], presence: {}, world: null };
  state.users ||= {}; state.sessions ||= {}; state.telemetry ||= []; state.marketSnapshots ||= {};
}
function persist() {
  writeChain = writeChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state), "utf8");
    await fs.rename(tmp, STATE_FILE);
  }).catch(() => {});
  return writeChain;
}
function bearer(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}
function auth(req) {
  const token = bearer(req);
  const session = token ? state.sessions[token] : null;
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
  const user = state.users[session.userId];
  return user ? { token, user } : null;
}
function requireAuth(req, res) {
  const result = auth(req);
  if (!result) { json(res, 401, { error: "authentication_required" }); return null; }
  return result;
}
async function body(req) {
  let size = 0; let raw = "";
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error("body_too_large"), { statusCode: 413 });
    raw += chunk;
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("invalid_json"), { statusCode: 400 }); }
}
function cleanName(value) {
  const name = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(name)) throw Object.assign(new Error("username must be 3-32 letters, numbers, _ or -"), { statusCode: 400 });
  return name;
}
function cleanRoom(value) {
  const room = String(value || "lobby").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(room)) throw Object.assign(new Error("invalid room id"), { statusCode: 400 });
  return room;
}
function roomFor(roomId) {
  const room = state.rooms[roomId] ||= { version: 0, events: [], presence: {}, world: null };
  return room;
}
function publish(roomId, event) {
  const room = roomFor(roomId);
  room.events.push(event);
  if (room.events.length > MAX_ROOM_EVENTS) room.events.splice(0, room.events.length - MAX_ROOM_EVENTS);
  for (const res of streams.get(roomId) || []) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
}
function normalizeKalshi(item) {
  const yes = Number(item.yes_price ?? item.last_price ?? item.yes_ask);
  return { id: String(item.ticker || item.event_ticker || id("kalshi")), title: item.title || item.subtitle || "Untitled market",
    probability: Number.isFinite(yes) ? (yes > 1 ? yes / 100 : yes) : null, status: item.status || "unknown",
    closeTime: item.close_time || item.close_time_iso || null, provider: "kalshi", sourceUrl: "https://kalshi.com/" };
}
function normalizePolymarket(item) {
  let prices = item.outcomePrices;
  try { if (typeof prices === "string") prices = JSON.parse(prices); } catch { prices = null; }
  const probability = Array.isArray(prices) && prices.length ? Number(prices[0]) : Number(item.bestAsk);
  return { id: String(item.id || item.conditionId || id("polymarket")), title: item.question || item.title || "Untitled market",
    probability: Number.isFinite(probability) ? probability : null, status: item.active ? "open" : "closed",
    closeTime: item.endDate || null, provider: "polymarket", sourceUrl: item.url || "https://polymarket.com/" };
}
function normalizeManifold(item) {
  return { id: String(item.id || id("manifold")), title: item.question || item.text || "Untitled market",
    probability: Number.isFinite(Number(item.probability)) ? Number(item.probability) : null,
    status: item.isResolved ? "resolved" : "open", closeTime: item.closeTime ? new Date(item.closeTime).toISOString() : null,
    provider: "manifold", sourceUrl: item.url || `https://manifold.markets/${item.creatorUsername || ""}` };
}
async function fetchProvider(name, limit) {
  const provider = providers[name];
  const started = Date.now();
  if (!provider) throw new Error("unsupported_provider");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(provider.url, { headers: { accept: "application/json", "user-agent": "maTumbo-Living-Reality/launch" }, signal: controller.signal });
    const raw = await response.json();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const rows = Array.isArray(raw) ? raw : raw.markets || raw.data || [];
    const normalizer = name === "kalshi" ? normalizeKalshi : name === "polymarket" ? normalizePolymarket : normalizeManifold;
    return { provider: name, label: provider.label, status: "ready", retrievedAt: now(), latencyMs: Date.now() - started,
      records: rows.slice(0, Math.min(limit, MAX_MARKETS)).map(normalizer), source: provider.url, documentation: provider.docs };
  } finally { clearTimeout(timer); }
}
async function marketSnapshot(providerName, limit = 50) {
  const names = providerName === "all" ? Object.keys(providers) : [providerName];
  const results = await Promise.all(names.map(async name => {
    try { const result = await fetchProvider(name, limit); state.marketSnapshots[name] = result; return result; }
    catch (error) {
      return { provider: name, label: providers[name].label, status: "unavailable", retrievedAt: now(), records: [],
        source: providers[name].url, documentation: providers[name].docs, error: error.name === "AbortError" ? "timeout" : error.message };
    }
  }));
  await persist();
  return { retrievedAt: now(), providers: results, records: results.flatMap(r => r.records || []), disclaimer: "Read-only public observations; not trading, wagering, or investment advice." };
}

async function route(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {\n    if (TRUSTED_ORIGIN && req.headers.origin && req.headers.origin !== TRUSTED_ORIGIN) return json(res, 403, { error: "origin_not_allowed" });\n    res.writeHead(204); return res.end();\n  }
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    if (req.method === "GET" && url.pathname === "/api/health")
      return json(res, 200, { ok: true, service: "matumbo-live", storage: "json-file", postgres: false, multiplayer: true, accounts: true, predictionMarkets: Object.keys(providers), version: state.version });
    if (req.method === "GET" && url.pathname === "/api/prediction-markets/providers")
      return json(res, 200, Object.values(providers).map(p => ({ ...p, live: true, trading: false })));
    if (req.method === "GET" && url.pathname === "/api/prediction-markets") {
      const provider = url.searchParams.get("provider") || "all";
      const limit = Math.max(1, Math.min(MAX_MARKETS, Number(url.searchParams.get("limit") || 50)));
      return json(res, 200, await marketSnapshot(provider, limit));
    }
    if (req.method === "POST" && url.pathname === "/api/auth/register") {\n      if (!enforceRateLimit(req, res, "auth", 10)) return;
      const data = await body(req); const username = cleanName(data.username); const password = String(data.password || "");
      if (password.length < 10) return json(res, 400, { error: "password_min_10" });
      if (state.users[username]) return json(res, 409, { error: "username_taken" });
      const user = { id: id("user"), username, displayName: String(data.displayName || username).slice(0, 64), createdAt: now(), passwordHash: await hashPassword(password) };
      state.users[username] = user; await persist();
      return json(res, 201, { user: publicUser(user) });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/login") {\n      if (!enforceRateLimit(req, res, "auth", 20)) return;
      const data = await body(req); const username = cleanName(data.username); const user = state.users[username];
      if (!user || !(await verifyPassword(String(data.password || ""), user.passwordHash))) return json(res, 401, { error: "invalid_credentials" });
      const token = crypto.randomBytes(32).toString("base64url");
      state.sessions[token] = { userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() };
      await persist(); return json(res, 200, { token, expiresAt: state.sessions[token].expiresAt, user: publicUser(user) });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      const session = auth(req); if (session) { delete state.sessions[session.token]; await persist(); }
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/api/me") {
      const session = requireAuth(req, res); if (!session) return;
      return json(res, 200, { user: publicUser(session.user) });
    }
    if (parts[0] === "api" && parts[1] === "rooms" && parts[2] && parts[3] === "events") {
      const roomId = cleanRoom(parts[2]); const room = roomFor(roomId);
      if (req.method === "GET") {
        const since = Math.max(0, Number(url.searchParams.get("since") || 0));
        return json(res, 200, { roomId, version: room.version, events: room.events.filter(e => e.sequence > since) });
      }
      const session = requireAuth(req, res); if (!session) return;
      const data = await body(req);
      const event = { id: id("evt"), sequence: ++room.version, type: String(data.type || "message").slice(0, 48),
        roomId, user: publicUser(session.user), createdAt: now(), payload: data.payload ?? {} };
      publish(roomId, event); await persist(); return json(res, 201, event, { "x-matumboversion": String(room.version) });
    }
    if (parts[0] === "api" && parts[1] === "rooms" && parts[2] && parts[3] === "stream" && req.method === "GET") {
      const roomId = cleanRoom(parts[2]); const since = Math.max(0, Number(url.searchParams.get("since") || 0));
      const room = roomFor(roomId); res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": process.env.CORS_ORIGIN || "*" });
      res.write(`event: ready\ndata: ${JSON.stringify({ roomId, version: room.version, events: room.events.filter(e => e.sequence > since) })}\n\n`);
      const set = streams.get(roomId) || new Set(); set.add(res); streams.set(roomId, set);
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
      req.on("close", () => { clearInterval(heartbeat); set.delete(res); if (!set.size) streams.delete(roomId); });
      return;
    }
    if (parts[0] === "api" && parts[1] === "rooms" && parts[2] && parts[3] === "presence") {
      const roomId = cleanRoom(parts[2]); const room = roomFor(roomId);
      if (req.method === "GET") return json(res, 200, { roomId, members: Object.values(room.presence).filter(p => Date.now() - Date.parse(p.seenAt) < 30000) });
      const session = requireAuth(req, res); if (!session) return;
      const data = await body(req); const presence = { user: publicUser(session.user), seenAt: now(), state: String(data.state || "online").slice(0, 32), position: data.position && typeof data.position === "object" ? data.position : null };
      room.presence[session.user.id] = presence; await persist();
      publish(roomId, { id: id("presence"), sequence: ++room.version, type: "presence", roomId, user: publicUser(session.user), createdAt: now(), payload: presence });
      return json(res, 200, presence);
    }
    if (parts[0] === "api" && parts[1] === "world" && parts[2]) {
      const roomId = cleanRoom(parts[2]); const room = roomFor(roomId);
      if (req.method === "GET") return json(res, 200, { roomId, version: room.version, world: room.world, updatedAt: room.world?.updatedAt || null });
      const session = requireAuth(req, res); if (!session) return;
      const data = await body(req);
      const expectedVersion = Number(data.expectedVersion ?? room.version);
      if (expectedVersion !== room.version) return json(res, 409, { error: "version_conflict", version: room.version, world: room.world });
      room.world = { snapshot: data.snapshot ?? data.world ?? null, updatedAt: now(), updatedBy: publicUser(session.user) };
      room.version += 1; publish(roomId, { id: id("world"), sequence: room.version, type: "world.updated", roomId, user: publicUser(session.user), createdAt: now(), payload: { version: room.version } });
      await persist(); return json(res, 200, { roomId, version: room.version, updatedAt: room.world.updatedAt });
    }
    if (req.method === "POST" && url.pathname === "/api/data/events") {
      const session = requireAuth(req, res); if (!session) return;
      if (!enforceRateLimit(req, res, "telemetry", 120)) return;\n      const data = await body(req);\n      if (JSON.stringify(data.properties ?? {}).length > 16_000) return json(res, 413, { error: "event_properties_too_large" });\n      const record = { id: id("data"), userId: session.user.id, type: String(data.type || "event").slice(0, 64), createdAt: now(), properties: data.properties && typeof data.properties === "object" ? data.properties : {} };
      state.telemetry.push(record); if (state.telemetry.length > 20000) state.telemetry.splice(0, state.telemetry.length - 20000);
      await persist(); return json(res, 201, { accepted: true, id: record.id });
    }
    if (req.method === "GET" && url.pathname === "/api/data/export") {
      const session = requireAuth(req, res); if (!session) return;
      return json(res, 200, { exportedAt: now(), user: publicUser(session.user), events: state.telemetry.filter(e => e.userId === session.user.id) });
    }
    return json(res, 404, { error: "not_found" });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || "server_error" });
  }
}

await load();
const server = http.createServer(route);
server.listen(PORT, HOST, () => console.log(`maTumbo Live API listening on http://${HOST}:${PORT}`));
