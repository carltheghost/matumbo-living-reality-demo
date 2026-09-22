import http from 'node:http';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
const allowed = p => p === 'index.html' || p === 'favicon.svg' || (/^(src\/|vendor\/three-r179\.1\/)/.test(p) && !p.split('/').some(s => s.startsWith('.') || s.includes(':')) && Boolean(types[path.extname(p)]));
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const client = `let revision = null, paused = false;
const bar = document.createElement('div');
bar.style.cssText='position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:10000;background:#081422;color:#e9f5ff;border:1px solid #c34155;border-radius:8px;padding:6px 10px;font:12px system-ui;display:flex;gap:10px;align-items:center';
const label = document.createElement('span'); label.textContent='Live development preview';
const button = document.createElement('button'); button.textContent='Pause updates';
const link = document.createElement('a'); link.href='/context'; link.textContent='Chat context'; link.style.color='#89d8ff';
button.onclick=()=>{paused=!paused;button.textContent=paused?'Resume updates':'Pause updates';};
bar.append(label,button,link); document.body.append(bar);
async function tick(){try{const r=await fetch('/__preview/revision',{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json();const dirty=!!document.querySelector('[data-preview-dirty="true"]');if(revision&&revision!==data.revision&&!paused&&!dirty&&!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)){location.reload();return;}if(!revision)revision=data.revision;label.textContent='Live preview · '+revision.slice(0,8)+(dirty?' · export work before refresh':paused?' · paused':'');}catch{label.textContent='Preview disconnected · reconnecting';}setTimeout(tick,3000);}tick();`;

export async function createPreviewServer(root) {
  root = await realpath(root);
  async function safeFile(relative) {
    if (!allowed(relative)) return null;
    try {
      const resolved = await realpath(path.join(root, relative));
      const inside = path.relative(root, resolved);
      if (inside.startsWith('..') || path.isAbsolute(inside) || !(await stat(resolved)).isFile()) return null;
      return resolved;
    } catch { return null; }
  }
  let cached, expires = 0, pending;
  async function scan() {
    const files = [];
    async function walk(dir) {
      for (const entry of await readdir(path.join(root, dir), {withFileTypes:true}).catch(()=>[])) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const rel = dir ? dir+'/'+entry.name : entry.name;
        if(entry.isDirectory()) await walk(rel);
        else if(allowed(rel)) files.push(rel);
      }
    }
    files.push('index.html','favicon.svg');
    await walk('src'); await walk('vendor/three-r179.1');
    const hash = createHash('sha256'); let updated = 0, count = 0;
    for(const rel of files.sort()) {
      const f = await safeFile(rel); if(!f) continue;
      const info = await stat(f); hash.update(rel); hash.update(await readFile(f)); updated=Math.max(updated,info.mtimeMs); count++;
    }
    const html = await readFile(path.join(root,'index.html'),'utf8');
    const features = [];
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      try {
        const route = new URL(match[1].replaceAll('&amp;', '&'), 'http://preview.local/');
        const feature = route.searchParams.get('feature');
        const panel = route.searchParams.get('panel');
        const id = feature || (panel === 'runtime-sync' ? 'runtime-sync' : null);
        if (id && /^[a-z][a-z0-9-]{0,63}$/.test(id)) features.push(id);
      } catch {}
    }
    return {project:'maTumbo Living Reality', revision:hash.digest('hex'), updatedAt:new Date(updated).toISOString(), publicFiles:count,
      features:[...new Set(features)],
      status:'Development preview, not a production financial service.',
      implemented:['Centered draggable feature panels and equal-axis cube sigils', 'Source-linked and personal non-monetary single/pool authoring with parent/child contracts, explicit local entries, browser persistence, normal view and interactive cube view', 'Playable local chess room with legal move validation, turn state, captures, checkmate detection, standard chess pieces, orbit/zoom camera and accessible board view', 'Shared-scene VR/AR entry and target selection, hardware verification pending', 'Opt-in local camera/mic preview, audio-only, mute and stop; no calling backend', 'Approved-avatar domain foundation: immutable identity, versioned wardrobe, motion isolation and snapshot restore; likeness renderer pending'],
      boundaries:['Public provider data is read-only; availability and coverage vary by source.', 'Contracts, pools, child contracts and chess matches are local browser state; no authenticated shared backend or multiplayer service is attached yet.', 'No wallet signing, custody, token issuance, wagering or settlement is enabled.', 'Camera and device capabilities require consent and compatible hardware; cross-device behavior is not yet fully verified.'],
      requestedWork:['Extend connected sports coverage and implement verified result resolution', 'Shared authenticated markets, admin backend and release verification', 'One-to-one/group audio/video transport and multi-device testing', 'Approved likeness assets, humanoid rigs, sensor adapters and persistent companions'],
      chatInstructions:'Read this page on request to inspect the current source revision and declared scope. It is not a live transcript, browser-session state, or proof that every feature works.'};
  }
  async function context() {
    if(cached && Date.now()<expires) return cached;
    if(!pending) pending=scan().then(value=>{cached=value;expires=Date.now()+1500;return value;}).finally(()=>{pending=null;});
    return pending;
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('X-Frame-Options','DENY');
    const send=(code,body,type='text/plain')=>{res.writeHead(code,{'Content-Type':type+'; charset=utf-8'});res.end(req.method==='HEAD'?undefined:body);};
    if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return send(405,'Read-only preview');}
    try {
      const raw=decodeURIComponent((req.url??'/').split('?')[0]);
      if(raw.includes('\\') || raw.includes('\0') || raw.split('/').some(s=>s==='..'||s.startsWith('.')))return send(404,'Not found');
      if(raw==='/__preview/client.js')return send(200,client,'text/javascript');
      if(['/context','/context.json','/__preview/revision'].includes(raw)) {
        const data=await context();
        if(raw!=='/context')return send(200,JSON.stringify(data,null,2),'application/json');
        return send(200,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>maTumbo live project context</title><body style="max-width:850px;margin:40px auto;padding:20px;background:#07101c;color:#e9f3ff;font:16px/1.6 system-ui"><h1>maTumbo — live project context</h1><p><a style="color:#84caff" href="/">Open current demo</a> · <a style="color:#84caff" href="/context.json">Machine-readable context</a></p><p>${escape(data.status)}</p><p>Source revision: <code>${data.revision}</code><br>Last source update: ${data.updatedAt}</p><h2>Feature routes (implementation is still being verified)</h2><ul>${data.features.map(f=>`<li><a style="color:#84caff" href="/?feature=${f}">${escape(f)}</a></li>`).join('')}</ul><h2>Current boundaries</h2><ul>${data.boundaries.map(b=>`<li>${escape(b)}</li>`).join('')}</ul><h2>Requested next work</h2><ul>${data.requestedWork.map(b=>`<li>${escape(b)}</li>`).join('')}</ul><p>${escape(data.chatInstructions)}</p><script src="/__preview/client.js"></script></body></html>`,'text/html');
      }
      const file=await safeFile(raw==='/'?'index.html':raw.slice(1));
      if(!file)return send(404,'Not found');
      let body=await readFile(file);
      if(path.basename(file)==='index.html')body=body.toString().replace('</body>','<script src="/__preview/client.js"></script></body>');
      send(200,body,types[path.extname(file)]);
    }catch{send(404,'Not found');}
  });
  server.requestTimeout=15000; server.headersTimeout=10000;
  return server;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const server=await createPreviewServer(root);
  server.listen(Number(process.env.MATUMBO_PREVIEW_PORT??8081),'127.0.0.1',()=>console.log(`Read-only preview on http://127.0.0.1:${server.address().port}`));
}
