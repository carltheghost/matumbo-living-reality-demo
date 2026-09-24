import test from 'node:test';
import assert from 'node:assert/strict';
import {createContractFlow} from '../src/domains/contract-flow.js';
import {createOutcomeContracts} from '../src/domains/outcome-contracts.js';
import {createContractLedger} from '../src/domains/contract-ledger.js';
import {createProposalQueue} from '../src/domains/bot-plaza.js';

const NOW = Date.parse('2026-09-24T12:00:00Z');
const EVENT = 'espn-multi-sport:soccer:eng.1:123:123:0';
function setup() {
  const desk = createOutcomeContracts({now:()=>NOW}), ledger = createContractLedger();
  const flow = createContractFlow({outcomeDesk:desk,ledger,proposalQueue:createProposalQueue({storage:null}),fetchEspnRecords:async()=>[],fetchImpl:async()=>({ok:false}),now:()=>NOW});
  const contract = desk.createContract({eventId:EVENT,eventLabel:'Home vs Away',outcomes:['HOME','AWAY'],creator:'user'});
  desk.join({contractId:contract.id,participant:'user',outcome:'HOME',stakeAmount:10});
  desk.join({contractId:contract.id,participant:'peer',outcome:'AWAY',stakeAmount:10});
  const approve = () => flow.handleContractApproved({contract,proposal:{id:'approved:1',eventId:EVENT,expiresAt:new Date(NOW-60000).toISOString()}});
  const record = {id:EVENT,providerAvailable:true,liveFetch:true,sourceUrl:'https://site.api.espn.com/event/123',retrievedAt:new Date(NOW).toISOString(),statusDetail:{completed:true,final:true},participants:[{name:'HOME',winner:true,scoreValue:2},{name:'AWAY',winner:false,scoreValue:1}]};
  return {desk,ledger,flow,contract,approve,record};
}
test('approved provider book locks, grades and settles automatically; repeated evidence does not duplicate awards',()=>{
  const {desk,flow,contract,approve,record}=setup();
  assert.equal(flow.reconcileApprovedContracts([record]).checked,0);
  approve();
  assert.equal(flow.reconcileApprovedContracts([record]).graded.length,1);
  assert.equal(desk.get(contract.id).status,'settled');
  assert.equal(desk.get(contract.id).grading.result,'HOME');
  const before=desk.listNfts().length;
  assert.equal(flow.reconcileApprovedContracts([record]).graded.length,0);
  assert.equal(desk.listNfts().length,before);
});
test('stale, missing, conflicting, mismatched and unfinished observations never resolve a book',()=>{
  const variants=[[], null, 'stale', 'incomplete', 'conflict', 'mismatch', 'unknown', 'duplicate', 'spoof'];
  for(const mode of variants){
    const {desk,flow,contract,approve,record}=setup();approve();
    if(mode==='stale')record.retrievedAt=new Date(NOW-3600000).toISOString();
    if(mode==='incomplete')record.statusDetail.completed=false;
    if(mode==='conflict')record.participants[1].winner=true;
    if(mode==='mismatch')record.participants[0].name='OTHER';
    if(mode==='unknown')record.participants.forEach(p=>p.winner=null);
    if(mode==='spoof')record.sourceUrl='https://espn.com.evil.example/results';
    const rows=mode===null||Array.isArray(mode)?[]:mode==='duplicate'?[record,record]:[record];
    const result=flow.reconcileApprovedContracts(rows);
    assert.equal(result.graded.length,0, String(mode));
    assert.equal(desk.get(contract.id).status,'locked',String(mode));
    assert.equal(desk.get(contract.id).grading,null);
  }
});
test('explicit final tie yields canonical draw refund, never guesses from missing scores',()=>{
  const {desk,flow,contract,approve,record}=setup();approve();
  record.participants.forEach(p=>{p.winner=false;p.scoreValue=1;});
  assert.equal(flow.reconcileApprovedContracts([record]).graded[0].winner,'DRAW');
  assert.equal(desk.get(contract.id).grading.kind,'refund');
});
