import test from 'node:test';
import assert from 'node:assert/strict';
import {checkMountedPhaseCheckpoint} from '../../server/application/runtime.mjs';
const cp=()=>({spaceId:'root',shape:[8,8,8,8],lengths:[8,8,8,8],coupling:1,fields:Object.fromEntries(['portal','relic','workpiece'].map(id=>[id,{initialMass:1,chart:'flat',membership:['field.'+id]}]))});
test('mounted phase configuration is fixed8^4/domain8/default coupling/mass and exact field topology',()=>{
 assert.doesNotThrow(()=>checkMountedPhaseCheckpoint(cp()));
 for(const mutate of [c=>c.shape=[16,16,16,16],c=>c.lengths=[4,4,4,4],c=>c.coupling=2,c=>c.spaceId='inner',c=>c.fields.relic.initialMass=2,c=>c.fields.relic.membership=['another'],c=>delete c.fields.portal,c=>c.fields.extra=c.fields.portal,c=>c.fields.portal.chart='other']){
  const c=cp();mutate(c);assert.throws(()=>checkMountedPhaseCheckpoint(c),{code:'MOUNTED_PHASE_CONFIGURATION'});
 }
});
