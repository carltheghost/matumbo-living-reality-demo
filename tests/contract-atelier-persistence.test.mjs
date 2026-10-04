import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentContractAtelier, CONTRACT_ATELIER_STORAGE_KEY } from '../src/domains/contract-atelier-persistence.js';
const NOW=Date.parse('2026-10-04T12:00:00Z');
function fixture(){
  let now=NOW;const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  return {values,storage,load:()=>createPersistentContractAtelier({storage,seed:'manual',now:()=>now}),advance:()=>{now+=1000;}};
}
const create=studio=>studio.createContract({type:'yes_no',role:'house',topic:'custom',title:'Tumbo manual contract',logic:'accepted',houseMode:'pool'});

test('manual house funding, trading, sales and resolution replay after reload without another engine',()=>{
  const h=fixture(),studio=h.load(),contract=create(studio);
  studio.joinHousePool({contractId:contract.id,participant:'Tumbo',capital:60});
  studio.joinHousePool({contractId:contract.id,participant:'Visitor',capital:40});
  h.advance();const position=studio.placeStake({contractId:contract.id,participant:'Player',side:'YES',amount:20});
  studio.sellPosition({contractId:contract.id,positionId:position.id,participant:'Player',shares:5});
  h.advance();studio.resolveContract({contractId:contract.id,facts:{accepted:true}});
  const restored=h.load();assert.deepEqual(restored.list(),studio.list());
  assert.equal(restored.get(contract.id).resolution.payouts[0].amount,15);
  assert.equal(restored.getSnapshot().commandCount,6);assert.equal(restored.getSnapshot().persistence.status,'restored');
  assert.throws(()=>restored.placeStake({contractId:contract.id,side:'YES',amount:1}),/resolved/);
});

test('pool and multi-outcome manual stake records preserve exact payouts in a portable backup',()=>{
  const source=createPersistentContractAtelier({storage:null,now:()=>NOW}),contract=source.createContract({type:'pool',title:'Pool',logic:'done',outcomes:['YES','NO']});
  source.placeStake({contractId:contract.id,side:'YES',amount:5});source.placeStake({contractId:contract.id,side:'NO',amount:10});source.resolveContract({contractId:contract.id,facts:{done:true}});
  const h=fixture(),target=h.load();target.importState(source.exportState());
  assert.deepEqual(target.list(),source.list());assert.equal(target.get(contract.id).resolution.payouts[0].amount,15);
  const before=target.exportState(),saved=h.values.get(CONTRACT_ATELIER_STORAGE_KEY);
  assert.throws(()=>target.importState('{broken'),/valid JSON/);assert.equal(target.exportState(),before);assert.equal(h.values.get(CONTRACT_ATELIER_STORAGE_KEY),saved);
});

test('manual persistence failure is atomic and a successful retry does not duplicate the market',()=>{
  const h=fixture(),studio=h.load(),write=h.storage.setItem;
  h.storage.setItem=()=>{throw new Error('Quota full');};
  assert.throws(()=>create(studio),/was not changed.*Quota full/);
  assert.equal(studio.getSnapshot().commandCount,0);assert.equal(studio.list().length,3);
  h.storage.setItem=write;create(studio);assert.equal(studio.list().length,4);assert.equal(h.load().list().length,4);
});

test('unknown commands, mismatched state digests and invalid replay terms leave saved history intact',()=>{
  const h=fixture(),studio=h.load();create(studio);const original=studio.exportState();
  for(const mutate of [j=>{j.commands[0].method='executeRemote';},j=>{j.stateDigest='forged';},j=>{j.commands[0].input.houseCapital=-1;},j=>{j.commands[0].input.wallet='real';},j=>{j.simulation=false;}]){
    const journal=JSON.parse(original);mutate(journal);assert.throws(()=>studio.importState(JSON.stringify(journal)));
    assert.equal(studio.exportState(),original);
  }
});

test('a damaged manual journal remains held until explicit valid import or manual reset',()=>{
  const h=fixture();h.values.set(CONTRACT_ATELIER_STORAGE_KEY,'damaged original');const held=h.load();
  assert.equal(held.getSnapshot().persistence.status,'held');assert.throws(()=>create(held),/held/);assert.equal(h.values.get(CONTRACT_ATELIER_STORAGE_KEY),'damaged original');
  held.reset();assert.equal(h.load().getSnapshot().commandCount,0);
});

test('stale manual tabs cannot change or reset newer records and can explicitly reload the owner',()=>{
  const h=fixture(),first=h.load(),stale=h.load();const contract=create(first),raw=h.values.get(CONTRACT_ATELIER_STORAGE_KEY);
  assert.throws(()=>create(stale),/Another tab/);assert.throws(()=>stale.reset(),/Another tab/);assert.throws(()=>stale.importState(first.exportState()),/Another tab/);
  assert.equal(h.values.get(CONTRACT_ATELIER_STORAGE_KEY),raw);
  stale.reloadFromStorage();assert.equal(stale.get(contract.id).title,contract.title);
  stale.placeStake({contractId:contract.id,side:'YES',amount:1});assert.equal(h.load().get(contract.id).positions.length,1);
});

test('read-only snapshots and contributions do not add replay commands or rewrite saved history',()=>{
  const h=fixture(),studio=h.load();create(studio);const raw=h.values.get(CONTRACT_ATELIER_STORAGE_KEY);
  studio.getSnapshot();studio.list();studio.createContribution();
  assert.equal(h.values.get(CONTRACT_ATELIER_STORAGE_KEY),raw);assert.equal(studio.getSnapshot().commandCount,1);
});
