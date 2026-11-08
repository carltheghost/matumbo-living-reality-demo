import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const file=p=>readFile(new URL(p,import.meta.url),'utf8');
test('native entry retains original modules and adds one explicit mount',async()=>{
 const h=await file('../index.html');assert.deepEqual([...h.matchAll(/<script type="module" src="([^"]+)"/g)].map(x=>x[1]),['./static-shared.js','./bootstrap.mjs','./companion.mjs']);
 assert.equal((h.match(/id="vivoIntelligenceMount"/g)||[]).length,1);assert(h.includes("import {installIntelligenceControls} from './ai-accounts-panel.mjs'"));
});
test('new module assets and native Field Lab entry are in the versioned shell',async()=>{
 const sw=await file('../../vivo-sw.js');assert(sw.includes('vivo-phone-shell-2026-11-08-v24'));
 for(const f of ['ai-accounts-panel.mjs','constructive-memory.mjs','field-lab.html'])assert(sw.includes(`'phone/${f}'`));
});
test('callback and local session endpoints bypass the service worker cache',async()=>{
 const sw=await file('../../vivo-sw.js');assert(sw.includes('readyz|healthz|api|ws|auth|vivo-session'));
});
test('panel uses exact native scope and keeps credentials out of browser persistence',async()=>{
 const s=await file('../ai-accounts-panel.mjs');assert(s.includes('VivaPhoneEngine?.publishedSnapshot'));
 assert(!s.includes('localStorage'));assert(!s.includes("type='password'"));assert(s.includes("credentials:'same-origin'"));
});
test('account refresh and provider activity remain explicit user actions',async()=>{
 const s=await file('../ai-accounts-panel.mjs');assert(s.includes("button('Refresh account status',run(render))"));
 assert(s.includes("button('Add another account',run(()=>offerLogin(null)))"));assert(!s.includes('setInterval'));
});
