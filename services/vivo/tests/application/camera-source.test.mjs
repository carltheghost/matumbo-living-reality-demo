import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraConstraintFallbackAllowed,cameraConstraints} from '../../web/camera.js';

test('camera facing is an ideal preference, not a required built-in-camera contract',()=>{
  const preferred=cameraConstraints('environment');
  assert.deepEqual(preferred.video.facingMode,{ideal:'environment'});
  assert.equal(preferred.video.width.ideal,640);
  const generic=cameraConstraints('environment',true);
  assert.equal('facingMode' in generic.video,false);
});

test('ordinary linked or virtual cameras may retry without facing metadata',()=>{
  assert.equal(cameraConstraintFallbackAllowed({name:'OverconstrainedError'}),true);
  assert.equal(cameraConstraintFallbackAllowed({name:'NotFoundError'}),true);
  assert.equal(cameraConstraintFallbackAllowed({name:'NotAllowedError'}),false);
  assert.equal(cameraConstraintFallbackAllowed({name:'SecurityError'}),false);
});
