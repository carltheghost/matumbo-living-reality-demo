import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNvidiaGateway, NvidiaGatewayError } from "./nvidia-nim-gateway.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_JSON_BYTES = 256 * 1024;
const CONTENT_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
});

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
}

function json(res, status, payload) {
  securityHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new NvidiaGatewayError("Request body is too large", 413, "request_too_large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new NvidiaGatewayError("Request body must be valid JSON", 400, "invalid_json"); }
}

function safeStaticPath(urlPath) {
  let pathname;
  try { pathname = decodeURIComponent(urlPath.split("?")[0]); } catch { return null; }
  if (pathname === "/") pathname = "/index.html";
  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((segment) => segment.startsWith(".")) || segments[0] === "server") return null;
  const candidate = path.resolve(REPO_ROOT, `.${pathname}`);
  if (candidate !== REPO_ROOT && !candidate.startsWith(REPO_ROOT + path.sep)) return null;
  return candidate;
}

async function serveStatic(req, res) {
  const filePath = safeStaticPath(req.url || "/");
  if (!filePath) return json(res, 404, { ok: false, error: "not_found" });
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return json(res, 404, { ok: false, error: "not_found" });
    const body = await readFile(filePath);
    securityHeaders(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream");
    if (String(req.method || "GET").toUpperCase() === "HEAD") return res.end();
    res.end(body);
  } catch {
    json(res, 404, { ok: false, error: "not_found" });
  }
}

export function createMatumboDevServer({ gateway = createNvidiaGateway() } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const method = String(req.method || "GET").toUpperCase();
      const pathname = new URL(req.url || "/", "http://localhost").pathname;

      if (pathname === "/api/nvidia/status" && method === "GET") return json(res, 200, gateway.status());
      if (pathname === "/api/nvidia/chat" && method === "POST") {
        const body = await readJson(req);
        const result = await gateway.chat(body);
        return json(res, 200, result);
      }
      if (pathname.startsWith("/api/")) return json(res, 404, { ok: false, error: "unknown_api_route" });
      if (method !== "GET" && method !== "HEAD") return json(res, 405, { ok: false, error: "method_not_allowed" });
      return serveStatic(req, res);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      json(res, status, {
        ok: false,
        error: error?.code || "server_error",
        message: status >= 500 && !(error instanceof NvidiaGatewayError) ? "Server error" : String(error?.message || "Request failed"),
      });
    }
  });
}

export function startMatumboDevServer({
  port = Number(process.env.MATUMBO_PORT || process.env.PORT || 8080),
  host = "127.0.0.1",
} = {}) {
  const server = createMatumboDevServer();
  server.listen(port, host, () => {
    const configured = Boolean(String(process.env.NVIDIA_API_KEY || "").trim());
    console.log(`[maTumbo] http://${host}:${port}`);
    console.log(`[maTumbo] NVIDIA NIM gateway: ${configured ? "configured" : "not configured (set NVIDIA_API_KEY)"}`);
  });
  return server;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) startMatumboDevServer();
