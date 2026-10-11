import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraConstraintFallbackAllowed,genericCameraConstraints,installCameraConstraintFallback,normalizeCameraFacing} from '../../web/application/camera-compat.mjs';

test('camera facing is an ideal preference, not a required built-in-camera contract',()=>{
  const preferred={audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:640},height:{ideal:480}}};
  const generic=genericCameraConstraints(preferred);
  assert.equal('facingMode' in generic.video,false);
  assert.equal(generic.video.width.ideal,640);
  assert.deepEqual(preferred.video.facingMode,{ideal:'environment'});
});

test('ordinary linked or virtual cameras may retry without facing metadata',()=>{
  assert.equal(cameraConstraintFallbackAllowed({name:'OverconstrainedError'}),true);
  assert.equal(cameraConstraintFallbackAllowed({name:'NotFoundError'}),true);
  assert.equal(cameraConstraintFallbackAllowed({name:'NotAllowedError'}),false);
  assert.equal(cameraConstraintFallbackAllowed({name:'SecurityError'}),false);
});

test('constraint fallback retries only recoverable device-selection failures',async()=>{
  const calls=[];const stream={getTracks:()=>[]};
  const mediaDevices={getUserMedia:async constraints=>{
    calls.push(structuredClone(constraints));
    if(calls.length===1)throw Object.assign(new Error('facing unavailable'),{name:'OverconstrainedError'});
    return stream;
  }};
  assert.equal(installCameraConstraintFallback(mediaDevices),true);
  assert.equal(await mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:640}}}),stream);
  assert.equal(calls.length,2);assert.equal('facingMode' in calls[1].video,false);

  const deniedCalls=[];const denied={getUserMedia:async constraints=>{
    deniedCalls.push(constraints);throw Object.assign(new Error('denied'),{name:'NotAllowedError'});
  }};
  installCameraConstraintFallback(denied);
  await assert.rejects(denied.getUserMedia({video:{facingMode:{ideal:'user'}}}),error=>error.name==='NotAllowedError');
  assert.equal(deniedCalls.length,1);
});

test('facing adapter reports unknown metadata instead of relabeling a linked camera',async()=>{
  const camera={video:{style:{}},stream:null,start:async function(facing){
    this.requestedFacing=facing;this.stream={getVideoTracks:()=>[{getSettings:()=>({})}]};return true;
  }};
  normalizeCameraFacing(camera);await camera.start('environment');
  assert.equal(camera.requestedFacing,'environment');assert.equal(camera.facing,null);
  assert.equal(camera.video.style.transform,'none');
});
