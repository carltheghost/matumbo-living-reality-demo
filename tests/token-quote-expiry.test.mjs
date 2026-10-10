/** Trade controls exercise issued current-engine quotes, expiry and real settlement. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTokenEngine,CONFIG,fmt,quoteHash} from '../src/domains/token.js';
import {requestTokenTradeQuote,isTokenTradeQuoteFresh,settleTokenTradeQuote} from '../src/render/token-trade.js';
function funded(){const token=createTokenEngine();token.faucet('u:trader','TUMBO',50_000,{idempotencyKey:'fund'});return token;}
const quote=(token,action='buy',amountIn=1000)=>requestTokenTradeQuote({token,action,amountIn,acct:'trader'});
function withTime(time,fn){const original=Date.now;Date.now=()=>time;try{return fn();}finally{Date.now=original;}}
test('trade quote has the actual direction, rational output, hash and expiry',()=>{
  const q=withTime(100_000,()=>quote(funded()));assert.equal(q.fromAsset,'TUMBO');assert.equal(q.toAsset,'sMIMAS');assert.equal(q.from,'u:trader');
  assert.equal(q.amountOut,Math.floor(q.amountIn*CONFIG.price.num/CONFIG.price.den));assert.equal(q.expiresAt,100_000+CONFIG.quoteTtlMs);
  assert.equal(q.hash,quoteHash(q));assert.ok(Object.isFrozen(q));
});
test('sell quote uses the reciprocal market pair',()=>{
  const q=quote(funded(),'sell');assert.equal(q.fromAsset,'sMIMAS');assert.equal(q.toAsset,'TUMBO');
  assert.equal(q.amountOut,Math.floor(q.amountIn*CONFIG.price.den/CONFIG.price.num));
});
test('invalid amounts fail explicitly and old artificial sentinels are real quotes',()=>{
  const token=funded();for(const amount of [0,-1,0.5,NaN,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>quote(token,'buy',amount));
  assert.ok(quote(token,'buy',7777));
});
test('freshness disables confirmation at the exact expiry boundary',()=>{
  const q=quote(funded());assert.equal(isTokenTradeQuoteFresh(q,q.expiresAt-1),true);assert.equal(isTokenTradeQuoteFresh(q,q.expiresAt),false);
  assert.equal(isTokenTradeQuoteFresh(q,q.expiresAt+1),false);assert.equal(isTokenTradeQuoteFresh(null),false);assert.equal(isTokenTradeQuoteFresh({expiresAt:NaN}),false);
});
test('expired confirmation returns a requote reason without moving points',()=>{
  const token=funded(),q=withTime(100_000,()=>quote(token)),count=token.ledger.journalCount();
  const result=withTime(q.expiresAt,()=>settleTokenTradeQuote(token,q));assert.equal(result.ok,false);assert.equal(result.reason,'quote-expired');
  assert.equal(token.ledger.journalCount(),count);assert.equal(token.balance('u:trader','TUMBO'),50_000);
});
test('a fresh replacement enables confirmation after expiry',()=>{
  const token=funded(),old=withTime(100_000,()=>quote(token));
  withTime(old.expiresAt+1,()=>{const fresh=quote(token);assert.notEqual(fresh.id,old.id);assert.equal(isTokenTradeQuoteFresh(old),false);
    assert.equal(isTokenTradeQuoteFresh(fresh),true);assert.equal(settleTokenTradeQuote(token,fresh).ok,true);});
});
test('fresh trade pays the configured tithe and exact integer output',()=>{
  const token=funded(),q=quote(token,'buy',10_000),result=settleTokenTradeQuote(token,q);assert.equal(result.ok,true);
  const tithe=Math.floor(q.amountIn*CONFIG.titheBps/CONFIG.titheDenominator);assert.equal(result.tx.tithe,tithe);
  assert.equal(token.balance('sys:void','TUMBO'),tithe);assert.equal(token.balance('u:trader','TUMBO'),40_000);
  assert.equal(token.balance('u:trader','sMIMAS'),q.amountOut);assert.equal(token.ledger.verifyChain().ok,true);assert.equal(fmt(2500),'2.500 TUMBO-SIM');
});
test('reconfirmation replays a single trade receipt',()=>{
  const token=funded(),q=quote(token),first=settleTokenTradeQuote(token,q),count=token.ledger.journalCount(),second=settleTokenTradeQuote(token,q);
  assert.equal(second.ok,true);assert.equal(second.tx.id,first.tx.id);assert.equal(token.ledger.journalCount(),count);
});
test('forged and cross-engine trade quotes fail without a financial mutation',()=>{
  const token=funded(),q=quote(token),count=token.ledger.journalCount(),altered={...q,amountOut:q.amountOut+1};altered.hash=quoteHash(altered);
  assert.equal(settleTokenTradeQuote(token,altered).ok,false);assert.equal(settleTokenTradeQuote(funded(),q).ok,false);assert.equal(token.ledger.journalCount(),count);
});
test('cancelled selection cannot be confirmed',()=>{
  const token=funded(),q=quote(token);token.cancelQuote(q.id);const count=token.ledger.journalCount();
  assert.equal(settleTokenTradeQuote(token,q).ok,false);assert.equal(token.ledger.journalCount(),count);
});
