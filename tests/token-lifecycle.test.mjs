/** Current engine lifecycle: immutable journals, bounded reversals and pending quotes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTokenEngine,TumboUserLedger,CONFIG,fmt,REVERSE_WINDOW_TICKS,
  CancelRejectedError,ReverseWindowExpiredError,JournalNotFoundError,receiptChainHash,VOID_ACCOUNT} from '../src/domains/token.js';
import {sha256Hex} from '../src/domains/token-sha256.js';
function funded(){
  const engine=createTokenEngine(),wallet=new TumboUserLedger(engine);
  engine.faucet('u:alice','TUMBO',50_000,{idempotencyKey:'fund-alice'});
  return {engine,wallet};
}
const send=wallet=>wallet.send({from:'alice',to:'bob',amountFluff:1500,idempotencyKey:'send-1'});
const buy=engine=>engine.quote({action:'buy',from:'u:alice',fromAsset:'TUMBO',toAsset:'sMIMAS',amountIn:10_000});
function advance(engine,count){for(let i=0;i<count;i++)engine.faucet('u:clock','TUMBO',1,{idempotencyKey:'clock-'+i});}
function balanced(journal){
  const totals=new Map();for(const p of journal.postings)totals.set(p.asset,(totals.get(p.asset)??0n)+BigInt(p.amount));
  assert.ok([...totals.values()].every(total=>total===0n));
}
test('supplies come from the shared config and integer units format exactly',()=>{
  const {engine}=funded();
  for(const asset of ['TUMBO','sMIMAS']){
    const issued=engine.ledger.accounts().filter(a=>a.asset===asset&&a.account!=='sys:issuance').reduce((sum,a)=>sum+engine.balance(a.account,asset),0);
    assert.equal(issued,CONFIG.supply[asset]);
  }
  assert.equal(fmt(1500),'1.500 TUMBO-SIM');assert.equal(fmt(1),'0.001 TUMBO-SIM');
  assert.equal(sha256Hex('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('wallet send posts a balanced immutable journal and moves requested points',()=>{
  const {engine,wallet}=funded();send(wallet);const row=engine.ledger._journals.at(-1);balanced(row);assert.ok(Object.isFrozen(row));
  assert.equal(engine.balance('u:alice','TUMBO'),48_500);assert.equal(engine.balance('u:bob','TUMBO'),1500);
});
test('replay returns the existing send and changed payload fails without another journal',()=>{
  const {engine,wallet}=funded();const first=send(wallet),count=engine.ledger.journalCount();
  const replay=send(wallet);assert.equal(replay.id,first.id);assert.equal(replay.duplicate,true);assert.equal(engine.ledger.journalCount(),count);
  assert.throws(()=>wallet.send({from:'alice',to:'bob',amountFluff:1600,idempotencyKey:'send-1'}),/IDEM_MISMATCH/);
});
test('insufficient funds and system sends fail atomically',()=>{
  const {engine,wallet}=funded(),count=engine.ledger.journalCount();
  assert.throws(()=>wallet.send({from:'alice',to:'bob',amountFluff:50_001,idempotencyKey:'overdraw'}),/insufficient/);
  assert.throws(()=>wallet.send({from:'sys:treasury',to:'bob',amountFluff:1,idempotencyKey:'system'}),/user accounts/);
  assert.equal(engine.ledger.journalCount(),count);assert.equal(engine.balance('u:alice','TUMBO'),50_000);
});
test('market settlement balances both assets and credits the configured tithe',()=>{
  const {engine}=funded(),q=buy(engine),row=engine.execute(q,{idempotencyKey:'buy-1'});balanced(row);
  assert.equal(engine.balance(VOID_ACCOUNT,'TUMBO'),row.tithe);assert.equal(engine.balance('u:alice','sMIMAS'),q.amountOut);
});
test('reversal adds a compensating journal and preserves original history',()=>{
  const {engine,wallet}=funded();send(wallet);const before=engine.ledger._journals.slice();
  balanced(engine.reverse({idempotencyKey:'send-1'}));assert.deepEqual(engine.ledger._journals.slice(0,-1),before);
  assert.equal(engine.balance('u:alice','TUMBO'),50_000);assert.equal(engine.balance('u:bob','TUMBO'),0);assert.equal(engine.ledger.verifyChain().ok,true);
});
test('repeating a reversal returns one receipt without paying twice',()=>{
  const {engine,wallet}=funded();send(wallet);const first=engine.reverse({idempotencyKey:'send-1'}),count=engine.ledger.journalCount();
  assert.equal(engine.reverse({idempotencyKey:'send-1'}),first);assert.equal(engine.ledger.journalCount(),count);
  assert.throws(()=>engine.reverse({journalId:first.id}),/lifecycle journals/);
});
test('reversal at the exact journal window succeeds',()=>{
  const {engine,wallet}=funded();send(wallet);advance(engine,REVERSE_WINDOW_TICKS);
  engine.reverse({idempotencyKey:'send-1'});assert.equal(engine.balance('u:bob','TUMBO'),0);
});
test('reversal after the window fails without altering points or receipts',()=>{
  const {engine,wallet}=funded();send(wallet);advance(engine,REVERSE_WINDOW_TICKS+1);const count=engine.ledger.journalCount();
  assert.throws(()=>engine.reverse({idempotencyKey:'send-1'}),ReverseWindowExpiredError);
  assert.equal(engine.ledger.journalCount(),count);assert.equal(engine.balance('u:bob','TUMBO'),1500);
});
test('exchange reversal leaves the Void tithe intact and restores user principal',()=>{
  const {engine}=funded(),q=buy(engine),settled=engine.execute(q,{idempotencyKey:'buy-1'});engine.reverse({idempotencyKey:'buy-1'});
  assert.equal(engine.balance('u:alice','TUMBO'),50_000);assert.equal(engine.balance('u:alice','sMIMAS'),0);
  assert.equal(engine.balance(VOID_ACCOUNT,'TUMBO'),settled.tithe);assert.equal(engine.ledger.verifyChain().ok,true);
});
test('spent recipient points prevent unaffordable reversal atomically',()=>{
  const {engine,wallet}=funded();send(wallet);wallet.send({from:'bob',to:'charlie',amountFluff:1500,idempotencyKey:'spent'});
  const count=engine.ledger.journalCount();assert.throws(()=>engine.reverse({idempotencyKey:'send-1'}),/insufficient/);assert.equal(engine.ledger.journalCount(),count);
});
test('pending quote cancellation is repeatable and prevents execution',()=>{
  const {engine}=funded(),q=buy(engine),count=engine.ledger.journalCount(),cancelled=engine.cancelQuote(q.id);
  assert.equal(cancelled.cancelled,true);assert.equal(engine.cancelQuote(q.id),cancelled);
  assert.throws(()=>engine.execute(q,{idempotencyKey:'cancelled-buy'}),/cancelled/);assert.equal(engine.ledger.journalCount(),count);
});
test('settled quotes cannot be cancelled or executed under another key',()=>{
  const {engine}=funded(),q=buy(engine);engine.execute(q,{idempotencyKey:'buy-1'});const count=engine.ledger.journalCount();
  assert.throws(()=>engine.cancelQuote(q.id),CancelRejectedError);assert.throws(()=>engine.execute(q,{idempotencyKey:'buy-2'}),/already been executed/);
  assert.equal(engine.ledger.journalCount(),count);
});
test('cancellation keys cannot be reused for a different quote',()=>{
  const {engine}=funded(),first=buy(engine),second=buy(engine);engine.cancelQuote(first.id,{idempotencyKey:'cancel-1'});
  assert.throws(()=>engine.cancelQuote(second.id,{idempotencyKey:'cancel-1'}),/IDEM_MISMATCH/);
  assert.doesNotThrow(()=>engine.execute(second,{idempotencyKey:'buy-2'}));
});
test('history filters use actual action, account and asset postings',()=>{
  const {engine,wallet}=funded();send(wallet);engine.execute(buy(engine),{idempotencyKey:'buy-1'});
  const history=engine.journalHistory({action:'buy',account:'u:alice',asset:'sMIMAS'});
  assert.equal(history.rows.length,1);assert.equal(history.rows[0].action,'buy');
});
test('receipt hashes and chain links detect altered history',()=>{
  const {engine,wallet}=funded();send(wallet);assert.equal(engine.ledger.verifyChain().ok,true);
  const original=engine.ledger._journals.at(-1),altered={...original,postings:original.postings.map((p,i)=>({...p,amount:p.amount+(i===0?1:-1)}))};
  engine.ledger._journals[engine.ledger._journals.length-1]=altered;assert.equal(engine.ledger.verifyChain().reason,'hash-mismatch');
  altered.hash=receiptChainHash(altered);assert.equal(engine.ledger.verifyChain().ok,true);
  altered.prevHash='unissued-link';assert.equal(engine.ledger.verifyChain().reason,'broken-link');
});
test('unknown journals and malformed accounts fail explicitly',()=>{
  const {engine}=funded();assert.throws(()=>engine.reverse({journalId:'missing'}),JournalNotFoundError);assert.throws(()=>engine.balance('unknown','TUMBO'),/invalid account/);
});
test('wallet send observers fire once and stop after unsubscribe',()=>{
  const {wallet}=funded();let receipts=0,balances=0;const off1=wallet.on('receipt',()=>receipts++),off2=wallet.on('balance-changed',()=>balances++);
  send(wallet);assert.equal(receipts,1);assert.equal(balances,1);off1();off2();wallet.send({from:'alice',to:'bob',amountFluff:1,idempotencyKey:'send-2'});
  assert.equal(receipts,1);assert.equal(balances,1);
});
