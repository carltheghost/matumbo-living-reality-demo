import test from 'node:test';
import assert from 'node:assert/strict';
import {realityLensCopy,realityLensLabel,realityObjectSurfaceEngine} from '../src/domains/reality-object-engine.js';

const feature={id:'agent',label:'Agent',description:'Advisory features',sources:['mesh','bot-plaza'],boundary:'No execution.'};
const object={id:'agent',position:[11.25,5,28],shape:'phone',size:1.4,locked:false,open:false};

test('one shared surface model keeps feature data, identity, controls, and authority boundaries on every object',()=>{
  const surface=realityObjectSurfaceEngine.describe({feature,object,stage:3,summary:'Four advisory sources.'});
  assert.equal(surface.identitySame,true);assert.equal(surface.id,'agent');assert.deepEqual(surface.sourceRefs,['mesh','bot-plaza']);
  assert.equal(surface.positionLabel,'11.3 / 5 / 28');assert.equal(surface.state,'Mutabile');assert.equal(surface.layers.details,true);
  assert.equal(surface.controls.canMove,true);assert.equal(surface.authority.autonomousExecution,false);
  assert.throws(()=>surface.position.push(3),TypeError);
});

test('immutable objects remain enterable but cannot be reshaped, resized, or moved',()=>{
  const surface=realityObjectSurfaceEngine.describe({feature,object:{...object,locked:true}});
  assert.equal(surface.state,'Immutabile');assert.equal(surface.controls.canEnter,true);
  assert.equal(surface.controls.canReshape,false);assert.equal(surface.controls.canResize,false);assert.equal(surface.controls.canMove,false);
});

test('the same surface projector follows a selected shape and grows with its object and approach',()=>{
  const small=realityObjectSurfaceEngine.projectedBounds({shape:'phone',distance:18,viewportHeight:900});
  const close=realityObjectSurfaceEngine.projectedBounds({shape:'phone',size:3,distance:4,approachScale:2,viewportHeight:900});
  assert.ok(close.width>small.width*20);assert.ok(close.height>small.height*20);
});

test('one fitted live panel preserves every tab form while staying inside the viewport',()=>{
  const expectedAspect={phone:.86/1.5,square:1,rectangle:1.92/1.12,sphere:1,cylinder:1.36/1.64,cube:1,wave:1.92/1.12};
  for(const [shape,aspect] of Object.entries(expectedAspect)){
    const fit=realityObjectSurfaceEngine.fitPanel({shape,size:2,distance:4,approachScale:2,viewportWidth:420,viewportHeight:700});
    assert.equal(fit.shape,shape);assert.ok(fit.width<=388);assert.ok(fit.height<=524);assert.ok(fit.width>0&&fit.height>0);
    assert.ok(Math.abs(fit.width/fit.height-aspect)<.02,`${shape} preserves its own silhouette`);
    assert.equal(fit.scrollable,true);
  }
});

test('every mutable form has six finite, outward-facing live surface placements around one object',()=>{
  for(const shape of ['phone','square','rectangle','sphere','cylinder','cube','wave']){
    const faces=realityObjectSurfaceEngine.wrapLayout(shape);
    assert.deepEqual(faces.map(face=>face.id),['front','back','left','right','top','bottom']);
    for(const face of faces){
      assert.ok(face.width>0&&face.height>0,`${shape}/${face.id} has a readable surface area`);
      assert.equal(face.position.length,3);assert.equal(face.rotation.length,3);
      assert.ok([...face.position,...face.rotation].every(Number.isFinite));
      assert.ok(Object.isFrozen(face.position)&&Object.isFrozen(face.rotation));
    }
    const [front,back,left,right,top,bottom]=faces;
    assert.ok(front.position[2]>0&&back.position[2]<0);
    assert.ok(left.position[0]<0&&right.position[0]>0);
    assert.ok(top.position[1]>0&&bottom.position[1]<0);
  }
});

test('wrap layout refuses invalid thickness and always falls back to a supported form',()=>{
  assert.equal(realityObjectSurfaceEngine.wrapLayout('not-a-shape')[0].width,realityObjectSurfaceEngine.wrapLayout('rectangle')[0].width);
  assert.throws(()=>realityObjectSurfaceEngine.wrapLayout('sphere',{depthRatio:0}),/positive/);
});

test('surface identity mismatch and invalid reveal levels are rejected',()=>{
  assert.throws(()=>realityObjectSurfaceEngine.describe({feature,object:{...object,id:'other'}}),/identity/);
  assert.throws(()=>realityObjectSurfaceEngine.describe({feature,object,stage:4}),/stage/);
});

test('Reality Lens display names remove the old world wording while preserving feature IDs',()=>{
  assert.equal(realityLensLabel('block-world'),'Materia / Fabrica');
  assert.equal(realityLensLabel('world-events'),'Eventa');
  assert.equal(realityLensCopy('one world, many worlds'),'one locus, many loca');
  assert.equal(realityObjectSurfaceEngine.describe({feature,object}).id,'agent');
});
