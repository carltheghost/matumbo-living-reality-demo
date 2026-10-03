import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
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

for(const [width,height] of [[1440,1000],[390,844]]){
  for(const [bodyWidth,bodyHeight] of [[9,13],[15,9]]){
    test(`real camera keeps the entire ${bodyWidth}×${bodyHeight}×4 volume inside ${width}×${height} chrome`,()=>{
      const bounds={center:[2,1,-3],width:bodyWidth,height:bodyHeight,depth:4};
      const frame=frameRealitySpace({bounds,width,height}),camera=new THREE.PerspectiveCamera(60,width/height,.01,1000);
      camera.position.set(frame.target[0],frame.target[1],frame.target[2]+frame.distance);
      camera.lookAt(new THREE.Vector3(...frame.target));camera.updateMatrixWorld(true);
      const phone=width<700,inset=phone?12:32,top=phone?220:270;
      const corners=[];
      for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
        const point=new THREE.Vector3(bounds.center[0]+x*bounds.width/2,bounds.center[1]+y*bounds.height/2,bounds.center[2]+z*bounds.depth/2).project(camera);
        corners.push({x:(point.x+1)*width/2,y:(1-point.y)*height/2,z:point.z,side:z===1?'near':'far'});
      }
      for(const corner of corners){
        const evidence=`${corner.side} corner ${JSON.stringify(corner)}, frame ${JSON.stringify(frame)}`;
        assert.ok(corner.z>-1&&corner.z<1,`within camera depth: ${evidence}`);
        assert.ok(corner.x>=inset-1e-6&&corner.x<=width-inset+1e-6,`inside side margins: ${evidence}`);
        assert.ok(corner.y>=top-1e-6,`below header (${top}px): ${evidence}`);
        assert.ok(corner.y<=height-50+1e-6,`above bottom controls: ${evidence}`);
      }
    });
  }
}
