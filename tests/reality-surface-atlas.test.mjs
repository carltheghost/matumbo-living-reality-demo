import test from 'node:test';
import assert from 'node:assert/strict';
import {createRealitySurfaceAtlas} from '../src/render/reality-surface-atlas.js';

function fixture(blocks, chartCount = 5) {
  const textures = [], materials = [], commands = [], paintedText=[];
  const context = () => ({font: '', fillText(value) {paintedText.push(String(value));}, clearRect() {}, fillRect() {}, drawImage() {},
    measureText(value) { const pixels = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 25); return {width: String(value).length * pixels * .55}; },
    createLinearGradient() { return {addColorStop() {}}; }});
  const previousDocument = globalThis.document;
  globalThis.document = {createElement: () => ({width: 0, height: 0, getContext: () => context()})};
  class CanvasTexture { constructor(image) { this.image = image; this.disposeCount = 0; this.updates = 0; textures.push(this); } set needsUpdate(value) { if (value) this.updates++; } dispose() { this.disposeCount++; } }
  class MeshBasicMaterial { constructor(options) { Object.assign(this, options); this.disposeCount = 0; materials.push(this); } dispose() { this.disposeCount++; } }
  const adapter = {read: () => blocks, activate: id => { commands.push(id); return {id}; }};
  const charts = Array.isArray(chartCount) ? chartCount : Array.from({length: chartCount}, (_, i) => ({id: `side-${i}`, label: `Side ${i + 1}`, shape: 'prism'}));
  const atlas = createRealitySurfaceAtlas({THREE: {CanvasTexture, MeshBasicMaterial, SRGBColorSpace: 'srgb', LinearFilter: 'linear'},
    charts,
    document: adapter, feature: {id: 'test', label: 'Real feature', description: 'Actual feature description'}});
  globalThis.document = previousDocument;
  return {atlas, blocks, commands, textures, materials, adapter,paintedText};
}
const uvOf = region => ({x: region.x + region.width / 2, y: 1 - region.y - region.height / 2});

test('a live board receives a whole readable chart and retains its source aspect and exact hit area', () => {
  const element={tagName:'CANVAS',width:800,height:600,toDataURL:()=> 'data:image/png;base64,ok'};
  const {atlas}=fixture([
    {id:'before',kind:'text',text:'Board controls'},
    {id:'board',kind:'canvas',text:'Original chess board',actionId:'board',element},
    {id:'after',kind:'button',text:'Reset game',actionId:'reset'},
  ],[
    {id:'cap',aspect:1,contentBounds:{x:.3,y:.4,width:.4,height:.4}},
    {id:'side',aspect:1},
  ]);
  const region=atlas.reveal('board'),chart=atlas.snapshot().charts[region.chartIndex];
  assert.equal(chart.id,'side','prefer the readable wall over a constrained cap');
  assert.deepEqual(chart.blocks.map(block=>block.blockId),['board'],'canvas owns its whole content area');
  assert.ok(Math.abs((region.width*chart.width)/(region.height*chart.height)-4/3)<1e-9);
  assert.ok(region.height>.45,'board must not collapse into a narrow strip');
  assert.equal(atlas.hit(chart.index,uvOf(region)).actionId,'board');
  assert.equal(atlas.hit(chart.index,{x:region.x-.002,y:1-region.y-region.height/2}),null,'letterboxing remains a rotation area');
  atlas.dispose();
});

test('every canonical item remains reachable exactly once across body charts and pages', () => {
  const blocks = Array.from({length: 95}, (_, i) => ({id: `canonical-${i}`, kind: 'button', text: `Actual action ${i}`, actionId: `run-${i}`}));
  const {atlas} = fixture(blocks);
  const seen = [], first = atlas.snapshot();
  assert.ok(first.pageCount > 1);
  for (let page = 0; page < first.pageCount; page++) {
    const state = atlas.snapshot();
    for (const chart of state.charts) {
      seen.push(...chart.blocks.map(block => block.blockId));
      for (const region of chart.regions) {
        assert.ok(region.x >= 0 && region.y >= 0);
        assert.ok(region.x + region.width <= 1 && region.y + region.height <= 1);
      }
    }
    if (page < first.pageCount - 1) assert.ok(atlas.scroll(100));
  }
  assert.equal(new Set(seen).size, blocks.length);
  assert.deepEqual(seen, blocks.map(block => block.id));
  assert.equal(atlas.scroll(100), false, 'last page cannot run beyond the document');
  atlas.dispose();
});

