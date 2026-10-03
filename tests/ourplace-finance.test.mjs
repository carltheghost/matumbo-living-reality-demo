import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenEngine } from '../src/domains/token.js?v=20261003-complete8';
import { createEconomicKernel, ECONOMIC_POOLS } from '../src/domains/economic-kernel.js?v=20261003-complete8';
import { createEconomicFinance } from '../src/domains/economic-finance.js?v=20261003-complete8';
import { wireOurplaceFinance } from '../src/render/ourplace-finance.js?v=20261003-complete8';

// Synthetic form/event harness verifies domain continuation logic, not browser layout.
class FormNode {
  constructor(tag, text, attrs = {}) { this.tag = tag; this.textContent = text ?? ''; this.attrs = attrs; this.children = []; this.listeners = new Map(); this.value = ''; this.disabled = false; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  change(value) { this.value = value; this.listeners.get('change')?.(); }
}
const START = 1791040000000;
function fixture() {
  const engine = createTokenEngine();
  for (const account of ['u:you','u:visitor','u:creator']) engine.faucet(account,'TUMBO',100000,{idempotencyKey:`fund:${account}`});
  engine.execute(engine.quote({action:'buy',from:'u:visitor',fromAsset:'TUMBO',toAsset:'sMIMAS',amountIn:20000}),{idempotencyKey:'collateral'});
  let now = START, sequence = 0;
  const kernel = createEconomicKernel({engine,clock:()=>now}), finance = createEconomicFinance(kernel);
  const runtime = {kernel,finance,now:()=>now,advanceClock({deltaMs}) {now+=deltaMs;},changed(){}};
  return {engine,kernel,finance,runtime,setTime(value){now=value;},mount(){
    const nodes = [], actions = new Map(), create = (tag,text,attrs) => { const node = new FormNode(tag,text,attrs); nodes.push(node); return node; };
    const ui = {runtime,create,key:prefix=>`${prefix}:${++sequence}`,actor:{value:'u:you'},status:create('div'),panes:new Map(['services','markets','credit','proof'].map(name=>[name,create('section')]))};
    ui.select = (parent,label,options,attrs) => {const node=create('select',label,attrs); node.value=options[0][0]; node.append(...options.map(([value,text])=>create('option',text,{value}))); parent.append(node); return node;};
    ui.field = (parent,label,type,value,attrs) => {const node=create(type,label,attrs);node.value=value;parent.append(node);return node;};
    ui.button = (parent,label,action,name) => {const node=create('button',label);parent.append(node);actions.set(name,{node,action});return node;};
    const controller=wireOurplaceFinance(ui);
    return {controller,actions,status:ui.status,node:attr=>nodes.find(node=>Object.hasOwn(node.attrs,attr)),record:name=>nodes.find(node=>node.attrs['data-finance-record']===name),info:name=>nodes.find(node=>node.attrs['data-finance-record-info']===name),result:name=>nodes.find(node=>node.attrs['data-finance-result']===name),click:name=>actions.get(name).action()};
  }};
}
function request(f, key='request', payer='u:you', provider='u:visitor') {return f.paymentRequest({actor:'u:creator',payer,creator:'u:creator',provider,treasury:ECONOMIC_POOLS.operations,amountFluff:2000,creatorFluff:600,providerFluff:1200,treasuryFluff:200,expiresAt:START+10000,refundUntil:START+20000,terms:'Local test service',idempotencyKey:key});}

test('one pending payment is recovered and a repeated create cannot add another obligation', () => {
  const fx=fixture(), p=request(fx.finance); fx.finance.paymentAuthorize({actor:'u:you',paymentId:p.id,idempotencyKey:'authorize'});
  const ui=fx.mount(); assert.equal(ui.record('payments-0').value,p.id); assert.equal(ui.actions.get('service-request').node.disabled,true); assert.equal(ui.actions.get('service-fulfill').node.disabled,false);
  assert.match(ui.info('payments').textContent,/Payer u:you; provider u:visitor; creator u:creator/);
  assert.match(ui.info('payments').textContent,/2\.000 TUMBO-SIM held for this service/);
  const count=fx.kernel.snapshot().commandCount;
  assert.throws(()=>ui.click('service-request'),/New service request/); assert.equal(fx.kernel.snapshot().commandCount,count); assert.equal(fx.finance.snapshot().payments.length,1);
  ui.click('service-fulfill'); assert.equal(fx.finance.snapshot().payments[0].status,'fulfilled'); assert.equal(ui.actions.get('service-fulfill').node.disabled,true);
  assert.match(ui.status.textContent,/Delivery paid creator 0\.600 TUMBO-SIM, provider 1\.200 TUMBO-SIM, operations 0\.200 TUMBO-SIM/);
  assert.doesNotMatch(ui.status.textContent,/^\s*\{/);assert.equal(JSON.parse(ui.result('services').textContent).id,p.id);ui.controller.dispose();
});

test('multiple pending records require an explicit selection and use the selected payer role', () => {
  const fx=fixture(), first=request(fx.finance), second=request(fx.finance,'request2','u:visitor','u:you'), ui=fx.mount();
  assert.equal(ui.record('payments-0').value,''); assert.equal(ui.actions.get('service-authorize').node.disabled,true); assert.throws(()=>ui.click('service-request'),/New service request/);
  ui.record('payments-0').change(second.id); ui.click('service-authorize');
  assert.equal(fx.finance.snapshot().payments.find(p=>p.id===second.id).status,'authorized'); assert.equal(fx.finance.snapshot().payments.find(p=>p.id===first.id).status,'requested'); assert.equal(fx.engine.balance('u:visitor','TUMBO'),78000);
  ui.record('payments-0').change('new'); ui.click('service-request'); assert.equal(fx.finance.snapshot().payments.length,3); ui.controller.dispose();
});

test('existing three-role refunds can continue from a freshly mounted UI', () => {
  const fx=fixture(), p=request(fx.finance);fx.finance.paymentAuthorize({actor:'u:you',paymentId:p.id,idempotencyKey:'authorize'});fx.finance.paymentFulfill({actor:'u:visitor',paymentId:p.id,evidence:'Delivered',idempotencyKey:'deliver'});
  fx.finance.paymentRefundRequest({actor:'u:you',paymentId:p.id,reason:'Returned',idempotencyKey:'refund-request'});
  const ui=fx.mount(); assert.match(ui.info('payments').textContent,/0\/3 affected payees approved/);
  assert.match(ui.info('payments').textContent,/Approval does not reserve payee funds/);
  for(const [index,role] of ['creator','provider','operations'].entries()) {ui.click(`service-refund-${role}`);assert.match(ui.info('payments').textContent,new RegExp(`${index+1}/3 affected payees approved`));}
  assert.equal(ui.actions.get('service-refund').node.disabled,false);
  ui.click('service-refund'); assert.equal(fx.finance.snapshot().payments[0].status,'refunded'); assert.equal(fx.engine.balance('u:you','TUMBO'),100000);assert.match(ui.status.textContent,/2\.000 TUMBO-SIM returned to u:you/); ui.controller.dispose();
});

test('restored partial orders supply remaining lots and both reservations can be cancelled explicitly', () => {
  const fx=fixture(), f=fx.finance;
  const base={baseAsset:'sMIMAS',quoteAsset:'TUMBO',lots:5,lotSizeFluff:1000,priceNumeratorFluff:100,expiresAt:START+10000};
  const buy=f.orderPlace({...base,side:'BUY',actor:'u:you',idempotencyKey:'buy'}), sell=f.orderPlace({...base,side:'SELL',actor:'u:visitor',idempotencyKey:'sell'});
  f.orderMatch({actor:'u:you',buyOrderId:buy.id,sellOrderId:sell.id,lots:2,idempotencyKey:'match'});
  const ui=fx.mount(); assert.equal(ui.record('orders-1').value,buy.id); assert.equal(ui.record('orders-2').value,sell.id); assert.equal(ui.node('data-order-lots').value,'3');
  assert.throws(()=>ui.click('order-buy'),/New buy order/); ui.click('order-cancel'); ui.click('order-sell-cancel'); assert.equal(f.snapshot().orders.every(o=>o.status==='cancelled'),true); ui.controller.dispose();
});

test('a saved active loan resumes its offer link and full debt repayment without another borrowing command', () => {
  const fx=fixture(),f=fx.finance;
  for(const source of ['a','b'])f.oracleObserve({actor:`b:oracle-${source}`,source,baseAsset:'sMIMAS',quoteAsset:'TUMBO',numerator:1,denominator:10,observedAt:START,evidence:'Local unit fixture',idempotencyKey:`obs:${source}`});
  const offer=f.loanOffer({actor:'u:you',asset:'TUMBO',collateralAsset:'sMIMAS',capitalFluff:20000,maxLtvBps:6000,termMs:10000,expiresAt:START+10000,interestKind:'FIXED',fixedInterestFluff:50,terms:'Local fixture',oracle:{sources:[{source:'a',observer:'b:oracle-a'},{source:'b',observer:'b:oracle-b'}],maxAgeMs:1000},idempotencyKey:'offer'});
  const loan=f.loanBorrow({actor:'u:visitor',offerId:offer.id,principalFluff:5000,collateralFluff:100000,idempotencyKey:'borrow'}),ui=fx.mount();
  assert.equal(ui.record('loans-5').value,loan.id); assert.equal(ui.record('offers-4').value,offer.id); assert.equal(ui.actions.get('loan-borrow').node.disabled,true); assert.throws(()=>ui.click('loan-borrow'),/New collateralized loan/);
  assert.match(ui.info('loans').textContent,/Borrower u:visitor; lender u:you/);assert.match(ui.info('loans').textContent,/5\.050 TUMBO-SIM debt remains; 100\.000 sMIMAS \(demo\) collateral held/);
  assert.match(ui.record('loans-5').children.find(node=>node.attrs.value===loan.id).textContent,/borrower u:visitor/);
  ui.click('loan-repay'); assert.equal(f.snapshot().loans[0].status,'repaid'); ui.click('loan-offer-cancel'); assert.equal(f.snapshot().offers[0].status,'cancelled'); ui.controller.dispose();
});

test('saved proposal ids, outcome and immutable question resume exact independent approvals', () => {
  const fx=fixture(),f=fx.finance;
  const m=f.predictionCreate({actor:'u:you',resolver:'u:resolver',reviewer:'u:reviewer',question:'Actual saved question',evidenceSpec:'Local evidence',closeAt:START+1000,resolutionAt:START+1000,challengeMs:1000,idempotencyKey:'market'});
  f.predictionStake({actor:'u:you',marketId:m.id,outcome:'YES',amountFluff:1000,idempotencyKey:'stake'});fx.setTime(START+1000);
  const p=f.predictionPropose({actor:'u:resolver',marketId:m.id,outcome:'INVALID',evidence:'Saved invalid evidence',idempotencyKey:'proposal'}),ui=fx.mount();
  assert.equal(ui.record('markets-3').value,m.id); assert.equal(ui.node('data-prediction-question').value,'Actual saved question'); assert.equal(ui.node('data-prediction-question').disabled,true); assert.equal(ui.node('data-prediction-outcome').value,'INVALID'); assert.equal(ui.node('data-prediction-evidence').value,p.proposal.evidence);
  ui.click('prediction-approve-resolver'); ui.click('prediction-approve-reviewer');fx.setTime(START+2000);ui.controller.refresh();ui.click('prediction-finalize'); assert.equal(f.snapshot().markets[0].status,'finalized');assert.equal(fx.engine.balance('u:you','TUMBO'),100000); ui.controller.dispose();
});

test('expired reservations explain the remaining obligation and retain cancellation as the available release', () => {
  const fx=fixture(), p=request(fx.finance);fx.finance.paymentAuthorize({actor:'u:you',paymentId:p.id,idempotencyKey:'authorize'});fx.setTime(START+10001);
  const ui=fx.mount();assert.equal(ui.actions.get('service-fulfill').node.disabled,true);assert.equal(ui.actions.get('service-cancel').node.disabled,false);
  assert.match(ui.info('payments').textContent,/2\.000 TUMBO-SIM held.*Authorization expired; the payer can cancel to release the reserve/);
  ui.click('service-cancel');assert.equal(fx.engine.balance('u:you','TUMBO'),100000);assert.match(ui.status.textContent,/reserve was released to u:you/);ui.controller.dispose();
});

test('local margin liquidation exposes unsecured residual debt and preserves its full inspectable result', () => {
  const fx=fixture(),ui=fx.mount();ui.click('oracle-record');ui.click('loan-offer');ui.click('loan-borrow');
  fx.setTime(START+1);ui.node('data-oracle-price').value='0.010';ui.click('oracle-record');ui.click('loan-default');ui.click('loan-liquidate');
  const loan=fx.finance.snapshot().loans[0];assert.equal(loan.status,'liquidated');assert.equal(loan.remainingDebtFluff,4050);assert.equal(loan.heldCollateralFluff,0);
  assert.match(ui.info('loans').textContent,/Collateral transferred in kind at a local fixture valuation/);assert.match(ui.status.textContent,/4\.050 TUMBO-SIM debt remains, unsecured; this is not cash recovery/);
  assert.equal(JSON.parse(ui.result('credit').textContent).remainingDebtFluff,4050);assert.equal(ui.actions.get('loan-repay').node.disabled,false);ui.controller.dispose();
});

test('accepted exact deadlines beyond the calendar display range remain inspectable after reload', () => {
  const fx=fixture(),f=fx.finance;
  const p=f.paymentRequest({actor:'u:creator',payer:'u:you',creator:'u:creator',provider:'u:visitor',treasury:ECONOMIC_POOLS.operations,amountFluff:2000,creatorFluff:600,providerFluff:1200,treasuryFluff:200,expiresAt:START+1000,refundUntil:Number.MAX_SAFE_INTEGER,terms:'Exact local deadline fixture',idempotencyKey:'long-deadline'});
  f.paymentAuthorize({actor:'u:you',paymentId:p.id,idempotencyKey:'authorize'});f.paymentFulfill({actor:'u:visitor',paymentId:p.id,evidence:'Delivered',idempotencyKey:'deliver'});
  const ui=fx.mount();assert.match(ui.info('payments').textContent,/9007199254740991 ms since rehearsal epoch/);assert.equal(ui.actions.get('service-refund-request').node.disabled,false);ui.controller.dispose();
});

test('fully covered liquidation discloses the in-kind transfer even when the domain marks debt repaid', () => {
  const fx=fixture(),ui=fx.mount();ui.click('oracle-record');ui.click('loan-offer');ui.click('loan-borrow');
  const id=fx.finance.snapshot().loans[0].id;fx.setTime(START+3600000);ui.click('oracle-record');fx.finance.loanDefault({actor:'u:you',loanId:id,reason:'maturity',idempotencyKey:'maturity'});ui.controller.refresh();
  const cashBefore=fx.engine.balance('u:you','TUMBO');ui.click('loan-liquidate');const loan=fx.finance.snapshot().loans[0];
  assert.equal(loan.status,'repaid');assert.equal(loan.remainingDebtFluff,0);assert.equal(loan.seizedCollateralFluff,50500);assert.equal(loan.returnedCollateralFluff,49500);assert.equal(fx.engine.balance('u:you','TUMBO'),cashBefore);
  assert.match(ui.info('loans').textContent,/Collateral transferred in kind at a local fixture valuation/);assert.match(ui.status.textContent,/50\.500 sMIMAS \(demo\) seized; 49\.500 sMIMAS \(demo\) returned\. No debt remains; this is not cash recovery/);
  assert.equal(JSON.parse(ui.result('credit').textContent).liquidatedAt,START+3600000);ui.controller.dispose();
});

test('restored reverse-pair orders explain the actual matched asset denominations', () => {
  const fx=fixture(),base={baseAsset:'TUMBO',quoteAsset:'sMIMAS',lots:5,lotSizeFluff:1000,priceNumeratorFluff:100,expiresAt:START+10000};
  fx.finance.orderPlace({...base,side:'BUY',actor:'u:visitor',idempotencyKey:'reverse-buy'});fx.finance.orderPlace({...base,side:'SELL',actor:'u:you',idempotencyKey:'reverse-sell'});
  const ui=fx.mount();ui.node('data-order-lots').value='2';ui.click('order-match');
  assert.match(ui.status.textContent,/2\.000 TUMBO-SIM exchanged for 0\.200 sMIMAS \(demo\)/);const record=JSON.parse(ui.result('markets').textContent);assert.equal(record.baseFluff,2000);assert.equal(record.quoteFluff,200);assert.equal(fx.finance.snapshot().orders.every(row=>row.remainingLots===3),true);ui.controller.dispose();
});

test('an offer at its exact expiry explains withdrawal while blocking another borrowing obligation', () => {
  const fx=fixture(),ui=fx.mount();ui.click('loan-offer');const offer=fx.finance.snapshot().offers[0];fx.setTime(offer.expiresAt);ui.controller.refresh();
  assert.match(ui.info('offers').textContent,/20\.000 TUMBO-SIM capital reserved.*Offer expired; withdraw unused capital/);assert.equal(ui.actions.get('loan-borrow').node.disabled,true);assert.equal(ui.actions.get('loan-offer-cancel').node.disabled,false);
  assert.throws(()=>ui.click('loan-borrow'),/expired/);assert.equal(fx.finance.snapshot().loans.length,0);ui.click('loan-offer-cancel');assert.equal(fx.engine.balance('u:you','TUMBO'),100000);ui.controller.dispose();
});
