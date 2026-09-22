import test from 'node:test';
import assert from 'node:assert/strict';
import {createRealityGraph, cloneRealityState} from '../src/domains/side-living-reality.js';

const clock = () => '2026-09-22T00:00:00.000Z';

test('creates a root reality with isolated state', () => {
  const graph = createRealityGraph({rootState:{cube:{x:1}}, now:clock});
  assert.equal(graph.getNode().kind, 'root');
  assert.equal(graph.getNode().depth, 0);
  assert.deepEqual(graph.getNode().state, {cube:{x:1}});
});

test('fork creates an independent side reality', () => {
  const graph = createRealityGraph({rootState:{cube:{x:1}}, now:clock});
  const branch = graph.fork('reality:root', {id:'reality:side-a', label:'Side A'});
  graph.updateState(branch.id, {cube:{x:99}});
  assert.deepEqual(graph.getNode('reality:root').state, {cube:{x:1}});
  assert.deepEqual(graph.getNode(branch.id).state, {cube:{x:99}});
  assert.equal(branch.parentId, 'reality:root');
  assert.equal(branch.kind, 'side');
});

test('fork is directional by default', () => {
  const graph = createRealityGraph({now:clock});
  const branch = graph.fork('reality:root', {id:'reality:side-a', label:'Side A'});
  graph.travel(branch.id);
  assert.equal(graph.activeId, branch.id);
  assert.throws(() => graph.travel('reality:root'), /No reality connection/);
});

test('bidirectional fork allows return travel', () => {
  const graph = createRealityGraph({now:clock});
  const branch = graph.fork('reality:root', {id:'reality:side-a', label:'Side A', bidirectional:true});
  graph.travel(branch.id);
  graph.travel('reality:root');
  assert.equal(graph.activeId, 'reality:root');
});

test('portal connects existing realities without copying state', () => {
  const graph = createRealityGraph({rootState:{name:'root'}, now:clock});
  const a = graph.fork('reality:root', {id:'reality:a', label:'A'});
  const b = graph.fork('reality:root', {id:'reality:b', label:'B'});
  graph.connect(a.id, b.id, {type:'portal', bidirectional:true});
  graph.travel(a.id);
  assert.equal(graph.canTravel(a.id,b.id), true);
  graph.travel(b.id);
  assert.equal(graph.activeId, b.id);
  assert.deepEqual(graph.getNode(b.id).state, graph.getNode('reality:root').state);
});

test('updateState affects only the selected reality', () => {
  const graph = createRealityGraph({rootState:{value:1}, now:clock});
  const branch = graph.fork('reality:root', {id:'reality:branch', label:'Branch'});
  graph.updateState(branch.id, {value:2});
  assert.deepEqual(graph.getNode(branch.id).state, {value:2});
  assert.deepEqual(graph.getNode('reality:root').state, {value:1});
});

test('cloneRealityState is detached', () => {
  const source = {nested:{value:7}, list:[1,2]};
  const copy = cloneRealityState(source);
  copy.nested.value = 8; copy.list.push(3);
  assert.deepEqual(source, {nested:{value:7}, list:[1,2]});
});

test('unknown realities fail closed', () => {
  const graph = createRealityGraph({now:clock});
  assert.throws(() => graph.getNode('missing'), /Unknown reality/);
  assert.throws(() => graph.travel('missing'), /Unknown reality/);
  assert.throws(() => graph.updateState('missing', {}), /Unknown reality/);
});