test('UV selection follows the painted rectangle and triggers exactly one canonical action', () => {
  const {atlas, commands} = fixture([{id: 'go', kind: 'button', text: 'Run the canonical action', actionId: 'go'}]);
  const chart = atlas.snapshot().charts.find(item => item.regions.some(region => region.actionId === 'go'));
  const region = chart.regions.find(item => item.actionId === 'go');
  assert.equal(atlas.hit(chart.index, uvOf(region)).actionId, 'go');
  assert.deepEqual(atlas.activate(chart.index, uvOf(region)), {id: 'go'});
  assert.deepEqual(commands, ['go']);
  assert.equal(atlas.hit(chart.index, {x: region.x - .001, y: uvOf(region).y}), null);
  assert.equal(atlas.hit(chart.index, {x: NaN, y: .5}), null);
  assert.equal(atlas.hit(chart.index, {x: .5, y: 1.01}), null);
  assert.equal(atlas.hit(-1, {x: .5, y: .5}), null);
  atlas.dispose();
});

test('disabled controls stay inert and canonical state edits repaint without allocating textures', () => {
  const fixtureState = fixture([{id: 'switch', kind: 'input', inputType: 'checkbox', checked: false, disabled: true, text: 'Switch', actionId: 'switch'}]);
  const {atlas, blocks, commands, textures, materials} = fixtureState;
  let region = atlas.snapshot().charts[0].regions.find(item => item.actionId === 'switch');
  assert.equal(atlas.activate(0, uvOf(region)), false);
  assert.deepEqual(commands, []);
  const before = textures.map(texture => texture.updates);
  assert.equal(atlas.refresh(), false);
  assert.deepEqual(textures.map(texture => texture.updates), before);
  blocks[0].disabled = false; blocks[0].checked = true;
  assert.equal(atlas.refresh(), true);
  assert.equal(textures.length, 5); assert.equal(materials.length, 5);
  region = atlas.snapshot().charts[0].regions.find(item => item.actionId === 'switch');
  assert.equal(region.disabled, false);
  atlas.activate(0, uvOf(region)); assert.deepEqual(commands, ['switch']);
  atlas.dispose(); atlas.dispose();
  assert.ok(textures.every(texture => texture.disposeCount === 1));
  assert.ok(materials.every(material => material.disposeCount === 1));
  assert.equal(atlas.refresh(), false); assert.equal(atlas.hit(0, uvOf(region)), null);
});

test('surface page buttons preserve the state owner and change only atlas pagination', () => {
  const {atlas, commands} = fixture(Array.from({length: 90}, (_, index) => ({id: String(index), kind: 'text', text: `Item ${index}`})), 3);
  const chart = atlas.snapshot().charts[2];
  const next = chart.regions.find(region => region.actionId === '@atlas:next');
  const previous = chart.regions.find(region => region.actionId === '@atlas:previous');
  assert.equal(atlas.activate(2, uvOf(previous)), false);
  assert.equal(atlas.activate(2, uvOf(next)).page, 1);
  assert.deepEqual(commands, []);
  assert.equal(atlas.scroll(-1).page, 0);
  atlas.dispose();
});

test('long information is split across pages without losing any lines; a control is never duplicated', () => {
  const {atlas} = fixture([{id: 'essay', kind: 'text', text: Array.from({length: 190}, (_, i) => `Line ${i}`).join('\n')},
    {id: 'one', kind: 'button', text: 'The only action', actionId: 'one'}], 2);
  const parts = [], actions = [];
  let lineCount = 0;
  const pages = atlas.snapshot().pageCount;
  assert.ok(pages > 2);
  for (let i = 0; i < pages; i++) {
    for (const chart of atlas.snapshot().charts) {
      parts.push(...chart.blocks.filter(block => block.blockId === 'essay').map(block => block.part));
      lineCount += chart.blocks.filter(block => block.blockId === 'essay').reduce((sum, block) => sum + block.lineCount, 0);
      actions.push(...chart.regions.filter(region => region.actionId === 'one'));
    }
    atlas.scroll(1);
  }
  assert.deepEqual(parts, Array.from({length: parts.length}, (_, i) => i));
  assert.equal(lineCount, 190);
  assert.equal(actions.length, 1);
  atlas.dispose();
});

