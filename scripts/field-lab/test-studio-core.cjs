'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const C=require('../../src/field-lab/studio-core.js');const tests=[];
function ok(name,fn){fn();tests.push(name);console.log('PASS',name);}
(async()=>{
ok('black and white camera samples are measured exactly',()=>{assert.equal(C.lightStats(new Uint8Array([0,0,0,255])).mean,0);assert.equal(Math.round(C.lightStats(new Uint8Array([255,255,255,255])).mean),255);});
ok('invalid RGBA input rejects',()=>assert.throws(()=>C.lightStats([1,2,3])));
ok('dim mode uses hysteresis rather than flickering at the threshold',()=>{const m=new C.LightMeter();assert.equal(m.update({mean:20}),'dim');for(let i=0;i<8;i++)assert.equal(m.update({mean:55}),'dim');for(let i=0;i<15;i++)m.update({mean:120});assert.equal(m.mode,'normal');});
ok('bright mode and reset return correctly',()=>{const m=new C.LightMeter();assert.equal(m.update({mean:230}),'bright');m.reset();assert.equal(m.mean,null);assert.equal(m.mode,'normal');});
for(let d=2;d<=9;d++)ok(d+'D plane rotation preserves radii and dormant coordinates',()=>{const q=Array.from({length:27},(_,i)=>Math.sin(i*.7)),r=C.planeRotate(q,3,d,0,d-1,.34);for(let i=0;i<3;i++){assert.ok(Math.abs(Math.hypot(...q.slice(i*9,i*9+d))-Math.hypot(...r.slice(i*9,i*9+d)))<1e-12);assert.deepEqual(q.slice(i*9+d,i*9+9),r.slice(i*9+d,i*9+9));}});
ok('inactive or duplicate rotation axes reject',()=>{assert.throws(()=>C.planeRotate(Array(9).fill(0),1,3,0,8,1));assert.throws(()=>C.planeRotate(Array(9).fill(0),1,3,1,1,1));});
ok('depth cue is centred and bounded, invalid spans do not drive motion',()=>{assert.equal(C.depthProxy(.2,.2),0);assert.ok(C.depthProxy(.4,.2)>0);assert.equal(C.depthProxy(1e10,.2),1.5);assert.equal(C.depthProxy(NaN,.2),0);});
ok('recorder codec is chosen by capability',()=>{assert.equal(C.recordingType(null),null);assert.equal(C.recordingType({isTypeSupported:t=>t==='video/mp4'}),'video/mp4');});
const t=new C.HistoryTape({maxFrames:2,maxBytes:20000});
ok('history is opt-in',()=>assert.equal(t.add({a:1},5),false));t.start(100);
ok('capture copies input without retaining mutable references',()=>{const s={q:[1,2]};t.add(s,101);s.q[0]=100;assert.equal(t.frames[0].state.q[0],1);});
ok('rolling frame budget and monotonic clock are enforced',()=>{t.add({q:[3]},102);t.add({q:[4]},103);assert.equal(t.frames.length,2);assert.equal(t.dropped,1);assert.equal(t.add({},102),false);});
ok('export distinguishes discrete state from camera video',()=>{assert.equal(t.export().cameraFrames,false);assert.match(t.export().sampling,/discrete/);});t.stop();
const imported=new C.HistoryTape();await imported.import(t.export(),s=>assert.ok(s.q));ok('history round-trips states',()=>assert.deepEqual(imported.export().frames,t.export().frames));
const original=JSON.stringify(imported.export());const invalid=JSON.parse(original);invalid.frames[1].t=invalid.frames[0].t;
await assert.rejects(()=>imported.import(invalid,()=>{}));ok('failed import is atomic',()=>assert.equal(JSON.stringify(imported.export()),original));
await assert.rejects(()=>imported.import({...t.export(),cameraFrames:true},()=>{}));ok('mixed camera payload format rejects',()=>assert.equal(JSON.stringify(imported.export()),original));
await assert.rejects(()=>imported.import(t.export(),()=>{throw Error('bad state')}));ok('underlying state validation failure is atomic',()=>assert.equal(JSON.stringify(imported.export()),original));
ok('per-checkpoint memory limit rejects before retention',()=>{const v=new C.HistoryTape({maxBytes:40});v.start(0);assert.throws(()=>v.add({x:'a'.repeat(100)},1));assert.equal(v.frames.length,0);});
const race=new C.HistoryTape();let resume;const pending=race.import({format:'matumbo-history',version:1,cameraFrames:false,frames:[{t:0,state:{q:[1]}}]},()=>new Promise(r=>resume=r));race.start(50);race.add({q:[9]},51);resume();await assert.rejects(()=>pending);ok('a new recording cannot be overwritten by an earlier asynchronous import',()=>assert.equal(race.frames[0].state.q[0],9));
fs.mkdirSync(path.join(process.cwd(),'studio-test-results'),{recursive:true});fs.writeFileSync(path.join(process.cwd(),'studio-test-results/core.json'),JSON.stringify({passed:tests.length,tests},null,2));
})().catch(e=>{console.error(e);process.exit(1);});
