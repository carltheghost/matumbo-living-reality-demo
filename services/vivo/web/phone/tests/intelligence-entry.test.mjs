import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const file=p=>readFile(new URL(p,import.meta.url),'utf8');
test('native entry retains original modules and adds one explicit mount',async()=>{
 const h=await file('../index.html');assert.deepEqual([...h.matchAll(/<script type="module" src="([^"]+)"/g)].map(x=>x[1]),['./static-shared.js','./bootstrap.mjs','./companion.mjs']);
 assert.equal((h.match(/id="vivoIntelligenceMount"/g)||[]).length,1);assert(h.includes("import {installIntelligenceControls} from './ai-accounts-panel.mjs'"));
});
test('new module assets and native Field Lab entry are in the versioned shell',async()=>{
 const [sw,upgrade]=await Promise.all([file('../../vivo-sw.js'),file('./browser_service_worker_upgrade.py')]);
 const cache=sw.match(/const SHELL_CACHE = '(vivo-phone-shell-\d{4}-\d{2}-\d{2}-v(\d+))';/);
 assert(cache&&Number(cache[2])>=28,'The current shell must be versioned at v28 or later');
 const versions=[...upgrade.matchAll(/^V(\d+)_CACHE = "([^"]+)"/gm)].sort((a,b)=>Number(b[1])-Number(a[1]));
 assert(versions.length,'The offline upgrade suite must declare its target cache');
 assert.equal(cache[1],versions[0][2],'Current shell and real offline upgrade target must agree');
 for(const f of ['ai-accounts-panel.mjs','constructive-memory.mjs','constructive-memory-agent.mjs','convergence-adapter.mjs','task-continuity.mjs','mission-graph.mjs','mission-orchestrator.mjs','mission-planner.mjs','mission-recovery.mjs','mission-experience.mjs','mission-recall.mjs','mission-associations.mjs','field-lab.html','social-room.mjs','social-room-panel.mjs'])assert(sw.includes(`'phone/${f}'`));
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
 // Adding an account opens the picker; only the selected provider starts login.
 assert(s.includes("button('Add another account',()=>{clearSelection();"));
 assert(s.includes("button('Sign in with ChatGPT',run(()=>offerLogin(null)))"));
 assert(!s.includes("button('Add another account',run(()=>offerLogin(null)))"));
 assert(!s.includes('setInterval'));
});
