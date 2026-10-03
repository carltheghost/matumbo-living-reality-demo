import test from 'node:test';
import assert from 'node:assert/strict';
import {frameRealitySpace} from '../src/render/reality-assembly.js';

for(const [width,height,bounds] of [[1440,1000,{center:[0,1,0],width:18,height:10}],[390,844,{center:[0,1,0],width:11,height:16}],[844,390,{center:[0,1,0],width:18,height:10}]]){
  test(`space fits both dimensions within ${width}×${height} chrome`,()=>{
    const frame=frameRealitySpace({bounds,width,height});
    const viewportHeight=2*frame.distance*Math.tan(Math.PI/6),viewportWidth=viewportHeight*width/height;
    const projectedWidth=bounds.width/viewportWidth*width,projectedHeight=bounds.height/viewportHeight*height;
    assert.ok(projectedWidth<=Math.max(160,width-(width<700?24:64)));
    assert.ok(projectedHeight<=Math.max(180,height-(width<700?270:260)));
    assert.equal(frame.target[0],bounds.center[0]);
    assert.equal(frame.target[2],bounds.center[2]);
    if(width<700){
      const projectedCenter=height/2+(frame.target[1]-bounds.center[1])/viewportHeight*height;
      assert.ok(Math.abs(projectedCenter-projectedHeight/2-220)<1e-6,'phone objects start just below the heading');
      assert.ok(projectedCenter+projectedHeight/2<=height-50,'phone objects clear bottom controls');
    }else assert.ok(frame.target[1]>bounds.center[1],'camera leaves room above the objects for the heading');
  });
}

test('paged phone spaces leave room for the heading and page controls',()=>{
  const width=390,height=844,bounds={center:[0,1,0],width:11,height:10};
  const frame=frameRealitySpace({bounds,width,height,topInset:300});
  const viewportHeight=2*frame.distance*Math.tan(Math.PI/6),projectedHeight=bounds.height/viewportHeight*height;
  const projectedCenter=height/2+(frame.target[1]-bounds.center[1])/viewportHeight*height;
  assert.ok(Math.abs(projectedCenter-projectedHeight/2-300)<1e-6);
  assert.ok(projectedCenter+projectedHeight/2<=height-50);
});
