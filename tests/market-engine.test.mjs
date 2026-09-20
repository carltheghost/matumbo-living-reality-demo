import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket,enterMarket,closeMarket,summarizeMarket,createMarketBook} from '../src/domains/market-engine.js';
const source={id:'test:record',title:'Test fixture, not a live feed',provider:'ESPN',sourceUrl:'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard',retrievedAt:'2026-09-05T00:00:00Z'};
const spec={id:'test',source,kind:'pool',question:'User question?',outcomes:['Yes','No'],closesAt:'2026-09-07T00:00:00Z',now:Date.parse('2026-09-05T00:00:00Z')};
test('authored personal pools have explicit provenance and no invented observation',()=>{
  const book=createMarketBook();const m=book.create({...spec,origin:'authored',author:'Creator',source:null,terms:'Participant-authored completion rule'});
  assert.equal(m.source.sourceUrl,null);assert.equal(m.source.provider,'User-authored statement');assert.equal(m.author,'Creator');assert.equal(m.settlement,false);
  assert.throws(()=>book.create({...spec}),/already/);
});
test('child creation, parent close and persistence validation use one book',()=>{
  const book=createMarketBook();book.create(spec);const child=book.create({...spec,id:'child',parentId:'test'});
  assert.equal(child.parentId,'test');assert.throws(()=>book.create({...spec,id:'orphan',parentId:'missing'}),/Parent/);
  assert.throws(()=>book.create({...spec,id:'late',parentId:'test',closesAt:'2026-09-08'}),/no later/);
  book.enter('child',{participant:'A',outcome:'Yes',now:spec.now});
  const restored=createMarketBook(JSON.parse(JSON.stringify(book.snapshot())));assert.deepEqual(restored.snapshot(),book.snapshot());
  restored.close('test');assert.throws(()=>restored.enter('child',{participant:'B',outcome:'No',now:spec.now}),/Parent is closed/);
  assert.throws(()=>restored.create({...spec,id:'blocked',parentId:'test'}),/Parent is closed/);
  assert.throws(()=>createMarketBook([{...book.snapshot()[0],parentId:'child'},book.snapshot()[1]]),/Parent/);
  assert.throws(()=>createMarketBook([{...book.snapshot()[0],state:'settled'}]),/Invalid saved state/);
});
test('pool engine records only explicit entries, rejects duplicates and locks on close',()=>{
  let m=createMarket(spec);assert.equal(m.entries.length,0);
  m=enterMarket(m,{participant:'User A',outcome:'Yes',now:spec.now});
  assert.equal(summarizeMarket(m).participants,1);assert.ok(Object.isFrozen(m.entries));
  assert.throws(()=>enterMarket(m,{participant:'user a',outcome:'No',now:spec.now}),/already/);
  m=closeMarket(m);assert.throws(()=>enterMarket(m,{participant:'B',outcome:'No',now:spec.now}),/closed/);assert.equal(m.settlement,false);
});
test('single-entry, provenance, rules and clock are validated',()=>{
  let m=createMarket({...spec,kind:'single'});m=enterMarket(m,{participant:'A',outcome:'Yes',now:spec.now});
  assert.throws(()=>enterMarket(m,{participant:'B',outcome:'No',now:spec.now}),/already/);
  assert.throws(()=>createMarket({...spec,source:null}),/public sports/);
  assert.throws(()=>createMarket({...spec,source:{...source,sourceUrl:'https://evil.example/'}}),/provenance/);
  assert.throws(()=>createMarket({...spec,outcomes:['Yes','yes']}),/distinct/);
  assert.throws(()=>createMarket({...spec,closesAt:'2026-01-01'}),/future/);
  assert.throws(()=>enterMarket(createMarket(spec),{participant:'A',outcome:'Yes',now:Date.parse(spec.closesAt)}),/closed/);
});
