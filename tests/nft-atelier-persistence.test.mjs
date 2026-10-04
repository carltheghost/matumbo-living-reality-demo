import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNftAtelier, createNftAtelierContribution,
  NFT_ATELIER_STORAGE_KEY, NFT_ATELIER_MAX_PIECES, NFT_ATELIER_MAX_BACKUP_BYTES,
} from '../src/domains/nft-atelier.js';
import { sha256Hex } from '../src/domains/token-sha256.js';

const NOW = '2026-10-04T12:00:00.000Z';
function fixture() {
  const values = new Map();
  const storage = {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  return {values,storage,load:()=>createNftAtelier({seed:'test',now:()=>NOW,storage})};
}
function resign(raw, mutate) {
  const {digest,...body}=JSON.parse(raw); mutate(body);
  return JSON.stringify({...body,digest:sha256Hex(JSON.stringify(body))});
}

test('local designs, attributes, burned records and next mint identity survive browser reload',()=>{
  const h=fixture(),studio=h.load();
  const authored=studio.mint({name:'Tumbo design',description:'A handmade local record',attributes:[{trait:'color',value:'blue'}]});
  studio.burn(authored.id);
  const restored=h.load();
  assert.deepEqual(restored.get(authored.id),studio.get(authored.id));
  assert.equal(restored.getSnapshot().burned,1);
  assert.equal(restored.getSnapshot().persistence.status,'restored');
  const next=restored.mint({name:'Second design'});
  assert.match(next.id,/:0005$/);
  assert.equal(h.load().get(next.id).name,'Second design');
});

test('backup import is portable and a malformed replacement is atomic',()=>{
  const source=createNftAtelier({seed:'source',now:()=>NOW,storage:null});
  source.mint({name:'Portable design'});
  const h=fixture(),target=h.load();target.mint({name:'Before import'});
  target.importState(source.exportState());
  assert.equal(target.getSnapshot().seed,'source');
  assert.deepEqual(target.list({includeBurned:true}),source.list({includeBurned:true}));
  const saved=h.values.get(NFT_ATELIER_STORAGE_KEY),before=target.exportState();
  assert.throws(()=>target.importState('{bad json'),/valid JSON/);
  assert.equal(target.exportState(),before);assert.equal(h.values.get(NFT_ATELIER_STORAGE_KEY),saved);
});

test('even a rehashed backup cannot assert transfer authority or forge mint identities',()=>{
  const studio=createNftAtelier({now:()=>NOW,storage:null}),original=studio.exportState();
  for(const mutate of [
    b=>{b.pieces[0].transferable=true;},b=>{b.pieces[0].chain=true;},
    b=>{b.pieces[0].id='nft:00000000:0001';},b=>{b.pieces[0].provenance=[];},
    b=>{b.counter=0;},b=>{b.trace=[{seq:1,action:'mint',pieceId:'unknown',detail:'x',at:NOW,simulation:true}];b.sequence=1;},
  ]) {
    assert.throws(()=>studio.importState(resign(original,mutate)),/authority|identity|provenance|limit|unsupported|history/i);
    assert.equal(studio.exportState(),original);
  }
});

test('damaged saved data is held intact until an explicit reset or validated import',()=>{
  const h=fixture();h.values.set(NFT_ATELIER_STORAGE_KEY,'broken saved data');
  const studio=h.load();assert.equal(studio.getSnapshot().persistence.status,'held');
  assert.throws(()=>studio.mint({name:'Must not overwrite'}),/held/);
  assert.equal(h.values.get(NFT_ATELIER_STORAGE_KEY),'broken saved data');
  studio.reset();assert.equal(studio.getSnapshot().persistence.status,'saved');
  assert.equal(h.load().list().length,3);
  h.values.set(NFT_ATELIER_STORAGE_KEY,'damaged again');
  const held=h.load(),backup=createNftAtelier({seed:'recovered',now:()=>NOW,storage:null}).exportState();
  held.importState(backup);assert.equal(h.load().getSnapshot().seed,'recovered');
});

test('a stale tab cannot mint, reset or import over newer authored records',()=>{
  const h=fixture(),first=h.load(),stale=h.load();
  first.mint({name:'Newer tab record'});
  const raw=h.values.get(NFT_ATELIER_STORAGE_KEY);
  for(const action of [()=>stale.mint({name:'Stale'}),()=>stale.reset(),()=>stale.importState(first.exportState())]) assert.throws(action,/Another tab/);
  assert.equal(h.values.get(NFT_ATELIER_STORAGE_KEY),raw);assert.equal(h.load().list().at(-1).name,'Newer tab record');
});

test('storage quota failure keeps the design in memory with an exportable warning',()=>{
  const storage={getItem:()=>null,setItem:()=>{throw new Error('Storage quota reached');}};
  const studio=createNftAtelier({now:()=>NOW,storage}),piece=studio.mint({name:'Still exportable'});
  assert.equal(studio.get(piece.id).name,'Still exportable');
  assert.equal(studio.getSnapshot().persistence.status,'save-failed');
  assert.match(studio.getSnapshot().persistence.error,/quota/);
  const restore=createNftAtelier({storage:null});restore.importState(studio.exportState());assert.equal(restore.get(piece.id).name,'Still exportable');
});

test('a read-only detail repaint does not consume action history or write browser storage',()=>{
  const h=fixture(),studio=h.load(),id=studio.list()[0].id;
  const before=studio.exportState();studio.inspect(id,{record:false});studio.inspect(id,{record:false});
  assert.equal(studio.exportState(),before);assert.equal(h.values.size,0);
  studio.inspect(id);assert.equal(studio.getSnapshot().trace.length,1);assert.equal(h.values.size,1);
});

test('piece capacity blocks the next mint without deleting earlier designs',()=>{
  const studio=createNftAtelier({now:()=>NOW,storage:null});
  for(let i=3;i<NFT_ATELIER_MAX_PIECES;i++)studio.mint({name:`Design ${i}`});
  const before=studio.exportState();assert.throws(()=>studio.mint({name:'Too many'}),/collection is full/);
  assert.equal(studio.exportState(),before);assert.equal(studio.list().length,NFT_ATELIER_MAX_PIECES);
});

test('static projection contributions never read or modify the authored browser collection',()=>{
  const previous=globalThis.localStorage;let accesses=0;
  globalThis.localStorage={getItem(){accesses++;throw new Error('Do not read');},setItem(){accesses++;}};
  try {assert.equal(createNftAtelierContribution().entities.length,3);assert.equal(accesses,0);}
  finally {if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});

test('a near-capacity compact backup remains exportable and importable without pretty-print expansion',()=>{
  const source=createNftAtelier({now:()=>NOW,storage:null});
  for(let i=3;i<NFT_ATELIER_MAX_PIECES;i++)source.mint({name:'N'.repeat(48),description:'D'.repeat(280),collection:'C'.repeat(48),attributes:Array.from({length:8},()=>({trait:'T'.repeat(32),value:'V'.repeat(64)}))});
  const raw=resign(source.exportState(),body=>{for(const piece of body.pieces){piece.key='K'.repeat(200);for(const event of piece.provenance)event.note='N'.repeat(200);}});
  assert.ok(Buffer.byteLength(raw,'utf8')<NFT_ATELIER_MAX_BACKUP_BYTES);
  const target=createNftAtelier({storage:null});target.importState(raw);
  const exported=target.exportState();assert.ok(Buffer.byteLength(exported,'utf8')<=NFT_ATELIER_MAX_BACKUP_BYTES);
  const roundtrip=createNftAtelier({storage:null});roundtrip.importState(exported);assert.deepEqual(roundtrip.list({includeBurned:true}),target.list({includeBurned:true}));
});

test('UTF-8 capacity blocks a new Unicode design before losing the exportable collection',()=>{
  const studio=createNftAtelier({now:()=>NOW,storage:null}),input={name:'界'.repeat(48),description:'界'.repeat(280),collection:'界'.repeat(48),attributes:Array.from({length:8},()=>({trait:'界'.repeat(32),value:'界'.repeat(64)}))};
  let blocked=false;
  for(let i=3;i<NFT_ATELIER_MAX_PIECES;i++){
    const before=studio.exportState();
    try{studio.mint(input);}catch(error){assert.match(error.message,/capacity/);assert.equal(studio.exportState(),before);blocked=true;break;}
  }
  assert.equal(blocked,true);assert.ok(Buffer.byteLength(studio.exportState(),'utf8')<=NFT_ATELIER_MAX_BACKUP_BYTES);
  const restored=createNftAtelier({storage:null});restored.importState(studio.exportState());assert.equal(restored.list().length,studio.list().length);
  const oversized=resign(studio.exportState(),body=>{for(const piece of body.pieces)piece.key='界'.repeat(200);});
  assert.ok(Buffer.byteLength(oversized,'utf8')>NFT_ATELIER_MAX_BACKUP_BYTES);assert.throws(()=>studio.importState(oversized),/bounded JSON/);
});
