import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTrackingInteraction} from '../src/domains/tracking-interaction.js';
function setup(){
  let now=0,active=true,target={kind:'space',id:'network',dwellAllowed:true};const calls=[],focus=[];
  const input=createTrackingInteraction({clock:()=>now,isActive:()=>active,dispatch:event=>{calls.push(event);return {target};},onFocus:state=>focus.push(state)});
  const hands=(events=[],names=['Left'],source='a')=>input.handleHands({timestamp:now,source:{id:source},hands:names.map(handedness=>({handedness,landmarks:Array.from({length:21},()=>({x:.4,y:.4}))})),lensEvents:events});
  const pinch=(type,hand='Left',x=.4,y=.4)=>({type,hand,x,y});
  return {input,calls,focus,hands,pinch,setNow:value=>now=value,setActive:value=>active=value,setTarget:value=>target=value,gaze:(point={x:.5,y:.5})=>input.handleGaze({valid:true,point,timestamp:now})};
}
test('a hand already pinched on startup must open before it can act',()=>{
  const s=setup();s.hands([s.pinch('pinchstart')]);assert.equal(s.calls.some(c=>c.type==='down'),false);
  s.hands([s.pinch('pinchend')]);s.hands([s.pinch('pinchstart')]);s.hands([s.pinch('pinchend')]);
  assert.equal(s.calls.filter(c=>c.type==='down').length,1);assert.equal(s.calls.filter(c=>c.type==='up').length,1);
});
test('occlusion cancels held input instead of clicking or committing',()=>{
  const s=setup();s.hands();s.hands([s.pinch('pinchstart')]);s.hands([s.pinch('pinchend')],[]);
  assert.equal(s.calls.some(c=>c.type==='up'),false);assert.equal(s.calls.at(-1).reason,'hand-lost');
});
test('a hand must open again after disappearing before a new pinch can act',()=>{
  const s=setup();s.hands();s.hands([],[]);s.hands([s.pinch('pinchstart')]);
  assert(!s.calls.some(c=>c.type==='down'));
});
test('loss pinchend cannot arm an already closed startup hand',()=>{
  const s=setup();s.hands([s.pinch('pinchstart')]);
  s.setNow(40);s.hands([s.pinch('pinchend')],[]);
  s.setNow(80);s.hands([s.pinch('pinchstart')]);
  assert(!s.calls.some(c=>c.type==='down'));assert.equal(s.input.snapshot().held,null);
  s.hands([s.pinch('pinchend')]);s.hands([s.pinch('pinchstart')]);
  assert.equal(s.calls.filter(c=>c.type==='down').length,1,'opening the visible hand arms the next intentional pinch');
});
test('a delayed model result cannot act on a frame captured before the current interaction',()=>{
  const s=setup();s.hands();s.setNow(1000);
  s.input.handleHands({timestamp:100,source:{id:'a'},hands:[{handedness:'Left'}],lensEvents:[s.pinch('pinchstart')]});
  assert(!s.calls.some(c=>c.type==='down'));assert.equal(s.calls.at(-1).reason,'hand-frame-stale');
});
test('source replacement and a stalled frame cancel a held drag',()=>{
  const s=setup();s.hands();s.hands([s.pinch('pinchstart')]);s.hands([],['Left'],'b');assert.equal(s.input.snapshot().held,null);
  s.hands([s.pinch('pinchstart')],['Left'],'b');s.setNow(701);s.input.tick();assert.equal(s.input.snapshot().held,null);assert.equal(s.calls.at(-1).reason,'tracking-stale');
});
test('inactive assembly hands remain available for the legacy owner',()=>{
  const s=setup();s.setActive(false);assert.equal(s.hands(),false);s.setActive(true);assert.equal(s.hands(),true);
});
test('suspended or unarmed video input cannot fall through into the legacy world',()=>{
  const s=setup();s.input.configure({enabled:false});s.setActive(false);
  assert.equal(s.hands([s.pinch('pinchstart')]),true);assert(!s.calls.some(c=>c.type==='down'));
});
test('two handed scale and roll are incremental bounded transforms',()=>{
  const s=setup();s.input.configure({arrange:true});s.hands([],['Left','Right']);
  s.hands([s.pinch('pinchstart','Left',.2,.4),s.pinch('pinchstart','Right',.6,.4)],['Left','Right']);
  s.hands([s.pinch('pinchmove','Right',.8,.5)],['Left','Right']);
  assert.equal(s.calls.find(c=>c.type==='scale').factor,1.1);assert.equal(s.calls.find(c=>c.type==='rotate').radians,.15);
  assert(s.calls.filter(c=>c.type==='scale'||c.type==='rotate').every(c=>c.arrange));
});
test('gaze aiming locks its selection point while the hand moves',()=>{
  const s=setup();s.input.configure({gazePinch:true});s.hands();s.gaze({x:.7,y:.6});s.hands([s.pinch('pinchstart')]);
  const down=s.calls.find(c=>c.type==='down');assert.equal(down.x,.7);assert.equal(down.y,.6);
  s.gaze({x:.1,y:.1});s.hands([s.pinch('pinchmove','Left',.5,.5)]);
  const move=s.calls.find(c=>c.type==='move');assert(Math.abs(move.x-.8)<1e-9);assert(Math.abs(move.y-.7)<1e-9);
});
test('stale gaze cannot confirm a pinch',()=>{
  const s=setup();s.input.configure({gazePinch:true});s.hands();s.gaze();s.setNow(351);s.hands([s.pinch('pinchstart')]);assert(!s.calls.some(c=>c.type==='down'));
});
test('dwell is explicitly armed, navigation-only and requires looking away to repeat',()=>{
  const s=setup();s.gaze();s.setNow(2000);s.gaze();assert(!s.calls.some(c=>c.type==='activate'));
  s.input.configure({dwell:true});s.gaze();s.setNow(3900);s.gaze();assert.equal(s.calls.filter(c=>c.type==='activate').length,1);
  s.setNow(6000);s.gaze();s.setNow(9000);s.gaze();assert.equal(s.calls.filter(c=>c.type==='activate').length,1);
  s.setTarget({kind:'control',id:'send',dwellAllowed:false});s.gaze();s.setNow(12000);s.gaze();assert.equal(s.calls.filter(c=>c.type==='activate').length,1);
  s.setTarget({kind:'space',id:'network',dwellAllowed:true});s.gaze();s.setNow(14000);s.gaze();assert.equal(s.calls.filter(c=>c.type==='activate').length,2);
});
test('invalid eyes, a hand, or controls suspension interrupts dwell',()=>{
  const s=setup();s.input.configure({dwell:true});s.gaze();s.setNow(1700);s.input.handleGaze({valid:false,timestamp:1700});s.setNow(2000);s.gaze();
  assert(!s.calls.some(c=>c.type==='activate'));s.hands();s.setNow(2300);s.gaze();assert(!s.calls.some(c=>c.type==='activate'));
  s.input.configure({enabled:false});s.setNow(10000);s.gaze();assert(!s.calls.some(c=>c.type==='activate'));
});
