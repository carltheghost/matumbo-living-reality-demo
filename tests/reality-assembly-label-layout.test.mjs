import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblySideLabelPoint,placeAssemblyLabel,shouldShowRealityObjectLabel} from '../src/render/reality-assembly.js';

test('object labels sit a consistent margin beside either side of the object',()=>{
  assert.deepEqual(assemblySideLabelPoint({position:[3,4,5],cameraRight:[1,0,0],halfWidth:1.2,side:1}),[4.68,4,5]);
  assert.deepEqual(assemblySideLabelPoint({position:[3,4,5],cameraRight:[0,2,0],halfWidth:1.2,side:-1}),[3,2.32,5]);
});

test('side labels reject invalid projection inputs instead of drifting away',()=>{
  assert.throws(()=>assemblySideLabelPoint({position:[0,NaN,0],cameraRight:[1,0,0]}),/position/);
  assert.throws(()=>assemblySideLabelPoint({position:[0,0,0],cameraRight:[0,0,0]}),/axis/);
});

const project=(overrides={})=>placeAssemblyLabel({
  ndcX:0,ndcY:0,ndcZ:0,
  viewportWidth:400,viewportHeight:300,
  safeTop:8,safeBottom:292,
  labelWidth:100,labelHeight:28,
  ...overrides,
});

test('an isolated tab label stays centered on its projected feature',()=>{
  assert.deepEqual(project(),{visible:true,x:200,y:150,preferredX:200,preferredY:150,offset:0});
});

test('colliding labels move to the nearest open screen pocket and retain their anchor point',()=>{
  const placement=project({occupied:[{left:150,right:250,top:136,bottom:164}]});
  assert.equal(placement.visible,true);
  assert.equal(placement.x,200);
  assert.equal(placement.y,112);
  assert.equal(placement.preferredX,200);
  assert.equal(placement.preferredY,150);
  assert.ok(placement.y+14<136);
});

test('tab labels yield to overlays and previously placed labels',()=>{
  const placement=project({occupied:[
    {left:150,right:250,top:136,bottom:164},
    {left:150,right:250,top:98,bottom:126},
  ]});
  assert.equal(placement.visible,true);
  assert.equal(placement.y,188);
  assert.ok(placement.y-14>164);
});

test('a label is hidden only when the viewport has no collision-free slot',()=>{
  const placement=project({viewportWidth:100,viewportHeight:100,safeTop:8,safeBottom:92,labelWidth:80,labelHeight:80,occupied:[{left:0,right:100,top:0,bottom:100}]});
  assert.deepEqual(placement,{visible:false});
});

test('overview keeps feature labels inside their visible domain object',()=>{
  const tab={isTab:true,lensGroup:'network',root:{visible:false},contextOpacity:1,tabReveal:1};
  assert.equal(shouldShowRealityObjectLabel({node:tab,activeGroupId:null,objectId:'web-ai'}),false);
  tab.root.visible=true;
  assert.equal(shouldShowRealityObjectLabel({node:tab,activeGroupId:'network',objectId:'web-ai'}),true);
  assert.equal(shouldShowRealityObjectLabel({node:tab,activeGroupId:'value',objectId:'web-ai'}),false);
});

test('object labels clear when the focused living surface owns attention',()=>{
  const tab={isTab:true,lensGroup:'network',root:{visible:true},contextOpacity:.05,tabReveal:1};
  assert.equal(shouldShowRealityObjectLabel({node:tab,activeGroupId:'*',focusIsolated:true,selectedId:'bot-plaza',objectId:'web-ai'}),false);
  assert.equal(shouldShowRealityObjectLabel({node:tab,activeGroupId:'*',selectedId:'bot-plaza',objectId:'web-ai'}),false);
  assert.equal(shouldShowRealityObjectLabel({node:{...tab,contextOpacity:1},activeGroupId:'*',selectedId:'bot-plaza',objectId:'bot-plaza'}),true);
});
