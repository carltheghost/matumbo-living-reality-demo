import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {access, readdir, readFile, stat} from "node:fs/promises";
import {createServer} from "node:http";
import {extname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const PREVIEW_CLIENT = `(() => {
  const revision = document.createElement("meta");
  revision.name = "preview-revision";
  fetch("/__preview/revision").then((response) => response.json()).then((data) => {
    revision.content = data.revision;
    document.head.appendChild(revision);
  }).catch(() => {});
})();`;

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".txt", "text/plain; charset=utf-8"],
]);

const HIDDEN = new Set([".env", ".git", "node_modules"]);
const IGNORED_DIRS = new Set([".git", "node_modules", ".tumbo", "work", "scripts"]);

async function walk(root, directory = root, out = []) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await walk(root, full, out);
    else out.push(full);
  }
  return out;
}

async function sourceRevision(root) {
  const files = (await walk(root)).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const rel = relative(root, file).split(sep).join("/");
    hash.update(rel);
    hash.update(await readFile(file));
  }
  return hash.digest("hex").slice(0, 16);
}

function extractFeatures(html) {
  const features = [];
  const seen = new Set();
  const pattern = /[?&](?:feature|panel)=([^&#"']+)/g;
  for (const match of html.matchAll(pattern)) {
    let value;
    try { value = decodeURIComponent(match[1]); } catch { continue; }
    if (!value || seen.has(value)) continue;
    seen.add(value);
    features.push(value);
  }
  return features;
}

function json(res, status, body, head = false) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  if (head) {
    res.end();
    return;
  }
  res.end(payload);
}

function text(res, status, body, contentType = "text/plain; charset=utf-8", head = false) {
  res.writeHead(status, {"content-type": contentType, "cache-control": "no-store"});
  if (head) {
    res.end();
    return;
  }
  res.end(body);
}

function safePath(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (!decoded.startsWith("/") || decoded.includes("\0") || decoded.includes("\\"))
    return null;
  const candidate = resolve(root, "." + decoded);
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(prefix)) return null;
  const parts = relative(root, candidate).split(sep);
  if (parts.some((part) => HIDDEN.has(part) || IGNORED_DIRS.has(part))) return null;
  return candidate;
}

export async function createPreviewServer(rootDirectory) {
  const root = resolve(rootDirectory);
  await access(join(root, "index.html"));

  const server = createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      text(res, 405, "Method Not Allowed");
      return;
    }

    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;

    if (pathname === "/__preview/client.js") {
      text(res, 200, PREVIEW_CLIENT, "text/javascript; charset=utf-8", req.method === "HEAD");
      return;
    }

    if (pathname === "/__preview/revision") {
      json(res, 200, {revision: await sourceRevision(root)}, req.method === "HEAD");
      return;
    }

    if (pathname === "/context.json" || pathname === "/context") {
      const html = await readFile(join(root, "index.html"), "utf8");
      const revision = await sourceRevision(root);
      const body = {
        revision,
        features: extractFeatures(html),
        sourceRevision: revision,
        generatedAt: new Date().toISOString(),
      };
      if (pathname === "/context") {
        text(res, 200,
          `# Public Preview Context\n\nSource revision: ${revision}\n\nFeatures: ${body.features.join(", ")}\n`,
          "text/plain; charset=utf-8",
          req.method === "HEAD",
        );
      } else {
        json(res, 200, body, req.method === "HEAD");
      }
      return;
    }

    if (pathname === "/scripts/public-preview.mjs" || pathname.startsWith("/scripts/")) {
      text(res, 404, "Not Found");
      return;
    }

    if (pathname === "/api/world" || pathname.startsWith("/api/")) {
      text(res, 404, "Not Found");
      return;
    }

    if (pathname.startsWith("/__preview/")) {
      text(res, 404, "Not Found");
      return;
    }

    let file = safePath(root, pathname === "/" ? "/index.html" : pathname);
    if (!file) {
      text(res, 404, "Not Found");
      return;
    }

    try {
      const info = await stat(file);
      if (!info.isFile()) {
        text(res, 404, "Not Found");
        return;
      }
    } catch {
      text(res, 404, "Not Found");
      return;
    }

    const extension = extname(file).toLowerCase();
    const contentType = MIME.get(extension);
    if (!contentType) {
      text(res, 404, "Not Found");
      return;
    }

    res.writeHead(200, {"content-type": contentType, "cache-control": "no-store"});
    if (req.method === "HEAD") {
      res.end();
      return;
    }

    // Inject the preview client into the served root document without
    // modifying index.html on disk.
    if (pathname === "/" && extension === ".html") {
      const html = await readFile(file, "utf8");
      const script = "<script type=\"module\" src=\"/__preview/client.js\"></script>";
      const body = html.includes("/__preview/client.js")
        ? html
        : html.includes("</body>")
          ? html.replace("</body>", script + "</body>")
          : html + script;
      res.end(body);
      return;
    }

    createReadStream(file).pipe(res);
  });

  return server;
}