test('cube content begins on its real front material without rearranging material indices', () => {
  const {atlas, materials} = fixture([{id: 'first', kind: 'button', text: 'Front action', actionId: 'first'}],
    ['right', 'left', 'top', 'bottom', 'front', 'back'].map(id => ({id, label: id, shape: 'cube'})));
  assert.equal(atlas.snapshot().charts[4].blocks[0].blockId, 'first');
  assert.equal(atlas.materials[4], materials[4]);
  assert.equal(atlas.snapshot().charts[0].id, 'right');
  atlas.dispose();
});

test('triangular end controls and page buttons remain inside the supplied readable bounds', () => {
  const bounds = {x: .3, y: .45, width: .4, height: .4};
  const {atlas} = fixture(Array.from({length: 20}, (_, index) => ({id: String(index), kind: 'button', text: `Action ${index}`, actionId: String(index)})),
    [{id: 'front', label: 'Triangular end', shape: 'prism', contentBounds: bounds}]);
  assert.ok(atlas.snapshot().pageCount > 1);
  for (const region of atlas.snapshot().charts[0].regions) {
    assert.ok(region.x >= bounds.x && region.x + region.width <= bounds.x + bounds.width + 1e-9);
    assert.ok(region.y >= bounds.y && region.y + region.height <= bounds.y + bounds.height + 1e-9);
  }
  atlas.dispose();
});

test('short documents distribute actual context to every side without fake data or repeated actions', () => {
  const {atlas} = fixture([{id: 'real', kind: 'button', text: 'Real control', actionId: 'real'}], 8);
  const state = atlas.snapshot();
  assert.equal(state.pageCount, 1);
  assert.ok(state.charts.every(chart => chart.blocks.length > 0));
  const ids = state.charts.flatMap(chart => chart.blocks.map(block => block.blockId));
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(state.charts.flatMap(chart => chart.regions).filter(region => region.actionId === 'real').length, 1);
  atlas.dispose();
});

test('canvas pointer regions match the image pixels rather than its caption or outer control', () => {
  const {atlas}=fixture([{id:'drawing',kind:'canvas',text:'Draw here',actionId:'drawing',pointerSurface:true}],1);
  const region=atlas.snapshot().charts[0].regions.find(item=>item.actionId==='drawing');
  assert.equal(region.pointerSurface,true);
  const hit=atlas.hit(0,uvOf(region));
  assert.ok(Math.abs(hit.subUV.x-.5)<1e-9&&Math.abs(hit.subUV.y-.5)<1e-9);
  assert.equal(atlas.hit(0,{x:region.x+region.width/2,y:1-region.y+.002}),null,'the caption is not a pointer surface');
  const corner=atlas.hit(0,{x:region.x+region.width*.01,y:1-region.y-region.height*.02});
  assert.ok(Math.abs(corner.subUV.x-.01)<1e-9&&Math.abs(corner.subUV.y-.02)<1e-9);
  atlas.dispose();
});

test('native keyboard focus can reveal an off-page canonical action and paint its focus state',()=>{
  const {atlas,blocks}=fixture(Array.from({length:50},(_,i)=>({id:String(i),kind:'button',text:`Action ${i}`,actionId:`action-${i}`})),2);
  const before=atlas.snapshot().revision;
  const target=atlas.reveal('action-49');
  assert.ok(target&&target.page>0);
  assert.equal(target.focused,true);
  assert.equal(atlas.hit(target.chartIndex,target.uv).actionId,'action-49');
  assert.ok(atlas.snapshot().revision>before);
  const previous=atlas.snapshot().revision;
  blocks[0].focused=true;assert.equal(atlas.refresh(),true);
  assert.ok(atlas.snapshot().revision>previous,'DOM focus participates in dirty detection');
  assert.equal(atlas.reveal('not-a-control'),null);
  atlas.dispose();
});

test('live values, expanded sections and selected tabs are painted from canonical state',()=>{
  const {atlas,blocks,paintedText}=fixture([
    {id:'progress',kind:'text',text:'Download',value:'7',max:'10',role:'progress'},
    {id:'section',kind:'summary',text:'Details',expanded:false,actionId:'details'},
    {id:'tab',kind:'button',text:'History',selected:false,actionId:'history'},
  ],3);
  assert.ok(paintedText.includes('7 / 10'));
  assert.ok(paintedText.includes('▸ Details'));
  paintedText.length=0;blocks[0].value='8';blocks[1].expanded=true;blocks[2].selected=true;
  assert.equal(atlas.refresh(),true);
  assert.ok(paintedText.includes('8 / 10'));
  assert.ok(paintedText.includes('▾ Details'));
  assert.ok(paintedText.includes('✓ History'));
  atlas.dispose();
});
