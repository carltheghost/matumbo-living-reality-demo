import test from 'node:test';
import assert from 'node:assert/strict';
import {VivoXRIntegration} from './xr.mjs';

class FakeSession extends EventTarget{
  constructor(mode){super();this.mode=mode;this.ended=false;}
  async end(){this.ended=true;this.dispatchEvent(new Event('end'));}
}

function fakeXR(supported){
  return {
    async isSessionSupported(mode){return supported.includes(mode);},
    async requestSession(mode,init){return new FakeSession(mode);}
  };
}

test('XR capabilities are explicit and unsupported modes do not claim readiness',async()=>{
  const xr=new VivoXRIntegration({xr:fakeXR(['immersive-ar'])});
  const caps=await (async()=>{const modes={};for(const mode of xr.capabilities().modes)modes[mode]=await xr.supports(mode);return modes;})();
  assert.deepEqual(caps,{'immersive-ar':true,'immersive-vr':false});
  await assert.rejects(xr.start('immersive-vr'),error=>error.code==='XR_UNSUPPORTED');
});

test('XR lifecycle is user-initiated, observable, and ends without uploading frames',async()=>{
  const xr=new VivoXRIntegration({xr:fakeXR(['immersive-ar'])});
  const changes=[];xr.addEventListener('change',event=>changes.push(event.detail));
  const active=await xr.start('immersive-ar');
  assert.equal(active.sessionActive,true);
  assert.equal(active.cameraFramesUploaded,false);
  await xr.end();
  assert.equal(xr.capabilities().sessionActive,false);
  assert.equal(changes.at(-1).sessionActive,false);
});
